# Test-suite rationale

Why the test suite looks the way it does. The companion to [README.md](README.md), which tells you *how* to run things — this doc tells you *why* the shape was chosen so future maintainers (or future you) can revisit decisions when the context changes.

## Glossary

| Term | Meaning here |
| --- | --- |
| **Tier** | One layer of the suite, distinguished by what it tests and what it costs. Four tiers exist (1 cheap and structural, 4 expensive and behavioural). See [Tiers](#tiers). |
| **Group** | The orchestrator's word for "a thing you can run" — every tier is a group, plus the pre-existing `artifact` and `hook` groups. `node scripts/test.mjs <group>` invokes one. |
| **Fixture** | A checked-in input artefact a tier runs against. Tier 1 fixtures are tiny `.allium` files; Tier 2 fixtures are markdown files in `skills/`; Tier 3 fixtures are scenario JSON + temp workspaces written from `setup.files`; Tier 4 fixtures are full source trees (e.g. the `node-todo` mini-project). |
| **Scenario** | One Tier 3 or Tier 4 case: a JSON file describing a setup, a prompt (or sequence of prompts), and the assertions/snapshots that validate the result. |
| **Override** | A per-block annotation in `tests/fixtures/docs/overrides.json` that exempts a doc-example block from Tier 2 validation, with a reason. Used when the markdown source is canonical and we don't want to edit it in place. |
| **Skip path** | The pattern every tier follows when a dependency is missing: emit a `skip:` line with the reason and return success, never fail. Lets the orchestrator stay green when only some tools are installed. |
| **LLM-as-judge** | Tier 3's grading approach: after the agent runs, a separate `claude -p` call evaluates the result against a markdown rubric. Returns structured verdicts (`pass` / `fail` / `partial`) per criterion. |
| **Snapshot** | Tier 4's golden file. Two flavours per `.allium` artefact: a text snapshot (normalised raw `.allium` source) and a model snapshot (JSON from `allium model <file>`). Comparison passes if either matches. |
| **`--live`** | Orchestrator flag that enables tiers which cost API spend (Tier 3, Tier 4). Without it, those tiers skip cleanly. Default is offline-only. |
| **Starting state** | The `tests/fixtures/e2e/<fixture>/starting-state/` directory: the canonical input copied into a fresh tmpdir for each Tier 4 scenario. |
| **`--update-snapshots`** | Tier 4 flag that overwrites the accepted snapshots with the actual produced output. The diff must be reviewed before committing — snapshots are the contract for future runs. |

## Tiers

A tier groups tests by their **cost-to-feedback ratio**. The four tiers are deliberately ordered cheapest-first so the orchestrator's default run gives fast, free signal.

| Tier | What it tests | Why it's its own tier |
| --- | --- | --- |
| **1 — language fixtures** | Hand-authored `.allium` snippets exercising language constructs in isolation, run through `allium check` | Cheapest signal; one fixture per language feature; catches regressions in the CLI's parser/checker behaviour against this repo's expectations |
| **2 — doc examples** | Every Allium fenced code block in `skills/**/*.md`, validated against `allium check` | Catches drift between language docs and CLI behaviour. Fragments and library patterns get explicit `skip` overrides with reasons; new genuine drift is the only thing that produces a fail |
| **3 — skill behavioural evals** | Single skills (`tend`, `weed`, etc.) invoked by `claude -p` against a fixture workspace; LLM-as-judge scores against a rubric | Tests whether SKILL.md prose actually causes the model to do what it promises. Non-deterministic, costs API spend, gated behind `--live` |
| **4 — end-to-end pipeline** | Multi-step pipelines (typically `distill → tend → propagate`) against a real-shaped source tree; snapshot the produced files | Tests skill orchestration and the cumulative artefacts of a real workflow. Most expensive; flake-prone; highest fidelity |

The choice of four (not three, not seven) followed the principle that each tier should answer a different question:

- *Does the language definition behave?* → Tier 1
- *Do the docs match the language definition?* → Tier 2
- *Do the individual skills behave as their prompts claim?* → Tier 3
- *Does the end-to-end workflow produce useful artefacts?* → Tier 4

A fifth "load testing" or "concurrency" tier was rejected because Allium specs are LLM-mediated text; there's nothing concurrent or load-bearing to test in this repo. A "type-check the JS" tier was rejected because the JS surface is small enough that `node --check` and the existing test files cover it.

## Major decisions

### Local-only, no new CI workflow

The plan called for `tests/README.md` to document a local-only suite and explicitly avoided wiring everything into CI as part of the initial work. Three reasons:

1. **Suite maturity**. A test suite that's never been used locally tends to ship with brittle assumptions (timing, paths, cleanup). Running locally for a while shakes those out before CI starts amplifying them.
2. **Cost gating**. Tier 3 and Tier 4 cost real money per run. The default offline tiers (Tier 1, 2, `artifact`, `hook`) are CI-safe today; the expensive ones need a manual gate. Wiring CI before that decision is made would produce surprise bills.
3. **Existing CI is fine**. `.github/workflows/check-generated.yml` already runs `scripts/test-skills.mjs`. The orchestrator forwards to that as the `artifact` group, so anything CI catches today, the orchestrator also catches.

Promoting the orchestrator to CI is a follow-up once the suite has been used locally for a while.

### This repo only, not allium-tools

The `allium` CLI lives in a separate repo (`juxt/allium-tools`); this repo is skill prose, hooks, and scripts. Two repos = two test suites. The decision to keep them separate:

- **CLI tests belong with the CLI**. Parser, validator, and analyser tests need to run against the source they exercise. They live with that source.
- **This repo's tests treat the CLI as a black box**. We assert against `allium check` exit codes and stderr patterns; we don't assume anything about how the CLI works internally.
- **Cross-repo coupling is brittle**. If both suites lived together, every CLI patch would need to ship in lockstep with skill changes. The separation lets each repo evolve at its own pace.

### Phasing 1 → 2 → 4 → 3

Tiers landed in order 1, 2, 4, 3 (not the natural 1, 2, 3, 4). Reasons:

- Tier 1 first because it's the foundation; every other tier reuses its `lib/`.
- Tier 2 second because it reuses Tier 1's `allium-cli.mjs` directly and catches drift in canonical docs immediately.
- Tier 4 before Tier 3 because Tier 4's `claude -p` invocation pattern is identical to Tier 3's, so building it first proved the harness end-to-end. Tier 3 then reused the same machinery for single-skill scenarios. (Mid-flight the order swapped — Tier 3 actually landed before Tier 4 — but the reasoning above guided the design across both.)
- Tier 3 last because it's the highest-effort tier (judge harness, rubric authoring) and benefits from the fixture corpus that earlier tiers built.

### Custom Node runner for Tier 3, not Waza or Inspect AI

The original plan picked **microsoft/waza** as the Tier 3 framework on the assumption it could load Claude Code skills and run them. Closer reading of the docs revealed Waza only supports two executors — `mock` and `copilot-sdk` — and routes everything through GitHub Copilot's SDK. It cannot load this repo's `SKILL.md` files and run them agentically; the closest it does is rubric-grade the *prose* of a SKILL.md, which isn't behavioural validation.

**Inspect AI** (with the `inspect_swe` extension) was the next candidate — it has a `claude_code()` solver and is the most architecturally appropriate framework. It was rejected for two reasons:

1. **Python toolchain.** Adopting it would add a second language toolchain (Python with pip + virtualenv) to a repo that's been deliberately Node-only since before this work. Once added, it would grow (`requirements.txt`, version pinning, CI updates).
2. **Docker sandbox.** The `inspect_swe` example pins `sandbox="docker"`, and non-Docker sandbox modes aren't documented for it. Requiring Docker on every developer machine just to run ~10 scenarios is disproportionate.

The custom Node runner is **~150 LOC** total across `tests/lib/claude.mjs` and `tests/lib/judge.mjs`. It subprocesses `claude -p '<prompt>'` with the workspace as cwd (skills load via `--plugin-dir <repo-root>`), then a second `claude -p` call against a markdown rubric scores the result. It has no observability beyond stdout, no transcript replay, no multi-model comparison — and that's fine. If Tier 3 grows past ~30 scenarios or we feel the lack of observability, the scenarios are JSON; migrating to Inspect AI later is mechanical.

### Node fixture for Tier 4, not Python

The original plan picked Python (FastAPI todo app). Two reasons originally favoured it: smaller idiomatic web app size, and `skills/impact/adapters/python.md` being the most mature impact adapter. Both arguments weakened during the work:

1. **Impact map went opt-in** in commit `58e9f71`. Tier 4 default mode doesn't invoke the impact skill at all. The "Python adapter is most mature" argument is moot.
2. **Repo style consistency**. Everything else in the repo (hooks, scripts, lib) is plain Node ESM with no `package.json`. A Python fixture would mean `requirements.txt`, `python -m venv`, and a documented Python install requirement for any developer who wants to write a new fixture or scenario.

Node fixture is `tests/fixtures/e2e/node-todo/starting-state/` — vanilla JS (`models.js` / `service.js` / `routes.js` / `server.js`), no `package.json`, no build step, no deps beyond `node:http`. Distill reads source files; nothing actually executes the fixture during a Tier 4 run.

The TypeScript adapter is available if a future scenario wants impact-map-mode runs.

### No package.json

The repo has no top-level `package.json` and the test suite preserves that. Tests are plain `node tests/tierN.mjs` scripts, helpers are ESM imports, the only "framework" is `tests/lib/reporter.mjs` (a 30-line pass/fail/skip counter modelled on the existing `scripts/test-skills.mjs`).

This is a deliberate design choice in the wider repo, not an oversight. Adding a `package.json` introduces:

- A `node_modules/` directory to gitignore
- A `package-lock.json` to keep consistent across machines
- An `npm install` step before tests can run
- A surface for transitive-dependency vulnerabilities

For a repo whose purpose is to ship prompt content and a few small scripts, the cost outweighs the benefit. Test runners that genuinely need npm packages can be added later via a fixture-local `package.json` (the `node-todo` fixture would qualify if scenarios needed to actually run the server, which they don't).

### Dual snapshot for Tier 4 (text + model)

Tier 4 snapshots every produced file in two ways and passes if either matches:

- **Text snapshot** — normalised raw text. Catches everything (rules, surfaces, comments, formatting) but is flake-prone when the LLM reorders declarations or rephrases prose.
- **Model snapshot** — JSON from `allium model <file>`. Cosmetic variation (whitespace, comment phrasing, declaration order) collapses to identical structure.

The "either matches" semantic is genuinely permissive — it accepts a run where the LLM produced cosmetically-different text as long as the structural model is identical. This is the right trade-off given:

- LLM output for spec generation has well-known cosmetic variation
- Structural correctness (what the spec actually says) is what we care about
- Pure text snapshots without this safety net would flake every other run, eroding trust in the suite

The current limitation: `allium model` in 3.0.4 only emits entity-level structure. Rules, surfaces, contracts, and invariants don't appear in the model JSON, so changes to those constructs always need to clear the text-snapshot bar. This will improve as `allium model` matures; the dual semantic is forward-compatible.

### Tier 2 overrides instead of in-place fixes

Tier 2 found 10 currently-failing blocks in `skills/allium/references/patterns.md` on its first run. They're library-style pattern fragments (e.g. `soft-delete.allium` references a `User` entity the consumer is expected to define) or canonical docs with status enums whose reachability rules don't appear in the example. None are regressions in this work — they're pre-existing documentation conventions.

Two ways to handle them:

1. **Edit `patterns.md` in place** to add `<!-- allium-test: skip ... -->` HTML comments above each fence. Inline, contextual, but adds visual noise to canonical reference docs.
2. **Out-of-line `tests/fixtures/docs/overrides.json`** keyed by file:line. Keeps `patterns.md` clean. Trade-off: when a block moves (e.g. someone reorders examples), the line number breaks and the block silently re-enters the validation default.

Option 2 was chosen because:

- Canonical reference docs should stay free of test-tooling artefacts
- The line-number fragility surfaces as a fail (block re-validated, fails clean), not a silent skip — so it self-heals into a visible signal
- Each override entry has a `reason` field that catalogues the underlying issue, making the debt easy to scan
- Removing an override entry is the natural workflow when the underlying block is brought clean

In-line annotations remain available for fixtures we own, where adding test-tooling comments to the markdown source is appropriate.

## Things that are deliberately *not* in the suite

- **A snapshot of every SKILL.md as text.** SKILL.md files are prose; their value is the agent's behaviour when reading them, which Tier 3 actually measures. A text snapshot would just pin the wording.
- **Mocking `claude` for offline LLM behavioural tests.** Mocked LLM responses test the mock, not the model. Tier 3 is genuinely live or it's not a behavioural test.
- **A `package.json` to enable `npm test`.** See [No package.json](#no-packagejson). The orchestrator's `node scripts/test.mjs` is one keystroke shorter than `npm test` anyway.
- **Per-tier coverage thresholds.** Tier 1's fixture corpus is grown organically (one fixture per language feature you actually want to assert about); a coverage percentage would invite gaming. Tier 2's coverage is "every Allium block in `skills/`" with overrides for known exceptions — already an exhaustive metric.
- **Property-based testing of the Allium grammar.** That belongs with the parser in `juxt/allium-tools`. This repo treats the grammar as fixed.

## When to revisit these decisions

- **Local-only stance** — once the suite has been used for a release cycle and the cheap tiers are stable, promote them to CI. Keep Tier 3 and Tier 4 manual unless the CI provider supports cost gating.
- **Custom Node runner** — if Tier 3 grows past ~30 scenarios or you find yourself reinventing observability, evaluate Inspect AI again. The scenarios are already JSON; migration is mechanical.
- **Node-only repo** — if a fixture or scenario needs a Python or Rust toolchain to be useful (e.g. a Tier 4 scenario distilling a Rust codebase), add the toolchain at the *fixture* level, not the repo level. The Python fixture would have its own `requirements.txt`; the repo's testing infrastructure stays Node.
- **Dual snapshot** — once `allium model` covers rules and surfaces, consider tightening to "model match required, text match informational". The current "either matches" was a flake-tolerance choice, not a principle.
- **Tier 2 overrides** — every override entry catalogues an existing piece of documentation drift. The right long-term answer for the library-style patterns in `patterns.md` is probably a "wrap" template mechanism (planned but not built). Once that lands, library-pattern fixtures graduate from `skip` overrides to `wrap` annotations.
