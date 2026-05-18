"""Surface tests propagated from spec.allium.

Two surfaces are declared:

  surface Routes      — HTTP API (adjuster-facing)
  surface Webhooks    — inbound webhook surface (external feeds)

For each surface we verify:
  - the routes/handlers exist for each provided rule (surface_provides)
  - the rules dispatched via the surface actually run (surface_actor)

NOTE — there is a known spec-vs-code divergence: `surface Routes` declares
`RegisterPolicy` in `provides`, but the implementation has no HTTP route for
it (only a service function). That test is marked xfail so it documents
the gap rather than blocking the suite.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import pytest

# Triggering side-effect imports so routes/webhooks register themselves.
import app as _app_pkg  # noqa: F401
from app import app as router
from app import Route, store as _global_store
from app.models import AssessmentStatus, ClaimStatus
from app.services import register_assessor, register_policy


# ---------------------------------------------------------------------------
# Surface helpers
# ---------------------------------------------------------------------------

def _find_route(method: str, path: str) -> Route:
    for r in router.routes:
        if r.method == method and r.path == path:
            return r
    raise AssertionError(f"no {method} {path} registered (routes: "
                         f"{[(r.method, r.path) for r in router.routes]})")


# ---------------------------------------------------------------------------
# surface_provides.Routes — each rule mapped to an HTTP route
# ---------------------------------------------------------------------------

def test_routes_surface_provides_submit_claim_via_post_claims():
    """Spec @guidance: POST /claims -> create_claim_route."""
    _find_route("POST", "/claims")


def test_routes_surface_provides_triage_claim():
    _find_route("POST", "/claims/<claim_number>/triage")


def test_routes_surface_provides_start_assessment():
    _find_route("POST", "/claims/<claim_number>/assess")


def test_routes_surface_provides_approve_claim():
    _find_route("POST", "/claims/<claim_number>/approve")


def test_routes_surface_provides_deny_claim():
    _find_route("POST", "/claims/<claim_number>/deny")


def test_routes_surface_provides_mark_payout_paid():
    _find_route("POST", "/payouts/<payout_id>/mark-paid")


@pytest.mark.xfail(reason="Spec surface Routes lists RegisterPolicy but the "
                          "implementation exposes no HTTP route for it.",
                   strict=True)
def test_routes_surface_provides_register_policy_route():
    # TODO: divergence between spec and code — surface declares RegisterPolicy
    # but routes.py has no /policies create endpoint.
    _find_route("POST", "/policies")


# ---------------------------------------------------------------------------
# surface_actor.Routes — exercise the routes through the global app/store
# ---------------------------------------------------------------------------

def test_routes_full_lifecycle_through_handlers(reset_global_store):
    """End-to-end happy path via the HTTP route handlers.

    The Router stores handler callables; we invoke them directly the way a
    dispatcher would. This is the cleanest seam to exercise the surface
    without spinning up an HTTP server.
    """
    register_policy(
        _global_store, policy_number="P1", holder="Alice",
        coverage_limit_pence=10_000_00, holder_tags=set(),
    )
    register_assessor(_global_store, "Mira", {"motor"})

    create = _find_route("POST", "/claims").handler
    body: dict[str, Any] = {
        "claim_number": "C1",
        "policy_number": "P1",
        "incident_date": datetime.now(timezone.utc).isoformat(),
        "amount_claimed_pence": "1000",
    }
    resp = create(body)
    assert resp == {"claim_number": "C1", "status": "submitted"}

    triage = _find_route("POST", "/claims/<claim_number>/triage").handler
    assert triage("C1") == {"claim_number": "C1", "status": "triaged"}

    assess = _find_route("POST", "/claims/<claim_number>/assess").handler
    resp = assess("C1", {"assessor_name": "Mira"})
    assert resp["claim_number"] == "C1"
    assert resp["assessor_name"] == "Mira"
    assert resp["assessment_id"]
    assess_id = resp["assessment_id"]
    # Complete the assessment so approve can succeed.
    _global_store.assessments[assess_id].status = AssessmentStatus.COMPLETED

    approve = _find_route("POST", "/claims/<claim_number>/approve").handler
    resp = approve("C1")
    assert resp["claim_number"] == "C1"
    assert resp["status"] == "approved"
    payout_id = resp["payout_id"]

    paid = _find_route("POST", "/payouts/<payout_id>/mark-paid").handler
    resp = paid(payout_id)
    assert resp == {"payout_id": payout_id, "status": "paid"}
    assert _global_store.claims["C1"].status == ClaimStatus.PAID


def test_routes_deny_handler_writes_reason(reset_global_store):
    register_policy(
        _global_store, policy_number="P1", holder="Alice",
        coverage_limit_pence=10_000_00, holder_tags=set(),
    )
    _find_route("POST", "/claims").handler({
        "claim_number": "C1",
        "policy_number": "P1",
        "incident_date": datetime.now(timezone.utc).isoformat(),
        "amount_claimed_pence": "1000",
    })
    _find_route("POST", "/claims/<claim_number>/triage").handler("C1")
    deny = _find_route("POST", "/claims/<claim_number>/deny").handler
    resp = deny("C1", {"reason": "fraud"})
    assert resp == {
        "claim_number": "C1",
        "status": "denied",
        "denial_reason": "fraud",
    }


# ---------------------------------------------------------------------------
# Webhooks surface — ReceiveIncidentReport
# ---------------------------------------------------------------------------

def test_webhooks_surface_provides_receive_incident_report():
    """surface_provides.Webhooks: POST /webhooks/incident-reports."""
    _find_route("POST", "/webhooks/incident-reports")


def test_webhooks_receive_incident_report_stores_report(reset_global_store):
    """rule_success.ReceiveIncidentReport + rule_entity_creation."""
    handler = _find_route("POST", "/webhooks/incident-reports").handler
    payload = {
        "source": "police",
        "policy_number": None,
        "incident_date": datetime.now(timezone.utc).isoformat(),
        "description": "fender bender",
    }
    resp = handler(payload)
    assert resp["linked_claim_number"] is None
    assert resp["report_id"]
    assert resp["report_id"] in _global_store.incident_reports
    stored = _global_store.incident_reports[resp["report_id"]]
    assert stored.source == "police"
    assert stored.description == "fender bender"


def test_webhooks_receive_incident_report_links_within_window(reset_global_store):
    """The link_window config controls how close incident-dates must be."""
    register_policy(
        _global_store, policy_number="P1", holder="Alice",
        coverage_limit_pence=10_000_00, holder_tags=set(),
    )
    incident = datetime(2026, 5, 1, tzinfo=timezone.utc)
    _find_route("POST", "/claims").handler({
        "claim_number": "C1",
        "policy_number": "P1",
        "incident_date": incident.isoformat(),
        "amount_claimed_pence": "1000",
    })
    handler = _find_route("POST", "/webhooks/incident-reports").handler
    resp = handler({
        "source": "police",
        "policy_number": "P1",
        "incident_date": (incident + __import__("datetime").timedelta(days=1)).isoformat(),
        "description": "matches",
    })
    assert resp["linked_claim_number"] == "C1"


def test_webhooks_receive_incident_report_does_not_link_outside_window(reset_global_store):
    register_policy(
        _global_store, policy_number="P1", holder="Alice",
        coverage_limit_pence=10_000_00, holder_tags=set(),
    )
    incident = datetime(2026, 5, 1, tzinfo=timezone.utc)
    _find_route("POST", "/claims").handler({
        "claim_number": "C1",
        "policy_number": "P1",
        "incident_date": incident.isoformat(),
        "amount_claimed_pence": "1000",
    })
    handler = _find_route("POST", "/webhooks/incident-reports").handler
    far = (incident + __import__("datetime").timedelta(days=10)).isoformat()
    resp = handler({
        "source": "police",
        "policy_number": "P1",
        "incident_date": far,
        "description": "far",
    })
    assert resp["linked_claim_number"] is None
