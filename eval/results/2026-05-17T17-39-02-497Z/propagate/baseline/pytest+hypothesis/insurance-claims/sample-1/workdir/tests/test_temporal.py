"""Temporal rule obligations.

The four temporal rules in the spec are AutoAcknowledgeJob,
AssessmentSlaJob, PayoutRetryJob and AutoCloseDeniedJob. Each maps to a
function in app/jobs.py that accepts an injected `now` parameter — that's
the time-injection seam the propagate skill calls for.

For each, we exercise: deadline-just-after fires the rule; deadline-just-before
does not.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from app import Store
from app.jobs import (
    ASSESSMENT_SLA,
    AUTO_ACK_AFTER,
    AUTO_CLOSE_DENIED_AFTER,
    PAYOUT_RETRY_AFTER,
    assessment_sla_job,
    auto_acknowledge_job,
    auto_close_denied_job,
    payout_retry_job,
)
from app.models import ClaimStatus, PayoutStatus
from app.services import (
    deny_claim,
    mark_payout_failed,
)
from tests._helpers import (
    make_policy,
    make_scheduled_payout,
    make_submitted_claim,
    make_triaged_claim,
)


def _at(year=2026, month=3, day=1, hour=12) -> datetime:
    return datetime(year, month, day, hour, tzinfo=timezone.utc)


# ---------------------------------------------------------------------------
# AutoAcknowledgeJob — auto-triages SUBMITTED claims after 5 business days
# ---------------------------------------------------------------------------

class TestAutoAcknowledgeJob:
    def test_success_triages_after_threshold(self, store: Store):
        make_policy(store)
        claim = make_submitted_claim(store)
        # Use a Monday so weekday() arithmetic doesn't bite.
        start = datetime(2026, 3, 2, 9, tzinfo=timezone.utc)
        claim.submitted_at = start
        claim.last_activity_at = start
        # Eight calendar days later spans a full work week — comfortably >=5
        # business days regardless of weekend alignment.
        now = start + timedelta(days=8)
        triaged = auto_acknowledge_job(store, now=now)
        assert triaged == [claim.claim_number]
        assert claim.status == ClaimStatus.TRIAGED

    def test_failure_below_threshold(self, store: Store):
        make_policy(store)
        claim = make_submitted_claim(store)
        start = datetime(2026, 3, 2, 9, tzinfo=timezone.utc)
        claim.submitted_at = start
        claim.last_activity_at = start
        # Two days later — at most one business day in between.
        now = start + timedelta(days=2)
        triaged = auto_acknowledge_job(store, now=now)
        assert triaged == []
        assert claim.status == ClaimStatus.SUBMITTED

    def test_only_processes_submitted_claims(self, store: Store):
        make_policy(store)
        # TRIAGED already — must be skipped even though it's ancient.
        claim = make_triaged_claim(store)
        claim.submitted_at = _at() - timedelta(days=60)
        now = _at()
        triaged = auto_acknowledge_job(store, now=now)
        assert triaged == []

    def test_auto_ack_after_constant_matches_spec(self):
        assert AUTO_ACK_AFTER == timedelta(days=5)


# ---------------------------------------------------------------------------
# AssessmentSlaJob — flags claims past the 14-day SLA (observational)
# ---------------------------------------------------------------------------

class TestAssessmentSlaJob:
    def test_success_flags_breached_claim(self, store: Store):
        make_policy(store)
        claim = make_triaged_claim(store)
        claim.submitted_at = _at() - (ASSESSMENT_SLA + timedelta(days=1))
        breached = assessment_sla_job(store, now=_at())
        assert breached == [claim.claim_number]
        # Observational only — must not mutate status.
        assert claim.status == ClaimStatus.TRIAGED

    def test_failure_not_yet_breached(self, store: Store):
        make_policy(store)
        claim = make_triaged_claim(store)
        # 13 days after submit — inside SLA.
        claim.submitted_at = _at() - timedelta(days=13)
        breached = assessment_sla_job(store, now=_at())
        assert breached == []

    def test_ignores_closed_statuses(self, store: Store):
        make_policy(store)
        claim = make_triaged_claim(store)
        # Deny it (allowed from TRIAGED) and verify it's no longer surfaced.
        deny_claim(store, claim.claim_number, "x")
        claim.submitted_at = _at() - (ASSESSMENT_SLA + timedelta(days=5))
        breached = assessment_sla_job(store, now=_at())
        assert breached == []


# ---------------------------------------------------------------------------
# PayoutRetryJob — retries FAILED payouts whose retry_due_at has elapsed
# ---------------------------------------------------------------------------

class TestPayoutRetryJob:
    def test_success_retries_failed_payout_past_window(self, store: Store):
        make_policy(store)
        payout = make_scheduled_payout(store)
        mark_payout_failed(store, payout.payout_id)
        # Reset failure stamp to before the retry window.
        payout.last_failure_at = _at() - (PAYOUT_RETRY_AFTER + timedelta(days=1))
        retried = payout_retry_job(store, now=_at())
        assert retried == [payout.payout_id]
        assert payout.status == PayoutStatus.PAID

    def test_failure_within_retry_window(self, store: Store):
        make_policy(store)
        payout = make_scheduled_payout(store)
        mark_payout_failed(store, payout.payout_id)
        payout.last_failure_at = _at() - timedelta(days=1)
        retried = payout_retry_job(store, now=_at())
        assert retried == []
        assert payout.status == PayoutStatus.FAILED

    def test_does_not_touch_non_failed_payouts(self, store: Store):
        make_policy(store)
        payout = make_scheduled_payout(store)  # SCHEDULED, not FAILED
        payout.scheduled_at = _at() - (PAYOUT_RETRY_AFTER + timedelta(days=30))
        retried = payout_retry_job(store, now=_at())
        assert retried == []
        assert payout.status == PayoutStatus.SCHEDULED


# ---------------------------------------------------------------------------
# AutoCloseDeniedJob — closes DENIED claims inactive for 90 days
# ---------------------------------------------------------------------------

class TestAutoCloseDeniedJob:
    def test_success_closes_old_denied_claim(self, store: Store):
        make_policy(store)
        claim = make_triaged_claim(store)
        deny_claim(store, claim.claim_number, "no cover")
        claim.last_activity_at = _at() - (AUTO_CLOSE_DENIED_AFTER + timedelta(days=1))
        closed = auto_close_denied_job(store, now=_at())
        assert closed == [claim.claim_number]
        assert claim.status == ClaimStatus.CLOSED

    def test_failure_within_window(self, store: Store):
        make_policy(store)
        claim = make_triaged_claim(store)
        deny_claim(store, claim.claim_number, "no cover")
        claim.last_activity_at = _at() - timedelta(days=10)
        closed = auto_close_denied_job(store, now=_at())
        assert closed == []
        assert claim.status == ClaimStatus.DENIED


# ---------------------------------------------------------------------------
# Cross-check: temporal job functions accept an injected `now`
# ---------------------------------------------------------------------------

@pytest.mark.parametrize(
    "fn",
    [auto_acknowledge_job, assessment_sla_job, payout_retry_job, auto_close_denied_job],
    ids=lambda fn: fn.__name__,
)
def test_temporal_job_accepts_injected_now(fn):
    """Time injection seam: each temporal job exposes a `now` parameter."""
    import inspect
    sig = inspect.signature(fn)
    assert "now" in sig.parameters
