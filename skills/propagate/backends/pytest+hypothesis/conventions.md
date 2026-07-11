# pytest+hypothesis backend conventions

This document tells Stage A subagents how to populate the
obligation-bridge inventory's `bridge` fields when targeting a Python
codebase tested with pytest + Hypothesis. The schema is defined in
[`../../references/obligation-bridge-schema.md`](../../references/obligation-bridge-schema.md);
this file covers the *Python-specific* parts.

## Symbol form

A bridge uses the universal `<path>::<symbol>` form. For Python:

- `<path>` is a relative path from the inventory's `code_root` to a `.py`
  file. Example: `app/services.py`.
- `<symbol>` is the function or method that witnesses the obligation:
  - **Free function**: bare function name. Example: `approve_claim`.
  - **Method on a class**: `ClassName.method_name`. Example:
    `ClaimService.approve`.
  - **Nested classes**: `Outer.Inner.method`.
  - **Module-level constant / dataclass / enum**: bare identifier name.
    Example: `MAX_CLAIM_AMOUNT_PENCE`, `ClaimStatus`.

No leading `module.`, no `def `, no parentheses, no type annotations.
Pure identifier.

### Examples

| Construct                                          | `bridge.primary_symbol`                |
|----------------------------------------------------|----------------------------------------|
| `def approve_claim(claim, assessor): ...`          | `app/services.py::approve_claim`       |
| `class ClaimService: def approve(self, c): ...`    | `app/services.py::ClaimService.approve`|
| Route handler `@app.post("/claims/{id}/approve")`  | `app/routes.py::approve_route` (function name) |
| Hypothesis-style generator                          | `tests/builders.py::build_claim`       |
| Scheduled job `def stalled_claim_sweep(): ...`     | `app/jobs.py::stalled_claim_sweep`     |

## Directory layout assumed by templates

```
<code_root>/
├── app/                   ← implementation
│   ├── models.py
│   ├── routes.py
│   ├── services.py
│   ├── jobs.py
│   └── webhooks.py
├── tests/                 ← propagate writes here
│   ├── conftest.py        ← fixtures land here (see fixture_style: conftest)
│   ├── test_claim.py
│   └── ...
└── pyproject.toml
```

If the target project deviates significantly (e.g. tests live in
`<code_root>/test/` instead of `<code_root>/tests/`, or sources live
directly at `code_root` without an `app/` directory), v1 will still
write under `tests/` — see plan's "Non-goals (v1)" entry on convention
overrides.

## Test-infrastructure assumptions

- **Test framework**: pytest. The runner command is `python -m pytest`.
- **PBT framework**: Hypothesis. State-machine tests use
  `hypothesis.stateful.RuleBasedStateMachine`.
- **Fixtures**: pytest fixtures in `tests/conftest.py`. The translator
  writes new fixtures to `conftest.py` only when `fixtures_required[]`
  names a fixture not already declared.

## Injection points

| `injection_points[]` value | Idiom in generated tests                                        |
|----------------------------|-----------------------------------------------------------------|
| `clock`                    | `monkeypatch.setattr("app.services.now", lambda: <ts>)`         |
| `random`                   | `monkeypatch.setattr("random.random", lambda: <value>)`         |
| `network`                  | `monkeypatch.setattr` against the integration module's helpers  |

These are passed to templates as `{{injection.clock}}` etc., resolved
from `manifest.json`'s `*_injection` fields. The default for all three
is `monkeypatch`. A project using a more specialised library (`freezegun`,
`respx`, …) can fork this backend with adjusted manifest values.

## Stub form

When `bridge.confidence` resolves to `"low"` in the merged inventory,
the translator emits a skipped test using
`pytest.skip("bridge-unresolved")`. The string `bridge-unresolved` is the
`skip_marker` from `manifest.json` and is what Stage C greps for in the
runner report. Engineers reading the test see a TODO block with the
candidate symbols and preconditions.

Example:

```python
def test_approve_claim_succeeds_when_assessment_completed():
    """TODO: bridge unresolved

    candidates:
      - app/services.py::approve_claim
      - app/routes.py::adjuster_approve_route

    preconditions:
      - Claim.status = assessing
      - Assessment.status = completed
    """
    pytest.skip("bridge-unresolved")
```

## Self-check for Stage A subagents

- [ ] Every `bridge.primary_symbol` parses as `<path>::<symbol>` with
      exactly two colons.
- [ ] Every `<path>` exists relative to `code_root` and ends in `.py`.
- [ ] Every `<symbol>` is a valid Python identifier or
      `ClassName.method_name` chain — no parentheses, no `def`, no
      decorators.
- [ ] `fixtures_required[]` uses abstract names; no `fixture_` prefix,
      no `@pytest.fixture`-shaped strings.
- [ ] `injection_points[]` uses one of `clock`, `random`, `network`.
