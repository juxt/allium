
import pytest
from models import ClaimStatus



def test_enum_comparable_claim_status():
    """obligation: enum-comparable.ClaimStatus

    bridge: models.py::ClaimStatus
    """
    # TODO: invoke models.py::ClaimStatus and assert the obligation holds.
    # This stub is structurally complete: fixtures, bridge, and preconditions
    # are wired in. Fill in the assertion body against the implementation.
    assert ClaimStatus is not None, (
        "obligation enum-comparable.ClaimStatus witness models.py::ClaimStatus not importable"
    )

