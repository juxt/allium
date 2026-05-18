"""Surface (HTTP route + webhook) tests.

Covers surface_provides obligations: each rule listed under a surface's
``provides`` must be reachable through the implementing route/webhook.

The implementation bridge is the @app.post / @app.get registrations on the
shared Router (``app.app``). Tests dispatch the route handlers in-process.

surface_actor obligations are documented as "adjuster-driven" in the spec
guidance but the implementation does not enforce an actor type at the HTTP
layer — there is no authentication seam. Those tests are left as TODO skips.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

import pytest

import app as app_pkg
from app.models import ClaimStatus, IncidentReport
from app.services import register_assessor, register_policy
from app.webhooks import LINK_WINDOW


def _find_route(method: str, path: str):
    for r in app_pkg.app.routes:
        if r.method == method and r.path == path:
            return r
    raise AssertionError(f"no route registered for {method} {path}")


# ---------------------------------------------------------------------------
# Routes surface — `provides` obligations
# ---------------------------------------------------------------------------

class TestRoutesSurfaceProvides:
    """Each rule the Routes surface provides must be reachable via HTTP."""

    @pytest.mark.parametrize(
        "method, path",
        [
            ("POST", "/claims"),
            ("GET", "/claims/<claim_number>"),
            ("POST", "/claims/<claim_number>/approve"),
            ("POST", "/claims/<claim_number>/assess"),
            ("POST", "/claims/<claim_number>/deny"),
            ("POST", "/claims/<claim_number>/triage"),
            ("POST", "/payouts/<payout_id>/mark-paid"),
            ("GET", "/policies/<policy_number>/claims"),
        ],
    )
    def test_route_is_registered(self, method, path):
        _find_route(method, path)

    def test_register_policy_then_submit_then_triage(self, clean_store):
        register_policy(
            clean_store,
            policy_number="POL-1",
            holder="Alice",
            coverage_limit_pence=100_000,
        )
        body: dict[str, Any] = {
            "claim_number": "CLM-1",
            "policy_number": "POL-1",
            "incident_date": datetime.now(timezone.utc).isoformat(),
            "amount_claimed_pence": 100,
        }
        create_route = _find_route("POST", "/claims").handler
        resp = create_route(body)
        assert resp == {"claim_number": "CLM-1", "status": "submitted"}

        triage_route = _find_route("POST", "/claims/<claim_number>/triage").handler
        resp = triage_route("CLM-1")
        assert resp["status"] == "triaged"

    def test_start_assessment_route(self, clean_store):
        register_policy(clean_store, policy_number="POL-1", holder="Alice", coverage_limit_pence=10_000)
        register_assessor(clean_store, "Bob", {"fire"})
        _find_route("POST", "/claims").handler(
            {
                "claim_number": "CLM-1",
                "policy_number": "POL-1",
                "incident_date": datetime.now(timezone.utc).isoformat(),
                "amount_claimed_pence": 1,
            }
        )
        _find_route("POST", "/claims/<claim_number>/triage").handler("CLM-1")
        resp = _find_route("POST", "/claims/<claim_number>/assess").handler(
            "CLM-1", {"assessor_name": "Bob"}
        )
        assert resp["claim_number"] == "CLM-1"
        assert resp["assessor_name"] == "Bob"

    def test_deny_route_records_reason(self, clean_store):
        register_policy(clean_store, policy_number="POL-1", holder="Alice", coverage_limit_pence=10_000)
        _find_route("POST", "/claims").handler(
            {
                "claim_number": "CLM-1",
                "policy_number": "POL-1",
                "incident_date": datetime.now(timezone.utc).isoformat(),
                "amount_claimed_pence": 1,
            }
        )
        _find_route("POST", "/claims/<claim_number>/triage").handler("CLM-1")
        resp = _find_route("POST", "/claims/<claim_number>/deny").handler(
            "CLM-1", {"reason": "fraud"}
        )
        assert resp["status"] == "denied"
        assert resp["denial_reason"] == "fraud"

    def test_approve_and_mark_paid_via_routes(self, clean_store):
        from app.services import complete_assessment, start_assessment, triage_claim
        register_policy(clean_store, policy_number="POL-1", holder="Alice", coverage_limit_pence=10_000)
        register_assessor(clean_store, "Bob", {"fire"})
        _find_route("POST", "/claims").handler(
            {
                "claim_number": "CLM-1",
                "policy_number": "POL-1",
                "incident_date": datetime.now(timezone.utc).isoformat(),
                "amount_claimed_pence": 100,
            }
        )
        triage_claim(clean_store, "CLM-1")
        a = start_assessment(clean_store, "CLM-1", "Bob")
        complete_assessment(clean_store, a.assessment_id, "ok")

        approve_resp = _find_route("POST", "/claims/<claim_number>/approve").handler("CLM-1")
        assert approve_resp["status"] == "approved"
        payout_id = approve_resp["payout_id"]

        paid_resp = _find_route("POST", "/payouts/<payout_id>/mark-paid").handler(payout_id)
        assert paid_resp["status"] == "paid"
        assert clean_store.claims["CLM-1"].status == ClaimStatus.PAID

    def test_get_claim_route_exposes_derived_fields(self, clean_store):
        register_policy(clean_store, policy_number="POL-1", holder="Alice", coverage_limit_pence=10_000)
        _find_route("POST", "/claims").handler(
            {
                "claim_number": "CLM-1",
                "policy_number": "POL-1",
                "incident_date": datetime.now(timezone.utc).isoformat(),
                "amount_claimed_pence": 100,
            }
        )
        resp = _find_route("GET", "/claims/<claim_number>").handler("CLM-1")
        # Spec: GET /claims/<claim_number> exposes the claim and its derived
        # values such as is_within_sla, is_stalled and total_paid.
        assert resp["status"] == "submitted"
        assert "is_within_sla" in resp
        assert "is_stalled" in resp
        assert "total_paid_pence" in resp
        assert "closed" in resp

    def test_list_policy_claims_route(self, clean_store):
        register_policy(clean_store, policy_number="POL-1", holder="Alice", coverage_limit_pence=10_000)
        register_policy(clean_store, policy_number="POL-2", holder="Bob", coverage_limit_pence=10_000)
        create = _find_route("POST", "/claims").handler
        now = datetime.now(timezone.utc).isoformat()
        create({"claim_number": "C1", "policy_number": "POL-1", "incident_date": now, "amount_claimed_pence": 1})
        create({"claim_number": "C2", "policy_number": "POL-1", "incident_date": now, "amount_claimed_pence": 2})
        create({"claim_number": "C3", "policy_number": "POL-2", "incident_date": now, "amount_claimed_pence": 3})
        listed = _find_route("GET", "/policies/<policy_number>/claims").handler("POL-1")
        assert {c["claim_number"] for c in listed} == {"C1", "C2"}


# ---------------------------------------------------------------------------
# Webhooks surface — ReceiveIncidentReport
# ---------------------------------------------------------------------------

class TestWebhooksSurface:
    def test_incident_report_webhook_registered(self):
        _find_route("POST", "/webhooks/incident-reports")

    def test_webhook_persists_incident_report(self, clean_store):
        body: dict[str, Any] = {
            "source": "police",
            "policy_number": None,
            "incident_date": datetime.now(timezone.utc).isoformat(),
            "description": "A bump",
        }
        handler = _find_route("POST", "/webhooks/incident-reports").handler
        resp = handler(body)
        assert "report_id" in resp
        assert resp["linked_claim_number"] is None
        stored = clean_store.incident_reports[resp["report_id"]]
        assert isinstance(stored, IncidentReport)

    def test_webhook_links_to_matching_claim_inside_link_window(self, clean_store):
        register_policy(clean_store, policy_number="POL-1", holder="Alice", coverage_limit_pence=10_000)
        incident_dt = datetime.now(timezone.utc)
        _find_route("POST", "/claims").handler(
            {
                "claim_number": "CLM-1",
                "policy_number": "POL-1",
                "incident_date": incident_dt.isoformat(),
                "amount_claimed_pence": 1,
            }
        )
        resp = _find_route("POST", "/webhooks/incident-reports").handler(
            {
                "source": "police",
                "policy_number": "POL-1",
                # Within the 2-day link window.
                "incident_date": (incident_dt + (LINK_WINDOW - timedelta(hours=1))).isoformat(),
                "description": "...",
            }
        )
        assert resp["linked_claim_number"] == "CLM-1"

    def test_webhook_does_not_link_outside_link_window(self, clean_store):
        register_policy(clean_store, policy_number="POL-1", holder="Alice", coverage_limit_pence=10_000)
        incident_dt = datetime.now(timezone.utc)
        _find_route("POST", "/claims").handler(
            {
                "claim_number": "CLM-1",
                "policy_number": "POL-1",
                "incident_date": incident_dt.isoformat(),
                "amount_claimed_pence": 1,
            }
        )
        resp = _find_route("POST", "/webhooks/incident-reports").handler(
            {
                "source": "police",
                "policy_number": "POL-1",
                # Outside the 2-day link window.
                "incident_date": (incident_dt + LINK_WINDOW + timedelta(hours=1)).isoformat(),
                "description": "...",
            }
        )
        assert resp["linked_claim_number"] is None

    def test_webhook_without_policy_number_does_not_link(self, clean_store):
        register_policy(clean_store, policy_number="POL-1", holder="Alice", coverage_limit_pence=10_000)
        incident_dt = datetime.now(timezone.utc)
        _find_route("POST", "/claims").handler(
            {
                "claim_number": "CLM-1",
                "policy_number": "POL-1",
                "incident_date": incident_dt.isoformat(),
                "amount_claimed_pence": 1,
            }
        )
        resp = _find_route("POST", "/webhooks/incident-reports").handler(
            {
                "source": "police",
                "policy_number": None,
                "incident_date": incident_dt.isoformat(),
                "description": "...",
            }
        )
        assert resp["linked_claim_number"] is None


# ---------------------------------------------------------------------------
# surface_actor obligations
# ---------------------------------------------------------------------------

@pytest.mark.skip(
    reason=(
        "spec does not declare an `actor` block on either surface; the "
        "implementation has no authentication seam. surface_actor obligations "
        "from `allium plan` map to a non-existent bridge."
    )
)
def test_routes_actor_restriction_todo():
    """Bridge ambiguous: no actor declared, no auth in implementation."""
    pass


@pytest.mark.skip(
    reason=(
        "spec does not declare an `actor` block on Webhooks; no authentication "
        "seam in the implementation."
    )
)
def test_webhooks_actor_restriction_todo():
    """Bridge ambiguous: no actor declared, no auth in implementation."""
    pass
