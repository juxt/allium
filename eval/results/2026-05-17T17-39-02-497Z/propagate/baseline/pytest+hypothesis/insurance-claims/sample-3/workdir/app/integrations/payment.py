"""Third-party payment integration.

Faster-Payments-shaped client. Real implementation would POST to a bank API
over mTLS. Here we expose just the surface area — the request and response
shapes — so that distill has a chance to recognise this as a library-spec
candidate (the bank's API contract is not ours to redefine).
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from enum import Enum


class PaymentError(Exception):
    """Raised when the upstream Faster Payments service rejects a request."""


class PaymentResultStatus(str, Enum):
    ACCEPTED = "accepted"
    REJECTED = "rejected"
    PENDING_REVIEW = "pending_review"


@dataclass
class PaymentRequest:
    account_number: str  # 8 digits
    sort_code: str       # NN-NN-NN
    amount_pence: int
    reference: str       # appears on the recipient's statement


@dataclass
class PaymentResult:
    request: PaymentRequest
    status: PaymentResultStatus
    upstream_id: str
    submitted_at: datetime


def send_faster_payment(
    *,
    account_number: str,
    sort_code: str,
    amount_pence: int,
    reference: str,
) -> PaymentResult:
    """Submit a Faster Payment to the upstream bank.

    Side-effect free in this fixture — a real implementation would post to
    the bank's API and raise PaymentError on a non-2xx response.
    """
    if amount_pence <= 0:
        raise PaymentError("amount must be positive")
    if len(account_number) != 8 or not account_number.isdigit():
        raise PaymentError("account_number must be 8 digits")
    if not _valid_sort_code(sort_code):
        raise PaymentError("sort_code must be in NN-NN-NN format")
    if amount_pence > 1_000_000_00:  # £1M upstream cap
        raise PaymentError("upstream caps Faster Payments at £1,000,000")

    return PaymentResult(
        request=PaymentRequest(
            account_number=account_number,
            sort_code=sort_code,
            amount_pence=amount_pence,
            reference=reference,
        ),
        status=PaymentResultStatus.ACCEPTED,
        upstream_id=f"fp-{reference}",
        submitted_at=datetime.now(timezone.utc),
    )


def _valid_sort_code(sort_code: str) -> bool:
    parts = sort_code.split("-")
    return len(parts) == 3 and all(len(p) == 2 and p.isdigit() for p in parts)
