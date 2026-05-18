"""Enum comparability tests propagated from spec.allium.

Each enum declared in the spec maps to a Python `Enum`. We check membership,
ordering by equality, and (for ClaimStatus) the full variant set.
"""
from __future__ import annotations

from app.integrations.payment import PaymentResultStatus as PaymentResultStatusImpl
from app.models import (
    AssessmentStatus,
    ClaimStatus,
    PayoutStatus,
    PolicyStatus,
)


def test_assessment_status_members():
    assert {s.value for s in AssessmentStatus} == {"completed", "in_progress", "pending"}


def test_assessment_status_equality():
    assert AssessmentStatus.COMPLETED == AssessmentStatus.COMPLETED
    assert AssessmentStatus.COMPLETED != AssessmentStatus.IN_PROGRESS


def test_claim_status_members():
    expected = {"approved", "assessing", "closed", "denied", "paid",
                "submitted", "triaged"}
    assert {s.value for s in ClaimStatus} == expected


def test_claim_status_equality():
    assert ClaimStatus.SUBMITTED == ClaimStatus.SUBMITTED
    assert ClaimStatus.SUBMITTED != ClaimStatus.TRIAGED


def test_payment_result_status_members():
    assert {s.value for s in PaymentResultStatusImpl} == {
        "accepted", "pending_review", "rejected"
    }


def test_payment_result_status_equality():
    assert PaymentResultStatusImpl.ACCEPTED == PaymentResultStatusImpl.ACCEPTED
    assert PaymentResultStatusImpl.ACCEPTED != PaymentResultStatusImpl.REJECTED


def test_payout_status_members():
    assert {s.value for s in PayoutStatus} == {"failed", "paid", "scheduled"}


def test_payout_status_equality():
    assert PayoutStatus.PAID == PayoutStatus.PAID
    assert PayoutStatus.PAID != PayoutStatus.FAILED


def test_policy_status_members():
    assert {s.value for s in PolicyStatus} == {"active", "cancelled", "lapsed"}


def test_policy_status_equality():
    assert PolicyStatus.ACTIVE == PolicyStatus.ACTIVE
    assert PolicyStatus.ACTIVE != PolicyStatus.CANCELLED
