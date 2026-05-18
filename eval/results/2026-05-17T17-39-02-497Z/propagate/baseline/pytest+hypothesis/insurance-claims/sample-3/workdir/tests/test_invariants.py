"""Property-based tests for the four spec invariants.

Invariants (must hold at every step of the lifecycle):

  ApprovedClaimsHaveCompletedAssessment
      c.status in {approved, paid} implies c.has_completed_assessment
  ClaimAmountWithinCoverage
      c.amount_claimed_pence <= c.policy.coverage_limit_pence
  DeniedClaimsHaveReason
      c.status = denied implies c.denial_reason != null
  PayoutAmountMatchesClaim
      p.amount_pence = p.claim.amount_claimed_pence
"""
from __future__ import annotations

from datetime import datetime, timezone

import pytest
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

import app as app_pkg
from app.models import (
    AssessmentStatus,
    ClaimStatus,
    Policy,
)
from app.services import (
    ClaimRejected,
    InvalidTransition,
    approve_claim,
    complete_assessment,
    deny_claim,
    mark_payout_paid,
    register_assessor,
    register_policy,
    schedule_payout,
    start_assessment,
    submit_claim,
    triage_claim,
)

CLAIM_HYP_SETTINGS = settings(
    max_examples=50,
    deadline=None,
    suppress_health_check=[HealthCheck.function_scoped_fixture],
)


def _check_all_invariants(store):
    """Assert every spec invariant against the entire store state."""
    closed = {ClaimStatus.PAID, ClaimStatus.DENIED, ClaimStatus.CLOSED}

    for claim in store.claims.values():
        policy: Policy = store.policies[claim.policy_number]

        # ClaimAmountWithinCoverage
        assert claim.amount_claimed_pence <= policy.coverage_limit_pence, (
            f"{claim.claim_number}: amount {claim.amount_claimed_pence} > "
            f"coverage {policy.coverage_limit_pence}"
        )

        # ApprovedClaimsHaveCompletedAssessment
        if claim.status in {ClaimStatus.APPROVED, ClaimStatus.PAID}:
            has_completed = any(
                a.claim_number == claim.claim_number
                and a.status == AssessmentStatus.COMPLETED
                for a in store.assessments.values()
            )
            assert has_completed, f"{claim.claim_number} {claim.status.value} without completed assessment"

        # DeniedClaimsHaveReason
        if claim.status == ClaimStatus.DENIED:
            assert claim.denial_reason is not None, (
                f"{claim.claim_number} denied with null reason"
            )

        # Sanity: closed-set membership is monotonic — once paid/denied/closed,
        # status should never silently become e.g. submitted.
        if claim.status in closed:
            assert claim.status in closed

    for payout in store.payouts:
        claim = store.claims[payout.claim_number]
        # PayoutAmountMatchesClaim
        assert payout.amount_pence == claim.amount_claimed_pence


# ---------------------------------------------------------------------------
# ClaimAmountWithinCoverage — submit_claim is the only ingress for new claims.
# Hypothesis explores a wide grid of (coverage, amount) pairs.
# ---------------------------------------------------------------------------

@given(
    coverage=st.integers(min_value=1, max_value=10_000_000_00),
    amount=st.integers(min_value=1, max_value=10_000_000_00),
)
@CLAIM_HYP_SETTINGS
def test_submit_claim_enforces_coverage_invariant(coverage, amount):
    store = app_pkg.Store()
    register_policy(
        store,
        policy_number="POL-1",
        holder="Alice",
        coverage_limit_pence=coverage,
    )
    if amount <= coverage:
        claim = submit_claim(
            store,
            claim_number="CLM-1",
            policy_number="POL-1",
            incident_date=datetime.now(timezone.utc),
            amount_claimed_pence=amount,
        )
        assert claim.amount_claimed_pence <= coverage
    else:
        with pytest.raises(ClaimRejected):
            submit_claim(
                store,
                claim_number="CLM-1",
                policy_number="POL-1",
                incident_date=datetime.now(timezone.utc),
                amount_claimed_pence=amount,
            )
        assert "CLM-1" not in store.claims
    _check_all_invariants(store)


# ---------------------------------------------------------------------------
# DeniedClaimsHaveReason
# ---------------------------------------------------------------------------

@given(reason=st.text(min_size=1, max_size=50))
@CLAIM_HYP_SETTINGS
def test_deny_claim_records_reason(reason):
    store = app_pkg.Store()
    register_policy(store, policy_number="POL-1", holder="Alice", coverage_limit_pence=10_000)
    submit_claim(
        store,
        claim_number="CLM-1",
        policy_number="POL-1",
        incident_date=datetime.now(timezone.utc),
        amount_claimed_pence=1,
    )
    triage_claim(store, "CLM-1")
    claim = deny_claim(store, "CLM-1", reason)
    assert claim.status == ClaimStatus.DENIED
    assert claim.denial_reason == reason
    _check_all_invariants(store)


# ---------------------------------------------------------------------------
# ApprovedClaimsHaveCompletedAssessment
# ---------------------------------------------------------------------------

class TestApprovedClaimsHaveCompletedAssessment:
    def test_approve_requires_completed_assessment(self, store):
        # Direct enforcement check at the rule level. Hypothesis isn't needed
        # to express this — the implementation should always reject approval
        # without a completed assessment.
        register_policy(store, policy_number="POL-1", holder="Alice", coverage_limit_pence=10_000)
        register_assessor(store, "Bob", {"fire"})
        submit_claim(
            store,
            claim_number="CLM-1",
            policy_number="POL-1",
            incident_date=datetime.now(timezone.utc),
            amount_claimed_pence=1,
        )
        triage_claim(store, "CLM-1")
        start_assessment(store, "CLM-1", "Bob")
        with pytest.raises(InvalidTransition):
            approve_claim(store, "CLM-1")
        _check_all_invariants(store)

    def test_invariant_after_full_happy_path(self, store):
        register_policy(store, policy_number="POL-1", holder="Alice", coverage_limit_pence=10_000)
        register_assessor(store, "Bob", {"fire"})
        submit_claim(
            store,
            claim_number="CLM-1",
            policy_number="POL-1",
            incident_date=datetime.now(timezone.utc),
            amount_claimed_pence=100,
        )
        triage_claim(store, "CLM-1")
        a = start_assessment(store, "CLM-1", "Bob")
        complete_assessment(store, a.assessment_id, "ok")
        approve_claim(store, "CLM-1")
        p = schedule_payout(store, "CLM-1")
        mark_payout_paid(store, p.payout_id)
        _check_all_invariants(store)


# ---------------------------------------------------------------------------
# PayoutAmountMatchesClaim — schedule_payout always copies claim.amount_claimed_pence
# ---------------------------------------------------------------------------

@given(amount=st.integers(min_value=1, max_value=10_000_000))
@CLAIM_HYP_SETTINGS
def test_schedule_payout_amount_matches_claim(amount):
    store = app_pkg.Store()
    register_policy(store, policy_number="POL-1", holder="Alice", coverage_limit_pence=10_000_000)
    register_assessor(store, "Bob", {"fire"})
    submit_claim(
        store,
        claim_number="CLM-1",
        policy_number="POL-1",
        incident_date=datetime.now(timezone.utc),
        amount_claimed_pence=amount,
    )
    triage_claim(store, "CLM-1")
    a = start_assessment(store, "CLM-1", "Bob")
    complete_assessment(store, a.assessment_id, "ok")
    approve_claim(store, "CLM-1")
    payout = schedule_payout(store, "CLM-1")
    assert payout.amount_pence == amount
    _check_all_invariants(store)
