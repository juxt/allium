"""Temporal job tests propagated from spec.allium.

The jobs (`auto_acknowledge_job`, `assessment_sla_job`, `payout_retry_job`,
`auto_close_denied_job`) accept an injected `now=` parameter — the implementation
bridge for the spec's `when: <field> + <duration> <= now` triggers.

`AutoApprovalScheduler` has no temporal trigger (it fires on
`Claim.has_completed_assessment`), so its tests live in test_rules.py.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from app import Store
from app.jobs import (
    AUTO_APPROVE_MAX_PENCE,
    AUTO_CLOSE_DENIED_AFTER,
    PAYOUT_RETRY_AFTER,
    assessment_sla_job,
    auto_acknowledge_job,
    auto_approval_scheduler,
    auto_close_denied_job,
    payout_retry_job,
)
from app.models import (
    ASSESSMENT_SLA,
    Assessment,
    AssessmentStatus,
    Claim,
    ClaimStatus,
    Payout,
    PayoutStatus,
    Policy,
    PolicyStatus,
)


# ---------------------------------------------------------------------------
# Helpers — seed an entity directly into the store at a chosen timestamp.
# ---------------------------------------------------------------------------

def _policy(store: Store, *, number="P1", tags=None) -> Policy:
    p = Policy(
        policy_number=number, holder="Alice",
        coverage_limit_pence=10_000_00, status=PolicyStatus.ACTIVE,
        holder_tags=set(tags or []),
    )
    store.policies[number] = p
    return p


def _claim(
    store: Store, *,
    number: str = "C1",
    policy_number: str = "P1",
    status: ClaimStatus = ClaimStatus.SUBMITTED,
    submitted_at: datetime | None = None,
    last_activity_at: datetime | None = None,
    amount: int = 1_000_00,
) -> Claim:
    ts = submitted_at or datetime.now(timezone.utc)
    c = Claim(
        claim_number=number,
        policy_number=policy_number,
        incident_date=ts,
        amount_claimed_pence=amount,
        submitted_at=ts,
        last_activity_at=last_activity_at or ts,
        status=status,
    )
    store.claims[number] = c
    return c


# ---------------------------------------------------------------------------
# AutoAcknowledgeJob — claims sat in SUBMITTED for >= 5 business days
# ---------------------------------------------------------------------------

def test_auto_acknowledge_job_triages_old_submitted_claims():
    store = Store()
    _policy(store)
    now = datetime(2026, 5, 18, 12, 0, tzinfo=timezone.utc)  # Monday
    # Submitted two weeks back — plenty of business days have elapsed.
    _claim(store, status=ClaimStatus.SUBMITTED, submitted_at=now - timedelta(days=14))
    auto_acked = auto_acknowledge_job(store, now=now)
    assert auto_acked == ["C1"]
    assert store.claims["C1"].status == ClaimStatus.TRIAGED


def test_auto_acknowledge_job_skips_recent_submissions():
    store = Store()
    _policy(store)
    now = datetime(2026, 5, 18, 12, 0, tzinfo=timezone.utc)
    _claim(store, status=ClaimStatus.SUBMITTED, submitted_at=now - timedelta(hours=1))
    assert auto_acknowledge_job(store, now=now) == []
    assert store.claims["C1"].status == ClaimStatus.SUBMITTED


def test_auto_acknowledge_job_skips_non_submitted_claims():
    """rule_failure: requires claim.status == submitted."""
    store = Store()
    _policy(store)
    now = datetime(2026, 5, 18, 12, 0, tzinfo=timezone.utc)
    _claim(store, status=ClaimStatus.TRIAGED, submitted_at=now - timedelta(days=14))
    assert auto_acknowledge_job(store, now=now) == []


# ---------------------------------------------------------------------------
# AssessmentSlaJob — observational; surfaces SLA-breaching claims
# ---------------------------------------------------------------------------

def test_assessment_sla_job_flags_breached_claims():
    store = Store()
    _policy(store)
    now = datetime.now(timezone.utc)
    _claim(store, number="C1",
           status=ClaimStatus.TRIAGED,
           submitted_at=now - ASSESSMENT_SLA - timedelta(days=1))
    _claim(store, number="C2",
           status=ClaimStatus.ASSESSING,
           submitted_at=now - ASSESSMENT_SLA - timedelta(hours=1))
    breached = assessment_sla_job(store, now=now)
    assert set(breached) == {"C1", "C2"}


def test_assessment_sla_job_skips_within_sla_or_terminal():
    """rule_failure: requires claim.status in {triaged, assessing}."""
    store = Store()
    _policy(store)
    now = datetime.now(timezone.utc)
    _claim(store, number="C1",
           status=ClaimStatus.TRIAGED,
           submitted_at=now - timedelta(days=1))           # within SLA
    _claim(store, number="C2",
           status=ClaimStatus.PAID,
           submitted_at=now - ASSESSMENT_SLA - timedelta(days=1))  # terminal
    _claim(store, number="C3",
           status=ClaimStatus.DENIED,
           submitted_at=now - ASSESSMENT_SLA - timedelta(days=1))  # terminal
    assert assessment_sla_job(store, now=now) == []


def test_assessment_sla_job_does_not_mutate_state():
    store = Store()
    _policy(store)
    now = datetime.now(timezone.utc)
    c = _claim(store, status=ClaimStatus.TRIAGED,
               submitted_at=now - ASSESSMENT_SLA - timedelta(days=1))
    before_activity = c.last_activity_at
    before_status = c.status
    assessment_sla_job(store, now=now)
    assert c.status == before_status
    assert c.last_activity_at == before_activity


# ---------------------------------------------------------------------------
# PayoutRetryJob — retry FAILED payouts whose retry_due_at has elapsed.
# ---------------------------------------------------------------------------

def test_payout_retry_job_retries_eligible_failed_payouts():
    store = Store()
    _policy(store)
    c = _claim(store, status=ClaimStatus.APPROVED)
    now = datetime.now(timezone.utc)
    failed_at = now - PAYOUT_RETRY_AFTER - timedelta(hours=1)
    p = Payout(
        payout_id="po-1", claim_number=c.claim_number,
        amount_pence=c.amount_claimed_pence,
        status=PayoutStatus.FAILED,
        scheduled_at=failed_at,
        last_failure_at=failed_at,
    )
    store.payouts.append(p)
    retried = payout_retry_job(store, now=now)
    assert retried == ["po-1"]
    assert p.status == PayoutStatus.PAID
    # The implementation also marks the claim paid via mark_payout_paid.
    assert store.claims[c.claim_number].status == ClaimStatus.PAID


def test_payout_retry_job_skips_non_failed_payouts():
    """rule_failure: requires payout.status == failed."""
    store = Store()
    _policy(store)
    c = _claim(store, status=ClaimStatus.APPROVED)
    now = datetime.now(timezone.utc)
    far_past = now - PAYOUT_RETRY_AFTER - timedelta(days=1)
    store.payouts.append(Payout(
        payout_id="po-sched", claim_number=c.claim_number,
        amount_pence=1, status=PayoutStatus.SCHEDULED,
        scheduled_at=far_past,
    ))
    store.payouts.append(Payout(
        payout_id="po-paid", claim_number=c.claim_number,
        amount_pence=1, status=PayoutStatus.PAID,
        scheduled_at=far_past,
    ))
    assert payout_retry_job(store, now=now) == []


def test_payout_retry_job_skips_recently_failed_payouts():
    """Boundary: failed but retry window hasn't elapsed."""
    store = Store()
    _policy(store)
    c = _claim(store, status=ClaimStatus.APPROVED)
    now = datetime.now(timezone.utc)
    p = Payout(
        payout_id="po-1", claim_number=c.claim_number,
        amount_pence=c.amount_claimed_pence,
        status=PayoutStatus.FAILED,
        scheduled_at=now - timedelta(days=1),
        last_failure_at=now - timedelta(days=1),
    )
    store.payouts.append(p)
    assert payout_retry_job(store, now=now) == []
    assert p.status == PayoutStatus.FAILED


# ---------------------------------------------------------------------------
# AutoCloseDeniedJob — close DENIED claims inactive for 90 days
# ---------------------------------------------------------------------------

def test_auto_close_denied_job_closes_old_denied():
    store = Store()
    _policy(store)
    now = datetime.now(timezone.utc)
    c = _claim(store,
               status=ClaimStatus.DENIED,
               submitted_at=now - timedelta(days=120),
               last_activity_at=now - AUTO_CLOSE_DENIED_AFTER - timedelta(days=1))
    closed = auto_close_denied_job(store, now=now)
    assert closed == [c.claim_number]
    assert store.claims[c.claim_number].status == ClaimStatus.CLOSED


def test_auto_close_denied_job_skips_recently_denied():
    """Boundary: denied but threshold hasn't elapsed."""
    store = Store()
    _policy(store)
    now = datetime.now(timezone.utc)
    _claim(store,
           status=ClaimStatus.DENIED,
           submitted_at=now - timedelta(days=10),
           last_activity_at=now - timedelta(days=1))
    assert auto_close_denied_job(store, now=now) == []


def test_auto_close_denied_job_skips_non_denied():
    """rule_failure: requires claim.status == denied."""
    store = Store()
    _policy(store)
    now = datetime.now(timezone.utc)
    _claim(store,
           status=ClaimStatus.TRIAGED,
           submitted_at=now - timedelta(days=120),
           last_activity_at=now - AUTO_CLOSE_DENIED_AFTER - timedelta(days=1))
    assert auto_close_denied_job(store, now=now) == []


# ---------------------------------------------------------------------------
# AutoApprovalScheduler — non-temporal but rule_failure cases worth covering
# ---------------------------------------------------------------------------

def _seed_for_auto_approval(
    store: Store,
    *,
    tags=("trusted",),
    amount: int = 1_000_00,
    status: ClaimStatus = ClaimStatus.ASSESSING,
    add_completed_assessment: bool = True,
) -> Claim:
    _policy(store, tags=tags)
    c = _claim(store, status=status, amount=amount)
    if add_completed_assessment:
        store.assessments["a1"] = Assessment(
            assessment_id="a1", claim_number=c.claim_number, assessor_name="Mira",
            status=AssessmentStatus.COMPLETED,
        )
    return c


def test_auto_approval_scheduler_approves_eligible_claims():
    store = Store()
    c = _seed_for_auto_approval(store)
    approved = auto_approval_scheduler(store)
    assert approved == [c.claim_number]
    assert c.status == ClaimStatus.APPROVED


def test_auto_approval_skips_when_holder_not_trusted():
    """rule_failure: requires 'trusted' in holder_tags."""
    store = Store()
    c = _seed_for_auto_approval(store, tags=())
    assert auto_approval_scheduler(store) == []
    assert c.status == ClaimStatus.ASSESSING


def test_auto_approval_skips_high_value_claims():
    """rule_failure: requires amount < auto_approve_max_pence."""
    store = Store()
    c = _seed_for_auto_approval(store, amount=AUTO_APPROVE_MAX_PENCE + 1)
    assert auto_approval_scheduler(store) == []
    assert c.status == ClaimStatus.ASSESSING


def test_auto_approval_skips_when_not_assessing():
    """rule_failure: requires claim.status == assessing."""
    store = Store()
    c = _seed_for_auto_approval(store, status=ClaimStatus.TRIAGED)
    assert auto_approval_scheduler(store) == []
    assert c.status == ClaimStatus.TRIAGED


def test_auto_approval_skips_when_no_completed_assessment():
    """rule trigger: when: claim.has_completed_assessment."""
    store = Store()
    c = _seed_for_auto_approval(store, add_completed_assessment=False)
    assert auto_approval_scheduler(store) == []
    assert c.status == ClaimStatus.ASSESSING
