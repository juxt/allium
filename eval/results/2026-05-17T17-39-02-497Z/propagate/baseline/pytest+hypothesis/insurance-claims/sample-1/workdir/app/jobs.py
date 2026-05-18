"""Scheduled jobs.

These run on a cron-like schedule (in a real deployment, via APScheduler /
Celery beat / similar). Each job iterates the store and applies time-based
business rules. Temporal thresholds are:

  - auto-acknowledge claims still SUBMITTED after 5 business days
  - flag SLA breach if assessment isn't done within 14 days of submission
  - retry FAILED payouts after 28 days
  - auto-close DENIED claims that have been inactive for 90 days
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from app import Store
from app.integrations.payment import PaymentError, send_faster_payment
from app.models import (
    ASSESSMENT_SLA,
    AssessmentStatus,
    Claim,
    ClaimStatus,
    PayoutStatus,
    Policy,
)
from app.services import (
    approve_claim,
    mark_payout_failed,
    mark_payout_paid,
    triage_claim,
)

AUTO_ACK_AFTER = timedelta(days=5)  # business days, approximated below
PAYOUT_RETRY_AFTER = timedelta(days=28)
AUTO_CLOSE_DENIED_AFTER = timedelta(days=90)
AUTO_APPROVE_MAX_PENCE = 50_000_00  # £50,000


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _business_days_between(start: datetime, end: datetime) -> int:
    """Approximate count of weekdays between two timestamps."""
    if end <= start:
        return 0
    days = 0
    cursor = start
    one_day = timedelta(days=1)
    while cursor.date() < end.date():
        cursor = cursor + one_day
        if cursor.weekday() < 5:  # Mon-Fri
            days += 1
    return days


def auto_acknowledge_job(store: Store, now: datetime | None = None) -> list[str]:
    """Auto-triage anything that has been sat in SUBMITTED for >=5 business days."""
    now = now or _utcnow()
    auto_acked: list[str] = []
    for claim in list(store.claims.values()):
        if claim.status != ClaimStatus.SUBMITTED:
            continue
        if _business_days_between(claim.submitted_at, now) >= 5:
            triage_claim(store, claim.claim_number)
            auto_acked.append(claim.claim_number)
    return auto_acked


def assessment_sla_job(store: Store, now: datetime | None = None) -> list[str]:
    """Surface claims that have breached the 14-day assessment SLA."""
    now = now or _utcnow()
    breached: list[str] = []
    open_statuses = {ClaimStatus.TRIAGED, ClaimStatus.ASSESSING}
    for claim in store.claims.values():
        if claim.status not in open_statuses:
            continue
        if (now - claim.submitted_at) > ASSESSMENT_SLA:
            breached.append(claim.claim_number)
    return breached


def payout_retry_job(store: Store, now: datetime | None = None) -> list[str]:
    """Retry FAILED payouts older than the retry threshold."""
    now = now or _utcnow()
    retried: list[str] = []
    for payout in store.payouts:
        if payout.status != PayoutStatus.FAILED:
            continue
        anchor = payout.last_failure_at or payout.scheduled_at
        if (now - anchor) < PAYOUT_RETRY_AFTER:
            continue
        try:
            send_faster_payment(
                account_number="00000000",
                sort_code="00-00-00",
                amount_pence=payout.amount_pence,
                reference=payout.payout_id,
            )
            mark_payout_paid(store, payout.payout_id)
            retried.append(payout.payout_id)
        except PaymentError:
            mark_payout_failed(store, payout.payout_id)
    return retried


def auto_close_denied_job(store: Store, now: datetime | None = None) -> list[str]:
    """Close DENIED claims that have had no activity for 90 days."""
    now = now or _utcnow()
    closed: list[str] = []
    for claim in store.claims.values():
        if claim.status != ClaimStatus.DENIED:
            continue
        if (now - claim.last_activity_at) >= AUTO_CLOSE_DENIED_AFTER:
            claim.status = ClaimStatus.CLOSED
            claim.touch()
            closed.append(claim.claim_number)
    return closed


def auto_approval_scheduler(store: Store) -> list[str]:
    """Scattered logic: this also calls approve_claim().

    Auto-approves low-value claims for trusted holders once their assessment is
    completed, so an adjuster doesn't need to click through them by hand.
    """
    auto_approved: list[str] = []
    for claim in list(store.claims.values()):
        if not _eligible_for_auto_approval(store, claim):
            continue
        approve_claim(store, claim.claim_number)
        auto_approved.append(claim.claim_number)
    return auto_approved


def _eligible_for_auto_approval(store: Store, claim: Claim) -> bool:
    if claim.status != ClaimStatus.ASSESSING:
        return False
    if claim.amount_claimed_pence >= AUTO_APPROVE_MAX_PENCE:
        return False
    if not _has_completed_assessment(store, claim.claim_number):
        return False
    policy: Policy | None = store.policies.get(claim.policy_number)
    if policy is None or "trusted" not in policy.holder_tags:
        return False
    return True


def _has_completed_assessment(store: Store, claim_number: str) -> bool:
    return any(
        a.claim_number == claim_number and a.status == AssessmentStatus.COMPLETED
        for a in store.assessments.values()
    )
