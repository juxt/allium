"""Invariant tests propagated from spec.allium.

The spec declares four invariants. We verify each by:
  1. assertion-based tests on hand-built positive and negative examples
  2. a stateful Hypothesis test that walks the claim transition graph and
     re-checks the invariants after every transition
"""
from __future__ import annotations

from datetime import datetime, timezone

import pytest
from hypothesis import HealthCheck, assume, given, note, settings
from hypothesis import strategies as st
from hypothesis.stateful import (
    RuleBasedStateMachine,
    initialize,
    invariant,
    precondition,
    rule,
)

from app import Store
from app.models import (
    Assessment,
    AssessmentStatus,
    Claim,
    ClaimStatus,
    Payout,
    PayoutStatus,
)
from app.services import (
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


# ---------------------------------------------------------------------------
# Invariant 1: ApprovedClaimsHaveCompletedAssessment
#   for c in Claims: c.status in {approved, paid} => c.has_completed_assessment
# ---------------------------------------------------------------------------

def _has_completed_assessment(store: Store, claim_number: str) -> bool:
    return any(
        a.claim_number == claim_number and a.status == AssessmentStatus.COMPLETED
        for a in store.assessments.values()
    )


def _check_invariants(store: Store) -> None:
    """All four spec invariants — checked at every state."""
    for c in store.claims.values():
        # ApprovedClaimsHaveCompletedAssessment
        if c.status in (ClaimStatus.APPROVED, ClaimStatus.PAID):
            assert _has_completed_assessment(store, c.claim_number), (
                f"claim {c.claim_number} is {c.status.value} without a "
                f"completed assessment"
            )
        # ClaimAmountWithinCoverage
        pol = store.policies.get(c.policy_number)
        assert pol is not None
        assert c.amount_claimed_pence <= pol.coverage_limit_pence, (
            f"claim {c.claim_number} amount {c.amount_claimed_pence} exceeds "
            f"coverage {pol.coverage_limit_pence}"
        )
        # DeniedClaimsHaveReason
        if c.status == ClaimStatus.DENIED:
            assert c.denial_reason is not None, (
                f"denied claim {c.claim_number} has no denial_reason"
            )
    for p in store.payouts:
        # PayoutAmountMatchesClaim
        claim = store.claims.get(p.claim_number)
        assert claim is not None
        assert p.amount_pence == claim.amount_claimed_pence, (
            f"payout {p.payout_id} amount {p.amount_pence} does not match "
            f"claim amount {claim.amount_claimed_pence}"
        )


def test_invariant_approved_implies_completed_assessment_positive_example():
    store = Store()
    register_policy(store, policy_number="P", holder="A",
                    coverage_limit_pence=10_000_00)
    submit_claim(store, claim_number="C", policy_number="P",
                 incident_date=datetime.now(timezone.utc),
                 amount_claimed_pence=1_000_00)
    triage_claim(store, "C")
    register_assessor(store, "Mira", {"motor"})
    a = start_assessment(store, "C", "Mira")
    complete_assessment(store, a.assessment_id, "ok")
    approve_claim(store, "C")
    _check_invariants(store)


def test_invariant_approved_implies_completed_assessment_negative_example():
    """Directly construct a violation; verify the checker catches it."""
    store = Store()
    register_policy(store, policy_number="P", holder="A",
                    coverage_limit_pence=10_000_00)
    c = Claim(claim_number="C", policy_number="P",
              incident_date=datetime.now(timezone.utc),
              amount_claimed_pence=1_000_00,
              status=ClaimStatus.APPROVED)
    store.claims["C"] = c
    with pytest.raises(AssertionError):
        _check_invariants(store)


def test_invariant_claim_amount_within_coverage_negative_example():
    store = Store()
    register_policy(store, policy_number="P", holder="A",
                    coverage_limit_pence=100)
    c = Claim(claim_number="C", policy_number="P",
              incident_date=datetime.now(timezone.utc),
              amount_claimed_pence=1_000_000,
              status=ClaimStatus.SUBMITTED)
    store.claims["C"] = c
    with pytest.raises(AssertionError):
        _check_invariants(store)


def test_invariant_denied_claims_have_reason_negative_example():
    store = Store()
    register_policy(store, policy_number="P", holder="A",
                    coverage_limit_pence=10_000_00)
    c = Claim(claim_number="C", policy_number="P",
              incident_date=datetime.now(timezone.utc),
              amount_claimed_pence=1_000_00,
              status=ClaimStatus.DENIED, denial_reason=None)
    store.claims["C"] = c
    with pytest.raises(AssertionError):
        _check_invariants(store)


def test_invariant_payout_amount_matches_claim_negative_example():
    store = Store()
    register_policy(store, policy_number="P", holder="A",
                    coverage_limit_pence=10_000_00)
    c = Claim(claim_number="C", policy_number="P",
              incident_date=datetime.now(timezone.utc),
              amount_claimed_pence=1_000_00,
              status=ClaimStatus.APPROVED)
    store.claims["C"] = c
    store.assessments["a"] = Assessment(
        assessment_id="a", claim_number="C", assessor_name="m",
        status=AssessmentStatus.COMPLETED,
    )
    store.payouts.append(Payout(payout_id="p", claim_number="C",
                                amount_pence=999))
    with pytest.raises(AssertionError):
        _check_invariants(store)


# ---------------------------------------------------------------------------
# Property-based: invariants hold after any valid rule sequence.
# ---------------------------------------------------------------------------

class ClaimLifecycleMachine(RuleBasedStateMachine):
    """Walks the claim transition graph via the real service functions.

    Every rule mirrors a spec rule; pre/postconditions match the spec's
    `requires` clauses. Hypothesis explores arbitrary valid orderings and
    `_check_invariants` is asserted after each step.
    """

    def __init__(self) -> None:
        super().__init__()
        self.store: Store = Store()
        self._claim_seq = 0
        self._assessment_ids: list[str] = []

    @initialize()
    def setup(self) -> None:
        register_policy(
            self.store, policy_number="POL",
            holder="Alice", coverage_limit_pence=1_000_000_00,
            holder_tags={"trusted"},
        )
        register_assessor(self.store, "Mira", {"motor"})

    @rule(amount=st.integers(min_value=1, max_value=1_000_000_00))
    def submit(self, amount: int) -> None:
        self._claim_seq += 1
        cn = f"C{self._claim_seq}"
        submit_claim(
            self.store, claim_number=cn, policy_number="POL",
            incident_date=datetime.now(timezone.utc),
            amount_claimed_pence=amount,
        )

    @rule(data=st.data())
    @precondition(lambda self: any(
        c.status == ClaimStatus.SUBMITTED for c in self.store.claims.values()
    ))
    def triage(self, data) -> None:
        cn = data.draw(st.sampled_from([
            c.claim_number for c in self.store.claims.values()
            if c.status == ClaimStatus.SUBMITTED
        ]))
        triage_claim(self.store, cn)

    @rule(data=st.data())
    @precondition(lambda self: any(
        c.status == ClaimStatus.TRIAGED for c in self.store.claims.values()
    ))
    def begin_assessment(self, data) -> None:
        cn = data.draw(st.sampled_from([
            c.claim_number for c in self.store.claims.values()
            if c.status == ClaimStatus.TRIAGED
        ]))
        a = start_assessment(self.store, cn, "Mira")
        self._assessment_ids.append(a.assessment_id)

    @rule(data=st.data())
    @precondition(lambda self: any(
        a.status == AssessmentStatus.IN_PROGRESS
        for a in self.store.assessments.values()
    ))
    def finish_assessment(self, data) -> None:
        aid = data.draw(st.sampled_from([
            a.assessment_id for a in self.store.assessments.values()
            if a.status == AssessmentStatus.IN_PROGRESS
        ]))
        complete_assessment(self.store, aid, "ok")

    @rule(data=st.data())
    @precondition(lambda self: any(
        c.status == ClaimStatus.ASSESSING
        and _has_completed_assessment(self.store, c.claim_number)
        for c in self.store.claims.values()
    ))
    def approve(self, data) -> None:
        cn = data.draw(st.sampled_from([
            c.claim_number for c in self.store.claims.values()
            if c.status == ClaimStatus.ASSESSING
            and _has_completed_assessment(self.store, c.claim_number)
        ]))
        approve_claim(self.store, cn)

    @rule(data=st.data(), reason=st.text(min_size=1, max_size=20))
    @precondition(lambda self: any(
        c.status in (ClaimStatus.TRIAGED, ClaimStatus.ASSESSING)
        for c in self.store.claims.values()
    ))
    def deny(self, data, reason: str) -> None:
        cn = data.draw(st.sampled_from([
            c.claim_number for c in self.store.claims.values()
            if c.status in (ClaimStatus.TRIAGED, ClaimStatus.ASSESSING)
        ]))
        deny_claim(self.store, cn, reason)

    @rule(data=st.data())
    @precondition(lambda self: any(
        c.status == ClaimStatus.APPROVED for c in self.store.claims.values()
    ))
    def schedule(self, data) -> None:
        cn = data.draw(st.sampled_from([
            c.claim_number for c in self.store.claims.values()
            if c.status == ClaimStatus.APPROVED
        ]))
        schedule_payout(self.store, cn)

    @rule(data=st.data())
    @precondition(lambda self: any(
        p.status == PayoutStatus.SCHEDULED for p in self.store.payouts
    ))
    def pay(self, data) -> None:
        pid = data.draw(st.sampled_from([
            p.payout_id for p in self.store.payouts
            if p.status == PayoutStatus.SCHEDULED
        ]))
        mark_payout_paid(self.store, pid)

    @invariant()
    def all_spec_invariants_hold(self) -> None:
        _check_invariants(self.store)


TestClaimLifecycle = ClaimLifecycleMachine.TestCase
TestClaimLifecycle.settings = settings(
    max_examples=30,
    stateful_step_count=25,
    suppress_health_check=[HealthCheck.filter_too_much],
)


# ---------------------------------------------------------------------------
# Targeted property: a Claim that survives the SUBMITTED -> PAID happy path
# must satisfy all invariants at every intermediate state.
# ---------------------------------------------------------------------------

@given(
    coverage=st.integers(min_value=1_000_00, max_value=1_000_000_00),
    amount_frac=st.floats(min_value=0.001, max_value=1.0,
                          allow_nan=False, allow_infinity=False),
)
@settings(max_examples=20)
def test_happy_path_preserves_invariants(coverage: int, amount_frac: float):
    amount = max(1, int(coverage * amount_frac))
    assume(amount <= coverage)
    store = Store()
    register_policy(store, policy_number="P", holder="A",
                    coverage_limit_pence=coverage)
    register_assessor(store, "Mira", {"motor"})
    submit_claim(store, claim_number="C", policy_number="P",
                 incident_date=datetime.now(timezone.utc),
                 amount_claimed_pence=amount)
    _check_invariants(store)
    triage_claim(store, "C")
    _check_invariants(store)
    a = start_assessment(store, "C", "Mira")
    _check_invariants(store)
    complete_assessment(store, a.assessment_id, "ok")
    _check_invariants(store)
    approve_claim(store, "C")
    _check_invariants(store)
    p = schedule_payout(store, "C")
    _check_invariants(store)
    mark_payout_paid(store, p.payout_id)
    _check_invariants(store)
    note(f"final status: {store.claims['C'].status.value}")


# ---------------------------------------------------------------------------
# Negative-state-machine property: submit_claim rejects when amount > coverage.
# ---------------------------------------------------------------------------

@given(
    coverage=st.integers(min_value=1, max_value=1_000_000_00),
    extra=st.integers(min_value=1, max_value=1_000_000_00),
)
@settings(max_examples=20)
def test_submit_claim_invariant_blocks_overcoverage(coverage: int, extra: int):
    """`SubmitClaim` enforces ClaimAmountWithinCoverage at the boundary."""
    store = Store()
    register_policy(store, policy_number="P", holder="A",
                    coverage_limit_pence=coverage)
    from app.services import ClaimRejected
    with pytest.raises(ClaimRejected):
        submit_claim(store, claim_number="C", policy_number="P",
                     incident_date=datetime.now(timezone.utc),
                     amount_claimed_pence=coverage + extra)
