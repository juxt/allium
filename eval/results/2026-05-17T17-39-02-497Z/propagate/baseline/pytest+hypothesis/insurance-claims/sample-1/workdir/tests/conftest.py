"""Shared fixtures for propagated tests.

Most rule/service tests construct their own `Store` and call services directly
(services already accept `store` as a parameter). The `global_store` fixture is
for route/webhook tests that go through the module-level `app` singleton.
"""
from __future__ import annotations

from collections.abc import Iterator

import pytest

from app import Store
from app import store as _global_store


def _reset(s: Store) -> None:
    s.policies.clear()
    s.claims.clear()
    s.assessors.clear()
    s.assessments.clear()
    s.payouts.clear()
    s.incident_reports.clear()


@pytest.fixture
def store() -> Store:
    """A fresh, isolated in-memory store."""
    return Store()


@pytest.fixture
def global_store() -> Iterator[Store]:
    """The module-level store used by routes/webhooks, reset before and after the test."""
    _reset(_global_store)
    try:
        yield _global_store
    finally:
        _reset(_global_store)
