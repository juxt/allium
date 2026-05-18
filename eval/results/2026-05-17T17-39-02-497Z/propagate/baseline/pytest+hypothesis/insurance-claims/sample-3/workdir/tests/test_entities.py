"""Entity, enum and value-type shape tests.

Covers obligations from `allium plan`:
  - entity_fields: all declared fields are present on the implementation class
  - entity_optional: optional fields accept both null and non-null values
  - enum_comparable: enum values are comparable / round-trippable
  - value_equality: value types support structural equality
  - entity_relationship: relationships from one entity to another navigate
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
# entity_fields obligations — each declared field exists on the implementation
# ---------------------------------------------------------------------------

def _field_names(cls) -> set[str]:
    return {f.name for f in fields(cls)}


def test_incident_report_has_all_spec_fields():
    spec_fields = {
        "description",
        "incident_date",
        # spec: linked_claim (Claim?) — implementation stores the FK as
        # linked_claim_number; treat that as the implementation bridge for
        # the spec's optional Claim reference.
        "linked_claim_number",
        "policy_number",
        "received_at",
        "report_id",
        "source",
    }
    assert spec_fields.issubset(_field_names(IncidentReport))


def test_assessment_has_all_spec_fields():
    # Spec talks in terms of `claim` and `assessor`. The implementation FK-aliases
    # these to claim_number / assessor_name; that is the documented bridge.
    spec_fields = {
        "assessment_id",
        "assessor_name",
        "claim_number",
        "completed_at",
        "findings",
        "started_at",
        "status",
    }
    assert spec_fields.issubset(_field_names(Assessment))


def test_assessor_has_all_spec_fields():
    assert {"name", "specialties"}.issubset(_field_names(Assessor))


def test_claim_has_all_spec_fields():
    spec_fields = {
        "amount_claimed_pence",
        "claim_number",
        "denial_reason",
        "incident_date",
        "last_activity_at",
        "policy_number",  # spec: policy: Policy — implementation FK
        "status",
        "submitted_at",
    }
    assert spec_fields.issubset(_field_names(Claim))


def test_payout_has_all_spec_fields():
    spec_fields = {
        "amount_pence",
        "claim_number",  # spec: claim: Claim — implementation FK
        "failed_attempts",
        "last_failure_at",
        "paid_at",
        "payout_id",
        "scheduled_at",
        "status",
    }
    assert spec_fields.issubset(_field_names(Payout))


def test_policy_has_all_spec_fields():
    spec_fields = {
        "coverage_limit_pence",
        "holder",
        "holder_tags",
        "policy_number",
        "status",
    }
    assert spec_fields.issubset(_field_names(Policy))


def test_assessor_dispatch_value_has_all_spec_fields():
    assert {"claim_number", "dispatch_id", "specialties"}.issubset(
        _field_names(AssessorDispatch)
    )


def test_payment_request_value_has_all_spec_fields():
    assert {"account_number", "amount_pence", "reference", "sort_code"}.issubset(
        _field_names(PaymentRequest)
    )


def test_payment_result_value_has_all_spec_fields():
    assert {"request", "status", "submitted_at", "upstream_id"}.issubset(
        _field_names(PaymentResult)
    )


# ---------------------------------------------------------------------------
# entity_optional obligations — optional fields accept null
# ---------------------------------------------------------------------------

def test_incident_report_linked_claim_is_optional():
    report = IncidentReport(
        report_id="r1",
        source="police",
        policy_number=None,
        incident_date=datetime.now(timezone.utc),
        description="...",
    )
    assert report.linked_claim_number is None
    report.linked_claim_number = "CLM-1"
    assert report.linked_claim_number == "CLM-1"


def test_incident_report_policy_number_is_optional():
    nullp = IncidentReport(
        report_id="r1",
        source="medical",
        policy_number=None,
        incident_date=datetime.now(timezone.utc),
        description="...",
    )
    setp = IncidentReport(
        report_id="r2",
        source="police",
        policy_number="POL-9",
        incident_date=datetime.now(timezone.utc),
        description="...",
    )
    assert nullp.policy_number is None
    assert setp.policy_number == "POL-9"


def test_assessment_completed_at_and_started_at_optional():
    a = Assessment(assessment_id="a1", claim_number="CLM-1", assessor_name="Bob")
    assert a.started_at is None
    assert a.completed_at is None
    a.started_at = datetime.now(timezone.utc)
    a.completed_at = datetime.now(timezone.utc)
    assert a.started_at is not None
    assert a.completed_at is not None


def test_claim_denial_reason_is_optional():
    c = Claim(
        claim_number="CLM-1",
        policy_number="POL-1",
        incident_date=datetime.now(timezone.utc),
        amount_claimed_pence=100,
    )
    assert c.denial_reason is None
    c.denial_reason = "fraud"
    assert c.denial_reason == "fraud"


def test_payout_last_failure_at_and_paid_at_optional():
    p = Payout(payout_id="p1", claim_number="CLM-1", amount_pence=100)
    assert p.last_failure_at is None
    assert p.paid_at is None


# ---------------------------------------------------------------------------
# enum_comparable obligations
# ---------------------------------------------------------------------------

@pytest.mark.parametrize(
    "enum_cls, expected_values",
    [
        (AssessmentStatus, {"completed", "in_progress", "pending"}),
        (
            ClaimStatus,
            {"approved", "assessing", "closed", "denied", "paid", "submitted", "triaged"},
        ),
        (PaymentResultStatus, {"accepted", "pending_review", "rejected"}),
        (PayoutStatus, {"failed", "paid", "scheduled"}),
        (PolicyStatus, {"active", "cancelled", "lapsed"}),
    ],
)
def test_enum_has_declared_values(enum_cls, expected_values):
    assert {m.value for m in enum_cls} == expected_values


@pytest.mark.parametrize(
    "enum_cls",
    [AssessmentStatus, ClaimStatus, PaymentResultStatus, PayoutStatus, PolicyStatus],
)
def test_enum_values_are_comparable(enum_cls):
    members = list(enum_cls)
    a, b = members[0], members[-1]
    assert a == a
    assert (a == b) is (a is b)
    assert a != "not-a-member"


def test_enum_membership_via_in_set():
    open_statuses = {ClaimStatus.SUBMITTED, ClaimStatus.TRIAGED, ClaimStatus.ASSESSING}
    assert ClaimStatus.SUBMITTED in open_statuses
    assert ClaimStatus.PAID not in open_statuses


# ---------------------------------------------------------------------------
# value_equality obligations — value types are structurally equal
# ---------------------------------------------------------------------------

def test_assessor_dispatch_structural_equality():
    a = AssessorDispatch(dispatch_id="d1", claim_number="CLM-1", specialties=["fire"])
    b = AssessorDispatch(dispatch_id="d1", claim_number="CLM-1", specialties=["fire"])
    c = AssessorDispatch(dispatch_id="d2", claim_number="CLM-1", specialties=["fire"])
    assert a == b
    assert a != c


def test_payment_request_structural_equality():
    a = PaymentRequest(account_number="12345678", sort_code="11-22-33", amount_pence=10, reference="r")
    b = PaymentRequest(account_number="12345678", sort_code="11-22-33", amount_pence=10, reference="r")
    c = PaymentRequest(account_number="12345678", sort_code="11-22-33", amount_pence=11, reference="r")
    assert a == b
    assert a != c


def test_payment_result_structural_equality():
    req = PaymentRequest(account_number="12345678", sort_code="11-22-33", amount_pence=10, reference="r")
    ts = datetime(2026, 1, 1, tzinfo=timezone.utc)
    a = PaymentResult(request=req, status=PaymentResultStatus.ACCEPTED, upstream_id="u1", submitted_at=ts)
    b = PaymentResult(request=req, status=PaymentResultStatus.ACCEPTED, upstream_id="u1", submitted_at=ts)
    c = PaymentResult(request=req, status=PaymentResultStatus.REJECTED, upstream_id="u1", submitted_at=ts)
    assert a == b
    assert a != c


# ---------------------------------------------------------------------------
# entity_relationship obligations — navigation via the FK is wired
# ---------------------------------------------------------------------------

def test_policy_to_claims_relationship_via_store(store):
    from .helpers import make_policy, make_submitted_claim

    make_policy(store, policy_number="POL-A")
    make_policy(store, policy_number="POL-B")
    make_submitted_claim(store, claim_number="CLM-A1", policy_number="POL-A")
    make_submitted_claim(store, claim_number="CLM-A2", policy_number="POL-A")
    make_submitted_claim(store, claim_number="CLM-B1", policy_number="POL-B")

    a_claims = [c for c in store.claims.values() if c.policy_number == "POL-A"]
    assert {c.claim_number for c in a_claims} == {"CLM-A1", "CLM-A2"}


def test_claim_to_assessments_relationship_via_store(store):
    from app.services import register_assessor, start_assessment, triage_claim
    from .helpers import make_policy, make_submitted_claim

    make_policy(store)
    register_assessor(store, "Bob", {"fire"})
    make_submitted_claim(store, claim_number="CLM-1")
    triage_claim(store, "CLM-1")
    start_assessment(store, "CLM-1", "Bob")

    related = [a for a in store.assessments.values() if a.claim_number == "CLM-1"]
    assert len(related) == 1


def test_claim_to_payouts_relationship_via_store(store):
    from app.services import (
        approve_claim,
        complete_assessment,
        register_assessor,
        schedule_payout,
        start_assessment,
        triage_claim,
    )
    from .helpers import make_policy, make_submitted_claim

    make_policy(store)
    register_assessor(store, "Bob", {"fire"})
    make_submitted_claim(store, claim_number="CLM-1")
    triage_claim(store, "CLM-1")
    assessment = start_assessment(store, "CLM-1", "Bob")
    complete_assessment(store, assessment.assessment_id, "ok")
    approve_claim(store, "CLM-1")
    payout = schedule_payout(store, "CLM-1")

    related = [p for p in store.payouts if p.claim_number == "CLM-1"]
    assert related == [payout]
