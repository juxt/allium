"""Rule success/failure tests propagated from spec.allium.

Each `rule_success` obligation has a paired test for the happy path; each
`rule_failure` obligation has a test that the rule's `requires` clauses
actually gate execution.
"""
from __future__ import annotations

from datetime import datetime, timezone

import pytest

from app import Store
from app.models import (
    Assessment,
    AssessmentStatus,
    Assessor,
    Claim,
    ClaimStatus,
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


# ---------------------------------------------------------------------------
# Helpers — minimal setup ladders into each status the rules require.
# ---------------------------------------------------------------------------

def _policy(store, *, number="P1", status=PolicyStatus.ACTIVE,
            limit=100_000_00, tags=None) -> Policy:
    pol = Policy(
        policy_number=number, holder="Alice",
        coverage_limit_pence=limit, status=status,
        holder_tags=set(tags or []),
    )
    store.policies[number] = pol
    return pol


def _submitted(store, *, claim_number="C1", policy_number="P1",
               amount=10_000_00) -> Claim:
    return submit_claim(
        store,
        claim_number=claim_number,
        policy_number=policy_number,
        incident_date=datetime.now(timezone.utc),
        amount_claimed_pence=amount,
    )


def _triaged(store, **kw) -> Claim:
    c = _submitted(store, **kw)
    return triage_claim(store, c.claim_number)


def _assessing(store, *, assessor_name="Mira", **kw) -> tuple[Claim, Assessment]:
    c = _triaged(store, **kw)
    register_assessor(store, assessor_name, {"motor"})
    a = start_assessment(store, c.claim_number, assessor_name)
    return c, a


def _assessed(store, **kw) -> tuple[Claim, Assessment]:
    c, a = _assessing(store, **kw)
    complete_assessment(store, a.assessment_id, "ok")
    return c, a


# ---------------------------------------------------------------------------
# RegisterPolicy
# ---------------------------------------------------------------------------

def test_register_policy_success_creates_active_policy(store: Store):
    p = register_policy(
        store,
        policy_number="P1",
        holder="Alice",
        coverage_limit_pence=10_000_00,
        holder_tags={"trusted"},
    )
    assert p.status == PolicyStatus.ACTIVE
    assert store.policies["P1"] is p
    assert p.holder == "Alice"
    assert p.coverage_limit_pence == 10_000_00
    assert p.holder_tags == {"trusted"}


# ---------------------------------------------------------------------------
# RegisterAssessor
# ---------------------------------------------------------------------------

def test_register_assessor_success_creates_assessor(store: Store):
    a = register_assessor(store, "Mira", {"motor", "property"})
    assert isinstance(a, Assessor)
    assert store.assessors["Mira"] is a
    assert a.specialties == {"motor", "property"}


# ---------------------------------------------------------------------------
# SubmitClaim — happy path + 2 failure modes
# ---------------------------------------------------------------------------

def test_submit_claim_success_creates_submitted_claim(store: Store):
    _policy(store)
    c = _submitted(store)
    assert c.status == ClaimStatus.SUBMITTED
    assert store.claims["C1"] is c
    assert c.submitted_at is not None
    assert c.last_activity_at is not None


def test_submit_claim_rejects_when_policy_inactive(store: Store):
    _policy(store, status=PolicyStatus.LAPSED)
    with pytest.raises(ClaimRejected):
        _submitted(store)


def test_submit_claim_rejects_when_amount_exceeds_coverage(store: Store):
    _policy(store, limit=100)
    with pytest.raises(ClaimRejected):
        _submitted(store, amount=101)


# ---------------------------------------------------------------------------
# TriageClaim
# ---------------------------------------------------------------------------

def test_triage_claim_success(store: Store):
    _policy(store)
    c = _submitted(store)
    triaged = triage_claim(store, c.claim_number)
    assert triaged.status == ClaimStatus.TRIAGED


def test_triage_claim_fails_from_non_submitted_status(store: Store):
    _policy(store)
    c = _submitted(store)
    triage_claim(store, c.claim_number)  # now TRIAGED
    with pytest.raises(InvalidTransition):
        triage_claim(store, c.claim_number)


# ---------------------------------------------------------------------------
# StartAssessment
# ---------------------------------------------------------------------------

def test_start_assessment_success(store: Store):
    _policy(store)
    c = _triaged(store)
    register_assessor(store, "Mira", {"motor"})
    a = start_assessment(store, c.claim_number, "Mira")
    assert a.status == AssessmentStatus.IN_PROGRESS
    assert a.started_at is not None
    assert store.assessments[a.assessment_id] is a
    assert store.claims[c.claim_number].status == ClaimStatus.ASSESSING


def test_start_assessment_fails_when_claim_not_triaged(store: Store):
    _policy(store)
    c = _submitted(store)
    register_assessor(store, "Mira", {"motor"})
    with pytest.raises(InvalidTransition):
        start_assessment(store, c.claim_number, "Mira")


# ---------------------------------------------------------------------------
# CompleteAssessment
# ---------------------------------------------------------------------------

def test_complete_assessment_success(store: Store):
    _policy(store)
    _, a = _assessing(store)
    completed = complete_assessment(store, a.assessment_id, "all good")
    assert completed.status == AssessmentStatus.COMPLETED
    assert completed.findings == "all good"
    assert completed.completed_at is not None


def test_complete_assessment_fails_when_not_in_progress(store: Store):
    _policy(store)
    _, a = _assessing(store)
    complete_assessment(store, a.assessment_id, "first")
    with pytest.raises(InvalidTransition):
        complete_assessment(store, a.assessment_id, "second")


# ---------------------------------------------------------------------------
# ApproveClaim
# ---------------------------------------------------------------------------

def test_approve_claim_success(store: Store):
    _policy(store)
    c, _ = _assessed(store)
    approved = approve_claim(store, c.claim_number)
    assert approved.status == ClaimStatus.APPROVED


def test_approve_claim_fails_without_completed_assessment(store: Store):
    _policy(store)
    c, _ = _assessing(store)  # in_progress — not completed
    with pytest.raises(InvalidTransition):
        approve_claim(store, c.claim_number)


def test_approve_claim_fails_when_not_assessing(store: Store):
    _policy(store)
    c = _submitted(store)  # never reached assessing
    with pytest.raises(InvalidTransition):
        approve_claim(store, c.claim_number)


# ---------------------------------------------------------------------------
# DenyClaim
# ---------------------------------------------------------------------------

def test_deny_claim_from_triaged_success(store: Store):
    _policy(store)
    c = _triaged(store)
    denied = deny_claim(store, c.claim_number, "fraud")
    assert denied.status == ClaimStatus.DENIED
    assert denied.denial_reason == "fraud"


def test_deny_claim_from_assessing_success(store: Store):
    _policy(store)
    c, _ = _assessing(store)
    denied = deny_claim(store, c.claim_number, "insufficient evidence")
    assert denied.status == ClaimStatus.DENIED
    assert denied.denial_reason == "insufficient evidence"


def test_deny_claim_fails_from_disallowed_status(store: Store):
    _policy(store)
    c = _submitted(store)  # SUBMITTED is not in {TRIAGED, ASSESSING}
    with pytest.raises(InvalidTransition):
        deny_claim(store, c.claim_number, "reason")


# ---------------------------------------------------------------------------
# SchedulePayout — rule_success, rule_failure, rule_entity_creation
# ---------------------------------------------------------------------------

def test_schedule_payout_success_creates_payout(store: Store):
    _policy(store)
    c, _ = _assessed(store)
    approve_claim(store, c.claim_number)
    p = schedule_payout(store, c.claim_number)
    assert p.status == PayoutStatus.SCHEDULED
    assert p.amount_pence == c.amount_claimed_pence
    assert p.failed_attempts == 0
    assert p in store.payouts


def test_schedule_payout_fails_when_not_approved(store: Store):
    _policy(store)
    c, _ = _assessed(store)  # ASSESSING, not APPROVED
    with pytest.raises(InvalidTransition):
        schedule_payout(store, c.claim_number)


# ---------------------------------------------------------------------------
# MarkPayoutPaid — also asserts the claim's status becomes paid
# ---------------------------------------------------------------------------

def test_mark_payout_paid_success(store: Store):
    _policy(store)
    c, _ = _assessed(store)
    approve_claim(store, c.claim_number)
    p = schedule_payout(store, c.claim_number)
    paid = mark_payout_paid(store, p.payout_id)
    assert paid.status == PayoutStatus.PAID
    assert paid.paid_at is not None
    assert store.claims[c.claim_number].status == ClaimStatus.PAID


# ---------------------------------------------------------------------------
# MarkPayoutFailed — no requires clauses; just verify ensures
# ---------------------------------------------------------------------------

def test_mark_payout_failed_success(store: Store):
    _policy(store)
    c, _ = _assessed(store)
    approve_claim(store, c.claim_number)
    p = schedule_payout(store, c.claim_number)
    before_attempts = p.failed_attempts
    failed = mark_payout_failed(store, p.payout_id)
    assert failed.status == PayoutStatus.FAILED
    assert failed.last_failure_at is not None
    assert failed.failed_attempts == before_attempts + 1


def test_mark_payout_failed_increments_attempts(store: Store):
    _policy(store)
    c, _ = _assessed(store)
    approve_claim(store, c.claim_number)
    p = schedule_payout(store, c.claim_number)
    mark_payout_failed(store, p.payout_id)
    mark_payout_failed(store, p.payout_id)
    assert p.failed_attempts == 2
