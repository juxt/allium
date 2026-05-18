"""Inbound webhooks.

External feeds (police, medical assessors) push IncidentReport objects to us
as they happen. We persist them and try to link to a matching claim using a
loose match on policy_number plus incident-date proximity (±2 days).
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta
from typing import Any

from app import app, store
from app.models import IncidentReport

LINK_WINDOW = timedelta(days=2)


@app.post("/webhooks/incident-reports")
def receive_incident_report(body: dict[str, Any]) -> dict[str, Any]:
    report = IncidentReport(
        report_id=str(uuid.uuid4()),
        source=body["source"],
        policy_number=body.get("policy_number"),
        incident_date=datetime.fromisoformat(body["incident_date"]),
        description=body["description"],
    )
    store.incident_reports[report.report_id] = report
    linked = _try_link_report(report)
    if linked is not None:
        report.linked_claim_number = linked
    return {
        "report_id": report.report_id,
        "linked_claim_number": report.linked_claim_number,
    }


def _try_link_report(report: IncidentReport) -> str | None:
    if report.policy_number is None:
        return None
    for claim in store.claims.values():
        if claim.policy_number != report.policy_number:
            continue
        if abs(claim.incident_date - report.incident_date) <= LINK_WINDOW:
            return claim.claim_number
    return None
