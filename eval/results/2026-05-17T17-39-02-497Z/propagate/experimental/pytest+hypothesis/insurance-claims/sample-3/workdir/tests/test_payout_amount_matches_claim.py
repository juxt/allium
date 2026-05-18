
import pytest
from app.services import schedule_payout
from hypothesis import HealthCheck, assume, given, settings, strategies as st



@settings(suppress_health_check=[HealthCheck.function_scoped_fixture])
@given(state=st.builds(dict))
def test_invariant_payout_amount_matches_claim(state):
    """obligation: invariant.PayoutAmountMatchesClaim

    property test — invariant must hold across generated states.

    bridge: app/services.py::schedule_payout
    preconditions:
      - Payout.amount_pence = Payout.claim.amount_claimed_pence
    
    """
    # TODO: replace the placeholder state strategy above with a real
    # generator that builds inputs satisfying preconditions, then call
    # schedule_payout and assert the invariant.
    assume(state is not None)
    assert schedule_payout is not None

