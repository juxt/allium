---
name: propagate
description: "Generate tests from Allium specifications. Use when the user wants to propagate tests, generate test files from a spec, write tests for a specification, create property-based tests, produce state machine tests, check test coverage against spec obligations, or understand what tests a specification requires."
---

# Propagation (consensus pipeline)

This skill generates **byte-deterministic** test files from an Allium spec
and a target codebase. It does so by orchestrating K independent
inventory-extraction passes in parallel, canonicalising each, merging into
a single consensus inventory, and translating that to test files through
a per-language **backend**.

When invoked, you are the **orchestrator**. You do not write the tests
yourself — that's the translator's job. You drive the procedure below.

## Pipeline

```
allium plan / allium model              (deterministic external inputs)
   ↓
K subagents (Agent tool)
   ↓  each produces obligation-bridge-i.json
scripts/canonicalize-obligations.mjs    (per inventory)
   ↓
scripts/merge-obligations.mjs           (one-shot K-vote consensus)
   ↓
scripts/obligations-to-tests.mjs        (translator core + backend dispatch)
   ↓ N test files
scripts/run-suite.mjs                   (Stage C: runner + report)
   ↓
propagation-report.md
```

Scripts live at `${CLAUDE_PLUGIN_ROOT}/scripts/`. References, backends, and
the schema subagents follow live at
`${CLAUDE_PLUGIN_ROOT}/skills/propagate/{references,backends}`.

## Procedure (mandatory, in order)

### Step 1 — Decide K, backend, and output paths

- **K**: default 3. Use 5 if the user wants higher determinism confidence
  at higher cost; use 2 only if cost is the primary constraint.
- **Backend**: pick from `backends/` based on the target codebase. If the
  user does not specify, infer from project files:
  - `pyproject.toml` or `setup.py` → `pytest+hypothesis`
  - `package.json` with `jest` in devDependencies → `jest+fastcheck`
    (v2 — not yet shipped in this plugin version; abort if requested)
  - Otherwise, ask the user.
- **Spec path** and **code root**: pick these MECHANICALLY, not by LLM
  judgement, so two runs on the same project produce byte-identical
  inventories.
  - **`code_root`**: always `"."` (the current working directory). Do not
    pick `"./app"` or any subdirectory even if the implementation lives
    there — the convention is "the project root is the code root", and
    paths in bridges (`<path>::<symbol>`) carry the `app/` prefix when
    needed. The whole pipeline is designed around this; varying
    `code_root` breaks byte-determinism across orchestrations.
  - **`spec_path`**: the path the user named, made relative to `code_root`.
    If they did not name one, look for `./allium-distilled/spec.allium`
    first, then `./spec.allium`, then ask. Always express it with a
    leading `./` (so `"./allium-distilled/spec.allium"`, never
    `"allium-distilled/spec.allium"` and never an absolute path).
  - Pass these EXACT strings to every subagent's prompt and use them
    verbatim in the inventory's top-level fields. Subagents must not
    reinterpret them.
- **Output directory**: `./allium-propagated/` by default, relative to the
  current working directory. Test files are written into `<code_root>/tests/`
  (or whatever the backend's `name-policy.json` directs); intermediate
  artefacts (inventories, plan, model, merged) land in `./allium-propagated/`.

Create the layout:

```
./allium-propagated/
├── inventories/                # subagent outputs land here
├── plan.json                   # cached `allium plan` output
├── model.json                  # cached `allium model` output
├── merged.json                 # consensus inventory (after Stage B)
└── propagation-report.md       # Stage C output
```

### Step 2 — Pre-compute deterministic external inputs

Run via Bash, capturing output to disk:

```
allium plan <spec_path>  > ./allium-propagated/plan.json
allium model <spec_path> > ./allium-propagated/model.json
```

If either command fails, abort and tell the user — propagation requires
both files. The plan output is used by `canonicalize-obligations.mjs` to
validate that every subagent inventory has exactly the right obligation
set.

### Step 3 — Spawn K subagents in parallel

Use the **Agent tool** with `subagent_type: "general-purpose"`. Send all
K Agent tool calls **in a single message** so they execute concurrently.
Each subagent receives the prompt template from Step 4 with placeholders
substituted. The i-th subagent's output path is
`./allium-propagated/inventories/inventory-<i>.json` (1-indexed).

### Step 4 — Subagent prompt template

Use this prompt verbatim per subagent, with placeholders replaced:

```
You are producing one obligation-bridge inventory of a codebase as part
of a consensus pipeline. Other subagents are doing the same job in
parallel; your output will be merged with theirs.

Step 1: Read these inputs:
  - The Allium spec:              <SPEC_PATH>
  - The test plan (obligations):  ./allium-propagated/plan.json
  - The domain model:             ./allium-propagated/model.json
  - The target codebase under:    <CODE_ROOT>

Skip generated / vendored / dependency directories.

Step 2: Read the obligation-bridge schema and the chosen backend's
conventions:
  - ${CLAUDE_PLUGIN_ROOT}/skills/propagate/references/obligation-bridge-schema.md
  - ${CLAUDE_PLUGIN_ROOT}/skills/propagate/backends/<FRAMEWORK>/conventions.md

The schema defines the JSON shape, the bridge symbol notation
(<path>::<symbol>), test_kind values, bridge confidence semantics, and
the self-check list to run before emitting.

Step 3: For every obligation in plan.json, produce one entry in your
inventory. The set of obligation_ids in your output MUST equal the set
in plan.json — no additions, no omissions. The canonicaliser rejects
deviations.

Step 4: Write the inventory to:
    <OUTPUT_PATH>

Use these top-level field values verbatim (do not invent your own):
    "spec_path":  "<SPEC_PATH>"
    "code_root":  "<CODE_ROOT>"
    "framework":  "<FRAMEWORK>"

Step 5: Stop. Do NOT:
  - write a test file (the orchestrator's translator handles that)
  - run `allium plan` / `allium model` yourself (the orchestrator did)
  - write any other file
  - invoke any other skill (in particular, do not invoke `propagate` —
    that would recurse)
  - read or follow the orchestrator's SKILL.md
  - print anything other than a one-line confirmation that the file was written

The inventory is your only deliverable.
```

### Step 5 — Canonicalize each inventory

For each inventory the subagents produced, run via Bash:

```
node ${CLAUDE_PLUGIN_ROOT}/scripts/canonicalize-obligations.mjs \
    ./allium-propagated/inventories/inventory-<i>.json \
    ./allium-propagated/inventories/inventory-<i>.canonical.json \
    --plan ./allium-propagated/plan.json
```

If a subagent failed to write its inventory, or the canonicaliser rejects
it (obligation set mismatch, malformed bridge, unknown framework), skip
it and continue with the survivors. Note any failures in the final
report. If fewer than ⌈K/2⌉ survive, abort and ask the user to re-run.

### Step 6 — Merge into a consensus inventory

Run via Bash, passing every canonical inventory:

```
node ${CLAUDE_PLUGIN_ROOT}/scripts/merge-obligations.mjs \
    ./allium-propagated/merged.json \
    ./allium-propagated/inventories/inventory-1.canonical.json \
    ./allium-propagated/inventories/inventory-2.canonical.json \
    ...
```

The merger does modal voting on `test_kind` and `bridge.primary_symbol`,
set-style majority on `preconditions`, `fixtures_required`, and
`injection_points`. Obligations where K subagents cannot converge on a
single primary symbol are demoted to `bridge.confidence: "low"` with
the candidates preserved — the translator will emit those as
backend-idiomatic skipped stubs.

Same K canonical inventories always produce byte-identical merged bytes.

### Step 7 — Translate to test files

```
node ${CLAUDE_PLUGIN_ROOT}/scripts/obligations-to-tests.mjs \
    ./allium-propagated/merged.json \
    --out <CODE_ROOT>
```

The translator dispatches on the inventory's `framework` field, loads
that backend's manifest, name-policy, and templates, and writes test
files under `<CODE_ROOT>/<backend's directory_layout>/`. Same merged
inventory always produces byte-identical files.

### Step 8 — Verify with Stage C runner

```
node ${CLAUDE_PLUGIN_ROOT}/scripts/run-suite.mjs \
    ./allium-propagated/merged.json \
    --tests-root <CODE_ROOT> \
    --report ./allium-propagated/propagation-report.md
```

Stage C runs the backend's runner command (e.g. `python3 -m pytest
--junit-xml=…`), parses the runner's JSON/XML report via a per-format
adapter, categorises outcomes into pass / fail / error / skipped
(bridge-unresolved) / skipped (other), and emits a Markdown report.

Stage C is intentionally read-only against the inventory pipeline: it
does not feed back into Stage B.

### Step 9 — Report

State to the user:

- Backend used and number of subagents (K)
- Total obligations vs obligations covered
- Number of `bridge-unresolved` stubs (these need human follow-up)
- Number of likely real failures and likely wrong bridges
- Path to the generated test files and to `propagation-report.md`
- Any subagent failures and survivor count

Do not embed test file contents in your reply — point the user at the
files.

## Defaults

- K = 3
- Backend = inferred from project files (`pytest+hypothesis` for Python,
  `jest+fastcheck` for TypeScript/JavaScript projects with Jest)
- Output directory = `./allium-propagated/`
- Subagents run in parallel (always)
- One propagation per invocation

## What this skill does NOT do

- It does not invoke `allium analyse` beyond reading `allium plan` and
  `allium model`. If the user wants completeness checks against analyse
  findings, they run those tools manually against the spec first.
- It does not modify implementation source code — only the test tree under
  `<CODE_ROOT>/<directory_layout>/`.
- It does not delete pre-existing tests. The generated tree may overlap
  with hand-written tests; the user is responsible for reconciling.
- It does not implement new test bodies — it emits *stubs* with a wired
  bridge (import + skeleton + TODO). Engineers fill in the assertion body.
  Stubs are still useful: they prove the obligation is structurally
  covered and the bridge is importable.
- It does not invoke other skills (no recursion through the subagent path).

## How backends are dispatched

The backend is selected from the inventory's `framework` field, set by
the orchestrator and propagated through canonicalize / merge / translate
unchanged. To add a new language (Rust + proptest, Go + rapid, …),
contribute a new backend under `backends/<id>/`:

- `manifest.json`           — runner, file extension, imports style,
                              injection idioms (see
                              [`references/backend-authoring-guide.md`](./references/backend-authoring-guide.md))
- `name-policy.json`        — casing, directory layout, file pattern
- `conventions.md`          — symbol form for Stage A subagents
- `templates/`              — six templates (test-file, assertion,
                              pbt-property, state-machine,
                              stub-unresolved, fixture)

The translator does not need changes when a backend is added.
Stage C's runner-output adapter (in `run-suite.mjs`) may need a new
entry if the backend's runner emits a JSON/XML format not yet supported.

## What subagents extract — guidance

The `references/obligation-bridge-schema.md` document carries the full
contract. Subagents read that. The orchestrator (you) does not need to
know what to extract — only how to drive the pipeline.

If subagents produce visibly poor inventories (most bridges low-confidence
when the implementation is obvious; bogus `<symbol>` shapes; obligation
IDs that don't match the plan), the right interventions are:

1. Extend `references/obligation-bridge-schema.md` (covers all backends).
2. Extend the specific backend's `conventions.md` (per-language).

Keep this SKILL.md focused on orchestration.
