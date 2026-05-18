
import pytest
from app.routes import create_claim_route



def test_surface_actor_routes():
    """obligation: surface-actor.Routes

    bridge: app/routes.py::create_claim_route
    """
    # TODO: invoke app/routes.py::create_claim_route and assert the obligation holds.
    # This stub is structurally complete: fixtures, bridge, and preconditions
    # are wired in. Fill in the assertion body against the implementation.
    assert create_claim_route is not None, (
        "obligation surface-actor.Routes witness app/routes.py::create_claim_route not importable"
    )

def test_surface_provides_routes():
    """obligation: surface-provides.Routes

    bridge: app/routes.py::create_claim_route
    """
    # TODO: invoke app/routes.py::create_claim_route and assert the obligation holds.
    # This stub is structurally complete: fixtures, bridge, and preconditions
    # are wired in. Fill in the assertion body against the implementation.
    assert create_claim_route is not None, (
        "obligation surface-provides.Routes witness app/routes.py::create_claim_route not importable"
    )

