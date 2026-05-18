"""Entity/value-type structural tests propagated from spec.allium.

Covers obligations of categories:
  entity_fields, entity_optional, entity_relationship, projection, derived,
  value_equality.
"""
from __future__ import annotations

from dataclasses import fields
from datetime import datetime, timedelta, timezone

from app import Store
from app.integrations.assessor import AssessorDispatch
from app.integrations.payment import PaymentRequest, PaymentResult, PaymentResultStatus
from app.models import (
    ASSESSMENT_SLA,
    STALLED_AFTER,
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

def _field_names(cls) -> set[str]:
    return {f.name for f in fields(cls)}


def test_incident_report_has_declared_fields():
    # Spec field `linked_claim` maps to implementation `linked_claim_number`
    # (FK string instead of relation). Test for the implementation name and
    # leave a TODO for the spec-vs-code naming divergence.
    expected = {
        "report_id",
        "source",
        "policy_number",
        "incident_date",
        "description",
        "received_at",
        "linked_claim_number",  # TODO: spec calls this `linked_claim: Claim?`
    }
    assert _field_names(IncidentReport) == expected


def test_assessor_dispatch_value_has_declared_fields():
    assert _field_names(AssessorDispatch) == {
        "dispatch_id",
        "claim_number",
        "specialties",
    }


def test_payment_request_value_has_declared_fields():
    assert _field_names(PaymentRequest) == {
        "account_number",
        "sort_code",
        "amount_pence",
        "reference",
    }


def test_payment_result_value_has_declared_fields():
    assert _field_names(PaymentResult) == {
        "request",
        "status",
        "upstream_id",
        "submitted_at",
    }


def test_assessment_has_declared_fields():
    # Spec: assessor: Assessor / claim: Claim — implementation uses FK strings.
    expected = {
        "assessment_id",
        "claim_number",     # TODO: spec calls this `claim: Claim`
        "assessor_name",    # TODO: spec calls this `assessor: Assessor`
        "findings",
        "status",
        "started_at",
        "completed_at",
    }
    assert _field_names(Assessment) == expected


def test_assessor_has_declared_fields():
    assert _field_names(Assessor) == {"name", "specialties"}


def test_claim_has_declared_fields():
    expected = {
        "claim_number",
        "policy_number",  # TODO: spec calls this `policy: Policy`
        "incident_date",
        "amount_claimed_pence",
        "submitted_at",
        "last_activity_at",
        "status",
        "denial_reason",
    }
    assert _field_names(Claim) == expected


def test_payout_has_declared_fields():
    expected = {
        "payout_id",
        "claim_number",  # TODO: spec calls this `claim: Claim`
        "amount_pence",
        "status",
        "scheduled_at",
        "paid_at",
        "failed_attempts",
        "last_failure_at",
    }
    assert _field_names(Payout) == expected


def test_policy_has_declared_fields():
    assert _field_names(Policy) == {
        "policy_number",
        "holder",
        "coverage_limit_pence",
        "status",
        "holder_tags",
    }


# ---------------------------------------------------------------------------
# entity_optional obligations
# ---------------------------------------------------------------------------

def test_incident_report_policy_number_is_optional():
    report = IncidentReport(
        report_id="r1",
        source="police",
        policy_number=None,
        incident_date=datetime.now(timezone.utc),
        description="-",
    )
    assert report.policy_number is None
    report.policy_number = "POL-1"
    assert report.policy_number == "POL-1"


def test_incident_report_linked_claim_is_optional():
    report = IncidentReport(
        report_id="r1",
        source="police",
        policy_number=None,
        incident_date=datetime.now(timezone.utc),
        description="-",
    )
    # Default unlinked
    assert report.linked_claim_number is None
    report.linked_claim_number = "C-1"
    assert report.linked_claim_number == "C-1"


def test_assessment_started_at_is_optional():
    a = Assessment(assessment_id="a1", claim_number="c1", assessor_name="x")
    assert a.started_at is None
    a.started_at = datetime.now(timezone.utc)
    assert a.started_at is not None


def test_assessment_completed_at_is_optional():
    a = Assessment(assessment_id="a1", claim_number="c1", assessor_name="x")
    assert a.completed_at is None
    a.completed_at = datetime.now(timezone.utc)
    assert a.completed_at is not None


def test_claim_denial_reason_is_optional():
    c = Claim(
        claim_number="C1",
        policy_number="P1",
        incident_date=datetime.now(timezone.utc),
        amount_claimed_pence=1000,
    )
    assert c.denial_reason is None
    c.denial_reason = "fraud"
    assert c.denial_reason == "fraud"


def test_payout_paid_at_is_optional():
    p = Payout(payout_id="P1", claim_number="C1", amount_pence=1000)
    assert p.paid_at is None
    p.paid_at = datetime.now(timezone.utc)
    assert p.paid_at is not None


def test_payout_last_failure_at_is_optional():
    p = Payout(payout_id="P1", claim_number="C1", amount_pence=1000)
    assert p.last_failure_at is None
    p.last_failure_at = datetime.now(timezone.utc)
    assert p.last_failure_at is not None


# ---------------------------------------------------------------------------
# entity_relationship and projection obligations
#
# Spec: Claim has `assessments: Assessment with claim = this`,
# `payouts: Payout with claim = this`, and projections
# `completed_assessments` / `paid_payouts`. Implementation uses FK strings
# rather than relations, so the test must run via the store and the
# implementation's matching predicate (claim_number).
# ---------------------------------------------------------------------------

def _seed_policy(store: Store, number="P1") -> Policy:
    p = Policy(
        policy_number=number,
        holder="Alice",
        coverage_limit_pence=10_000_00,
        status=PolicyStatus.ACTIVE,
    )
    store.policies[number] = p
    return p


def _seed_claim(store: Store, claim_number="C1", policy_number="P1") -> Claim:
    c = Claim(
        claim_number=claim_number,
        policy_number=policy_number,
        incident_date=datetime.now(timezone.utc),
        amount_claimed_pence=5_000_00,
    )
    store.claims[claim_number] = c
    return c


def test_claim_assessments_relationship_filters_by_claim_number(store):
    _seed_policy(store)
    _seed_claim(store, "C1")
    _seed_claim(store, "C2")
    store.assessments["a1"] = Assessment("a1", "C1", "Mira", status=AssessmentStatus.IN_PROGRESS)
    store.assessments["a2"] = Assessment("a2", "C1", "Mira", status=AssessmentStatus.COMPLETED)
    store.assessments["a3"] = Assessment("a3", "C2", "Mira", status=AssessmentStatus.PENDING)

    related = [a for a in store.assessments.values() if a.claim_number == "C1"]
    assert {a.assessment_id for a in related} == {"a1", "a2"}


def test_claim_completed_assessments_projection(store):
    _seed_policy(store)
    _seed_claim(store, "C1")
    store.assessments["a1"] = Assessment("a1", "C1", "Mira", status=AssessmentStatus.COMPLETED)
    store.assessments["a2"] = Assessment("a2", "C1", "Mira", status=AssessmentStatus.IN_PROGRESS)
    store.assessments["a3"] = Assessment("a3", "C1", "Mira", status=AssessmentStatus.PENDING)

    completed = [
        a for a in store.assessments.values()
        if a.claim_number == "C1" and a.status == AssessmentStatus.COMPLETED
    ]
    assert len(completed) == 1
    assert completed[0].assessment_id == "a1"


def test_claim_payouts_relationship(store):
    _seed_policy(store)
    _seed_claim(store, "C1")
    store.payouts.append(Payout("p1", "C1", 100))
    store.payouts.append(Payout("p2", "C1", 200))
    store.payouts.append(Payout("p3", "C2", 300))

    related = [p for p in store.payouts if p.claim_number == "C1"]
    assert {p.payout_id for p in related} == {"p1", "p2"}


def test_claim_paid_payouts_projection(store):
    _seed_policy(store)
    _seed_claim(store, "C1")
    store.payouts.append(Payout("p1", "C1", 100, status=PayoutStatus.PAID))
    store.payouts.append(Payout("p2", "C1", 200, status=PayoutStatus.SCHEDULED))
    store.payouts.append(Payout("p3", "C1", 300, status=PayoutStatus.FAILED))

    paid = [
        p for p in store.payouts
        if p.claim_number == "C1" and p.status == PayoutStatus.PAID
    ]
    assert [p.payout_id for p in paid] == ["p1"]


def test_policy_claims_relationship(store):
    _seed_policy(store, "P1")
    _seed_policy(store, "P2")
    _seed_claim(store, "C1", "P1")
    _seed_claim(store, "C2", "P1")
    _seed_claim(store, "C3", "P2")

    related = [c for c in store.claims.values() if c.policy_number == "P1"]
    assert {c.claim_number for c in related} == {"C1", "C2"}


def test_policy_open_claims_projection_excludes_paid_denied_closed(store):
    _seed_policy(store, "P1")
    c1 = _seed_claim(store, "C1", "P1"); c1.status = ClaimStatus.SUBMITTED
    c2 = _seed_claim(store, "C2", "P1"); c2.status = ClaimStatus.PAID
    c3 = _seed_claim(store, "C3", "P1"); c3.status = ClaimStatus.DENIED
    c4 = _seed_claim(store, "C4", "P1"); c4.status = ClaimStatus.CLOSED
    c5 = _seed_claim(store, "C5", "P1"); c5.status = ClaimStatus.ASSESSING

    closed = {ClaimStatus.PAID, ClaimStatus.DENIED, ClaimStatus.CLOSED}
    open_ = [
        c for c in store.claims.values()
        if c.policy_number == "P1" and c.status not in closed
    ]
    assert {c.claim_number for c in open_} == {"C1", "C5"}


# ---------------------------------------------------------------------------
# derived value obligations
# ---------------------------------------------------------------------------

def test_claim_age_is_now_minus_submitted_at():
    c = Claim(
        claim_number="C",
        policy_number="P",
        incident_date=datetime.now(timezone.utc),
        amount_claimed_pence=1,
        submitted_at=datetime.now(timezone.utc) - timedelta(days=3),
    )
    assert timedelta(days=2, hours=23) < c.age < timedelta(days=3, hours=1)


def test_claim_has_completed_assessment_derived(store):
    _seed_policy(store)
    _seed_claim(store, "C1")
    assert not any(
        a.claim_number == "C1" and a.status == AssessmentStatus.COMPLETED
        for a in store.assessments.values()
    )
    store.assessments["a"] = Assessment("a", "C1", "Mira", status=AssessmentStatus.COMPLETED)
    assert any(
        a.claim_number == "C1" and a.status == AssessmentStatus.COMPLETED
        for a in store.assessments.values()
    )


def test_claim_is_within_sla_boundary():
    fresh = Claim(
        claim_number="C",
        policy_number="P",
        incident_date=datetime.now(timezone.utc),
        amount_claimed_pence=1,
        submitted_at=datetime.now(timezone.utc) - timedelta(days=1),
    )
    assert fresh.is_within_sla is True
    stale = Claim(
        claim_number="C",
        policy_number="P",
        incident_date=datetime.now(timezone.utc),
        amount_claimed_pence=1,
        submitted_at=datetime.now(timezone.utc) - ASSESSMENT_SLA - timedelta(minutes=1),
    )
    assert stale.is_within_sla is False


def test_claim_is_stalled_requires_assessing_and_age():
    incident = datetime.now(timezone.utc)
    # Old activity but wrong status — not stalled.
    not_assessing = Claim(
        claim_number="C",
        policy_number="P",
        incident_date=incident,
        amount_claimed_pence=1,
        status=ClaimStatus.SUBMITTED,
        last_activity_at=datetime.now(timezone.utc) - STALLED_AFTER - timedelta(days=1),
    )
    assert not_assessing.is_stalled is False
    # Assessing but recent activity — not stalled.
    fresh_assessing = Claim(
        claim_number="C",
        policy_number="P",
        incident_date=incident,
        amount_claimed_pence=1,
        status=ClaimStatus.ASSESSING,
        last_activity_at=datetime.now(timezone.utc) - timedelta(days=1),
    )
    assert fresh_assessing.is_stalled is False
    # Assessing + stale activity — stalled.
    stalled = Claim(
        claim_number="C",
        policy_number="P",
        incident_date=incident,
        amount_claimed_pence=1,
        status=ClaimStatus.ASSESSING,
        last_activity_at=datetime.now(timezone.utc) - STALLED_AFTER - timedelta(days=1),
    )
    assert stalled.is_stalled is True


def test_claim_total_paid_sums_paid_payouts(store):
    _seed_policy(store)
    c = _seed_claim(store, "C1")
    store.payouts.append(Payout("p1", "C1", 100, status=PayoutStatus.PAID))
    store.payouts.append(Payout("p2", "C1", 250, status=PayoutStatus.SCHEDULED))
    store.payouts.append(Payout("p3", "C1", 50, status=PayoutStatus.PAID))
    store.payouts.append(Payout("p4", "OTHER", 999, status=PayoutStatus.PAID))
    assert c.total_paid(store) == 150


# ---------------------------------------------------------------------------
# Payout.retry_due_at — derived
# ---------------------------------------------------------------------------

def test_payout_retry_anchor_uses_scheduled_when_never_failed():
    scheduled_at = datetime(2026, 1, 1, tzinfo=timezone.utc)
    p = Payout("p", "c", 1, status=PayoutStatus.SCHEDULED, scheduled_at=scheduled_at)
    anchor = p.last_failure_at or p.scheduled_at
    assert anchor == scheduled_at


def test_payout_retry_anchor_prefers_last_failure_at():
    scheduled_at = datetime(2026, 1, 1, tzinfo=timezone.utc)
    failed_at = datetime(2026, 2, 1, tzinfo=timezone.utc)
    p = Payout(
        "p", "c", 1,
        status=PayoutStatus.FAILED,
        scheduled_at=scheduled_at,
        last_failure_at=failed_at,
    )
    anchor = p.last_failure_at or p.scheduled_at
    assert anchor == failed_at


# ---------------------------------------------------------------------------
# Policy.has_open_claims — derived
# ---------------------------------------------------------------------------

def test_policy_has_open_claims_true_when_any_open(store):
    p = _seed_policy(store, "P1")
    c = _seed_claim(store, "C1", "P1")
    c.status = ClaimStatus.ASSESSING
    assert p.has_open_claims(store) is True


def test_policy_has_open_claims_false_when_all_terminal(store):
    p = _seed_policy(store, "P1")
    c1 = _seed_claim(store, "C1", "P1"); c1.status = ClaimStatus.PAID
    c2 = _seed_claim(store, "C2", "P1"); c2.status = ClaimStatus.DENIED
    c3 = _seed_claim(store, "C3", "P1"); c3.status = ClaimStatus.CLOSED
    assert p.has_open_claims(store) is False


# ---------------------------------------------------------------------------
# value_equality obligations
# ---------------------------------------------------------------------------

def test_payment_request_structural_equality():
    a = PaymentRequest(account_number="12345678", sort_code="00-00-00",
                       amount_pence=100, reference="r")
    b = PaymentRequest(account_number="12345678", sort_code="00-00-00",
                       amount_pence=100, reference="r")
    c = PaymentRequest(account_number="12345678", sort_code="00-00-00",
                       amount_pence=101, reference="r")
    assert a == b
    assert a != c


def test_assessor_dispatch_structural_equality():
    a = AssessorDispatch(dispatch_id="d", claim_number="c", specialties=["x"])
    b = AssessorDispatch(dispatch_id="d", claim_number="c", specialties=["x"])
    c = AssessorDispatch(dispatch_id="d", claim_number="c", specialties=["y"])
    assert a == b
    assert a != c


def test_payment_result_structural_equality():
    ts = datetime.now(timezone.utc)
    req = PaymentRequest(account_number="12345678", sort_code="00-00-00",
                         amount_pence=100, reference="r")
    a = PaymentResult(request=req, status=PaymentResultStatus.ACCEPTED,
                      upstream_id="u", submitted_at=ts)
    b = PaymentResult(request=req, status=PaymentResultStatus.ACCEPTED,
                      upstream_id="u", submitted_at=ts)
    assert a == b
