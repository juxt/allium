# Allium tests

Local-only test suite for this repo. This README is the operator's guide — how to run things, how to add fixtures, what flags exist. The companion [RATIONALE.md](RATIONALE.md) covers the *why* of the suite's shape: the four-tier model, the choice of custom Node runner over Waza/Inspect AI, why Tier 4's fixture is Node not Python, and a glossary of terms used here.

## Quick start

Run from the repo root (the orchestrator path is `scripts/test.mjs` relative to it):

```bash
node scripts/test.mjs              # all currently-wired groups (offline)
node scripts/test.mjs tier1        # one group
node scripts/test.mjs tier1 entities   # tier1, filtered to category 'entities'
```

Every run starts with a one-line banner showing the `allium` CLI version and the language versions it supports — so when triaging a failed test, the version that produced it is right there in the log:

```text
🌱 Allium test suite
   allium 3.2.3 (language versions: 1, 2, 3)
```

The banner prints once per process and is idempotent across entry points, so invoking the orchestrator and a tier runner together (or in a script) doesn't double-print.

Each tier runner can also be invoked directly (cwd-agnostic — they use ESM `import.meta.url` to find their own paths):

```bash
node tests/tier1-language.mjs
node tests/tier2-docs.mjs
node tests/tier3-evals.mjs --live
node tests/tier4-e2e.mjs --live
```

The orchestrator returns non-zero on any failure; safe to wire into a pre-commit hook later.

## Groups

| Group | What it tests | Runtime | Dependencies | Status |
| --- | --- | --- | --- | --- |
| `tier1` | Language fixtures: every `.allium` in `tests/fixtures/language/` checked against the `allium` CLI | <5s | `allium` on PATH | Active |
| `tier2` | Doc-example validation: every `.allium` code block in `skills/**/*.md` round-tripped through `allium check` | <10s | `allium` on PATH | Active |
| `tier4` | End-to-end: `claude -p` drives `/distill`, `/tend`, `/propagate` against a fixture project; output compared to text + model snapshots | 3–10 min/scenario, ~$1–$5 each | `claude`, `allium`, `ANTHROPIC_API_KEY`; gated behind `--live` | Active (3 scenarios) |
| `tier3` | Skill behavioural evals: `claude -p` invokes a skill against a fixture workspace, then a second `claude -p` call scores the result against a rubric (LLM-as-judge) | 30–120s/scenario, $0.05–$0.50 each | `claude`, `allium`, `ANTHROPIC_API_KEY`; gated behind `--live` | Active (1 starter scenario) |
| `artifact` | Forwards to `scripts/test-skills.mjs` (skill frontmatter, links, routing, generation) | ~1s | none | Active (pre-existing) |
| `hook` | Forwards to `hooks/allium-check.test.mjs` (cross-editor hook payloads) | ~1s | none | Active (pre-existing) |

A group whose dependency is missing skips with `skip:`, never fails.

## Writing a Tier 1 fixture

Fixtures live under `tests/fixtures/language/<version>/<expectation>/<category>/`. Conventions:

- **Valid fixture** — `valid/<category>/<descriptive-name>.allium`. Must `allium check` clean (exit 0, no warnings or errors). Reference every entity, field and rule you declare; otherwise the analyser flags unused-construct warnings.
- **Invalid fixture** — `invalid/<category>/<descriptive-name>.allium` paired with `<descriptive-name>.expected`. The `.expected` file holds one regex per line; every regex must match somewhere in the CLI's combined stdout+stderr. `#` lines are comments, blank lines ignored.
- **Notes** — optional `<descriptive-name>.notes.md` next to a fixture; ignored by the runner, useful for human context.

Categories so far: `entities`, `rules`. Add a new directory under both `valid/` and `invalid/` when you want a new one (e.g. `surfaces`, `contracts`, `triggers`, `composition`). The runner discovers categories from the directory tree; no registration step needed.

Pre-flight check: run `allium check tests/fixtures/.../your-fixture.allium` directly before adding the fixture. If a "valid" fixture has even one warning, decide whether to (a) flesh it out so the warning goes away, or (b) re-classify it as `invalid/` with a `.expected` matching the warning code.

### Drift fixtures (spec/CLI gaps)

Some constructs the language reference describes as errors are not yet enforced by the `allium` CLI. Authoring a fixture for one of these would normally produce a "expected failure, got exit 0" fail, which would block the suite. Instead, list it in `tests/fixtures/language/drift.json`:

```json
{
  "v3/invalid/variants/create-base-instead-of-variant.allium": {
    "spec_says": "Creating a base entity instead of a variant must error: the variant is ambiguous.",
    "cli_does": "Passes clean. No diagnostic produced.",
    "ref": "skills/allium/references/language-reference.md (Sum types section)",
    "since_cli_version": "3.2.3"
  }
}
```

The runner reads this and emits a `drift:` line for each entry instead of pass/fail. Drift items don't fail the suite — they document the gap so it stays visible at every test run, with a one-line spec-vs-CLI comparison.

When `allium-tools` adds enforcement for the construct, the fixture's `.expected` patterns start matching CLI output. The runner detects this and FAILs the fixture with "drift entry is stale: CLI now emits the expected diagnostic — remove this fixture's entry from drift.json", prompting graduation back to a regular `pass:`.

Drift entries are keyed by the fixture path relative to `tests/fixtures/language/`. Entries with a leading `_` (like `_comment`) are ignored.

The current drift catalogue covers six constructs that allium 3.2.3 doesn't enforce: variant safety (creating a base, accessing variant-only fields outside guards), `now` in invariant bodies (purity), surfaces with undeclared actors, temporal triggers without `requires` guards, and open question warnings.

## Filters

Positional args after the group name are passed to the tier runner as filters. Tier 1 matches a filter against version, expectation, or category (any one wins). Tier 2 matches a filter as a substring against the markdown file path.

```bash
node scripts/test.mjs tier1 v3            # only v3
node scripts/test.mjs tier1 invalid       # only invalid fixtures
node scripts/test.mjs tier1 entities      # only entities/ category
node scripts/test.mjs tier2 patterns.md   # only blocks from patterns.md
```

`--quiet` suppresses per-fixture pass lines (failures, skips and drift still print).

### Output styling

When stdout is a TTY, the runner emits coloured glyphs (`✓` `✗` `⊘` `◆`) with a 🌱 prefix on tier headings. When piped to a file or pipeline, output falls back to plain text (`pass:` / `FAIL:` / `skip:` / `drift:`) so log greppers and CI-result parsers keep working unchanged.

Three opt-out paths force plain output even in a TTY:

```bash
node scripts/test.mjs --plain         # explicit flag
NO_COLOR=1 node scripts/test.mjs      # standard env var (no-color.org)
node scripts/test.mjs > log.txt       # not a TTY
```

One opt-in path forces colours in a non-TTY context (useful for CI providers that render ANSI in their log viewer):

```bash
FORCE_COLOR=1 node scripts/test.mjs | tee log.txt
```

Order of precedence: `--plain` and `NO_COLOR` always win; `FORCE_COLOR` only applies when neither opt-out is active and stdout isn't already a TTY.

## Tier 2 — doc-example validation

Tier 2 walks every `.md` file under `skills/`, extracts Allium fenced code blocks, and runs `allium check` against each. A fenced block is recognised when:

- the fence has an `allium` info-string (` ```allium`), OR
- the fence has no info-string AND the first non-blank line of its body matches `^-- allium:`.

Default per-block behaviour:

- **Version-marked, unannotated** — must `allium check` clean. Any error or warning is a failure.
- **Fragment** (info-string only, no version marker) — skipped with reason `fragment without version marker; no wrap configured`. Wrappers are a planned extension; until they exist, fragments are documented as untestable.

Per-block annotations override the default. Two forms are supported.

### In-line annotation (HTML comment immediately above the fence)

```markdown
<!-- allium-test: skip          reason="explain why" -->
<!-- allium-test: expect-error  pattern="regex" -->
```

`skip` exempts the block from validation. `expect-error` requires the block to fail and the CLI output to match the regex.

### Override file (out-of-line)

`tests/fixtures/docs/overrides.json` holds the same annotations for blocks whose markdown source you don't want to edit (canonical references, library-style pattern fragments). Format:

```json
{
  "skills/path/to/file.md": {
    "<starting-line>": { "kind": "skip", "reason": "..." }
  }
}
```

The line number is the line of the opening fence (1-indexed), matching the line number in the block's failure output. Override beats in-line annotation. Remove an entry once the underlying block is brought clean.

The current overrides catalogue ten blocks in `skills/allium/references/patterns.md` that are library-style spec fragments referencing types the consumer is expected to define, or status enums whose reachability rules don't appear in the doc. These are deliberate documentation conventions and are not regressions.

## Tier 3 — skill behavioural evals

Tier 3 invokes a skill against a fixture workspace, then asks Claude to score the result against a rubric (LLM-as-judge). Every scenario costs API spend, so Tier 3 is **gated behind `--live`** and skips silently otherwise.

```bash
node scripts/test.mjs tier3 --live              # all scenarios
node scripts/test.mjs tier3 tend --live         # only scenarios for the tend skill
node scripts/test.mjs tier3 tend-fix-syntax-error --live   # one scenario by id
```

Skip conditions (any one triggers a clean skip, never a failure):

- `--live` not passed
- `claude` not on PATH
- The chosen auth mode (see below) has no credentials

### Auth modes (bare vs oauth)

Tier 3 supports two ways to authenticate `claude`. Choose the one that fits your machine:

| Mode | Selected by | Auth source | Trade-off |
| --- | --- | --- | --- |
| `bare` (default) | nothing — it's the default | `ANTHROPIC_API_KEY` env var | Hermetic. Strips hooks, plugin sync, auto-memory, CLAUDE.md auto-discovery, OAuth and keychain reads. Best for CI and reproducible runs. |
| `oauth` | `--oauth` flag, or `ALLIUM_TIER3_AUTH=oauth` env | Whatever `claude` is logged in to | Local-friendly. No API key needed. Trade-off: claude loads CLAUDE.md from parent dirs, fires hooks, reads auto-memory — your local config bleeds into the test. Convenient for iterating locally without setting up an API key. |

```bash
# Hermetic (CI)
ANTHROPIC_API_KEY=sk-ant-... node scripts/test.mjs tier3 --live

# Local with OAuth (no key needed)
node scripts/test.mjs tier3 --live --oauth

# Same thing via env
ALLIUM_TIER3_AUTH=oauth node scripts/test.mjs tier3 --live
```

The runner announces the chosen mode (`auth mode: bare` / `auth mode: oauth`) at the top of the Tier 3 section so you can see at a glance how the run was authenticated. Mismatches between local and CI runs (different model behaviour, different skill resolution because of CLAUDE.md interference) usually trace back to mode differences.

### Scenario layout

```text
tests/fixtures/evals/
  scenarios/
    tend-fix-syntax-error.json
    ...
  rubrics/
    tend.md
    ...
```

A scenario is one JSON file. Schema:

```json
{
  "id": "tend-fix-syntax-error",
  "skill": "tend",
  "setup": { "files": { "broken.allium": "<initial content>" } },
  "prompt": "Use the tend skill to fix the syntax error...",
  "budget_usd": 0.5,
  "model": "sonnet",
  "assertions": [
    { "type": "file-exists", "path": "broken.allium" },
    { "type": "cli-passes", "cmd": ["allium", "check", "broken.allium"] },
    {
      "type": "judge",
      "rubric": "tend.md",
      "criteria": ["minimal-edit", "preserves-intent"]
    }
  ]
}
```

### Assertion types

- **`file-exists`** — `path` (workspace-relative) must exist after the agent ran.
- **`cli-passes`** — `cmd` (argv array) must exit 0 when run with the workspace as cwd. Used to invoke `allium check` against the produced state.
- **`judge`** — invoke the LLM-as-judge with the named rubric. `criteria` is the list passed into the rubric template; the judge returns one verdict per criterion.

Assertions run in declaration order. A failure on one assertion does not stop later assertions — the report stays complete.

### Rubrics

Markdown templates with `{{placeholders}}` for `prompt`, `before`, `after`, and `criteria`. The judge call uses `--max-budget-usd`, `--output-format json`, and `--model claude-haiku-4-5` (cheap and plenty capable for rubric scoring). The rubric instructs the model to return a JSON array of `{criterion, verdict, reason}` objects; markdown code fences are stripped before parsing. `--json-schema` is deliberately NOT used — empirically it's incompatible with OAuth/agent mode (the model returns "Done." instead of structured output).

### Cost budget

Each scenario sets its own `budget_usd` (passed to `claude --max-budget-usd`). The judge call is capped separately at $0.10. Typical run: $0.05–$0.50 per scenario, 30–120 seconds. The starter `tend-fix-syntax-error` scenario should land well under $0.20.

Hard cost cap is enforced by the `claude` CLI; if it overshoots the budget, the invocation fails before completing.

### Adding a scenario

1. Create `tests/fixtures/evals/scenarios/<id>.json`.
2. If the assertion list includes `judge`, ensure `tests/fixtures/evals/rubrics/<rubric-name>.md` exists. Copy `tend.md` and adjust criterion definitions.
3. Run `node scripts/test.mjs tier3 <id> --live` once to confirm it works.
4. Adjust `budget_usd` based on actual spend.

## Tier 4 — end-to-end pipeline

Tier 4 drives a multi-step skill pipeline (typically `distill` → `tend` → `propagate`) against a checked-in fixture project, then compares the produced files against accepted snapshots. Like Tier 3 it's gated behind `--live` and skips otherwise.

```bash
node scripts/test.mjs tier4 --live                   # all scenarios (bare; needs API key)
node scripts/test.mjs tier4 --live --oauth           # use claude's OAuth login (no key needed)
node scripts/test.mjs tier4 distill-only --live      # one scenario by id
node scripts/test.mjs tier4 node-todo --live         # all scenarios for one fixture
node scripts/test.mjs tier4 --live --update-snapshots # rewrite snapshots from actual output
node scripts/test.mjs tier4 --live --verbose         # tee claude's stderr to console as it arrives
node scripts/test.mjs tier4 --live --keep-workspace  # preserve workspace + per-step checkpoints + manifest
node scripts/test.mjs tier4 --workspace <path>       # replay snapshot comparison against a kept workspace (no API spend)
```

Skip conditions: `--live` not passed; `claude` not on PATH; the chosen auth mode lacks credentials (see below); `allium` not on PATH.

### Auth modes

Tier 4 uses the same auth-mode mechanism as Tier 3 — `bare` by default (needs `ANTHROPIC_API_KEY`), or `oauth` (claude's OAuth login, opt-in via `--oauth` or `ALLIUM_TIER4_AUTH=oauth`). Same trade-off applies, with one extra wrinkle for snapshots:

- `bare` — clean, hermetic. CLAUDE.md auto-discovery / hooks / auto-memory disabled. Snapshots will be more stable across runs.
- `oauth` — convenient locally. Loads your CLAUDE.md / hooks / auto-memory, which **affects the spec content the agent produces** (and therefore the snapshot text). Snapshots taken under OAuth may not match snapshots taken under bare. Pick one mode for snapshot capture and stick with it.

The runner announces the active mode (`auth mode: bare` / `auth mode: oauth`) at the top of the Tier 4 section.

### Layout

```text
tests/fixtures/e2e/
  node-todo/                       # one fixture
    starting-state/                # checked-in source tree (the input)
      models.js
      service.js
      routes.js
      server.js
      README.md
    scenarios/                     # one JSON file per scenario
      distill-only.json
      distill-then-tend.json
      full-pipeline.json
    snapshots/                     # accepted golden outputs (per scenario)
      distill-only/
        spec.allium                # text snapshot
        spec.allium.model.json     # parallel model snapshot (auto-derived)
      ...
```

### Scenario schema

```json
{
  "id": "distill-only",
  "fixture": "node-todo",
  "steps": [
    { "skill": "distill", "prompt": "Use the distill skill to ..." }
  ],
  "snapshot_files": ["spec.allium"],
  "snapshot_dir": "snapshots/distill-only",
  "budget_usd_per_step": 1.5,
  "model": "sonnet"
}
```

`steps` runs sequentially in a single tmpdir copy of the fixture's `starting-state/`. Each step is a `claude -p` invocation with the workspace as cwd; the workspace persists across steps (so step 2 sees what step 1 produced). After all steps, every file in `snapshot_files` is compared against the snapshot dir.

### Dual snapshot comparison

For every snapshot file, the runner tries two comparators and passes if EITHER matches:

1. **Text snapshot** — normalised raw text of the produced file. Strict but flake-prone (LLM may reorder declarations or rephrase comments).
2. **Model snapshot** — for `.allium` files only, the JSON output of `allium model <file>`. Cosmetic variation (whitespace, comment phrasing, declaration order) collapses to identical structure. Currently the model command emits entity-level structure only; rules and surfaces still depend on the text comparator.

This dual semantic means a passing scenario's text-snapshot diff is informational ("the LLM wrote it slightly differently this time") and only needs investigation when both snapshots disagree. The fail report shows both diffs.

### Snapshot-failure reports (judge gates pass/fail)

When the dual-snapshot comparator (text + model) doesn't match, the **judge** is consulted — and its `recommendation` is what determines whether the test passes or fails:

- `accept` (cosmetic or behaviour-preserving structural drift) → **pass** (with a "judge accepted" note)
- `investigate` (any semantic change, or a structural one the judge flagged as worth a look) → **fail**

In both cases the verdict prints inline as a bulleted list of distinct changes with per-change severity tags, so you can see at a glance which changes drove the recommendation.

Pass example (cosmetic-only):

```text
pass: distill-only/spec.allium (judge accepted: cosmetic drift) (9.0s)
    judge (9.0s): COSMETIC — recommend accept (1 change)
      • [cosmetic] External entity declarations reordered: Cron now appears before User
```

Fail example (semantic drift):

```text
FAIL: distill-only/spec.allium (53s) — snapshot drift requires investigation
    judge (52.9s): SEMANTIC — recommend investigate (12 changes)
      • [cosmetic  ] File header comments and extraction metadata removed
      • [structural] Inline enum on Todo.status extracted to named TodoStatus
      • [structural] ArchiveTodo rule split into two rules
      • [semantic  ] User authorization parameters removed from rule signatures
      • [semantic  ] ExpireOverdue changed from temporal trigger to explicit action
      • [semantic  ] todo.owner removed from TodoAPI exposes clause
      …
```

You can scan and see WHICH changes are the worrying ones at a glance. In a TTY, severity tags are colour-coded (semantic in red, structural in yellow, cosmetic in gray).

Severity:

- **cosmetic** — comments, whitespace, declaration order; behaviour identical
- **structural** — refactoring that preserves behaviour (e.g. extracting an inline enum to a named one)
- **semantic** — changes that alter behaviour (removed rules, changed types, altered transitions)

#### When the judge isn't available

The judge needs `claude` on PATH and viable auth (API key for bare; OAuth for `--oauth`). Without it, the runner can't make a verdict — so it falls back to "any mismatch is a fail":

```text
FAIL: distill-only/spec.allium (4ms) — snapshot mismatch (judge unavailable: no claude/auth; pass --diff for unified diff)
```

Same fallback if the judge call itself errors out (network, budget exceeded, malformed response): the failure carries the underlying error message.

#### Opting out

`--no-judge` disables the judge entirely and reverts to the conservative behaviour (any mismatch is a fail, no LLM cost):

```bash
node scripts/test.mjs tier4 distill-only --workspace tests/.tier4-runs/<id> --no-judge
```

#### Seeing the diff

The judge verdict is the headline; the unified diff is supplementary detail behind `--diff`:

```bash
node scripts/test.mjs tier4 distill-only --workspace tests/.tier4-runs/<id> --diff
```

When set, the diff prints as an indented trailing block AFTER the judge verdict (or after the fail line if no judge ran). Canonical unified diff (`diff -u`) with hunk headers and `+`/`-` markers; truncated to 200 lines for wholesale rewrites — the full file is in the kept workspace.

#### Cost and tuning

Each judge call costs ~$0.05 and takes 10–30s in OAuth mode (less in bare). The judge runs on every mismatch when enabled, so a flaky scenario that produces persistent cosmetic drift will pay $0.05 per run to re-confirm `accept`. If that becomes annoying, `--update-snapshots` locks in the new shape and stops the recurring judge calls.

Default model is `claude-haiku-4-5` (overridable in `tests/lib/snapshot-judge.mjs`). The rubric — including the severity definitions and what counts as `accept` vs `investigate` — is editable at `tests/fixtures/evals/rubrics/snapshot-diff.md`. Pairs with replay mode for cheap iteration: edit the rubric, re-run `--workspace <kept-run>`, see the new judgment for ~$0.05.

### Updating snapshots

First-ever run for a scenario will fail with "no snapshot at ...". Re-run with `--update-snapshots` to populate them, then **review the diff before committing** — the snapshots are the contract for future runs.

```bash
node scripts/test.mjs tier4 distill-only --live --update-snapshots
git diff tests/fixtures/e2e/node-todo/snapshots/distill-only/
git add tests/fixtures/e2e/node-todo/snapshots/distill-only/
```

After a deliberate change to a SKILL.md (e.g. tweaking the distill prose), re-run with `--update-snapshots` to capture the new accepted output, review carefully, and commit.

### Progress visibility

Every step prints a `⏱ Ns elapsed` heartbeat every 15 seconds while the call is in flight, so a multi-minute wait doesn't look like a hung process. Add `--verbose` to also tee claude's stderr to the console as it arrives — useful for diagnosing slow runs (you'll see plugin sync, model selection, hook activity etc.).

```bash
node scripts/test.mjs tier4 distill-only --live --oauth --verbose
```

Per-step timeout is 20 minutes. Distill on a multi-file fixture in OAuth mode (1M-context Opus startup + agentic file reading) can legitimately take 10-15 minutes; the previous 10-minute cap was tripping SIGTERM mid-run.

### Kept workspaces and replay (`--keep-workspace` / `--workspace`)

Generation is expensive ($1–5/scenario) and the workspace gets deleted at the end of a normal run, so iterating on the snapshot-comparison logic — or capturing a baseline after seeing the first-run "no snapshot at..." failure — meant re-paying for the generation. Two flags address this:

`--keep-workspace` writes the run to a persistent dir at `tests/.tier4-runs/<scenario>-<UTC-ts>/` instead of `mkdtemp`. Layout:

```text
tests/.tier4-runs/distill-only-2026-05-08T17-23-15-000Z/
  .tier4-manifest.json          ← scenario id, timestamps, cost/turns/session per step
  starting-state/               ← reference copy (never modified)
  workspace/                    ← live working copy invoke() wrote into
  after-step-1-distill/         ← snapshot of workspace at end of step 1
  …
  after-step-N-<skill>/         ← one per step
  final/                        ← symlink to the last after-step-N-<skill>
```

For a multi-step scenario (`full-pipeline` has 3) each step's checkpoint is preserved separately, so an interrupted or failed run leaves usable artefacts from completed steps. The manifest is written incrementally (after each step) and finalised with `result: "success"|"failed"|"interrupted"`.

`--workspace <path>` reuses an existing kept-run dir. The runner inspects the dir's checkpoints against the scenario's current step list and picks one of two modes automatically:

- **Replay** — checkpoint count equals scenario step count: skip the invoke loop entirely, run only the snapshot comparison against `<path>/final/` (or `<path>/workspace/`, or `<path>` itself).
- **Resume** — checkpoint count is fewer than scenario step count: claude is re-invoked for the missing tail of steps, starting from the last existing checkpoint as the working state. New checkpoints append to the same dir, the manifest is appended to and re-finalised, the `final/` symlink is refreshed, then snapshot comparison runs as normal. Useful when a scenario gains additional steps after a kept run was captured (e.g. adding more weed passes to test convergence) — only the new steps cost API spend; prior work is reused.

Both modes validate that existing checkpoints' skill names match the scenario's prefix; if they don't (workspace was captured against a different scenario, or the prefix steps were edited) the runner fails fast rather than silently doing the wrong thing.

The cheap iteration loop:

```bash
# Generate once (expensive, $1–2)
node scripts/test.mjs tier4 distill-only --live --oauth --keep-workspace
# → "workspace preserved at tests/.tier4-runs/distill-only-2026-05-08T17-23-15-000Z/"

# Replay snapshot comparison (free, runs in seconds)
node scripts/test.mjs tier4 --workspace tests/.tier4-runs/distill-only-2026-05-08T17-23-15-000Z

# Or capture the baseline from the kept workspace (also free — just copies files)
node scripts/test.mjs tier4 --workspace tests/.tier4-runs/distill-only-2026-05-08T17-23-15-000Z --update-snapshots

# Add steps to an existing scenario, then resume from the last checkpoint
# (only the new steps cost API spend; prior checkpoints are reused as starting state)
node scripts/test.mjs tier4 --workspace tests/.tier4-runs/weed-convergence-2026-05-11T10-12-23-685Z --oauth
```

Replay mode reads the scenario id from the workspace's manifest, so positional `<scenario-id>` args aren't needed (but can be passed if the workspace has no manifest, e.g. for an arbitrary directory containing produced files).

The kept-runs directory is gitignored. Clean up old runs with `rm -rf tests/.tier4-runs/<old>/`.

### Variance scenarios (`repeat: N`)

Convergence asks "does running weed repeatedly stabilise the spec?". Variance asks a different question: "how much does the non-deterministic distill output influence the final spec, even after weed + tend cleanup?". To answer it we need N independent runs of the same pipeline against the same starting state and a way to compare the results.

A scenario opts in by adding `repeat: N` to its JSON:

```json
{
  "id": "distill-stability",
  "fixture": "node-todo",
  "repeat": 10,
  "steps": [
    { "skill": "distill", "prompt": "..." },
    { "skill": "weed",    "prompt": "..." },
    { "skill": "weed",    "prompt": "..." },
    { "skill": "weed",    "prompt": "..." },
    { "skill": "tend",    "prompt": "..." }
  ],
  "budget_usd_per_step": 5.0,
  "model": "claude-opus-4-7"
}
```

Variance scenarios require `--keep-workspace`. The runner produces a single parent dir with N nested per-run subdirs:

```text
tests/.tier4-runs/distill-stability-2026-05-12T…Z/
  .tier4-variance-manifest.json   ← scenario id, repeat, per-run completion status
  starting-state/
  runs/
    01/.tier4-manifest.json  runs/01/workspace/  runs/01/after-step-*/  runs/01/final/
    02/...
    10/...
```

Each `runs/NN/` is structurally identical to a regular kept run, so per-run tooling (the convergence script, snapshot inspectors) works against the subdirs unchanged.

`--repeats N` overrides the scenario's repeat (useful for cheap iteration: try N=3 first). `--concurrency N` (default 3) controls how many runs execute simultaneously — API spend is unchanged, but wall time scales inversely. `--concurrency 1` reproduces strict sequential behaviour; `--concurrency N` (= repeat) is full parallel, subject to rate limits.

In-place heartbeats are disabled under concurrency to avoid sibling workers clobbering each other; each step logs `[<scenario>/run-NN M/K skill]` start + completion lines that interleave readably.

The post-run analysis script `scripts/tier4-variance.mjs` operates on the parent dir:

```bash
# Cheap dry run first
node scripts/test.mjs tier4 distill-stability --live --oauth --keep-workspace --repeats 3

# Free analysis (line-count distribution + pairwise diff line counts)
node scripts/tier4-variance.mjs tests/.tier4-runs/distill-stability-<ts>

# With --judge: every pair gets a haiku verdict (~$0.05 each), cached in
# .variance-judges.json. Output adds a cluster summary grouping runs whose
# pairwise verdicts are cosmetic-or-zero.
node scripts/tier4-variance.mjs tests/.tier4-runs/distill-stability-<ts> --judge

# Drill down into one specific pair
node scripts/tier4-variance.mjs tests/.tier4-runs/distill-stability-<ts> --judge --pair 1,7
```

Full N=10 spend: ~$50–$60 for the runs + ~$2.25 for 45 pairwise judges. Re-running the analysis is free after the first judge pass.

#### Variance resume

If a variance run was interrupted partway through, or you bump `repeat: 10` → `repeat: 15` after a previous batch completed, point `--workspace` at the existing parent dir:

```bash
node scripts/test.mjs tier4 --workspace tests/.tier4-runs/distill-stability-<ts> --oauth
```

The runner detects the parent variance manifest and:

- keeps every `runs/NN/` whose per-run manifest reports `result: "success"`;
- wipes and re-executes any `runs/NN/` that's `failed` or `in-progress`;
- adds any `runs/NN/` that doesn't yet exist (up to the scenario's current `repeat`, or the `--repeats N` override);
- bumps the parent manifest's `repeat` to the new target and appends the new run entries.

`--repeats N` can override the scenario's `repeat` during resume (same as during a fresh run). API spend is exactly `N × per-run-cost` for the runs that actually execute; previously-successful runs cost nothing.

### Cost expectations

Each step caps at `budget_usd_per_step` USD via `claude --max-budget-usd`. A typical run:

- `distill-only` — 1 step, ~$0.50–$1.50
- `distill-then-tend` — 2 steps, ~$1–$3
- `full-pipeline` — 3 steps, ~$2–$5 (largest because propagate generates many test cases)

Full Tier 4 suite end-to-end: ~$5–$10 and ~10–15 minutes. Not for every commit — run before tagging a release or after material SKILL.md changes.

### Adding a fixture or scenario

To add a scenario to the existing `node-todo` fixture:

1. Create `tests/fixtures/e2e/node-todo/scenarios/<id>.json`.
2. Run `node scripts/test.mjs tier4 <id> --live --update-snapshots` to populate.
3. Review the snapshot diff and commit.

To add a new fixture (e.g. a different domain or stack):

1. Create `tests/fixtures/e2e/<fixture-name>/starting-state/` with the source files.
2. Add a `README.md` documenting the domain.
3. Add scenarios under `scenarios/`.
4. The runner discovers fixtures automatically.

## CI

Currently none. The existing `.github/workflows/check-generated.yml` runs only `scripts/test-skills.mjs` (the `artifact` group). Promoting the orchestrator to CI is a follow-up once the suite has been used locally for a while.
