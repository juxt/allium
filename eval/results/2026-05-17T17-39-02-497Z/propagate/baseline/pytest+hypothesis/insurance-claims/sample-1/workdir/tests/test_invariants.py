"""Property-based tests for the four spec invariants.

Spec invariants exercised:

* ApprovedClaimsHaveCompletedAssessment — c.status in {approved, paid}
  implies c.has_completed_assessment
* ClaimAmountWithinCoverage — c.amount_claimed_pence <= c.policy.coverage_limit_pence
* DeniedClaimsHaveReason — c.status = denied implies c.denial_reason != null
* PayoutAmountMatchesClaim — p.amount_pence = p.claim.amount_claimed_pence

We use a Hypothesis `RuleBasedStateMachine` to walk random valid paths
through the claim/payout lifecycle and check all four invariants after
every step. The state machine is the fullest expression of the spec's
transition graph the propagate skill calls for.
"""
from __future__ import annotations

from datetime import datetime, timezone

from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st
from hypothesis.stateful import RuleBasedStateMachine, invariant, rule

from app import Store
from app.models import AssessmentStatus, ClaimStatus, PayoutStatus
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


CLOSED_STATUSES = {ClaimStatus.PAID, ClaimStatus.DENIED, ClaimStatus.CLOSED}


def _has_completed_assessment(store: Store, claim_number: str) -> bool:
    return any(
        a.claim_number == claim_number and a.status == AssessmentStatus.COMPLETED
        for a in store.assessments.values()
    )


def _check_invariants(store: Store) -> None:
    for claim in store.claims.values():
        # ApprovedClaimsHaveCompletedAssessment
        if claim.status in {ClaimStatus.APPROVED, ClaimStatus.PAID}:
            assert _has_completed_assessment(store, claim.claim_number), (
                f"approved/paid claim {claim.claim_number} has no completed assessment"
            )
        # ClaimAmountWithinCoverage
        policy = store.policies[claim.policy_number]
        assert claim.amount_claimed_pence <= policy.coverage_limit_pence, (
            f"claim {claim.claim_number} amount exceeds coverage"
        )
        # DeniedClaimsHaveReason
        if claim.status == ClaimStatus.DENIED:
            assert claim.denial_reason is not None, (
                f"denied claim {claim.claim_number} has no denial_reason"
            )
    # PayoutAmountMatchesClaim
    for payout in store.payouts:
        claim = store.claims.get(payout.claim_number)
        assert claim is not None, f"payout {payout.payout_id} references missing claim"
        assert payout.amount_pence == claim.amount_claimed_pence, (
            f"payout {payout.payout_id} amount diverges from claim"
        )


# ---------------------------------------------------------------------------
# Stateful PBT: walks random valid lifecycle paths
# ---------------------------------------------------------------------------

class ClaimLifecycleMachine(RuleBasedStateMachine):
    def __init__(self) -> None:
        super().__init__()
        self.store = Store()
        register_assessor(self.store, "Bob", {"vehicle"})
        register_policy(
            self.store,
            policy_number="POL-1",
            holder="Alice",
            coverage_limit_pence=1_000_000_00,
        )
        self._claim_counter = 0
        self._payout_counter = 0

    @rule(amount_pence=st.integers(min_value=1, max_value=1_000_000_00))
    def submit_claim(self, amount_pence: int) -> None:
        self._claim_counter += 1
        try:
            submit_claim(
                self.store,
                claim_number=f"C{self._claim_counter}",
                policy_number="POL-1",
                incident_date=datetime.now(timezone.utc),
                amount_claimed_pence=amount_pence,
            )
        except ClaimRejected:
            pass

    @rule(data=st.data())
    def triage(self, data) -> None:
        eligible = [c for c in self.store.claims.values() if c.status == ClaimStatus.SUBMITTED]
        if not eligible:
            return
        claim = data.draw(st.sampled_from(eligible))
        try:
            triage_claim(self.store, claim.claim_number)
        except InvalidTransition:
            pass

    @rule(data=st.data())
    def start_assessment(self, data) -> None:
        eligible = [c for c in self.store.claims.values() if c.status == ClaimStatus.TRIAGED]
        if not eligible:
            return
        claim = data.draw(st.sampled_from(eligible))
        try:
            start_assessment(self.store, claim.claim_number, "Bob")
        except InvalidTransition:
            pass

    @rule(
        data=st.data(),
        findings=st.text(min_size=1, max_size=20),
    )
    def complete_assessment(self, data, findings: str) -> None:
        eligible = [
            a for a in self.store.assessments.values()
            if a.status == AssessmentStatus.IN_PROGRESS
        ]
        if not eligible:
            return
        assessment = data.draw(st.sampled_from(eligible))
        try:
            complete_assessment(self.store, assessment.assessment_id, findings)
        except InvalidTransition:
            pass

    @rule(data=st.data())
    def approve(self, data) -> None:
        eligible = [
            c for c in self.store.claims.values()
            if c.status == ClaimStatus.ASSESSING
            and _has_completed_assessment(self.store, c.claim_number)
        ]
        if not eligible:
            return
        claim = data.draw(st.sampled_from(eligible))
        try:
            approve_claim(self.store, claim.claim_number)
        except InvalidTransition:
            pass

    @rule(data=st.data(), reason=st.text(min_size=1, max_size=20))
    def deny(self, data, reason: str) -> None:
        eligible = [
            c for c in self.store.claims.values()
            if c.status in {ClaimStatus.TRIAGED, ClaimStatus.ASSESSING}
        ]
        if not eligible:
            return
        claim = data.draw(st.sampled_from(eligible))
        try:
            deny_claim(self.store, claim.claim_number, reason)
        except InvalidTransition:
            pass

    @rule(data=st.data())
    def schedule_payout(self, data) -> None:
        eligible = [c for c in self.store.claims.values() if c.status == ClaimStatus.APPROVED]
        if not eligible:
            return
        claim = data.draw(st.sampled_from(eligible))
        try:
            schedule_payout(self.store, claim.claim_number)
        except InvalidTransition:
            pass

    @rule(data=st.data())
    def mark_payout_paid(self, data) -> None:
        eligible = [
            p for p in self.store.payouts
            if p.status in {PayoutStatus.SCHEDULED, PayoutStatus.FAILED}
        ]
        if not eligible:
            return
        payout = data.draw(st.sampled_from(eligible))
        mark_payout_paid(self.store, payout.payout_id)

    @rule(data=st.data())
    def mark_payout_failed(self, data) -> None:
        eligible = [
            p for p in self.store.payouts
            if p.status in {PayoutStatus.SCHEDULED, PayoutStatus.FAILED}
        ]
        if not eligible:
            return
        payout = data.draw(st.sampled_from(eligible))
        mark_payout_failed(self.store, payout.payout_id)

    @invariant()
    def spec_invariants_hold(self) -> None:
        _check_invariants(self.store)


TestClaimLifecycle = ClaimLifecycleMachine.TestCase
TestClaimLifecycle.settings = settings(
    max_examples=50,
    stateful_step_count=30,
    deadline=None,
    suppress_health_check=[HealthCheck.too_slow, HealthCheck.filter_too_much],
)


# ---------------------------------------------------------------------------
# Targeted PBTs per invariant (focus on the boundary the invariant guards)
# ---------------------------------------------------------------------------

@given(
    coverage=st.integers(min_value=1, max_value=1_000_000_00),
    amount=st.integers(min_value=1, max_value=2_000_000_00),
)
@settings(max_examples=100, deadline=None)
def test_claim_amount_within_coverage_enforced_at_submit(coverage: int, amount: int):
    """Invariant ClaimAmountWithinCoverage: enforced by SubmitClaim's requires."""
    store = Store()
    register_policy(
        store, policy_number="POL", holder="Alice", coverage_limit_pence=coverage,
    )
    if amount > coverage:
        import pytest
        with pytest.raises(ClaimRejected):
            submit_claim(
                store,
                claim_number="C",
                policy_number="POL",
                incident_date=datetime.now(timezone.utc),
                amount_claimed_pence=amount,
            )
    else:
        claim = submit_claim(
            store,
            claim_number="C",
            policy_number="POL",
            incident_date=datetime.now(timezone.utc),
            amount_claimed_pence=amount,
        )
        assert claim.amount_claimed_pence <= coverage


@given(reason=st.text(min_size=1, max_size=50))
@settings(max_examples=50, deadline=None)
def test_denied_claims_have_reason(reason: str):
    """Invariant DeniedClaimsHaveReason: holds for every denial."""
    store = Store()
    register_policy(
        store, policy_number="POL", holder="Alice", coverage_limit_pence=10_000_00,
    )
    submit_claim(
        store,
        claim_number="C",
        policy_number="POL",
        incident_date=datetime.now(timezone.utc),
        amount_claimed_pence=1_000_00,
    )
    triage_claim(store, "C")
    deny_claim(store, "C", reason)
    claim = store.claims["C"]
    assert claim.status == ClaimStatus.DENIED
    assert claim.denial_reason == reason
    assert claim.denial_reason is not None


@given(amount=st.integers(min_value=1, max_value=10_000_00))
@settings(max_examples=30, deadline=None)
def test_payout_amount_matches_claim(amount: int):
    """Invariant PayoutAmountMatchesClaim: SchedulePayout copies claim.amount."""
    store = Store()
    register_assessor(store, "Bob", {"vehicle"})
    register_policy(
        store, policy_number="POL", holder="Alice", coverage_limit_pence=10_000_00,
    )
    submit_claim(
        store,
        claim_number="C",
        policy_number="POL",
        incident_date=datetime.now(timezone.utc),
        amount_claimed_pence=amount,
    )
    triage_claim(store, "C")
    assessment = start_assessment(store, "C", "Bob")
    complete_assessment(store, assessment.assessment_id, "ok")
    approve_claim(store, "C")
    payout = schedule_payout(store, "C")
    assert payout.amount_pence == amount
    assert payout.amount_pence == store.claims["C"].amount_claimed_pence


def test_approved_claims_have_completed_assessment_guarded_by_approve_rule():
    """Invariant ApprovedClaimsHaveCompletedAssessment: ApproveClaim refuses
    when no completed assessment exists.
    """
    store = Store()
    register_assessor(store, "Bob", {"vehicle"})
    register_policy(
        store, policy_number="POL", holder="Alice", coverage_limit_pence=10_000_00,
    )
    submit_claim(
        store,
        claim_number="C",
        policy_number="POL",
        incident_date=datetime.now(timezone.utc),
        amount_claimed_pence=1_000_00,
    )
    triage_claim(store, "C")
    start_assessment(store, "C", "Bob")  # IN_PROGRESS, not COMPLETED
    import pytest
    with pytest.raises(InvalidTransition):
        approve_claim(store, "C")
