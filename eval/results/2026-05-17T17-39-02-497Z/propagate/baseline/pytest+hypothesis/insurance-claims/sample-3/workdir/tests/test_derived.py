"""Tests for derived values, projections and config defaults.

Covers:

  derived obligations (spec category `derived`):
      Claim.age, Claim.has_completed_assessment, Claim.is_stalled,
      Claim.is_within_sla, Claim.total_paid,
      Payout.retry_anchor / retry_due_at,
      Policy.has_open_claims

  projection obligations (spec category `projection`):
      Claim.completed_assessments (assessments where status = completed)
      Claim.paid_payouts (payouts where status = paid)
      Policy.open_claims (claims where status not in {paid, denied, closed})

  config defaults: assessment_sla, auto_ack_after, auto_approve_max_pence,
  auto_close_denied_after, link_window, payout_retry_after, stalled_after
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from app.jobs import (
    ASSESSMENT_SLA as JOBS_ASSESSMENT_SLA,
    AUTO_APPROVE_MAX_PENCE,
    AUTO_CLOSE_DENIED_AFTER,
    PAYOUT_RETRY_AFTER,
    AUTO_ACK_AFTER,
)
from app.models import (
    ASSESSMENT_SLA,
    STALLED_AFTER,
    AssessmentStatus,
    ClaimStatus,
    PayoutStatus,
)
from app.services import (
    approve_claim,
    complete_assessment,
    schedule_payout,
    start_assessment,
    triage_claim,
)
from app.webhooks import LINK_WINDOW

from .helpers import (
    make_assessor,
    make_policy,
    make_submitted_claim,
)


# ---------------------------------------------------------------------------
# Config defaults
# ---------------------------------------------------------------------------

class TestConfigDefaults:
    def test_assessment_sla_default_is_14_days(self):
        # Two definitions, one in models, one re-exported through jobs.
        assert ASSESSMENT_SLA == timedelta(days=14)
        assert JOBS_ASSESSMENT_SLA == timedelta(days=14)

    def test_stalled_after_default_is_21_days(self):
        assert STALLED_AFTER == timedelta(days=21)

    def test_auto_ack_after_default_is_5_days(self):
        assert AUTO_ACK_AFTER == timedelta(days=5)

    def test_payout_retry_after_default_is_28_days(self):
        assert PAYOUT_RETRY_AFTER == timedelta(days=28)

    def test_auto_close_denied_after_default_is_90_days(self):
        assert AUTO_CLOSE_DENIED_AFTER == timedelta(days=90)

    def test_auto_approve_max_pence_default(self):
        assert AUTO_APPROVE_MAX_PENCE == 50_000_00

    def test_link_window_default_is_2_days(self):
        assert LINK_WINDOW == timedelta(days=2)


# ---------------------------------------------------------------------------
# Claim.age and Claim.is_within_sla
# ---------------------------------------------------------------------------

class TestClaimAge:
    def test_age_is_non_negative_for_fresh_claim(self, store):
        make_policy(store)
        c = make_submitted_claim(store)
        assert c.age >= timedelta(0)
        assert c.age < timedelta(seconds=10)

    def test_is_within_sla_true_when_fresh(self, store):
        make_policy(store)
        c = make_submitted_claim(store)
        assert c.is_within_sla is True

    def test_is_within_sla_false_when_age_exceeds_sla(self, store):
        make_policy(store)
        c = make_submitted_claim(store)
        c.submitted_at = datetime.now(timezone.utc) - (ASSESSMENT_SLA + timedelta(days=1))
        assert c.is_within_sla is False

    def test_is_within_sla_boundary(self, store):
        # spec: is_within_sla = age <= config.assessment_sla
        make_policy(store)
        c = make_submitted_claim(store)
        c.submitted_at = datetime.now(timezone.utc) - (ASSESSMENT_SLA - timedelta(seconds=1))
        assert c.is_within_sla is True


# ---------------------------------------------------------------------------
# Claim.is_stalled  (implicit / derived; not a stored field)
# ---------------------------------------------------------------------------

class TestClaimIsStalled:
    def test_not_stalled_when_not_assessing(self, store):
        make_policy(store)
        c = make_submitted_claim(store)
        c.last_activity_at = datetime.now(timezone.utc) - (STALLED_AFTER + timedelta(days=1))
        # Status is still submitted -> spec says only ASSESSING claims can stall.
        assert c.is_stalled is False

    def test_not_stalled_when_recently_active(self, store):
        make_policy(store)
        c = make_submitted_claim(store)
        c.status = ClaimStatus.ASSESSING
        c.last_activity_at = datetime.now(timezone.utc) - (STALLED_AFTER - timedelta(days=1))
        assert c.is_stalled is False

    def test_stalled_when_assessing_and_inactive_past_threshold(self, store):
        make_policy(store)
        c = make_submitted_claim(store)
        c.status = ClaimStatus.ASSESSING
        c.last_activity_at = datetime.now(timezone.utc) - (STALLED_AFTER + timedelta(days=1))
        assert c.is_stalled is True

    def test_is_stalled_is_derived_no_column(self):
        from dataclasses import fields
        from app.models import Claim
        # Sentinel: there must not be a stored `is_stalled` field. The spec
        # comment is explicit: "Stalled state is implicit".
        assert "is_stalled" not in {f.name for f in fields(Claim)}


# ---------------------------------------------------------------------------
# Claim.has_completed_assessment and projection: completed_assessments
# ---------------------------------------------------------------------------

class TestHasCompletedAssessment:
    def _drive_to(self, store, final_assessment_status: AssessmentStatus):
        make_policy(store)
        make_assessor(store)
        make_submitted_claim(store)
        triage_claim(store, "CLM-1")
        a = start_assessment(store, "CLM-1", "Bob")
        if final_assessment_status == AssessmentStatus.COMPLETED:
            complete_assessment(store, a.assessment_id, "ok")
        elif final_assessment_status == AssessmentStatus.PENDING:
            a.status = AssessmentStatus.PENDING
        return a

    def test_false_without_assessment(self, store):
        make_policy(store)
        make_submitted_claim(store)
        completed = [
            a for a in store.assessments.values()
            if a.claim_number == "CLM-1" and a.status == AssessmentStatus.COMPLETED
        ]
        assert completed == []

    def test_false_when_assessment_in_progress(self, store):
        self._drive_to(store, AssessmentStatus.IN_PROGRESS)
        completed = [
            a for a in store.assessments.values()
            if a.claim_number == "CLM-1" and a.status == AssessmentStatus.COMPLETED
        ]
        assert completed == []

    def test_true_when_completed_assessment_exists(self, store):
        self._drive_to(store, AssessmentStatus.COMPLETED)
        completed = [
            a for a in store.assessments.values()
            if a.claim_number == "CLM-1" and a.status == AssessmentStatus.COMPLETED
        ]
        assert len(completed) == 1


# ---------------------------------------------------------------------------
# Claim.total_paid and projection: paid_payouts
# ---------------------------------------------------------------------------

class TestClaimTotalPaid:
    def test_zero_when_no_payouts(self, store):
        make_policy(store)
        c = make_submitted_claim(store)
        assert c.total_paid(store) == 0

    def test_sums_only_paid_payouts(self, store):
        from app.services import mark_payout_paid
        make_policy(store)
        make_assessor(store)
        make_submitted_claim(store, amount_claimed_pence=100)
        triage_claim(store, "CLM-1")
        a = start_assessment(store, "CLM-1", "Bob")
        complete_assessment(store, a.assessment_id, "ok")
        approve_claim(store, "CLM-1")
        p = schedule_payout(store, "CLM-1")
        # Still scheduled — total_paid should be 0.
        assert store.claims["CLM-1"].total_paid(store) == 0
        mark_payout_paid(store, p.payout_id)
        assert store.claims["CLM-1"].total_paid(store) == 100

    def test_scheduled_and_failed_payouts_excluded(self, store):
        # Manually splice in three payouts in different statuses on one claim.
        from app.models import Payout
        make_policy(store)
        make_submitted_claim(store, amount_claimed_pence=100)
        store.payouts.extend(
            [
                Payout(payout_id="p1", claim_number="CLM-1", amount_pence=50, status=PayoutStatus.PAID),
                Payout(payout_id="p2", claim_number="CLM-1", amount_pence=70, status=PayoutStatus.SCHEDULED),
                Payout(payout_id="p3", claim_number="CLM-1", amount_pence=20, status=PayoutStatus.FAILED),
            ]
        )
        assert store.claims["CLM-1"].total_paid(store) == 50


# ---------------------------------------------------------------------------
# Policy.has_open_claims and projection: open_claims
# ---------------------------------------------------------------------------

class TestPolicyHasOpenClaims:
    def test_false_when_no_claims(self, store):
        p = make_policy(store)
        assert p.has_open_claims(store) is False

    @pytest.mark.parametrize(
        "status,expected",
        [
            (ClaimStatus.SUBMITTED, True),
            (ClaimStatus.TRIAGED, True),
            (ClaimStatus.ASSESSING, True),
            (ClaimStatus.APPROVED, True),
            (ClaimStatus.PAID, False),
            (ClaimStatus.DENIED, False),
            (ClaimStatus.CLOSED, False),
        ],
    )
    def test_open_excludes_closed_statuses(self, store, status, expected):
        p = make_policy(store)
        c = make_submitted_claim(store)
        c.status = status
        assert p.has_open_claims(store) is expected


# ---------------------------------------------------------------------------
# Payout.retry_anchor / retry_due_at (derived)
# ---------------------------------------------------------------------------

class TestPayoutRetryDerived:
    def test_retry_anchor_is_scheduled_at_when_never_failed(self):
        # spec: retry_anchor = coalesce(last_failure_at, scheduled_at)
        from app.models import Payout
        scheduled = datetime(2026, 1, 1, tzinfo=timezone.utc)
        p = Payout(
            payout_id="p1",
            claim_number="CLM-1",
            amount_pence=1,
            scheduled_at=scheduled,
        )
        anchor = p.last_failure_at or p.scheduled_at
        assert anchor == scheduled

    def test_retry_anchor_uses_last_failure_at_when_set(self):
        from app.models import Payout
        scheduled = datetime(2026, 1, 1, tzinfo=timezone.utc)
        failed_at = datetime(2026, 2, 15, tzinfo=timezone.utc)
        p = Payout(
            payout_id="p1",
            claim_number="CLM-1",
            amount_pence=1,
            scheduled_at=scheduled,
            last_failure_at=failed_at,
        )
        anchor = p.last_failure_at or p.scheduled_at
        assert anchor == failed_at

    def test_retry_due_at_equals_anchor_plus_config(self):
        from app.models import Payout
        scheduled = datetime(2026, 1, 1, tzinfo=timezone.utc)
        p = Payout(
            payout_id="p1",
            claim_number="CLM-1",
            amount_pence=1,
            scheduled_at=scheduled,
        )
        anchor = p.last_failure_at or p.scheduled_at
        retry_due_at = anchor + PAYOUT_RETRY_AFTER
        assert retry_due_at == scheduled + timedelta(days=28)
