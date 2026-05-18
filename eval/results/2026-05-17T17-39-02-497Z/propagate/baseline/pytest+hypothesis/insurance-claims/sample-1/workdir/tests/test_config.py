"""Config default obligations.

The spec declares seven config defaults; the implementation hard-codes them as
module-level constants. Verify the values match the spec's declared defaults.
"""
from __future__ import annotations

from datetime import timedelta

from app import jobs, models, webhooks


def test_assessment_sla_default():
    assert models.ASSESSMENT_SLA == timedelta(days=14)


def test_auto_ack_after_default():
    assert jobs.AUTO_ACK_AFTER == timedelta(days=5)


def test_auto_approve_max_pence_default():
    assert jobs.AUTO_APPROVE_MAX_PENCE == 50_000_00


def test_auto_close_denied_after_default():
    assert jobs.AUTO_CLOSE_DENIED_AFTER == timedelta(days=90)


def test_link_window_default():
    assert webhooks.LINK_WINDOW == timedelta(days=2)


def test_payout_retry_after_default():
    assert jobs.PAYOUT_RETRY_AFTER == timedelta(days=28)


def test_stalled_after_default():
    assert models.STALLED_AFTER == timedelta(days=21)
