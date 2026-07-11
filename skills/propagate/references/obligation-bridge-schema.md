# Obligation-bridge inventory schema (language-agnostic)

This document is the contract between **Stage A subagents** and the **Stage B
canonicaliser** for the deterministic `propagate` pipeline. A Stage A subagent
reads:

- the Allium spec
- `allium plan <spec>` output (the authoritative obligation list)
- `allium model <spec>` output (entity shapes, transition graphs)
- the target codebase

…and emits exactly one JSON file matching the schema below. K such files are
merged by `merge-obligations.mjs` into a consensus inventory; the translator
(`obligations-to-tests.mjs`) then renders that inventory through a backend.

The schema is **language-agnostic**. Per-language idioms live in
`backends/<framework>/{manifest.json, name-policy.json, conventions.md,
templates/}` — see [`backend-authoring-guide.md`](./backend-authoring-guide.md).
This document tells you *what* to extract; the chosen backend's
`conventions.md` tells you *how* the symbols and identifiers should look.

## Top-level shape

```jsonc
{
  "spec_path": "fixtures/insurance-claims/allium-distilled/spec.allium",
  "code_root": "fixtures/insurance-claims",
  "framework": "pytest+hypothesis",
  "obligations": [ /* one entry per obligation_id from `allium plan` */ ],
  "transition_graph": { /* verbatim subset of `allium model` */ }
}
```

### Top-level fields

| Field              | Type     | Required | Notes                                                                                 |
|--------------------|----------|----------|---------------------------------------------------------------------------------------|
| `spec_path`        | string   | yes      | Relative path to the `.allium` spec, from the working directory.                      |
| `code_root`        | string   | yes      | Relative path to the implementation root (paths in `bridge.primary_symbol` are relative to this). |
| `framework`        | string   | yes      | Backend id, matches a directory under `backends/`. The orchestrator passes this in.   |
| `obligations`      | array    | yes      | One object per obligation, see below. The set of `obligation_id`s must exactly match `allium plan`. |
| `transition_graph` | object   | yes      | Map of entity name → list of `{from, to, via_rule}` edges. Copy verbatim from `allium model`'s state-machine section. May be `{}` for specs with no transitions. |

## Per-obligation shape

```jsonc
{
  "obligation_id": "rule_success.ApproveClaim",
  "test_kind": "state_machine",
  "bridge": {
    "primary_symbol": "app/services.py::approve_claim",
    "candidates": ["app/routes.py::adjuster_approve"],
    "confidence": "high"
  },
  "preconditions": [
    "Claim.status = assessing",
    "Assessment.status = completed"
  ],
  "fixtures_required": [
    "a_claim_in_assessing_state",
    "a_completed_assessment"
  ],
  "injection_points": ["clock"],
  "target_file": "tests/test_claim_approval.py",
  "test_name": "test_approve_claim_succeeds_when_assessment_completed"
}
```

### Field reference

#### `obligation_id` — string, required

The exact obligation id from `allium plan`'s `obligations[].id`. Stage B will
**reject** the inventory if the set of `obligation_id` values does not match
the plan output exactly. No additions; no omissions.

#### `test_kind` — enum string, required

Picks the template the translator uses. One of:

| Value           | Use when                                                                                                 |
|-----------------|----------------------------------------------------------------------------------------------------------|
| `assertion`     | Deterministic, one-shot fact: field shape, enum membership, surface exposure, projection result.          |
| `pbt`           | Invariant or property holding over generated inputs. The bridge identifies the rule (or chain) to drive. |
| `state_machine` | Obligation derived from a transition graph: walk the graph with generated paths.                          |
| `temporal`      | Deadline-/clock-driven trigger: requires controllable time. `injection_points` must include `clock`.      |
| `scenario`      | Cross-entity / multi-rule happy-path or edge case scripted as ordered steps.                              |
| `contract`      | `demands`/`fulfils` between two surfaces, or a contract's `@invariant`.                                   |

The mapping from `allium plan` `category` to `test_kind` is **not** mechanical
(some categories produce different kinds depending on whether the construct
has a transition graph or expression-bearing invariant) — that's why this
field is part of the inventory, voted on by K subagents.

Suggested defaults (the LLM may override when the obligation warrants it):

| `category` from `allium plan` | Default `test_kind` |
|-------------------------------|---------------------|
| `entity_fields`               | `assertion`         |
| `entity_optional`             | `assertion`         |
| `entity_relationship`         | `assertion`         |
| `value_equality`              | `assertion`         |
| `enum_comparable`             | `assertion`         |
| `derived`                     | `assertion`         |
| `projection`                  | `assertion`         |
| `config_default`              | `assertion`         |
| `rule_success`                | `state_machine` if the rule sits on a graph edge, else `scenario`. |
| `rule_failure`                | `assertion`         |
| `rule_entity_creation`        | `scenario`          |
| `invariant`                   | `pbt` if expression-bearing, else `assertion`. |
| `temporal`                    | `temporal`          |
| `surface_actor`               | `assertion`         |
| `surface_provides`            | `assertion`         |
| `contract_signature`          | `contract`          |

#### `bridge` — object, required

Tells the translator which implementation symbol witnesses the obligation.

```jsonc
{
  "primary_symbol": "app/services.py::approve_claim",
  "candidates": ["app/routes.py::adjuster_approve"],
  "confidence": "high"
}
```

- `primary_symbol`: a string in the universal `<path>::<symbol>` form, or
  `null` if no confident bridge can be identified.
  - `<path>` is relative to `code_root`.
  - `<symbol>` is the implementation symbol's name in the project's language.
    The backend's `conventions.md` defines what a valid symbol looks like
    (Python: bare function name or `ClassName.method`; TypeScript: named
    export or `ClassName.method`; future languages: language-appropriate).
  - The `::` separator is universal — it is **always** two colons, never `.`,
    `::`, `#`, or `:`. The canonicaliser parses on this exact token.
- `candidates`: array of additional `<path>::<symbol>` strings observed in
  the codebase that *could* be the witness. May be empty. **Must not include
  the value of `primary_symbol`.**
- `confidence`:
  - `"high"` — exactly one obvious witness was found; `candidates` is empty
    or contains only deprecated/old forms.
  - `"medium"` — a primary is clear, but plausible alternatives exist
    (e.g. both a route handler and an underlying service method).
  - `"low"` — the witness is genuinely ambiguous. **Only valid when**
    `candidates.length >= 2` **or** `primary_symbol` is `null`. The merged
    inventory will downgrade to a stub test if K subagents fail to converge
    on a single primary.

#### `preconditions` — array of strings, required

Prose-form predicates that must hold for the obligation to be tested. Copy
the `requires` clause(s) of the rule witnessing the obligation, in the
form `<EntityName>.<field> = <literal>` or `<EntityName>.<field>?` etc.
The order does not matter (the canonicaliser sorts).

Example: `["Claim.status = assessing", "Assessment.status = completed"]`.

For obligations that have no preconditions (e.g. `entity_fields`), use `[]`.

#### `fixtures_required` — array of strings, required

Abstract fixture names the test will need. These are *names*, not language-
specific function or builder identifiers — backend templates know how to
turn `"a_claim_in_assessing_state"` into a pytest fixture or a TypeScript
factory call. Naming convention: `a_<entity>_in_<state>_state`,
`a_<entity>_with_<property>`, `a_<entity>` (default).

Order does not matter. Use `[]` for obligations needing no fixture (most
`entity_fields` / `enum_comparable` obligations).

#### `injection_points` — array of strings, required

Abstract test-infrastructure seams the test depends on. Currently defined:

| Value     | Meaning                                                                          |
|-----------|----------------------------------------------------------------------------------|
| `clock`   | Test must control time (deadline tests, temporal triggers).                      |
| `random`  | Test must control randomness (generators with non-determinism upstream).         |
| `network` | Test exercises an integration boundary needing a stub/recorded response.         |

The backend's `manifest.json` records how each seam is realised
(`monkeypatch` in Python, `vi.useFakeTimers()` in Jest, etc.). The
translator does not require all subagents to agree exhaustively here —
the merge takes set-union for `injection_points`.

#### `target_file` and `test_name` — strings, required (but recomputed)

The LLM fills these in for sanity (so the inventory is reviewable on its
own), but the canonicaliser **overwrites both** using the backend's
`name-policy.json`. They exist in the schema for two reasons:

1. They make a single inventory readable without consulting the backend.
2. They give Stage B a fallback when `name-policy.json` is missing a rule.

Treat the LLM-supplied values as advisory. Naming is determined by the
backend, not by the model.

## `transition_graph` — object, required

Verbatim copy of the relevant section of `allium model`'s output. Keys are
entity names; values are arrays of edges:

```jsonc
{
  "Claim": [
    { "from": "submitted",  "to": "triaged",  "via_rule": "TriageClaim"   },
    { "from": "triaged",    "to": "assessing", "via_rule": "AssignAssessor" },
    { "from": "assessing",  "to": "approved",  "via_rule": "ApproveClaim" }
  ],
  "Assessment": [ /* ... */ ]
}
```

If `allium model` reports no transition graph for any entity, use `{}`.
The merge step expects unanimous agreement here (since `allium model` is
deterministic); any divergence is logged as a warning.

## Language-agnostic invariants

The Stage B canonicaliser **rejects** any inventory that violates these:

1. The set of `obligations[].obligation_id` values is exactly the set of
   `obligations[].id` values from `allium plan`. No additions; no omissions.
2. `bridge.confidence: "low"` is only valid when `candidates.length >= 2`
   or `primary_symbol` is `null`.
3. `bridge.candidates` does not contain `bridge.primary_symbol`.
4. `framework` refers to an existing directory under `backends/`.
5. Every `<path>` in a `<path>::<symbol>` exists relative to `code_root`.
   (The canonicaliser does **not** verify that `<symbol>` exists in the
   file — that's the runner's job in Stage C.)

## Self-check before emitting

Run this checklist mentally before writing the file:

- [ ] `obligations[]` has exactly one entry per `obligation_id` in `allium plan`.
- [ ] Every `bridge.primary_symbol` uses `<path>::<symbol>` with exactly two
      colons as the separator.
- [ ] Every `bridge.primary_symbol` path is relative to `code_root`.
- [ ] `bridge.confidence: "low"` is paired with multiple candidates or a
      null primary.
- [ ] `preconditions[]` use `<EntityName>.<field>` form, not implementation
      paths or `<symbol>` names.
- [ ] `fixtures_required[]` and `injection_points[]` use the abstract names
      from this document, not backend-specific identifiers.
- [ ] `transition_graph` matches `allium model` for every entity referenced
      by a `state_machine` obligation.
- [ ] `framework` matches a real backend directory.

If any check fails, the canonicaliser will reject the inventory and Stage B
will discard this sample from the consensus.
