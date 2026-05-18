"""Test factory helpers — kept separate from conftest so test modules can
import them directly without relying on pytest's autodiscovery path.
"""
from __future__ import annotations

from datetime import datetime, timezone

from app.models import Assessor, Claim, Policy, PolicyStatus
from app.services import (
    register_assessor,
    register_policy,
    submit_claim,
    triage_claim,
)


def make_policy(
    store,
    *,
    policy_number: str = "POL-1",
    holder: str = "Alice",
    coverage_limit_pence: int = 100_000_00,
    holder_tags: set[str] | None = None,
    status: PolicyStatus = PolicyStatus.ACTIVE,
) -> Policy:
    policy = register_policy(
        store,
        policy_number=policy_number,
        holder=holder,
        coverage_limit_pence=coverage_limit_pence,
        holder_tags=holder_tags,
    )
    policy.status = status
    return policy


def make_assessor(store, *, name: str = "Bob", specialties=None) -> Assessor:
    return register_assessor(store, name, set(specialties or {"fire"}))


def make_submitted_claim(
    store,
    *,
    claim_number: str = "CLM-1",
    policy_number: str = "POL-1",
    incident_date: datetime | None = None,
    amount_claimed_pence: int = 1_000_00,
) -> Claim:
    return submit_claim(
        store,
        claim_number=claim_number,
        policy_number=policy_number,
        incident_date=incident_date or datetime.now(timezone.utc),
        amount_claimed_pence=amount_claimed_pence,
    )


def make_triaged_claim(store, **kwargs) -> Claim:
    claim = make_submitted_claim(store, **kwargs)
    return triage_claim(store, claim.claim_number)


def utc(*args, **kwargs) -> datetime:
    return datetime(*args, **kwargs, tzinfo=timezone.utc)
