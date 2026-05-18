"""Shared fixtures for propagated tests.

The implementation in `app/` exposes module-level `app` (Router) and `store`
(Store) singletons; routes/webhooks are registered onto them at import time.
Service functions accept `store` as a parameter, so most tests get a fresh
Store. Tests that go through the HTTP route layer use the global store
and reset it via the `reset_global_store` fixture.
"""
from __future__ import annotations

from datetime import datetime, timezone

import pytest

from app import Store


@pytest.fixture
def store() -> Store:
    return Store()


@pytest.fixture
def reset_global_store():
    """Clear the module-level store used by routes/webhooks before & after."""
    import app as _app

    def _clear() -> None:
        _app.store.policies.clear()
        _app.store.claims.clear()
        _app.store.assessors.clear()
        _app.store.assessments.clear()
        _app.store.payouts.clear()
        _app.store.incident_reports.clear()

    _clear()
    yield _app.store
    _clear()


@pytest.fixture
def now_utc() -> datetime:
    return datetime.now(timezone.utc)
