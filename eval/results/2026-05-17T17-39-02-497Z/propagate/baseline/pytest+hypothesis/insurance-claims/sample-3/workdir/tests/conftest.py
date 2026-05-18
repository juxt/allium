"""Shared fixtures and helpers for the propagated test suite.

The implementation uses a process-global ``app.store`` for the route layer, but
the service layer accepts an explicit ``Store`` argument. Most tests therefore
pass a freshly constructed ``Store`` instance directly. The ``clean_store``
fixture additionally resets the shared global so route-level tests do not bleed
state into each other.
"""
from __future__ import annotations

import sys
from datetime import datetime, timezone
from pathlib import Path

import pytest

# Make the fixture app importable regardless of where pytest is invoked.
_WORKDIR = Path(__file__).resolve().parent.parent
if str(_WORKDIR) not in sys.path:
    sys.path.insert(0, str(_WORKDIR))

import app as app_pkg  # noqa: E402
from app.models import (  # noqa: E402
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
from app.services import (  # noqa: E402
    register_assessor,
    register_policy,
    submit_claim,
    triage_claim,
)


@pytest.fixture
def store():
    """A fresh in-memory Store, isolated per test."""
    return app_pkg.Store()


@pytest.fixture
def clean_store():
    """Reset the global ``app.store`` to a fresh Store for route-level tests.

    The route handlers reference the module-level ``store`` by closure, so we
    mutate the same object in place rather than rebinding the attribute.
    """
    fresh = app_pkg.Store()
    app_pkg.store.policies = fresh.policies
    app_pkg.store.claims = fresh.claims
    app_pkg.store.assessors = fresh.assessors
    app_pkg.store.assessments = fresh.assessments
    app_pkg.store.payouts = fresh.payouts
    app_pkg.store.incident_reports = fresh.incident_reports
    return app_pkg.store


# --- factory helpers -------------------------------------------------------

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
    """Convenience constructor for tz-aware UTC datetimes."""
    return datetime(*args, **kwargs, tzinfo=timezone.utc)


__all__ = [
    "Assessment",
    "AssessmentStatus",
    "Assessor",
    "Claim",
    "ClaimStatus",
    "Payout",
    "PayoutStatus",
    "Policy",
    "PolicyStatus",
    "make_assessor",
    "make_policy",
    "make_submitted_claim",
    "make_triaged_claim",
    "utc",
]
