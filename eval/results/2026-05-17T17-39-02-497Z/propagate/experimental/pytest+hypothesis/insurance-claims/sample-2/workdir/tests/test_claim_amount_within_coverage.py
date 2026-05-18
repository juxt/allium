
import pytest
from hypothesis import HealthCheck, assume, given, settings, strategies as st
from services import submit_claim



@settings(suppress_health_check=[HealthCheck.function_scoped_fixture])
@given(state=st.builds(dict))
def test_invariant_claim_amount_within_coverage(state):
    """obligation: invariant.ClaimAmountWithinCoverage

    property test — invariant must hold across generated states.

    bridge: services.py::submit_claim
    
    """
    # TODO: replace the placeholder state strategy above with a real
    # generator that builds inputs satisfying preconditions, then call
    # submit_claim and assert the invariant.
    assume(state is not None)
    assert submit_claim is not None

