"""Tests for rule_success, rule_failure, and rule_entity_creation obligations.

Each spec rule (SubmitClaim, TriageClaim, StartAssessment, CompleteAssessment,
ApproveClaim, DenyClaim, SchedulePayout, MarkPayoutPaid, MarkPayoutFailed,
RegisterAssessor, RegisterPolicy) gets:
  - a success test exercising the happy path,
  - failure tests for each `requires` clause,
  - a creation test for rules whose `ensures` clause creates a new entity.

The implementation bridge is direct: each rule corresponds 1:1 with a function
in ``app/services.py`` (or ``app/webhooks.py`` for ReceiveIncidentReport).
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from app.models import (
    Assessment,
    AssessmentStatus,
    Assessor,
    Claim,
    ClaimStatus,
    Payout,
    PayoutStatus,
    Policy,
    PolicyStatus,
)
from app.services import (
    ClaimRejected,
    InvalidTransition,
    approve_claim,
    complete_assessment,
    deny_claim,
    mark_payout_failed,
    mark_payout_paid,
    register_assessor,
    register_policy,
    schedule_payout,
    start_assessment,
    submit_claim,
    triage_claim,
)

from .helpers import (
    make_assessor,
    make_policy,
    make_submitted_claim,
    make_triaged_claim,
)


# ---------------------------------------------------------------------------
# RegisterPolicy
# ---------------------------------------------------------------------------

class TestRegisterPolicy:
    def test_success_creates_active_policy(self, store):
        policy = register_policy(
            store,
            policy_number="POL-1",
            holder="Alice",
            coverage_limit_pence=100_00,
        )
        assert isinstance(policy, Policy)
        assert policy.policy_number == "POL-1"
        assert policy.holder == "Alice"
        assert policy.coverage_limit_pence == 100_00
        assert policy.status == PolicyStatus.ACTIVE  # spec: status = active

    def test_success_stores_policy(self, store):
        register_policy(store, policy_number="POL-9", holder="X", coverage_limit_pence=1)
        assert "POL-9" in store.policies

    def test_success_with_holder_tags(self, store):
        p = register_policy(
            store,
            policy_number="POL-T",
            holder="Trusty",
            coverage_limit_pence=1,
            holder_tags={"trusted", "vip"},
        )
        assert p.holder_tags == {"trusted", "vip"}


# ---------------------------------------------------------------------------
# RegisterAssessor
# ---------------------------------------------------------------------------

class TestRegisterAssessor:
    def test_success_creates_assessor(self, store):
        a = register_assessor(store, "Bob", {"fire", "flood"})
        assert isinstance(a, Assessor)
        assert a.name == "Bob"
        assert a.specialties == {"fire", "flood"}

    def test_success_indexes_by_name(self, store):
        register_assessor(store, "Bob", {"fire"})
        assert "Bob" in store.assessors


# ---------------------------------------------------------------------------
# SubmitClaim
# ---------------------------------------------------------------------------

class TestSubmitClaim:
    def test_success_creates_submitted_claim(self, store):
        make_policy(store, policy_number="POL-1", coverage_limit_pence=10_000)
        claim = submit_claim(
            store,
            claim_number="CLM-1",
            policy_number="POL-1",
            incident_date=datetime.now(timezone.utc),
            amount_claimed_pence=5_000,
        )
        assert isinstance(claim, Claim)
        assert claim.status == ClaimStatus.SUBMITTED
        assert claim.claim_number == "CLM-1"
        assert claim.policy_number == "POL-1"
        assert claim.amount_claimed_pence == 5_000
        assert claim.submitted_at is not None
        assert claim.last_activity_at is not None
        assert "CLM-1" in store.claims

    def test_failure_unknown_policy(self, store):
        with pytest.raises(ClaimRejected):
            submit_claim(
                store,
                claim_number="CLM-1",
                policy_number="MISSING",
                incident_date=datetime.now(timezone.utc),
                amount_claimed_pence=1,
            )

    def test_failure_amount_exceeds_coverage(self, store):
        make_policy(store, policy_number="POL-1", coverage_limit_pence=1_000)
        with pytest.raises(ClaimRejected):
            submit_claim(
                store,
                claim_number="CLM-1",
                policy_number="POL-1",
                incident_date=datetime.now(timezone.utc),
                amount_claimed_pence=1_001,
            )

    @pytest.mark.parametrize("status", [PolicyStatus.LAPSED, PolicyStatus.CANCELLED])
    def test_failure_policy_not_active(self, store, status):
        make_policy(store, policy_number="POL-1", coverage_limit_pence=100, status=status)
        with pytest.raises(ClaimRejected):
            submit_claim(
                store,
                claim_number="CLM-1",
                policy_number="POL-1",
                incident_date=datetime.now(timezone.utc),
                amount_claimed_pence=50,
            )

    def test_boundary_amount_equals_coverage_succeeds(self, store):
        make_policy(store, policy_number="POL-1", coverage_limit_pence=1_000)
        claim = submit_claim(
            store,
            claim_number="CLM-1",
            policy_number="POL-1",
            incident_date=datetime.now(timezone.utc),
            amount_claimed_pence=1_000,
        )
        assert claim.amount_claimed_pence == 1_000


# ---------------------------------------------------------------------------
# TriageClaim
# ---------------------------------------------------------------------------

class TestTriageClaim:
    def test_success_transitions_submitted_to_triaged(self, store):
        make_policy(store)
        make_submitted_claim(store)
        claim = triage_claim(store, "CLM-1")
        assert claim.status == ClaimStatus.TRIAGED

    def test_success_updates_last_activity(self, store):
        make_policy(store)
        c = make_submitted_claim(store)
        before = c.last_activity_at
        # Force an obviously stale timestamp so the touch is observable.
        c.last_activity_at = before - timedelta(days=10)
        triage_claim(store, "CLM-1")
        assert c.last_activity_at > before - timedelta(days=10)

    @pytest.mark.parametrize(
        "starting_status",
        [
            ClaimStatus.TRIAGED,
            ClaimStatus.ASSESSING,
            ClaimStatus.APPROVED,
            ClaimStatus.DENIED,
            ClaimStatus.PAID,
            ClaimStatus.CLOSED,
        ],
    )
    def test_failure_only_from_submitted(self, store, starting_status):
        make_policy(store)
        c = make_submitted_claim(store)
        c.status = starting_status
        with pytest.raises(InvalidTransition):
            triage_claim(store, "CLM-1")

    def test_failure_unknown_claim(self, store):
        with pytest.raises(ClaimRejected):
            triage_claim(store, "NOPE")


# ---------------------------------------------------------------------------
# StartAssessment
# ---------------------------------------------------------------------------

class TestStartAssessment:
    def test_success_creates_in_progress_assessment(self, store):
        make_policy(store)
        make_assessor(store)
        make_triaged_claim(store)
        a = start_assessment(store, "CLM-1", "Bob")
        assert isinstance(a, Assessment)
        assert a.status == AssessmentStatus.IN_PROGRESS
        assert a.claim_number == "CLM-1"
        assert a.assessor_name == "Bob"
        assert a.findings == ""  # spec: findings = ""
        assert a.started_at is not None
        assert a.assessment_id in store.assessments

    def test_success_moves_claim_to_assessing(self, store):
        make_policy(store)
        make_assessor(store)
        make_triaged_claim(store)
        start_assessment(store, "CLM-1", "Bob")
        assert store.claims["CLM-1"].status == ClaimStatus.ASSESSING

    @pytest.mark.parametrize(
        "starting_status",
        [
            ClaimStatus.SUBMITTED,
            ClaimStatus.ASSESSING,
            ClaimStatus.APPROVED,
            ClaimStatus.DENIED,
            ClaimStatus.PAID,
            ClaimStatus.CLOSED,
        ],
    )
    def test_failure_when_claim_not_triaged(self, store, starting_status):
        make_policy(store)
        make_assessor(store)
        c = make_submitted_claim(store)
        c.status = starting_status
        with pytest.raises(InvalidTransition):
            start_assessment(store, "CLM-1", "Bob")

    def test_failure_unknown_assessor(self, store):
        make_policy(store)
        make_triaged_claim(store)
        with pytest.raises(ClaimRejected):
            start_assessment(store, "CLM-1", "Phantom")


# ---------------------------------------------------------------------------
# CompleteAssessment
# ---------------------------------------------------------------------------

class TestCompleteAssessment:
    def _setup_in_progress(self, store) -> Assessment:
        make_policy(store)
        make_assessor(store)
        make_triaged_claim(store)
        return start_assessment(store, "CLM-1", "Bob")

    def test_success_sets_completed_status_and_findings(self, store):
        a = self._setup_in_progress(store)
        result = complete_assessment(store, a.assessment_id, "all clear")
        assert result.status == AssessmentStatus.COMPLETED
        assert result.findings == "all clear"
        assert result.completed_at is not None

    def test_success_touches_owning_claim(self, store):
        a = self._setup_in_progress(store)
        claim = store.claims["CLM-1"]
        claim.last_activity_at = datetime.now(timezone.utc) - timedelta(days=30)
        complete_assessment(store, a.assessment_id, "ok")
        assert claim.last_activity_at > datetime.now(timezone.utc) - timedelta(seconds=10)

    @pytest.mark.parametrize(
        "starting_status",
        [AssessmentStatus.PENDING, AssessmentStatus.COMPLETED],
    )
    def test_failure_when_not_in_progress(self, store, starting_status):
        a = self._setup_in_progress(store)
        a.status = starting_status
        with pytest.raises(InvalidTransition):
            complete_assessment(store, a.assessment_id, "x")

    def test_failure_unknown_assessment(self, store):
        with pytest.raises(ClaimRejected):
            complete_assessment(store, "no-such-id", "x")


# ---------------------------------------------------------------------------
# ApproveClaim
# ---------------------------------------------------------------------------

class TestApproveClaim:
    def _setup_assessed(self, store) -> None:
        make_policy(store)
        make_assessor(store)
        make_triaged_claim(store)
        a = start_assessment(store, "CLM-1", "Bob")
        complete_assessment(store, a.assessment_id, "ok")

    def test_success_transitions_to_approved(self, store):
        self._setup_assessed(store)
        c = approve_claim(store, "CLM-1")
        assert c.status == ClaimStatus.APPROVED

    def test_failure_no_completed_assessment(self, store):
        make_policy(store)
        make_assessor(store)
        make_triaged_claim(store)
        # Start (but don't complete) the assessment.
        start_assessment(store, "CLM-1", "Bob")
        with pytest.raises(InvalidTransition):
            approve_claim(store, "CLM-1")

    @pytest.mark.parametrize(
        "starting_status",
        [
            ClaimStatus.SUBMITTED,
            ClaimStatus.TRIAGED,
            ClaimStatus.APPROVED,
            ClaimStatus.DENIED,
            ClaimStatus.PAID,
            ClaimStatus.CLOSED,
        ],
    )
    def test_failure_when_claim_not_assessing(self, store, starting_status):
        self._setup_assessed(store)
        store.claims["CLM-1"].status = starting_status
        with pytest.raises(InvalidTransition):
            approve_claim(store, "CLM-1")


# ---------------------------------------------------------------------------
# DenyClaim
# ---------------------------------------------------------------------------

class TestDenyClaim:
    @pytest.mark.parametrize("starting_status", [ClaimStatus.TRIAGED, ClaimStatus.ASSESSING])
    def test_success_from_triaged_or_assessing(self, store, starting_status):
        make_policy(store)
        make_submitted_claim(store)
        store.claims["CLM-1"].status = starting_status
        c = deny_claim(store, "CLM-1", "missing docs")
        assert c.status == ClaimStatus.DENIED
        assert c.denial_reason == "missing docs"

    @pytest.mark.parametrize(
        "starting_status",
        [
            ClaimStatus.SUBMITTED,
            ClaimStatus.APPROVED,
            ClaimStatus.DENIED,
            ClaimStatus.PAID,
            ClaimStatus.CLOSED,
        ],
    )
    def test_failure_from_disallowed_status(self, store, starting_status):
        make_policy(store)
        c = make_submitted_claim(store)
        c.status = starting_status
        with pytest.raises(InvalidTransition):
            deny_claim(store, "CLM-1", "no")


# ---------------------------------------------------------------------------
# SchedulePayout
# ---------------------------------------------------------------------------

class TestSchedulePayout:
    def _make_approved_claim(self, store, amount=1_000_00):
        make_policy(store)
        make_assessor(store)
        make_submitted_claim(store, amount_claimed_pence=amount)
        triage_claim(store, "CLM-1")
        a = start_assessment(store, "CLM-1", "Bob")
        complete_assessment(store, a.assessment_id, "ok")
        approve_claim(store, "CLM-1")

    def test_success_creates_scheduled_payout_with_claim_amount(self, store):
        self._make_approved_claim(store, amount=42_00)
        p = schedule_payout(store, "CLM-1")
        assert isinstance(p, Payout)
        assert p.status == PayoutStatus.SCHEDULED
        assert p.amount_pence == 42_00
        assert p.claim_number == "CLM-1"
        assert p.failed_attempts == 0
        assert p.scheduled_at is not None

    @pytest.mark.parametrize(
        "starting_status",
        [
            ClaimStatus.SUBMITTED,
            ClaimStatus.TRIAGED,
            ClaimStatus.ASSESSING,
            ClaimStatus.DENIED,
            ClaimStatus.PAID,
            ClaimStatus.CLOSED,
        ],
    )
    def test_failure_when_claim_not_approved(self, store, starting_status):
        make_policy(store)
        c = make_submitted_claim(store)
        c.status = starting_status
        with pytest.raises(InvalidTransition):
            schedule_payout(store, "CLM-1")


# ---------------------------------------------------------------------------
# MarkPayoutPaid
# ---------------------------------------------------------------------------

class TestMarkPayoutPaid:
    def _make_scheduled_payout(self, store):
        make_policy(store)
        make_assessor(store)
        make_submitted_claim(store)
        triage_claim(store, "CLM-1")
        a = start_assessment(store, "CLM-1", "Bob")
        complete_assessment(store, a.assessment_id, "ok")
        approve_claim(store, "CLM-1")
        return schedule_payout(store, "CLM-1")

    def test_success_marks_payout_paid(self, store):
        p = self._make_scheduled_payout(store)
        result = mark_payout_paid(store, p.payout_id)
        assert result.status == PayoutStatus.PAID
        assert result.paid_at is not None

    def test_success_marks_owning_claim_paid(self, store):
        p = self._make_scheduled_payout(store)
        mark_payout_paid(store, p.payout_id)
        assert store.claims["CLM-1"].status == ClaimStatus.PAID

    def test_failure_unknown_payout(self, store):
        with pytest.raises(ClaimRejected):
            mark_payout_paid(store, "no-such-payout")


# ---------------------------------------------------------------------------
# MarkPayoutFailed
# ---------------------------------------------------------------------------

class TestMarkPayoutFailed:
    def _make_scheduled_payout(self, store):
        make_policy(store)
        make_assessor(store)
        make_submitted_claim(store)
        triage_claim(store, "CLM-1")
        a = start_assessment(store, "CLM-1", "Bob")
        complete_assessment(store, a.assessment_id, "ok")
        approve_claim(store, "CLM-1")
        return schedule_payout(store, "CLM-1")

    def test_success_sets_failed_status_and_increments_attempts(self, store):
        p = self._make_scheduled_payout(store)
        result = mark_payout_failed(store, p.payout_id)
        assert result.status == PayoutStatus.FAILED
        assert result.failed_attempts == 1
        assert result.last_failure_at is not None

    def test_success_repeated_failures_accumulate(self, store):
        p = self._make_scheduled_payout(store)
        mark_payout_failed(store, p.payout_id)
        mark_payout_failed(store, p.payout_id)
        assert p.failed_attempts == 2

    def test_failure_unknown_payout(self, store):
        with pytest.raises(ClaimRejected):
            mark_payout_failed(store, "no-such-payout")
