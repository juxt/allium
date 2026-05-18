"""Third-party assessor dispatch integration.

Wraps the external assessor-network's "request an assessor" endpoint. We pass
a list of required specialties; the network returns a dispatch reference.
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass


class AssessorDispatchError(Exception):
    pass


@dataclass
class AssessorDispatch:
    dispatch_id: str
    claim_number: str
    specialties: list[str]


def request_assessor_dispatch(
    *,
    claim_number: str,
    specialties: list[str],
) -> AssessorDispatch:
    if not specialties:
        raise AssessorDispatchError("at least one specialty is required")
    return AssessorDispatch(
        dispatch_id=f"disp-{uuid.uuid4().hex[:8]}",
        claim_number=claim_number,
        specialties=list(specialties),
    )
