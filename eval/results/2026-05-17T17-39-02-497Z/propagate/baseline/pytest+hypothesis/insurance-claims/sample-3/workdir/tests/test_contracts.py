"""Contract signature + @invariant tests.

Two contracts:

  AssessorService.request_assessor_dispatch(claim_number, specialties)
                                                       -> AssessorDispatch
    @invariant Precondition: specialties.length > 0

  PaymentService.send_faster_payment(account_number, amount_pence,
                                     reference, sort_code) -> PaymentResult
    @invariant AmountPenceIsPositive: amount_pence > 0
    @invariant AmountPenceWithinCap:  amount_pence <= 1_000_000_00
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
    PaymentResult,
    PaymentResultStatus,
    send_faster_payment,
)

HYP = settings(max_examples=50, deadline=None, suppress_health_check=[HealthCheck.function_scoped_fixture])


# ---------------------------------------------------------------------------
# AssessorService.request_assessor_dispatch
# ---------------------------------------------------------------------------

class TestAssessorServiceSignature:
    def test_signature_matches_contract(self):
        sig = inspect.signature(request_assessor_dispatch)
        # The spec lists positional names; the implementation uses keyword-only.
        assert set(sig.parameters) == {"claim_number", "specialties"}

    def test_returns_assessor_dispatch(self):
        result = request_assessor_dispatch(claim_number="CLM-1", specialties=["fire"])
        assert isinstance(result, AssessorDispatch)
        assert result.claim_number == "CLM-1"
        assert result.specialties == ["fire"]

    def test_invariant_precondition_specialties_non_empty(self):
        # @invariant Precondition: specialties.length > 0
        with pytest.raises(AssessorDispatchError):
            request_assessor_dispatch(claim_number="CLM-1", specialties=[])

    @given(specialties=st.lists(st.text(min_size=1, max_size=10), min_size=1, max_size=5))
    @HYP
    def test_dispatch_preserves_specialties(self, specialties):
        result = request_assessor_dispatch(claim_number="CLM-X", specialties=specialties)
        assert result.specialties == specialties


# ---------------------------------------------------------------------------
# PaymentService.send_faster_payment
# ---------------------------------------------------------------------------

VALID_KW = dict(
    account_number="12345678",
    sort_code="11-22-33",
    reference="ref-1",
)


class TestPaymentServiceSignature:
    def test_signature_matches_contract(self):
        sig = inspect.signature(send_faster_payment)
        assert set(sig.parameters) == {
            "account_number",
            "sort_code",
            "amount_pence",
            "reference",
        }

    def test_returns_payment_result_for_valid_request(self):
        result = send_faster_payment(amount_pence=10, **VALID_KW)
        assert isinstance(result, PaymentResult)
        assert result.status == PaymentResultStatus.ACCEPTED
        assert result.upstream_id == "fp-ref-1"
        assert result.request.amount_pence == 10

    # ----- @invariant AmountPenceIsPositive: amount_pence > 0 ---------

    @pytest.mark.parametrize("amount", [0, -1, -100])
    def test_invariant_amount_must_be_positive(self, amount):
        with pytest.raises(PaymentError):
            send_faster_payment(amount_pence=amount, **VALID_KW)

    @given(amount=st.integers(min_value=1, max_value=1_000_000_00))
    @HYP
    def test_property_positive_amount_within_cap_accepted(self, amount):
        result = send_faster_payment(amount_pence=amount, **VALID_KW)
        assert result.request.amount_pence == amount
        assert result.status == PaymentResultStatus.ACCEPTED

    # ----- @invariant AmountPenceWithinCap: amount_pence <= 1_000_000_00 -

    def test_invariant_cap_boundary_accepted(self):
        result = send_faster_payment(amount_pence=1_000_000_00, **VALID_KW)
        assert result.status == PaymentResultStatus.ACCEPTED

    @pytest.mark.parametrize("amount", [1_000_000_01, 2_000_000_00])
    def test_invariant_cap_violation_rejected(self, amount):
        with pytest.raises(PaymentError):
            send_faster_payment(amount_pence=amount, **VALID_KW)

    # ----- Format guards (not in the spec contract, but observed at the
    #       implementation boundary). These don't map to a spec obligation
    #       directly; they're defensive checks documenting current behaviour. -

    @pytest.mark.parametrize(
        "account_number", ["1234567", "123456789", "abcdefgh"]
    )
    def test_account_number_must_be_eight_digits(self, account_number):
        with pytest.raises(PaymentError):
            send_faster_payment(
                amount_pence=100,
                account_number=account_number,
                sort_code="11-22-33",
                reference="r",
            )

    @pytest.mark.parametrize("sort_code", ["112233", "11-22", "AA-BB-CC"])
    def test_sort_code_must_be_nn_nn_nn(self, sort_code):
        with pytest.raises(PaymentError):
            send_faster_payment(
                amount_pence=100,
                account_number="12345678",
                sort_code=sort_code,
                reference="r",
            )
