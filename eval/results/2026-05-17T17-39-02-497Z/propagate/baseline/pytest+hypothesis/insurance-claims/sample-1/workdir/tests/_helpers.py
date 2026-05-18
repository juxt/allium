"""Factory helpers for propagated tests.

Each helper sets up the preconditions a rule requires so the rule itself can
be exercised in isolation. The names mirror the spec's transition edges.
"""
from __future__ import annotations

from datetime import datetime, timezone

from app import Store
from app.models import (
    Assessment,
    Claim,
    Payout,
    Policy,
    PolicyStatus,
)
from app.services import (
    approve_claim,
    complete_assessment,
    register_assessor,
    register_policy,
    schedule_payout,
    start_assessment,
    submit_claim,
    triage_claim,
)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def make_policy(
    store: Store,
    *,
    policy_number: str = "POL-1",
    holder: str = "Alice",
    coverage_limit_pence: int = 10_000_00,
    status: PolicyStatus = PolicyStatus.ACTIVE,
    holder_tags: set[str] | None = None,
) -> Policy:
    policy = register_policy(
        store,
        policy_number=policy_number,
        holder=holder,
        coverage_limit_pence=coverage_limit_pence,
        holder_tags=holder_tags or set(),
    )
    policy.status = status
    return policy


def make_assessor(
    store: Store, *, name: str = "Bob", specialties: set[str] | None = None
) -> None:
    register_assessor(store, name, specialties or {"vehicle"})


def make_submitted_claim(
    store: Store,
    *,
    claim_number: str = "CLM-1",
    policy_number: str = "POL-1",
    amount_pence: int = 1_000_00,
    incident_date: datetime | None = None,
) -> Claim:
    return submit_claim(
        store,
        claim_number=claim_number,
        policy_number=policy_number,
        incident_date=incident_date or _utcnow(),
        amount_claimed_pence=amount_pence,
    )


def make_triaged_claim(store: Store, **kw) -> Claim:
    claim = make_submitted_claim(store, **kw)
    return triage_claim(store, claim.claim_number)


def make_assessing_claim(
    store: Store, *, assessor_name: str = "Bob", **kw
) -> tuple[Claim, Assessment]:
    if assessor_name not in store.assessors:
        make_assessor(store, name=assessor_name)
    claim = make_triaged_claim(store, **kw)
    assessment = start_assessment(store, claim.claim_number, assessor_name)
    return claim, assessment


def make_claim_with_completed_assessment(
    store: Store, *, findings: str = "ok", **kw
) -> tuple[Claim, Assessment]:
    claim, assessment = make_assessing_claim(store, **kw)
    complete_assessment(store, assessment.assessment_id, findings)
    return claim, assessment


def make_approved_claim(store: Store, **kw) -> Claim:
    claim, _ = make_claim_with_completed_assessment(store, **kw)
    return approve_claim(store, claim.claim_number)


def make_scheduled_payout(store: Store, **kw) -> Payout:
    claim = make_approved_claim(store, **kw)
    return schedule_payout(store, claim.claim_number)


def make_failed_payout(store: Store, **kw) -> Payout:
    payout = make_scheduled_payout(store, **kw)
    from app.services import mark_payout_failed
    return mark_payout_failed(store, payout.payout_id)
