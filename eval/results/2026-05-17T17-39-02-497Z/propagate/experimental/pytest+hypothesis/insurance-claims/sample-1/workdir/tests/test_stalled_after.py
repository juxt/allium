
import pytest
from app.models import STALLED_AFTER



def test_config_default_stalled_after():
    """obligation: config-default.stalled_after

    bridge: app/models.py::STALLED_AFTER
    """
    # TODO: invoke app/models.py::STALLED_AFTER and assert the obligation holds.
    # This stub is structurally complete: fixtures, bridge, and preconditions
    # are wired in. Fill in the assertion body against the implementation.
    assert STALLED_AFTER is not None, (
        "obligation config-default.stalled_after witness app/models.py::STALLED_AFTER not importable"
    )

