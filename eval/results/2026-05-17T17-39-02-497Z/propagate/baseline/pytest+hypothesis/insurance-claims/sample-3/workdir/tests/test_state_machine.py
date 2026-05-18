"""State-machine test for the Claim lifecycle.

Walks random valid paths through the ClaimStatus graph implied by the rules:

    submitted -> triaged (TriageClaim)
    triaged   -> assessing (StartAssessment)
    triaged   -> denied (DenyClaim)
    assessing -> denied (DenyClaim)
    assessing -> approved (ApproveClaim) [requires has_completed_assessment]
    approved  -> paid (MarkPayoutPaid via SchedulePayout intermediate)
    denied    -> closed (AutoCloseDeniedJob, time-driven)

After every transition all four invariants are checked. Invalid actions for the
current state are excluded by the precondition gates rather than relying on
the implementation raising an exception.

Once the claim reaches a terminal state (paid, closed) there is no outbound
transition; ``terminal_noop`` keeps Hypothesis from raising InvalidDefinition
("no available rule") while still letting the invariants run on the final state.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from hypothesis import HealthCheck, settings
from hypothesis.stateful import RuleBasedStateMachine, invariant, precondition, rule
from hypothesis.strategies import text

import app as app_pkg
from app.jobs import AUTO_CLOSE_DENIED_AFTER, auto_close_denied_job
from app.models import AssessmentStatus, ClaimStatus, PayoutStatus
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


CLAIM_NUMBER = "CLM-1"
POLICY_NUMBER = "POL-1"
ASSESSOR_NAME = "Bob"
COVERAGE_LIMIT = 1_000_000
TERMINAL_STATES = {ClaimStatus.PAID, ClaimStatus.CLOSED}


class ClaimLifecycle(RuleBasedStateMachine):
    """Walk valid Claim transitions and check every invariant after each step."""

    def __init__(self) -> None:
        super().__init__()
        self.store = app_pkg.Store()
        self.assessment_id: str | None = None
        self.payout_id: str | None = None
        register_policy(
            self.store,
            policy_number=POLICY_NUMBER,
            holder="Alice",
            coverage_limit_pence=COVERAGE_LIMIT,
        )
        register_assessor(self.store, ASSESSOR_NAME, {"fire"})
        submit_claim(
            self.store,
            claim_number=CLAIM_NUMBER,
            policy_number=POLICY_NUMBER,
            incident_date=datetime.now(timezone.utc),
            amount_claimed_pence=100,
        )

    # ------------------------------------------------------------------
    # Transition rules guarded by current ClaimStatus
    # ------------------------------------------------------------------

    @precondition(lambda self: self._claim_status() == ClaimStatus.SUBMITTED)
    @rule()
    def do_triage(self):
        triage_claim(self.store, CLAIM_NUMBER)

    @precondition(lambda self: self._claim_status() == ClaimStatus.TRIAGED)
    @rule()
    def do_start_assessment(self):
        a = start_assessment(self.store, CLAIM_NUMBER, ASSESSOR_NAME)
        self.assessment_id = a.assessment_id

    @precondition(
        lambda self: self._claim_status() == ClaimStatus.ASSESSING
        and self._has_in_progress_assessment()
    )
    @rule()
    def do_complete_assessment(self):
        assert self.assessment_id is not None
        complete_assessment(self.store, self.assessment_id, "ok")

    @precondition(
        lambda self: self._claim_status() == ClaimStatus.ASSESSING
        and self._has_completed_assessment()
    )
    @rule()
    def do_approve(self):
        approve_claim(self.store, CLAIM_NUMBER)

    @precondition(
        lambda self: self._claim_status()
        in {ClaimStatus.TRIAGED, ClaimStatus.ASSESSING}
    )
    @rule(reason=text(min_size=1, max_size=20))
    def do_deny(self, reason):
        deny_claim(self.store, CLAIM_NUMBER, reason)

    @precondition(
        lambda self: self._claim_status() == ClaimStatus.APPROVED
        and self.payout_id is None
    )
    @rule()
    def do_schedule_payout(self):
        p = schedule_payout(self.store, CLAIM_NUMBER)
        self.payout_id = p.payout_id

    @precondition(
        lambda self: self._claim_status() == ClaimStatus.APPROVED
        and self.payout_id is not None
        and self._payout_status() == PayoutStatus.SCHEDULED
    )
    @rule()
    def do_mark_paid(self):
        assert self.payout_id is not None
        mark_payout_paid(self.store, self.payout_id)

    @precondition(lambda self: self._claim_status() == ClaimStatus.DENIED)
    @rule()
    def do_auto_close(self):
        # Advance the activity clock far enough into the past so the
        # 90-day window has passed, then drive the job.
        self.store.claims[CLAIM_NUMBER].last_activity_at = (
            datetime.now(timezone.utc) - AUTO_CLOSE_DENIED_AFTER - timedelta(days=1)
        )
        auto_close_denied_job(self.store)

    @precondition(lambda self: self._claim_status() in TERMINAL_STATES)
    @rule()
    def terminal_noop(self):
        # No outbound transitions from paid/closed; keep Hypothesis happy by
        # offering a no-op so the walker can continue (and re-check invariants).
        pass

    # ------------------------------------------------------------------
    # Invariants — checked after every rule
    # ------------------------------------------------------------------

    @invariant()
    def amount_within_coverage(self):
        claim = self.store.claims.get(CLAIM_NUMBER)
        if claim is None:
            return
        policy = self.store.policies[claim.policy_number]
        assert claim.amount_claimed_pence <= policy.coverage_limit_pence

    @invariant()
    def approved_or_paid_implies_completed_assessment(self):
        claim = self.store.claims.get(CLAIM_NUMBER)
        if claim is None:
            return
        if claim.status in {ClaimStatus.APPROVED, ClaimStatus.PAID}:
            assert self._has_completed_assessment()

    @invariant()
    def denied_has_reason(self):
        claim = self.store.claims.get(CLAIM_NUMBER)
        if claim is None:
            return
        if claim.status == ClaimStatus.DENIED:
            assert claim.denial_reason is not None

    @invariant()
    def payout_amount_matches_claim(self):
        for p in self.store.payouts:
            c = self.store.claims[p.claim_number]
            assert p.amount_pence == c.amount_claimed_pence

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _claim_status(self) -> ClaimStatus | None:
        claim = self.store.claims.get(CLAIM_NUMBER)
        return claim.status if claim is not None else None

    def _has_in_progress_assessment(self) -> bool:
        return any(
            a.claim_number == CLAIM_NUMBER
            and a.status == AssessmentStatus.IN_PROGRESS
            for a in self.store.assessments.values()
        )

    def _has_completed_assessment(self) -> bool:
        return any(
            a.claim_number == CLAIM_NUMBER
            and a.status == AssessmentStatus.COMPLETED
            for a in self.store.assessments.values()
        )

    def _payout_status(self) -> PayoutStatus | None:
        for p in self.store.payouts:
            if p.payout_id == self.payout_id:
                return p.status
        return None


ClaimLifecycle.TestCase.settings = settings(
    max_examples=30,
    stateful_step_count=20,
    deadline=None,
    suppress_health_check=[HealthCheck.function_scoped_fixture],
)


TestClaimLifecycle = ClaimLifecycle.TestCase
