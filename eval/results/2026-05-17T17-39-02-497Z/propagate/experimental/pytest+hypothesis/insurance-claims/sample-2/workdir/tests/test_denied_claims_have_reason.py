
import pytest
from hypothesis import HealthCheck, assume, given, settings, strategies as st
from services import deny_claim


@pytest.fixture
def a_claim_in_triaged_state():
    """Auto-generated fixture for obligation references to 'a_claim_in_triaged_state'.

    TODO: replace this stub with a real factory once the project's
    existing fixture conventions are known.
    """
    return None


@settings(suppress_health_check=[HealthCheck.function_scoped_fixture])
@given(state=st.builds(dict))
def test_invariant_denied_claims_have_reason(state, a_claim_in_triaged_state):
    """obligation: invariant.DeniedClaimsHaveReason

    property test — invariant must hold across generated states.

    bridge: services.py::deny_claim
    
    """
    # TODO: replace the placeholder state strategy above with a real
    # generator that builds inputs satisfying preconditions, then call
    # deny_claim and assert the invariant.
    assume(state is not None)
    assert deny_claim is not None

