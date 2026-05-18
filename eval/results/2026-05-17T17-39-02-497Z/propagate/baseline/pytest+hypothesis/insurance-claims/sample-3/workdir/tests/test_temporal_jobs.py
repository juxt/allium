"""Temporal rule tests.

The spec rules

    AutoAcknowledgeJob, AssessmentSlaJob, AutoCloseDeniedJob,
    PayoutRetryJob, AutoApprovalScheduler

implement time-driven obligations. The implementations in ``app/jobs.py``
accept an optional ``now`` parameter so tests can deterministically position
themselves before, at and after each deadline rather than relying on the wall
clock.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from app.jobs import (
    ASSESSMENT_SLA,
    AUTO_APPROVE_MAX_PENCE,
    AUTO_CLOSE_DENIED_AFTER,
    PAYOUT_RETRY_AFTER,
    assessment_sla_job,
    auto_acknowledge_job,
    auto_approval_scheduler,
    auto_close_denied_job,
    payout_retry_job,
)
from app.models import (
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

from .helpers import (
    make_assessor,
    make_policy,
    make_submitted_claim,
)

NOW = datetime(2026, 5, 17, 12, 0, tzinfo=timezone.utc)


# ---------------------------------------------------------------------------
# AutoAcknowledgeJob — submitted claims auto-triaged after 5 business days
# ---------------------------------------------------------------------------

class TestAutoAcknowledgeJob:
    def test_below_threshold_no_op(self, store):
        make_policy(store)
        c = make_submitted_claim(store)
        c.submitted_at = NOW - timedelta(days=1)
        acked = auto_acknowledge_job(store, now=NOW)
        assert acked == []
        assert c.status == ClaimStatus.SUBMITTED

    def test_after_threshold_triages_claim(self, store):
        # 10 calendar days from a Monday gives >= 5 business days regardless of
        # the specific weekday alignment.
        make_policy(store)
        c = make_submitted_claim(store)
        c.submitted_at = NOW - timedelta(days=14)
        acked = auto_acknowledge_job(store, now=NOW)
        assert "CLM-1" in acked
        assert c.status == ClaimStatus.TRIAGED

    def test_only_targets_submitted_claims(self, store):
        make_policy(store)
        c = make_submitted_claim(store)
        c.submitted_at = NOW - timedelta(days=30)
        c.status = ClaimStatus.TRIAGED  # already triaged
        acked = auto_acknowledge_job(store, now=NOW)
        assert acked == []


# ---------------------------------------------------------------------------
# AssessmentSlaJob — observational, surfaces breached claims
# ---------------------------------------------------------------------------

class TestAssessmentSlaJob:
    @pytest.mark.parametrize(
        "status", [ClaimStatus.TRIAGED, ClaimStatus.ASSESSING]
    )
    def test_breach_surfaced_for_open_statuses(self, store, status):
        make_policy(store)
        c = make_submitted_claim(store)
        c.submitted_at = NOW - (ASSESSMENT_SLA + timedelta(days=1))
        c.status = status
        breached = assessment_sla_job(store, now=NOW)
        assert "CLM-1" in breached

    @pytest.mark.parametrize(
        "status",
        [
            ClaimStatus.SUBMITTED,
            ClaimStatus.APPROVED,
            ClaimStatus.DENIED,
            ClaimStatus.PAID,
            ClaimStatus.CLOSED,
        ],
    )
    def test_not_surfaced_when_not_open_status(self, store, status):
        make_policy(store)
        c = make_submitted_claim(store)
        c.submitted_at = NOW - (ASSESSMENT_SLA + timedelta(days=1))
        c.status = status
        breached = assessment_sla_job(store, now=NOW)
        assert breached == []

    def test_does_not_mutate_state(self, store):
        make_policy(store)
        c = make_submitted_claim(store)
        c.submitted_at = NOW - (ASSESSMENT_SLA + timedelta(days=1))
        c.status = ClaimStatus.TRIAGED
        original_last_activity = c.last_activity_at
        assessment_sla_job(store, now=NOW)
        assert c.status == ClaimStatus.TRIAGED
        assert c.last_activity_at == original_last_activity

    def test_boundary_inside_sla_not_surfaced(self, store):
        # spec: submitted_at + config.assessment_sla <= now (i.e. age > 14d)
        make_policy(store)
        c = make_submitted_claim(store)
        c.submitted_at = NOW - (ASSESSMENT_SLA - timedelta(seconds=1))
        c.status = ClaimStatus.ASSESSING
        breached = assessment_sla_job(store, now=NOW)
        assert breached == []


# ---------------------------------------------------------------------------
# PayoutRetryJob — failed payouts older than 28d are retried
# ---------------------------------------------------------------------------

def _make_paid_path_for_failed_payout(store):
    """Drive a claim through submit -> approved -> scheduled-payout, then
    mark the payout as failed so we can exercise the retry job."""
    make_policy(store)
    make_assessor(store)
    make_submitted_claim(store)
    triage_claim(store, "CLM-1")
    a = start_assessment(store, "CLM-1", "Bob")
    complete_assessment(store, a.assessment_id, "ok")
    approve_claim(store, "CLM-1")
    payout = schedule_payout(store, "CLM-1")
    payout.status = PayoutStatus.FAILED
    payout.failed_attempts = 1
    return payout


class TestPayoutRetryJob:
    def test_failed_below_threshold_not_retried(self, store):
        p = _make_paid_path_for_failed_payout(store)
        p.last_failure_at = NOW - (PAYOUT_RETRY_AFTER - timedelta(days=1))
        retried = payout_retry_job(store, now=NOW)
        assert retried == []
        assert p.status == PayoutStatus.FAILED

    def test_failed_past_threshold_retried_and_marked_paid(self, store):
        p = _make_paid_path_for_failed_payout(store)
        p.last_failure_at = NOW - (PAYOUT_RETRY_AFTER + timedelta(days=1))
        retried = payout_retry_job(store, now=NOW)
        assert p.payout_id in retried
        # Spec PayoutRetryJob guidance: on success marks the payout paid.
        assert p.status == PayoutStatus.PAID
        assert store.claims["CLM-1"].status == ClaimStatus.PAID

    def test_non_failed_payouts_ignored(self, store):
        p = _make_paid_path_for_failed_payout(store)
        p.status = PayoutStatus.SCHEDULED
        p.last_failure_at = NOW - (PAYOUT_RETRY_AFTER + timedelta(days=10))
        retried = payout_retry_job(store, now=NOW)
        assert retried == []

    def test_retry_anchor_falls_back_to_scheduled_at(self, store):
        # spec: retry_anchor = coalesce(last_failure_at, scheduled_at)
        p = _make_paid_path_for_failed_payout(store)
        p.last_failure_at = None
        p.scheduled_at = NOW - (PAYOUT_RETRY_AFTER + timedelta(days=1))
        retried = payout_retry_job(store, now=NOW)
        assert p.payout_id in retried


# ---------------------------------------------------------------------------
# AutoCloseDeniedJob — denied claims auto-closed after 90 days
# ---------------------------------------------------------------------------

class TestAutoCloseDeniedJob:
    def test_below_threshold_no_op(self, store):
        make_policy(store)
        c = make_submitted_claim(store)
        c.status = ClaimStatus.DENIED
        c.denial_reason = "x"
        c.last_activity_at = NOW - (AUTO_CLOSE_DENIED_AFTER - timedelta(days=1))
        closed = auto_close_denied_job(store, now=NOW)
        assert closed == []
        assert c.status == ClaimStatus.DENIED

    def test_past_threshold_transitions_to_closed(self, store):
        make_policy(store)
        c = make_submitted_claim(store)
        c.status = ClaimStatus.DENIED
        c.denial_reason = "x"
        c.last_activity_at = NOW - (AUTO_CLOSE_DENIED_AFTER + timedelta(days=1))
        closed = auto_close_denied_job(store, now=NOW)
        assert "CLM-1" in closed
        assert c.status == ClaimStatus.CLOSED

    @pytest.mark.parametrize(
        "status",
        [
            ClaimStatus.SUBMITTED,
            ClaimStatus.TRIAGED,
            ClaimStatus.ASSESSING,
            ClaimStatus.APPROVED,
            ClaimStatus.PAID,
            ClaimStatus.CLOSED,
        ],
    )
    def test_only_targets_denied_claims(self, store, status):
        make_policy(store)
        c = make_submitted_claim(store)
        c.status = status
        c.last_activity_at = NOW - (AUTO_CLOSE_DENIED_AFTER + timedelta(days=10))
        closed = auto_close_denied_job(store, now=NOW)
        assert closed == []


# ---------------------------------------------------------------------------
# AutoApprovalScheduler — trusted + low-value + completed assessment + assessing
# ---------------------------------------------------------------------------

def _setup_assessment_complete(store, *, amount, holder_tags, status=ClaimStatus.ASSESSING):
    make_policy(
        store,
        policy_number="POL-1",
        holder_tags=holder_tags,
        coverage_limit_pence=AUTO_APPROVE_MAX_PENCE * 2,
    )
    make_assessor(store)
    make_submitted_claim(store, amount_claimed_pence=amount)
    triage_claim(store, "CLM-1")
    a = start_assessment(store, "CLM-1", "Bob")
    complete_assessment(store, a.assessment_id, "ok")
    store.claims["CLM-1"].status = status  # in case the test wants to drift the status
    return store.claims["CLM-1"]


class TestAutoApprovalScheduler:
    def test_eligible_claim_is_auto_approved(self, store):
        c = _setup_assessment_complete(
            store,
            amount=AUTO_APPROVE_MAX_PENCE - 1,
            holder_tags={"trusted"},
        )
        approved = auto_approval_scheduler(store)
        assert "CLM-1" in approved
        assert c.status == ClaimStatus.APPROVED

    def test_untrusted_holder_not_approved(self, store):
        c = _setup_assessment_complete(
            store,
            amount=AUTO_APPROVE_MAX_PENCE - 1,
            holder_tags=set(),
        )
        approved = auto_approval_scheduler(store)
        assert approved == []
        assert c.status == ClaimStatus.ASSESSING

    def test_amount_at_or_above_cap_not_approved(self, store):
        c = _setup_assessment_complete(
            store,
            amount=AUTO_APPROVE_MAX_PENCE,
            holder_tags={"trusted"},
        )
        approved = auto_approval_scheduler(store)
        assert approved == []
        assert c.status == ClaimStatus.ASSESSING

    @pytest.mark.parametrize(
        "status",
        [
            ClaimStatus.SUBMITTED,
            ClaimStatus.TRIAGED,
            ClaimStatus.APPROVED,
            ClaimStatus.DENIED,
            ClaimStatus.PAID,
            ClaimStatus.CLOSED,
        ],
    )
    def test_only_assessing_claims_are_targeted(self, store, status):
        _setup_assessment_complete(
            store,
            amount=AUTO_APPROVE_MAX_PENCE - 1,
            holder_tags={"trusted"},
            status=status,
        )
        approved = auto_approval_scheduler(store)
        assert approved == []

    def test_assessment_must_be_completed(self, store):
        make_policy(
            store,
            policy_number="POL-1",
            holder_tags={"trusted"},
            coverage_limit_pence=AUTO_APPROVE_MAX_PENCE * 2,
        )
        make_assessor(store)
        make_submitted_claim(store, amount_claimed_pence=AUTO_APPROVE_MAX_PENCE - 1)
        triage_claim(store, "CLM-1")
        # Start but do not complete the assessment.
        start_assessment(store, "CLM-1", "Bob")
        approved = auto_approval_scheduler(store)
        assert approved == []
        # And no assessment was forcibly completed.
        statuses = {a.status for a in store.assessments.values()}
        assert AssessmentStatus.COMPLETED not in statuses
