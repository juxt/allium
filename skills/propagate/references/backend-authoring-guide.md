# Backend authoring guide

The deterministic `propagate` pipeline is **backend-dispatched**. The
language-agnostic translator (`obligations-to-tests.mjs`) reads a merged
obligation-bridge inventory and renders it through whichever backend the
inventory's `framework` field names. This document describes the contract a
new backend must fulfil.

> Adding a new backend should be a matter of writing a manifest, a name-policy,
> a conventions doc, and six templates — **not** patching the translator.

## Directory layout

A backend lives at:

```
plugins/experimental/skills/propagate/backends/<id>/
├── manifest.json
├── name-policy.json
├── conventions.md
└── templates/
    ├── test-file.tmpl
    ├── assertion.tmpl
    ├── pbt-property.tmpl
    ├── state-machine.tmpl
    ├── stub-unresolved.tmpl
    └── fixture.tmpl
```

`<id>` is the value subagents put in the inventory's `framework` field
(e.g. `pytest+hypothesis`, `jest+fastcheck`, `proptest+cargo-test`). The id
must match the directory name byte-for-byte; the canonicaliser uses it as
the dispatch key.

## `manifest.json`

Declares the backend's high-level behaviour. Versioned via `manifest_version`
so the translator can reject mismatched backends rather than silently
misrender.

```jsonc
{
  "manifest_version": 1,
  "id": "pytest+hypothesis",
  "language": "python",
  "file_extension": ".py",
  "test_file_prefix": "test_",
  "runner": {
    "command": ["python3", "-m", "pytest", "--junit-xml={report_path}"],
    "report_format": "pytest-junitxml",
    "scope_args": ["{test_root}"]
  },
  "imports_style": "python",
  "imports": {
    "base": ["import pytest"],
    "pbt":  ["from hypothesis import HealthCheck, assume, given, settings, strategies as st"],
    "state_machine": [
      "from hypothesis import strategies as st",
      "from hypothesis.stateful import RuleBasedStateMachine, rule"
    ]
  },
  "bridge_import": {
    "transform": "python_module"
  },
  "fixture_style": "conftest",
  "stub_idiom": "pytest.skip",
  "skip_marker": "bridge-unresolved",
  "clock_injection": "monkeypatch",
  "random_injection": "monkeypatch",
  "network_injection": "monkeypatch"
}
```

### Required fields

- `manifest_version` (integer): currently `1`. The translator refuses any
  other value.
- `id` (string): matches the directory name.
- `language` (string): the source language. Informational; used in reports.
- `file_extension` (string): includes the leading dot. The translator uses
  this when computing target paths from `name-policy.json`.
- `test_file_prefix` (string): convention prefix on test filenames
  (`test_` for pytest, `""` for Jest, …).
- `runner.command` (array of strings): the command Stage C runs. Supported
  placeholders: `{report_path}` (absolute path the runner should write its
  JSON report to), `{test_root}` (path Stage C scopes the run to).
- `runner.report_format` (string): the parser key Stage C looks up. Must
  match one of the format adapters implemented in `run-suite.mjs`.
- `runner.scope_args` (array of strings, optional): extra arguments to
  scope the run to the generated tests. Same placeholder set as
  `runner.command`.
- `imports_style` (string): one of `"python"` (alphabetical), `"typescript"`
  (external-first, then relative; alphabetical within group), `"go"`,
  `"rust"`. The translator's import-deduper looks this up.
- `imports` (object): per-test_kind import lists, keyed by `base`, `pbt`,
  `state_machine`, `temporal`. `base` is always included; the others are
  added when an obligation's `test_kind` matches. If `temporal` is
  omitted, the translator falls back to `pbt` for temporal obligations.
  Adding a new framework means writing this list in the manifest, not
  editing the translator.
- `bridge_import.transform` (string): name of the translator's
  bridge-import transform. Currently supported:
  - `"python_module"` — `app/services.py::approve_claim`
    becomes `from app.services import approve_claim`.
  - `"typescript_relative"` — `src/services/claim.ts::approveClaim`
    becomes `import { approveClaim } from "../src/services/claim";`,
    with the path rewritten relative to the target test file.
  - `"noop"` — emit no bridge import line (use for languages where
    every symbol is in scope without an explicit import).
  Adding a new transform means adding one entry to
  `BRIDGE_IMPORT_TRANSFORMS` in `obligations-to-tests.mjs` and
  declaring it in the manifest.
- `fixture_style` (string): one of `"conftest"` (pytest), `"in-file"`
  (TypeScript: fixtures live alongside tests), `"shared-module"` (one
  fixtures module imported by all tests).
- `stub_idiom` (string): a free-form label used in the
  `stub-unresolved.tmpl`; not parsed by the translator.
- `skip_marker` (string): the label engineers grep for to find unresolved
  stubs. Surfaced in the Stage C report. Recommend `bridge-unresolved`
  for consistency across backends.
- `clock_injection`, `random_injection`, `network_injection` (strings,
  optional): how each `injection_points[]` value renders in test bodies.
  The values are passed verbatim to templates as
  `{{injection.clock}}`, `{{injection.random}}`, `{{injection.network}}`.

## `name-policy.json`

Declares the casing and layout rules the canonicaliser applies to rewrite
`target_file` and `test_name` from the LLM-supplied advisory values.

```jsonc
{
  "test_name_case": "snake",
  "file_name_case": "snake",
  "directory_layout": "tests/",
  "file_pattern": "test_{obligation_subject}{file_extension}",
  "test_name_pattern": "test_{obligation_id_slug}"
}
```

### Required fields

- `test_name_case`: one of `"snake"`, `"camel"`, `"pascal"`, `"kebab"`.
  Applied to the slug derived from `obligation_id`.
- `file_name_case`: same set.
- `directory_layout` (string): a relative directory under `code_root` where
  test files are written. Trailing slash optional. `""` means co-located
  with the source.
- `file_pattern` (string): template for the file name. Placeholders:
  - `{obligation_subject}` — the part of `obligation_id` before the first
    `.` (e.g. `Claim` for `rule_success.Claim.Approve`), cased per
    `file_name_case`.
  - `{file_extension}` — from `manifest.json`.
- `test_name_pattern` (string): template for the test function name.
  Placeholders:
  - `{obligation_id_slug}` — full `obligation_id` lowercased with `.` and
    other non-alphanumerics turned into `_` or the requested case's separator.

The canonicaliser owns this transformation; backends do not need to mirror
it elsewhere.

## `conventions.md`

A free-form Markdown document explaining the backend's *symbol* convention,
so Stage A subagents can produce well-formed `<path>::<symbol>` bridges.
At minimum, document:

- What a valid `<symbol>` looks like in this language (e.g. `module.function`,
  `Class.method`, `function`, `mod::function::generic`).
- The directory layout the templates assume (where source files live, where
  tests should be written).
- Any test-infrastructure assumptions (fixtures location, plugin requirements).
- How each `injection_points[]` value is realised in the backend's idiom.

The translator never reads this file. It exists for the Stage A subagent
prompt and for human contributors.

## Templates

Templates use a small placeholder syntax shared across backends. The renderer
lives in `obligations-to-tests.mjs`; do not duplicate it per backend.

### Placeholder syntax

- `{{name}}` — substitute the value of `name` in the current context.
  Dots traverse objects: `{{bridge.primary_symbol}}`,
  `{{manifest.skip_marker}}`.
- `{{#each items}}…{{/each}}` — repeat the body once per element in
  `items`, with each element bound as `it` (and `index` as the 0-based
  index). Inside, use `{{it}}` for primitives and `{{it.field}}` for
  records.
- `{{#if cond}}…{{else}}…{{/if}}` — conditionally render. `cond` is
  truthy if non-null, non-empty array, non-empty string.
- `{{!comment}}` — comment, stripped from output.

No filters, no expressions, no inheritance. If a template needs richer
logic, surface that as a new field on the rendering context — do not
extend the placeholder syntax.

### Rendering context (passed to every template)

```jsonc
{
  "obligation": { /* the full obligation entry */ },
  "bridge": { /* obligation.bridge, hoisted for convenience */ },
  "preconditions": ["…"],
  "fixtures_required": ["…"],
  "injection_points": ["clock", ...],
  "injection": { "clock": "monkeypatch", ... },     // from manifest
  "transition_graph_for_entity": [ /* edges for the obligation's entity, may be [] */ ],
  "manifest": { /* the backend's manifest.json */ },
  "name_policy": { /* the backend's name-policy.json */ }
}
```

For `test-file.tmpl` only, an additional field is bound:

```jsonc
{
  "imports": ["…"],          // deduped, ordered per imports_style
  "fixtures": ["…"],         // rendered fixture blocks
  "tests": ["…"]             // rendered test-body strings, alphabetical by test_name
}
```

### Required templates

1. **`test-file.tmpl`** — file skeleton. Emits imports + fixtures + tests.
2. **`assertion.tmpl`** — one assertion test. Must include the
   `obligation_id` somewhere in a comment for traceability.
3. **`pbt-property.tmpl`** — one property-based test.
4. **`state-machine.tmpl`** — a state-machine test (RuleBasedStateMachine
   in Hypothesis, `fc.modelRun` / `commands` in fast-check, etc.).
5. **`stub-unresolved.tmpl`** — a skipped test with a TODO block listing
   `bridge.candidates` and `preconditions`. Must use the backend's
   `skip_marker` so Stage C can identify it in the runner report.
6. **`fixture.tmpl`** — one fixture/factory entry. Used when
   `fixtures_required` references a name not already present in the
   backend's fixture location.

## Runner format adapter

Stage C (`run-suite.mjs`) needs a parser that maps the runner's JSON
output to the same internal `{pass, fail, error, skipped}` categorisation.
Each adapter is keyed by `manifest.runner.report_format`.

Adapter contract:

```js
// run-suite.mjs adapter
function adapt(rawReport) {
  return {
    results: [
      { test_id: "tests/test_x.py::test_foo", outcome: "pass" },
      { test_id: "tests/test_y.py::test_bar", outcome: "skipped",
        markers: ["bridge-unresolved"] },
      { test_id: "tests/test_z.py::test_baz", outcome: "error",
        kind: "ImportError", message: "no module …" }
    ]
  };
}
```

Outcome values: `pass | fail | error | skipped`.

Add a new adapter when you add a new backend whose runner emits a JSON
report format Stage C doesn't yet understand. The v1 baseline ships
`pytest-jsonl` only; `jest-json` is a planned addition.

## Versioning and breaking changes

- `manifest_version` is bumped when the translator changes the contract
  in a non-additive way.
- Adding new optional fields to `manifest.json` is **not** breaking.
- Adding new template placeholders is **not** breaking provided existing
  templates render the same output.
- Removing or renaming a placeholder, changing the rendering context
  shape, or changing the meaning of an existing field **is** breaking
  and requires a bump.

## Adding a backend: checklist

- [ ] Create `backends/<id>/` with the four artefacts.
- [ ] Pick a `runner.report_format`; if unfamiliar, add the adapter in
      `scripts/run-suite.mjs` and unit-test it against a captured
      runner-output sample.
- [ ] Author the six templates against a hand-written 4-obligation
      merged inventory; render and confirm the output parses with the
      runner's `--collect-only` (or equivalent dry-parse).
- [ ] Add a `conventions.md` section telling Stage A subagents what a
      valid `<symbol>` looks like.
- [ ] Run the translator on a real inventory twice and confirm
      byte-identical output.
