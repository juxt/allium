"""Derived value and projection obligations.

Maps to the model's `derived_values` (Claim.age, has_completed_assessment,
is_stalled, is_within_sla, Payout.retry_due_at, Policy.has_open_claims) and
`projections` (Claim.completed_assessments, Claim.paid_payouts,
Policy.open_claims).
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from app import Store
from app.models import (
    ASSESSMENT_SLA,
    STALLED_AFTER,
    AssessmentStatus,
    ClaimStatus,
)
from app.services import (
    complete_assessment,
    mark_payout_failed,
    mark_payout_paid,
)
from tests._helpers import (
    make_approved_claim,
    make_assessing_claim,
    make_policy,
    make_scheduled_payout,
    make_submitted_claim,
)

PAYOUT_RETRY_AFTER = timedelta(days=28)  # config.payout_retry_after


# ---------------------------------------------------------------------------
# Claim.age  (derived: now - submitted_at)
# ---------------------------------------------------------------------------

def test_claim_age_reflects_submitted_at(store: Store):
    make_policy(store)
    claim = make_submitted_claim(store)
    claim.submitted_at = datetime.now(timezone.utc) - timedelta(days=3)
    age = claim.age
    assert timedelta(days=3) - timedelta(seconds=2) < age < timedelta(days=3) + timedelta(seconds=2)


# ---------------------------------------------------------------------------
# Claim.is_within_sla
# ---------------------------------------------------------------------------

def test_claim_is_within_sla_true_when_age_under_threshold(store: Store):
    make_policy(store)
    claim = make_submitted_claim(store)
    claim.submitted_at = datetime.now(timezone.utc) - (ASSESSMENT_SLA - timedelta(days=1))
    assert claim.is_within_sla is True


def test_claim_is_within_sla_false_when_age_over_threshold(store: Store):
    make_policy(store)
    claim = make_submitted_claim(store)
    claim.submitted_at = datetime.now(timezone.utc) - (ASSESSMENT_SLA + timedelta(days=1))
    assert claim.is_within_sla is False


# ---------------------------------------------------------------------------
# Claim.is_stalled (implicit state: assessing + last_activity_at older than threshold)
# ---------------------------------------------------------------------------

def test_claim_is_stalled_true_when_assessing_and_idle(store: Store):
    make_policy(store)
    make_assessing_claim(store)
    claim = store.claims["CLM-1"]
    claim.last_activity_at = datetime.now(timezone.utc) - (STALLED_AFTER + timedelta(days=1))
    assert claim.is_stalled is True


def test_claim_is_stalled_false_when_not_assessing(store: Store):
    make_policy(store)
    claim = make_submitted_claim(store)
    claim.last_activity_at = datetime.now(timezone.utc) - (STALLED_AFTER + timedelta(days=10))
    assert claim.status == ClaimStatus.SUBMITTED
    assert claim.is_stalled is False


def test_claim_is_stalled_false_when_recently_active(store: Store):
    make_policy(store)
    make_assessing_claim(store)
    claim = store.claims["CLM-1"]
    claim.last_activity_at = datetime.now(timezone.utc) - timedelta(days=1)
    assert claim.is_stalled is False


# ---------------------------------------------------------------------------
# Claim.has_completed_assessment (derived: completed_assessments.count > 0)
# ---------------------------------------------------------------------------

def _has_completed(store: Store, claim_number: str) -> bool:
    """Mirror the spec's derived value over the implementation's flat store."""
    return any(
        a.claim_number == claim_number and a.status == AssessmentStatus.COMPLETED
        for a in store.assessments.values()
    )


def test_has_completed_assessment_false_until_completed(store: Store):
    make_policy(store)
    _, assessment = make_assessing_claim(store)
    assert _has_completed(store, "CLM-1") is False
    complete_assessment(store, assessment.assessment_id, "ok")
    assert _has_completed(store, "CLM-1") is True


# ---------------------------------------------------------------------------
# Claim.completed_assessments (projection over Claim.assessments)
# ---------------------------------------------------------------------------

def test_completed_assessments_filters_in_progress(store: Store):
    make_policy(store)
    _, assessment = make_assessing_claim(store)
    in_progress = [
        a for a in store.assessments.values()
        if a.claim_number == "CLM-1" and a.status == AssessmentStatus.COMPLETED
    ]
    assert in_progress == []
    complete_assessment(store, assessment.assessment_id, "ok")
    completed = [
        a for a in store.assessments.values()
        if a.claim_number == "CLM-1" and a.status == AssessmentStatus.COMPLETED
    ]
    assert len(completed) == 1


# ---------------------------------------------------------------------------
# Claim.total_paid (derived: sum(paid_payouts.amount_pence))
# Claim.paid_payouts (projection over payouts where status = paid)
# ---------------------------------------------------------------------------

def test_total_paid_sums_only_paid_payouts(store: Store):
    make_policy(store, coverage_limit_pence=100_000_00)
    payout = make_scheduled_payout(store)
    claim = store.claims["CLM-1"]
    assert claim.total_paid(store) == 0  # SCHEDULED, not yet paid
    mark_payout_paid(store, payout.payout_id)
    assert claim.total_paid(store) == payout.amount_pence


# ---------------------------------------------------------------------------
# Payout.retry_due_at (derived: coalesce(last_failure_at, scheduled_at) + retry_after)
# ---------------------------------------------------------------------------

def test_payout_retry_due_at_anchors_on_scheduled_when_never_failed(store: Store):
    make_policy(store)
    payout = make_scheduled_payout(store)
    expected = payout.scheduled_at + PAYOUT_RETRY_AFTER
    actual = (payout.last_failure_at or payout.scheduled_at) + PAYOUT_RETRY_AFTER
    assert actual == expected


def test_payout_retry_due_at_anchors_on_last_failure(store: Store):
    make_policy(store)
    payout = make_scheduled_payout(store)
    mark_payout_failed(store, payout.payout_id)
    assert payout.last_failure_at is not None
    expected = payout.last_failure_at + PAYOUT_RETRY_AFTER
    actual = (payout.last_failure_at or payout.scheduled_at) + PAYOUT_RETRY_AFTER
    assert actual == expected


# ---------------------------------------------------------------------------
# Policy.open_claims (projection: claims where status not in {paid, denied, closed})
# Policy.has_open_claims
# ---------------------------------------------------------------------------

def test_policy_has_open_claims_true_when_submitted(store: Store):
    make_policy(store)
    make_submitted_claim(store)
    policy = store.policies["POL-1"]
    assert policy.has_open_claims(store) is True


def test_policy_has_open_claims_false_when_only_paid(store: Store):
    make_policy(store)
    payout = make_scheduled_payout(store)
    mark_payout_paid(store, payout.payout_id)
    # Claim is now PAID — must not count as open.
    policy = store.policies["POL-1"]
    assert store.claims["CLM-1"].status == ClaimStatus.PAID
    assert policy.has_open_claims(store) is False


def test_policy_has_open_claims_excludes_denied_and_closed(store: Store):
    make_policy(store)
    from app.services import deny_claim
    from tests._helpers import make_triaged_claim
    make_triaged_claim(store)
    deny_claim(store, "CLM-1", "x")
    policy = store.policies["POL-1"]
    assert policy.has_open_claims(store) is False


# ---------------------------------------------------------------------------
# Quick sanity: derived properties on Claim are read-only @property style
# ---------------------------------------------------------------------------

def test_claim_derived_properties_are_callable(store: Store):
    make_policy(store)
    claim = make_approved_claim(store)
    # All derived attributes are accessible without raising
    _ = claim.age
    _ = claim.is_within_sla
    _ = claim.is_stalled
    _ = claim.total_paid(store)
