"""Business logic for claim lifecycle transitions.

Each function enforces the guards required to move a claim from one status to
the next, mutates the relevant entities in `store`, and returns the changed
entity. The transitions intentionally fan out across multiple call sites:
`approve_claim` is used both from the adjuster API (routes.py) and from the
nightly auto-approval scheduler (jobs.py).
"""
from __future__ import annotations

import uuid
from datetime import datetime

from app import Store
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
    _utcnow,
)


class InvalidTransition(Exception):
    pass


class ClaimRejected(Exception):
    pass


def submit_claim(
    store: Store,
    *,
    claim_number: str,
    policy_number: str,
    incident_date: datetime,
    amount_claimed_pence: int,
) -> Claim:
    policy = store.policies.get(policy_number)
    if policy is None:
        raise ClaimRejected(f"unknown policy {policy_number}")
    if policy.status != PolicyStatus.ACTIVE:
        raise ClaimRejected(f"policy {policy_number} is {policy.status.value}")
    if amount_claimed_pence > policy.coverage_limit_pence:
        raise ClaimRejected("amount claimed exceeds coverage limit")

    claim = Claim(
        claim_number=claim_number,
        policy_number=policy_number,
        incident_date=incident_date,
        amount_claimed_pence=amount_claimed_pence,
    )
    store.claims[claim_number] = claim
    return claim


def triage_claim(store: Store, claim_number: str) -> Claim:
    claim = _require_claim(store, claim_number)
    if claim.status != ClaimStatus.SUBMITTED:
        raise InvalidTransition(f"cannot triage from {claim.status.value}")
    claim.status = ClaimStatus.TRIAGED
    claim.touch()
    return claim


def start_assessment(store: Store, claim_number: str, assessor_name: str) -> Assessment:
    claim = _require_claim(store, claim_number)
    if claim.status != ClaimStatus.TRIAGED:
        raise InvalidTransition(f"cannot assess from {claim.status.value}")
    if assessor_name not in store.assessors:
        raise ClaimRejected(f"unknown assessor {assessor_name}")

    assessment = Assessment(
        assessment_id=str(uuid.uuid4()),
        claim_number=claim_number,
        assessor_name=assessor_name,
        status=AssessmentStatus.IN_PROGRESS,
        started_at=_utcnow(),
    )
    store.assessments[assessment.assessment_id] = assessment
    claim.status = ClaimStatus.ASSESSING
    claim.touch()
    return assessment


def complete_assessment(store: Store, assessment_id: str, findings: str) -> Assessment:
    assessment = store.assessments.get(assessment_id)
    if assessment is None:
        raise ClaimRejected(f"unknown assessment {assessment_id}")
    if assessment.status != AssessmentStatus.IN_PROGRESS:
        raise InvalidTransition(f"cannot complete from {assessment.status.value}")
    assessment.findings = findings
    assessment.status = AssessmentStatus.COMPLETED
    assessment.completed_at = _utcnow()

    claim = store.claims.get(assessment.claim_number)
    if claim is not None:
        claim.touch()
    return assessment


def approve_claim(store: Store, claim_number: str) -> Claim:
    """Guarded transition.

    A claim can only be approved when (a) it is currently `assessing` and
    (b) there exists a completed assessment for it.
    """
    claim = _require_claim(store, claim_number)
    if claim.status != ClaimStatus.ASSESSING:
        raise InvalidTransition(f"cannot approve from {claim.status.value}")
    if not _has_completed_assessment(store, claim_number):
        raise InvalidTransition("claim has no completed assessment")

    claim.status = ClaimStatus.APPROVED
    claim.touch()
    return claim


def deny_claim(store: Store, claim_number: str, reason: str) -> Claim:
    claim = _require_claim(store, claim_number)
    if claim.status not in (ClaimStatus.TRIAGED, ClaimStatus.ASSESSING):
        raise InvalidTransition(f"cannot deny from {claim.status.value}")
    claim.status = ClaimStatus.DENIED
    claim.denial_reason = reason
    claim.touch()
    return claim


def schedule_payout(store: Store, claim_number: str) -> Payout:
    claim = _require_claim(store, claim_number)
    if claim.status != ClaimStatus.APPROVED:
        raise InvalidTransition(f"cannot schedule payout from {claim.status.value}")

    payout = Payout(
        payout_id=str(uuid.uuid4()),
        claim_number=claim_number,
        amount_pence=claim.amount_claimed_pence,
    )
    store.payouts.append(payout)
    claim.touch()
    return payout


def mark_payout_paid(store: Store, payout_id: str) -> Payout:
    payout = _require_payout(store, payout_id)
    payout.status = PayoutStatus.PAID
    payout.paid_at = _utcnow()
    claim = store.claims.get(payout.claim_number)
    if claim is not None:
        claim.status = ClaimStatus.PAID
        claim.touch()
    return payout


def mark_payout_failed(store: Store, payout_id: str) -> Payout:
    payout = _require_payout(store, payout_id)
    payout.status = PayoutStatus.FAILED
    payout.failed_attempts += 1
    payout.last_failure_at = _utcnow()
    return payout


def register_assessor(store: Store, name: str, specialties: set[str]) -> Assessor:
    assessor = Assessor(name=name, specialties=set(specialties))
    store.assessors[name] = assessor
    return assessor


def register_policy(
    store: Store,
    *,
    policy_number: str,
    holder: str,
    coverage_limit_pence: int,
    holder_tags: set[str] | None = None,
) -> Policy:
    policy = Policy(
        policy_number=policy_number,
        holder=holder,
        coverage_limit_pence=coverage_limit_pence,
        holder_tags=holder_tags or set(),
    )
    store.policies[policy_number] = policy
    return policy


def _require_claim(store: Store, claim_number: str) -> Claim:
    claim = store.claims.get(claim_number)
    if claim is None:
        raise ClaimRejected(f"unknown claim {claim_number}")
    return claim


def _require_payout(store: Store, payout_id: str) -> Payout:
    for payout in store.payouts:
        if payout.payout_id == payout_id:
            return payout
    raise ClaimRejected(f"unknown payout {payout_id}")


def _has_completed_assessment(store: Store, claim_number: str) -> bool:
    return any(
        a.claim_number == claim_number and a.status == AssessmentStatus.COMPLETED
        for a in store.assessments.values()
    )
