"""HTTP routes — the adjuster-facing API.

Each route is a thin wrapper over a service-layer call. Body parsing is
faked out via plain dict arguments; we don't have a real WSGI server here.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any

from app import app, store
from app.models import ClaimStatus
from app.services import (
    approve_claim,
    deny_claim,
    mark_payout_paid,
    schedule_payout,
    start_assessment,
    submit_claim,
    triage_claim,
)


@app.post("/claims")
def create_claim_route(body: dict[str, Any]) -> dict[str, Any]:
    claim = submit_claim(
        store,
        claim_number=body["claim_number"],
        policy_number=body["policy_number"],
        incident_date=datetime.fromisoformat(body["incident_date"]),
        amount_claimed_pence=int(body["amount_claimed_pence"]),
    )
    return {"claim_number": claim.claim_number, "status": claim.status.value}


@app.post("/claims/<claim_number>/triage")
def triage_route(claim_number: str) -> dict[str, Any]:
    claim = triage_claim(store, claim_number)
    return {"claim_number": claim.claim_number, "status": claim.status.value}


@app.post("/claims/<claim_number>/assess")
def start_assessment_route(claim_number: str, body: dict[str, Any]) -> dict[str, Any]:
    assessment = start_assessment(store, claim_number, body["assessor_name"])
    return {
        "assessment_id": assessment.assessment_id,
        "claim_number": claim_number,
        "assessor_name": assessment.assessor_name,
    }


@app.post("/claims/<claim_number>/approve")
def approve_claim_route(claim_number: str) -> dict[str, Any]:
    # Adjuster-driven approval. The auto-approval scheduler in jobs.py also
    # calls approve_claim() for low-value, trusted-holder claims.
    claim = approve_claim(store, claim_number)
    payout = schedule_payout(store, claim_number)
    return {
        "claim_number": claim.claim_number,
        "status": claim.status.value,
        "payout_id": payout.payout_id,
    }


@app.post("/claims/<claim_number>/deny")
def deny_route(claim_number: str, body: dict[str, Any]) -> dict[str, Any]:
    claim = deny_claim(store, claim_number, body["reason"])
    return {
        "claim_number": claim.claim_number,
        "status": claim.status.value,
        "denial_reason": claim.denial_reason,
    }


@app.post("/payouts/<payout_id>/mark-paid")
def mark_paid_route(payout_id: str) -> dict[str, Any]:
    payout = mark_payout_paid(store, payout_id)
    return {"payout_id": payout.payout_id, "status": payout.status.value}


@app.get("/policies/<policy_number>/claims")
def list_policy_claims_route(policy_number: str) -> list[dict[str, Any]]:
    return [
        {
            "claim_number": c.claim_number,
            "status": c.status.value,
            "amount_claimed_pence": c.amount_claimed_pence,
            "is_within_sla": c.is_within_sla,
            "is_stalled": c.is_stalled,
        }
        for c in store.claims.values()
        if c.policy_number == policy_number
    ]


@app.get("/claims/<claim_number>")
def get_claim_route(claim_number: str) -> dict[str, Any]:
    claim = store.claims[claim_number]
    return {
        "claim_number": claim.claim_number,
        "policy_number": claim.policy_number,
        "status": claim.status.value,
        "amount_claimed_pence": claim.amount_claimed_pence,
        "total_paid_pence": claim.total_paid(store),
        "is_within_sla": claim.is_within_sla,
        "is_stalled": claim.is_stalled,
        "closed": claim.status in {ClaimStatus.PAID, ClaimStatus.DENIED, ClaimStatus.CLOSED},
    }
