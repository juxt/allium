
import pytest
from webhooks import LINK_WINDOW



def test_config_default_link_window():
    """obligation: config-default.link_window

    bridge: webhooks.py::LINK_WINDOW
    """
    # TODO: invoke webhooks.py::LINK_WINDOW and assert the obligation holds.
    # This stub is structurally complete: fixtures, bridge, and preconditions
    # are wired in. Fill in the assertion body against the implementation.
    assert LINK_WINDOW is not None, (
        "obligation config-default.link_window witness webhooks.py::LINK_WINDOW not importable"
    )

