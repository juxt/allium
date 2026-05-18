"""Entity and value-type structural tests.

Covers entity_fields, entity_optional, value_equality and enum_comparable
obligations from `allium plan`.
"""
from __future__ import annotations

from dataclasses import fields
from datetime import datetime, timezone

import pytest

from app.integrations.assessor import AssessorDispatch
from app.integrations.payment import (
    PaymentRequest,
    PaymentResult,
    PaymentResultStatus,
)
from app.models import (
    Assessment,
    AssessmentStatus,
    Assessor,
    Claim,
    ClaimStatus,
    IncidentReport,
    Payout,
    PayoutStatus,
    Policy,
    PolicyStatus,
)


# ---------------------------------------------------------------------------
# entity_fields obligations
# ---------------------------------------------------------------------------

ENTITY_FIELD_SETS: list[tuple[type, set[str]]] = [
    # The spec describes Claim with a `policy: Policy` relationship; in the
    # implementation the FK lives as `policy_number: str` (per app/README).
    (
        Claim,
        {
            "claim_number",
            "policy_number",
            "incident_date",
            "amount_claimed_pence",
            "submitted_at",
            "last_activity_at",
            "status",
            "denial_reason",
        },
    ),
    (
        Policy,
        {
            "policy_number",
            "holder",
            "coverage_limit_pence",
            "status",
            "holder_tags",
        },
    ),
    (Assessor, {"name", "specialties"}),
    (
        Assessment,
        {
            "assessment_id",
            "claim_number",
            "assessor_name",
            "findings",
            "status",
            "started_at",
            "completed_at",
        },
    ),
    (
        Payout,
        {
            "payout_id",
            "claim_number",
            "amount_pence",
            "status",
            "scheduled_at",
            "paid_at",
            "failed_attempts",
            "last_failure_at",
        },
    ),
    (
        IncidentReport,
        {
            "report_id",
            "source",
            "policy_number",
            "incident_date",
            "description",
            "received_at",
            "linked_claim_number",
        },
    ),
    (AssessorDispatch, {"dispatch_id", "claim_number", "specialties"}),
    (
        PaymentRequest,
        {"account_number", "sort_code", "amount_pence", "reference"},
    ),
    (PaymentResult, {"request", "status", "upstream_id", "submitted_at"}),
]


@pytest.mark.parametrize("cls,expected", ENTITY_FIELD_SETS, ids=lambda v: getattr(v, "__name__", str(v)))
def test_entity_has_declared_fields(cls, expected):
    declared = {f.name for f in fields(cls)}
    assert expected <= declared, f"missing fields on {cls.__name__}: {expected - declared}"


# ---------------------------------------------------------------------------
# entity_optional obligations
# ---------------------------------------------------------------------------

NOW = datetime.now(timezone.utc)


def _claim(**overrides) -> Claim:
    kwargs: dict = {
        "claim_number": "C",
        "policy_number": "P",
        "incident_date": NOW,
        "amount_claimed_pence": 1,
    }
    kwargs.update(overrides)
    return Claim(**kwargs)


def test_claim_denial_reason_optional():
    assert _claim().denial_reason is None
    assert _claim(denial_reason="fraud").denial_reason == "fraud"


def test_assessment_completed_at_optional():
    a = Assessment(assessment_id="A", claim_number="C", assessor_name="Bob")
    assert a.completed_at is None
    a.completed_at = NOW
    assert a.completed_at == NOW


def test_assessment_started_at_optional():
    a = Assessment(assessment_id="A", claim_number="C", assessor_name="Bob")
    assert a.started_at is None
    a.started_at = NOW
    assert a.started_at == NOW


def test_payout_paid_at_optional():
    p = Payout(payout_id="P", claim_number="C", amount_pence=1)
    assert p.paid_at is None


def test_payout_last_failure_at_optional():
    p = Payout(payout_id="P", claim_number="C", amount_pence=1)
    assert p.last_failure_at is None


def test_incident_report_policy_number_optional():
    r = IncidentReport(
        report_id="R", source="police", policy_number=None,
        incident_date=NOW, description="x",
    )
    assert r.policy_number is None
    r.policy_number = "POL-1"
    assert r.policy_number == "POL-1"


def test_incident_report_linked_claim_optional():
    """Spec: IncidentReport.linked_claim is optional.

    Implementation stores the FK as `linked_claim_number: str | None`.
    """
    r = IncidentReport(
        report_id="R", source="police", policy_number=None,
        incident_date=NOW, description="x",
    )
    assert r.linked_claim_number is None
    r.linked_claim_number = "CLM-1"
    assert r.linked_claim_number == "CLM-1"


# ---------------------------------------------------------------------------
# value_equality obligations (PaymentRequest, PaymentResult, AssessorDispatch)
# ---------------------------------------------------------------------------

def test_payment_request_structural_equality():
    a = PaymentRequest(
        account_number="12345678", sort_code="11-22-33",
        amount_pence=100, reference="ref",
    )
    b = PaymentRequest(
        account_number="12345678", sort_code="11-22-33",
        amount_pence=100, reference="ref",
    )
    c = PaymentRequest(
        account_number="87654321", sort_code="11-22-33",
        amount_pence=100, reference="ref",
    )
    assert a == b
    assert a != c


def test_payment_result_structural_equality():
    req = PaymentRequest(
        account_number="12345678", sort_code="11-22-33",
        amount_pence=100, reference="ref",
    )
    a = PaymentResult(request=req, status=PaymentResultStatus.ACCEPTED,
                     upstream_id="u", submitted_at=NOW)
    b = PaymentResult(request=req, status=PaymentResultStatus.ACCEPTED,
                     upstream_id="u", submitted_at=NOW)
    c = PaymentResult(request=req, status=PaymentResultStatus.REJECTED,
                     upstream_id="u", submitted_at=NOW)
    assert a == b
    assert a != c


def test_assessor_dispatch_structural_equality():
    a = AssessorDispatch(dispatch_id="d1", claim_number="C", specialties=["vehicle"])
    b = AssessorDispatch(dispatch_id="d1", claim_number="C", specialties=["vehicle"])
    c = AssessorDispatch(dispatch_id="d2", claim_number="C", specialties=["vehicle"])
    assert a == b
    assert a != c


# ---------------------------------------------------------------------------
# enum_comparable obligations
# ---------------------------------------------------------------------------

@pytest.mark.parametrize(
    "enum_cls,members",
    [
        (AssessmentStatus, {"PENDING", "IN_PROGRESS", "COMPLETED"}),
        (ClaimStatus, {"SUBMITTED", "TRIAGED", "ASSESSING", "APPROVED", "DENIED", "PAID", "CLOSED"}),
        (PaymentResultStatus, {"ACCEPTED", "REJECTED", "PENDING_REVIEW"}),
        (PayoutStatus, {"SCHEDULED", "PAID", "FAILED"}),
        (PolicyStatus, {"ACTIVE", "LAPSED", "CANCELLED"}),
    ],
    ids=lambda v: getattr(v, "__name__", str(v)),
)
def test_enum_has_spec_members_and_is_comparable(enum_cls, members):
    actual = {m.name for m in enum_cls}
    assert members <= actual, f"missing members on {enum_cls.__name__}: {members - actual}"
    # Comparability: members equal themselves and only themselves
    items = list(enum_cls)
    for m in items:
        assert m == m
    for i, a in enumerate(items):
        for b in items[i + 1:]:
            assert a != b
