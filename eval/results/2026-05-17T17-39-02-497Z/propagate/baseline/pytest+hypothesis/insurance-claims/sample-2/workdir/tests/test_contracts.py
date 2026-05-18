"""Contract signature and invariant tests propagated from spec.allium.

The spec declares two contracts: `PaymentService.send_faster_payment` and
`AssessorService.request_assessor_dispatch`. The bridge is:

- PaymentService -> app.integrations.payment.send_faster_payment
- AssessorService -> app.integrations.assessor.request_assessor_dispatch
"""
from __future__ import annotations

import inspect

import pytest
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

from app.integrations.assessor import (
    AssessorDispatch,
    AssessorDispatchError,
    request_assessor_dispatch,
)
from app.integrations.payment import (
    PaymentError,
    PaymentRequest,
    PaymentResult,
    PaymentResultStatus,
    send_faster_payment,
)


# ---------------------------------------------------------------------------
# contract_signature.AssessorService.request_assessor_dispatch
# ---------------------------------------------------------------------------

def test_assessor_dispatch_signature_matches_contract():
    sig = inspect.signature(request_assessor_dispatch)
    assert set(sig.parameters) == {"claim_number", "specialties"}
    assert sig.parameters["claim_number"].kind == inspect.Parameter.KEYWORD_ONLY
    assert sig.parameters["specialties"].kind == inspect.Parameter.KEYWORD_ONLY


def test_assessor_dispatch_returns_dispatch_with_request_fields():
    d = request_assessor_dispatch(claim_number="C1", specialties=["motor"])
    assert isinstance(d, AssessorDispatch)
    assert d.claim_number == "C1"
    assert d.specialties == ["motor"]
    assert d.dispatch_id


def test_assessor_dispatch_precondition_specialties_nonempty():
    """contract @invariant Precondition: specialties.length > 0."""
    with pytest.raises(AssessorDispatchError):
        request_assessor_dispatch(claim_number="C1", specialties=[])


# ---------------------------------------------------------------------------
# contract_signature.PaymentService.send_faster_payment
# ---------------------------------------------------------------------------

def test_send_faster_payment_signature_matches_contract():
    sig = inspect.signature(send_faster_payment)
    assert set(sig.parameters) == {
        "account_number", "sort_code", "amount_pence", "reference",
    }
    for p in sig.parameters.values():
        assert p.kind == inspect.Parameter.KEYWORD_ONLY


def test_send_faster_payment_success_returns_payment_result():
    result = send_faster_payment(
        account_number="12345678",
        sort_code="00-00-00",
        amount_pence=1_000_00,
        reference="ref",
    )
    assert isinstance(result, PaymentResult)
    assert isinstance(result.request, PaymentRequest)
    assert result.status == PaymentResultStatus.ACCEPTED
    assert result.upstream_id.startswith("fp-")


# ---------------------------------------------------------------------------
# contract invariants (property-based)
# ---------------------------------------------------------------------------

@given(amount=st.integers(max_value=0))
@settings(suppress_health_check=[HealthCheck.function_scoped_fixture], max_examples=25)
def test_send_faster_payment_rejects_non_positive_amounts(amount):
    """contract @invariant AmountPenceIsPositive: amount_pence > 0."""
    with pytest.raises(PaymentError):
        send_faster_payment(
            account_number="12345678",
            sort_code="00-00-00",
            amount_pence=amount,
            reference="r",
        )


@given(amount=st.integers(min_value=1_000_000_00 + 1, max_value=10_000_000_00))
@settings(max_examples=25)
def test_send_faster_payment_rejects_above_cap(amount):
    """contract @invariant AmountPenceWithinCap: amount_pence <= 1_000_000_00."""
    with pytest.raises(PaymentError):
        send_faster_payment(
            account_number="12345678",
            sort_code="00-00-00",
            amount_pence=amount,
            reference="r",
        )


@given(amount=st.integers(min_value=1, max_value=1_000_000_00))
@settings(max_examples=25)
def test_send_faster_payment_accepts_within_cap(amount):
    result = send_faster_payment(
        account_number="12345678",
        sort_code="00-00-00",
        amount_pence=amount,
        reference="r",
    )
    assert result.status == PaymentResultStatus.ACCEPTED
    assert result.request.amount_pence == amount
