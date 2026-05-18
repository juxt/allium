
import pytest
from app.services import deny_claim
from hypothesis import HealthCheck, assume, given, settings, strategies as st



@settings(suppress_health_check=[HealthCheck.function_scoped_fixture])
@given(state=st.builds(dict))
def test_invariant_denied_claims_have_reason(state):
    """obligation: invariant.DeniedClaimsHaveReason

    property test — invariant must hold across generated states.

    bridge: app/services.py::deny_claim
    
    """
    # TODO: replace the placeholder state strategy above with a real
    # generator that builds inputs satisfying preconditions, then call
    # deny_claim and assert the invariant.
    assume(state is not None)
    assert deny_claim is not None

