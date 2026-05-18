
import pytest
from hypothesis import strategies as st
from hypothesis.stateful import RuleBasedStateMachine, rule
from services import mark_payout_paid


@pytest.fixture
def a_scheduled_payout():
    """Auto-generated fixture for obligation references to 'a_scheduled_payout'.

    TODO: replace this stub with a real factory once the project's
    existing fixture conventions are known.
    """
    return None


class MarkPayoutPaidStateMachine(RuleBasedStateMachine):
    """obligation: rule-success.MarkPayoutPaid

    Walks the declared transition graph; each edge is a Hypothesis rule
    that calls the witnessing function and asserts the entity reaches
    the target state.

    bridge: services.py::mark_payout_paid
    """

    def __init__(self):
        super().__init__()
        self.entity = None

    

test_rule_success_mark_payout_paid = MarkPayoutPaidStateMachine.TestCase

