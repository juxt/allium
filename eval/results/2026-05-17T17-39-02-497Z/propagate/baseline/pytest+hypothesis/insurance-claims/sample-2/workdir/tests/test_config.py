"""Config default tests propagated from spec.allium.

The spec declares seven configuration parameters with default values. The
implementation hard-codes them as module-level constants split across
`app/models.py`, `app/jobs.py`, and `app/webhooks.py`.

These tests verify the implementation matches the spec's declared defaults.
"""
from __future__ import annotations

from datetime import timedelta

from app.jobs import (
    AUTO_APPROVE_MAX_PENCE,
    AUTO_CLOSE_DENIED_AFTER,
    AUTO_ACK_AFTER,
    PAYOUT_RETRY_AFTER,
)
from app.models import ASSESSMENT_SLA, STALLED_AFTER
from app.webhooks import LINK_WINDOW


def test_config_assessment_sla_default_is_14_days():
    assert ASSESSMENT_SLA == timedelta(days=14)


def test_config_auto_ack_after_default_is_5_days():
    assert AUTO_ACK_AFTER == timedelta(days=5)


def test_config_auto_approve_max_pence_default_is_50_000_pounds():
    assert AUTO_APPROVE_MAX_PENCE == 50_000_00


def test_config_auto_close_denied_after_default_is_90_days():
    assert AUTO_CLOSE_DENIED_AFTER == timedelta(days=90)


def test_config_link_window_default_is_2_days():
    assert LINK_WINDOW == timedelta(days=2)


def test_config_payout_retry_after_default_is_28_days():
    assert PAYOUT_RETRY_AFTER == timedelta(days=28)


def test_config_stalled_after_default_is_21_days():
    assert STALLED_AFTER == timedelta(days=21)
