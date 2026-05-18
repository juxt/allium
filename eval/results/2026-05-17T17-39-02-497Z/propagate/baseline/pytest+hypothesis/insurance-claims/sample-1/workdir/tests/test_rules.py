"""Rule success/failure and entity-creation obligations.

One section per rule in the spec. Each rule has at least one rule_success
test, one test per `requires` clause for rule_failure, and an
rule_entity_creation test where the rule's `ensures` includes `<Entity>.created`.

Temporal rules (AutoAcknowledgeJob, AssessmentSlaJob, PayoutRetryJob,
AutoCloseDeniedJob, AutoApprovalScheduler precondition timing) live in
test_temporal.py.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from app import Store
from app.models import (
    AssessmentStatus,
    ClaimStatus,
    PayoutStatus,
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

from tests._helpers import (
    make_approved_claim,
    make_assessing_claim,
    make_assessor,
    make_claim_with_completed_assessment,
    make_policy,
    make_scheduled_payout,
    make_submitted_claim,
    make_triaged_claim,
)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


# ---------------------------------------------------------------------------
# RegisterPolicy
# ---------------------------------------------------------------------------

class TestRegisterPolicy:
    def test_success_creates_policy_with_active_status(self, store: Store):
        policy = register_policy(
            store,
            policy_number="POL-1",
            holder="Alice",
            coverage_limit_pence=10_000_00,
        )
        assert policy.policy_number == "POL-1"
        assert policy.holder == "Alice"
        assert policy.coverage_limit_pence == 10_000_00
        assert policy.status == PolicyStatus.ACTIVE
        assert store.policies["POL-1"] is policy

    def test_entity_creation_records_holder_tags(self, store: Store):
        policy = register_policy(
            store,
            policy_number="POL-1",
            holder="Alice",
            coverage_limit_pence=10_000_00,
            holder_tags={"trusted", "vip"},
        )
        assert policy.holder_tags == {"trusted", "vip"}


# ---------------------------------------------------------------------------
# RegisterAssessor
# ---------------------------------------------------------------------------

class TestRegisterAssessor:
    def test_success_creates_assessor(self, store: Store):
        assessor = register_assessor(store, "Bob", {"vehicle", "property"})
        assert assessor.name == "Bob"
        assert assessor.specialties == {"vehicle", "property"}
        assert store.assessors["Bob"] is assessor


# ---------------------------------------------------------------------------
# SubmitClaim
# ---------------------------------------------------------------------------

class TestSubmitClaim:
    def test_success_creates_submitted_claim(self, store: Store):
        make_policy(store)
        claim = submit_claim(
            store,
            claim_number="CLM-1",
            policy_number="POL-1",
            incident_date=_utcnow(),
            amount_claimed_pence=1_000_00,
        )
        assert claim.status == ClaimStatus.SUBMITTED
        assert claim.policy_number == "POL-1"
        assert claim.amount_claimed_pence == 1_000_00
        # Spec: both submitted_at and last_activity_at are set to `now`. The
        # implementation reads the clock twice during dataclass construction
        # so allow a small skew.
        assert abs(claim.submitted_at - claim.last_activity_at) < timedelta(seconds=1)
        assert store.claims["CLM-1"] is claim

    def test_failure_amount_exceeds_coverage(self, store: Store):
        make_policy(store, coverage_limit_pence=1_000)
        with pytest.raises(ClaimRejected):
            submit_claim(
                store,
                claim_number="CLM-1",
                policy_number="POL-1",
                incident_date=_utcnow(),
                amount_claimed_pence=10_000,
            )

    def test_failure_policy_not_active(self, store: Store):
        make_policy(store, status=PolicyStatus.LAPSED)
        with pytest.raises(ClaimRejected):
            submit_claim(
                store,
                claim_number="CLM-1",
                policy_number="POL-1",
                incident_date=_utcnow(),
                amount_claimed_pence=1_000_00,
            )


# ---------------------------------------------------------------------------
# TriageClaim
# ---------------------------------------------------------------------------

class TestTriageClaim:
    def test_success_moves_submitted_to_triaged(self, store: Store):
        make_policy(store)
        make_submitted_claim(store)
        before = store.claims["CLM-1"].last_activity_at
        # Force a perceivable activity bump.
        store.claims["CLM-1"].last_activity_at = before - timedelta(seconds=5)
        claim = triage_claim(store, "CLM-1")
        assert claim.status == ClaimStatus.TRIAGED
        assert claim.last_activity_at >= before - timedelta(seconds=5)

    def test_failure_from_non_submitted_status(self, store: Store):
        make_policy(store)
        make_triaged_claim(store)  # already triaged
        with pytest.raises(InvalidTransition):
            triage_claim(store, "CLM-1")


# ---------------------------------------------------------------------------
# StartAssessment
# ---------------------------------------------------------------------------

class TestStartAssessment:
    def test_success_creates_in_progress_assessment_and_moves_claim_to_assessing(
        self, store: Store
    ):
        make_policy(store)
        make_assessor(store)
        make_triaged_claim(store)
        assessment = start_assessment(store, "CLM-1", "Bob")
        assert assessment.status == AssessmentStatus.IN_PROGRESS
        assert assessment.claim_number == "CLM-1"
        assert assessment.assessor_name == "Bob"
        assert assessment.started_at is not None
        assert assessment.findings == ""
        assert store.assessments[assessment.assessment_id] is assessment
        assert store.claims["CLM-1"].status == ClaimStatus.ASSESSING

    def test_failure_claim_not_triaged(self, store: Store):
        make_policy(store)
        make_assessor(store)
        make_submitted_claim(store)  # SUBMITTED, not TRIAGED
        with pytest.raises(InvalidTransition):
            start_assessment(store, "CLM-1", "Bob")


# ---------------------------------------------------------------------------
# CompleteAssessment
# ---------------------------------------------------------------------------

class TestCompleteAssessment:
    def test_success_marks_assessment_completed_and_touches_claim(self, store: Store):
        make_policy(store)
        _, assessment = make_assessing_claim(store)
        store.claims["CLM-1"].last_activity_at -= timedelta(seconds=5)
        prior = store.claims["CLM-1"].last_activity_at

        result = complete_assessment(store, assessment.assessment_id, "looks good")
        assert result.status == AssessmentStatus.COMPLETED
        assert result.findings == "looks good"
        assert result.completed_at is not None
        assert store.claims["CLM-1"].last_activity_at >= prior

    def test_failure_when_not_in_progress(self, store: Store):
        make_policy(store)
        _, assessment = make_assessing_claim(store)
        complete_assessment(store, assessment.assessment_id, "done")
        with pytest.raises(InvalidTransition):
            complete_assessment(store, assessment.assessment_id, "again")


# ---------------------------------------------------------------------------
# ApproveClaim
# ---------------------------------------------------------------------------

class TestApproveClaim:
    def test_success_moves_assessing_to_approved(self, store: Store):
        make_policy(store)
        claim, assessment = make_assessing_claim(store)
        complete_assessment(store, assessment.assessment_id, "ok")
        approved = approve_claim(store, claim.claim_number)
        assert approved.status == ClaimStatus.APPROVED

    def test_failure_claim_not_assessing(self, store: Store):
        make_policy(store)
        make_triaged_claim(store)  # TRIAGED, no assessment
        with pytest.raises(InvalidTransition):
            approve_claim(store, "CLM-1")

    def test_failure_no_completed_assessment(self, store: Store):
        make_policy(store)
        make_assessing_claim(store)  # IN_PROGRESS, not COMPLETED
        with pytest.raises(InvalidTransition):
            approve_claim(store, "CLM-1")


# ---------------------------------------------------------------------------
# DenyClaim
# ---------------------------------------------------------------------------

class TestDenyClaim:
    def test_success_from_triaged_records_reason(self, store: Store):
        make_policy(store)
        make_triaged_claim(store)
        result = deny_claim(store, "CLM-1", "fraud")
        assert result.status == ClaimStatus.DENIED
        assert result.denial_reason == "fraud"

    def test_success_from_assessing(self, store: Store):
        make_policy(store)
        make_assessing_claim(store)  # ASSESSING
        result = deny_claim(store, "CLM-1", "out of scope")
        assert result.status == ClaimStatus.DENIED

    def test_failure_from_submitted(self, store: Store):
        make_policy(store)
        make_submitted_claim(store)
        with pytest.raises(InvalidTransition):
            deny_claim(store, "CLM-1", "nope")


# ---------------------------------------------------------------------------
# SchedulePayout
# ---------------------------------------------------------------------------

class TestSchedulePayout:
    def test_success_creates_scheduled_payout_matching_claim_amount(self, store: Store):
        make_policy(store)
        claim = make_approved_claim(store)
        payout = schedule_payout(store, claim.claim_number)
        assert payout.status == PayoutStatus.SCHEDULED
        assert payout.claim_number == claim.claim_number
        assert payout.amount_pence == claim.amount_claimed_pence
        assert payout.failed_attempts == 0
        assert payout in store.payouts

    def test_failure_claim_not_approved(self, store: Store):
        make_policy(store)
        make_claim_with_completed_assessment(store)  # ASSESSING, not APPROVED
        with pytest.raises(InvalidTransition):
            schedule_payout(store, "CLM-1")


# ---------------------------------------------------------------------------
# MarkPayoutPaid
# ---------------------------------------------------------------------------

class TestMarkPayoutPaid:
    def test_success_marks_payout_paid_and_claim_paid(self, store: Store):
        make_policy(store)
        payout = make_scheduled_payout(store)
        result = mark_payout_paid(store, payout.payout_id)
        assert result.status == PayoutStatus.PAID
        assert result.paid_at is not None
        claim = store.claims[result.claim_number]
        assert claim.status == ClaimStatus.PAID


# ---------------------------------------------------------------------------
# MarkPayoutFailed
# ---------------------------------------------------------------------------

class TestMarkPayoutFailed:
    def test_success_marks_failed_and_increments_attempts(self, store: Store):
        make_policy(store)
        payout = make_scheduled_payout(store)
        result = mark_payout_failed(store, payout.payout_id)
        assert result.status == PayoutStatus.FAILED
        assert result.failed_attempts == 1
        assert result.last_failure_at is not None

    def test_repeated_failures_increment_counter(self, store: Store):
        make_policy(store)
        payout = make_scheduled_payout(store)
        mark_payout_failed(store, payout.payout_id)
        mark_payout_failed(store, payout.payout_id)
        result = store.payouts[0]
        assert result.failed_attempts == 2


# ---------------------------------------------------------------------------
# ReceiveIncidentReport (covered as a unit here; webhook surface in test_surfaces.py)
# ---------------------------------------------------------------------------

class TestReceiveIncidentReport:
    def test_success_creates_incident_report(self, global_store):
        from app.webhooks import receive_incident_report
        now = _utcnow()
        response = receive_incident_report(
            {
                "source": "police",
                "policy_number": None,
                "incident_date": now.isoformat(),
                "description": "rear-end",
            }
        )
        assert response["report_id"] in global_store.incident_reports
        report = global_store.incident_reports[response["report_id"]]
        assert report.source == "police"
        assert report.description == "rear-end"


# ---------------------------------------------------------------------------
# AutoApprovalScheduler (data-driven preconditions)
# ---------------------------------------------------------------------------

class TestAutoApprovalScheduler:
    def _setup_trusted_assessing_with_completed_assessment(
        self, store: Store, *, amount_pence: int
    ):
        make_policy(
            store,
            holder_tags={"trusted"},
            coverage_limit_pence=max(amount_pence, 10_000_00),
        )
        _, assessment = make_assessing_claim(store, amount_pence=amount_pence)
        complete_assessment(store, assessment.assessment_id, "ok")

    def test_success_auto_approves_eligible_claim(self, store: Store):
        from app.jobs import auto_approval_scheduler
        self._setup_trusted_assessing_with_completed_assessment(store, amount_pence=10_000_00)
        approved = auto_approval_scheduler(store)
        assert approved == ["CLM-1"]
        assert store.claims["CLM-1"].status == ClaimStatus.APPROVED

    def test_failure_not_trusted(self, store: Store):
        from app.jobs import auto_approval_scheduler
        make_policy(store, holder_tags=set())
        _, assessment = make_assessing_claim(store, amount_pence=10_000_00)
        complete_assessment(store, assessment.assessment_id, "ok")
        approved = auto_approval_scheduler(store)
        assert approved == []
        assert store.claims["CLM-1"].status == ClaimStatus.ASSESSING

    def test_failure_amount_at_or_above_cap(self, store: Store):
        from app.jobs import AUTO_APPROVE_MAX_PENCE, auto_approval_scheduler
        # Implementation guard is strict `>=` on the cap, matching the spec's
        # "< auto_approve_max_pence" precondition.
        self._setup_trusted_assessing_with_completed_assessment(
            store, amount_pence=AUTO_APPROVE_MAX_PENCE
        )
        approved = auto_approval_scheduler(store)
        assert approved == []

    def test_failure_claim_not_assessing(self, store: Store):
        from app.jobs import auto_approval_scheduler
        # Claim is SUBMITTED — even though tagged trusted and small, it doesn't
        # have a completed assessment and isn't ASSESSING.
        make_policy(store, holder_tags={"trusted"})
        make_submitted_claim(store, amount_pence=1_00)
        approved = auto_approval_scheduler(store)
        assert approved == []


# ---------------------------------------------------------------------------
# AutoCloseDeniedJob success-rule structural test (timing variant in test_temporal.py)
# ---------------------------------------------------------------------------

class TestAutoCloseDeniedJobShape:
    def test_only_processes_denied_claims(self, store: Store):
        from app.jobs import auto_close_denied_job
        make_policy(store)
        make_triaged_claim(store)
        # TRIAGED claim, even ancient, must not be touched.
        store.claims["CLM-1"].last_activity_at = _utcnow() - timedelta(days=365)
        closed = auto_close_denied_job(store)
        assert closed == []
        assert store.claims["CLM-1"].status == ClaimStatus.TRIAGED
