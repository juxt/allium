"""Insurance claims processing app.

Tiny Flask-like web service for submitting, triaging, assessing, approving,
denying and paying out on insurance claims. Built with only the standard
library so the package is importable without third-party dependencies — it
exists to be *read* (by the distill skill), not run end-to-end.
"""
from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any


@dataclass
class Route:
    method: str
    path: str
    handler: Callable[..., Any]


class Router:
    """Minimal stand-in for a Flask `app` object.

    Records routes so they can be enumerated / dispatched in tests. We don't
    actually serve HTTP here — the shape just needs to read like a web app.
    """

    def __init__(self) -> None:
        self.routes: list[Route] = []

    def _register(self, method: str, path: str) -> Callable[[Callable[..., Any]], Callable[..., Any]]:
        def decorator(fn: Callable[..., Any]) -> Callable[..., Any]:
            self.routes.append(Route(method=method, path=path, handler=fn))
            return fn
        return decorator

    def get(self, path: str): return self._register("GET", path)
    def post(self, path: str): return self._register("POST", path)
    def put(self, path: str): return self._register("PUT", path)


@dataclass
class Store:
    """In-memory storage. A real app would back this with Postgres."""
    policies: dict[str, "Policy"] = field(default_factory=dict)
    claims: dict[str, "Claim"] = field(default_factory=dict)
    assessors: dict[str, "Assessor"] = field(default_factory=dict)
    assessments: dict[str, "Assessment"] = field(default_factory=dict)
    payouts: list["Payout"] = field(default_factory=list)
    incident_reports: dict[str, "IncidentReport"] = field(default_factory=dict)


app = Router()
store = Store()

# Side-effect imports: registering routes/webhooks on `app`.
from app import routes as _routes  # noqa: E402,F401
from app import webhooks as _webhooks  # noqa: E402,F401
from app.models import (  # noqa: E402  # re-exported for forward refs
    Assessment,
    Assessor,
    Claim,
    IncidentReport,
    Payout,
    Policy,
)
