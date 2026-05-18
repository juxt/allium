"""Domain entities for the insurance-claims app.

Five core entities plus one external entity (IncidentReport) that arrives via
webhook from third-party feeds (police, medical). All status fields are
modelled as Enums so the underlying state machine is explicit; derived
properties live as @property methods on the entity they describe.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from enum import Enum
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app import Store


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class PolicyStatus(str, Enum):
    ACTIVE = "active"
    LAPSED = "lapsed"
    CANCELLED = "cancelled"


class ClaimStatus(str, Enum):
    SUBMITTED = "submitted"
    TRIAGED = "triaged"
    ASSESSING = "assessing"
    APPROVED = "approved"
    DENIED = "denied"
    PAID = "paid"
    CLOSED = "closed"


class AssessmentStatus(str, Enum):
    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"


class PayoutStatus(str, Enum):
    SCHEDULED = "scheduled"
    PAID = "paid"
    FAILED = "failed"


# How long an "assessing" claim can sit without activity before it counts as
# stalled. Implicit state — no `stalled` column on the claim.
STALLED_AFTER = timedelta(days=21)

# Assessment SLA: a claim must reach a completed assessment within 14 days of
# submission, otherwise it's out of SLA.
ASSESSMENT_SLA = timedelta(days=14)


@dataclass
class Policy:
    policy_number: str
    holder: str
    coverage_limit_pence: int
    status: PolicyStatus = PolicyStatus.ACTIVE
    holder_tags: set[str] = field(default_factory=set)

    def has_open_claims(self, store: "Store") -> bool:
        closed = {ClaimStatus.PAID, ClaimStatus.DENIED, ClaimStatus.CLOSED}
        return any(
            c.policy_number == self.policy_number and c.status not in closed
            for c in store.claims.values()
        )


@dataclass
class Claim:
    claim_number: str
    policy_number: str  # FK — distils to `policy: Policy`
    incident_date: datetime
    amount_claimed_pence: int
    submitted_at: datetime = field(default_factory=_utcnow)
    last_activity_at: datetime = field(default_factory=_utcnow)
    status: ClaimStatus = ClaimStatus.SUBMITTED
    denial_reason: str | None = None

    @property
    def age(self) -> timedelta:
        return _utcnow() - self.submitted_at

    @property
    def is_within_sla(self) -> bool:
        return self.age <= ASSESSMENT_SLA

    @property
    def is_stalled(self) -> bool:
        """Implicit state: assessing for too long with no activity.

        There is deliberately no `stalled` column — callers compute this from
        (status, last_activity_at).
        """
        if self.status != ClaimStatus.ASSESSING:
            return False
        return (_utcnow() - self.last_activity_at) > STALLED_AFTER

    def total_paid(self, store: "Store") -> int:
        return sum(
            p.amount_pence
            for p in store.payouts
            if p.claim_number == self.claim_number and p.status == PayoutStatus.PAID
        )

    def touch(self) -> None:
        self.last_activity_at = _utcnow()


@dataclass
class Assessor:
    name: str
    specialties: set[str] = field(default_factory=set)


@dataclass
class Assessment:
    assessment_id: str
    claim_number: str
    assessor_name: str
    findings: str = ""
    status: AssessmentStatus = AssessmentStatus.PENDING
    started_at: datetime | None = None
    completed_at: datetime | None = None


@dataclass
class Payout:
    payout_id: str
    claim_number: str
    amount_pence: int
    status: PayoutStatus = PayoutStatus.SCHEDULED
    scheduled_at: datetime = field(default_factory=_utcnow)
    paid_at: datetime | None = None
    failed_attempts: int = 0
    last_failure_at: datetime | None = None


@dataclass
class IncidentReport:
    """External entity: arrives via webhook from police or medical feeds.

    The app does not own the lifecycle of these — it only receives, stores and
    links them to existing claims by policy_number + incident_date proximity.
    """
    report_id: str
    source: str  # e.g. "police", "medical"
    policy_number: str | None
    incident_date: datetime
    description: str
    received_at: datetime = field(default_factory=_utcnow)
    linked_claim_number: str | None = None
