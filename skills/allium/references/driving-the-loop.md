# Driving the loop

This reference is the procedure `/allium` follows when you hand it a goal: it drives the Allium loop to convergence on your behalf. For the conceptual model and worked walkthroughs, see [recommended loops](./recommended-loops.md).

Drive a goal to convergence by running the Allium loop yourself: **gather context → take action → verify → repeat**, until the spec, tests and code agree. You orchestrate; each phase is an existing skill (`elicit`, `distill`, `propagate`, `tend`, `weed`) plus ordinary implementation. What makes the loop trustworthy is the verification signal — you stop when behaviour is proven against intent, not when the code merely runs.

## 1. Detect the entry point — announce, then proceed

Choose the starting mode from the project state **and the goal's intent**, then **announce the chosen path in one line, name the override, and proceed — do not wait for confirmation.** The user can interrupt and redirect if it's wrong; the entry choice is not a gate.

- No spec and no code → **spec-first**: start with `elicit`.
- No spec, code exists, goal captures/verifies existing behaviour → **code-first**: start with `distill`.
- No spec, code exists, goal adds **new** behaviour → **spec-first**: `elicit` the new behaviour (don't distill — distilling captures what's there, not what you're adding).
- Spec exists, goal **changes** behaviour → start with `tend`.
- Spec exists, code may have **drifted** from it → start with `weed`.

State answers "is there a spec / code?"; the **goal's intent** answers capture-vs-add (`distill` vs `elicit`) and change-vs-reconcile (`tend` vs `weed`) — so read the goal, not just the file tree. If the user gives an explicit entry (`/allium distill <area>`, or just "tend the spec"), use it and skip detection.

Announce like: *"No spec here, code present, goal reads as new behaviour → starting with elicit. (Say 'distill' or 'tend' to switch.)"* This announce-and-proceed applies to the **entry path only** — genuine blocking open questions still pause and escalate (§5).

## 2. Run the loop (one tick)

Announce each phase as it begins with a one-line marker (shown in parentheses below) so the run stays legible across ticks. Let the harness show the underlying commands — don't narrate every command, just the phase boundaries.

1. **Gather context** *(`→ Gather: elicit/distill/tend the spec`)* — run the entry skill (or `tend`) only if the spec needs to change this tick. Treat elicitation as an *inner loop*: keep asking the user questions until the spec covers the edge cases, then continue. Distillation may take several passes. The spec is CLI-checked on every edit (the hook / LSP run `allium check`); **resolve any reported issues before propagating** — tests are generated from the spec, so it must be valid first.
2. **Take action** *(`→ Act: propagate tests, then implement`)* — `propagate` to (re)generate tests when the spec changed, then implement.
   - **Spec-first: confirm the new tests FAIL before implementing.** A generated test that is already green is already covered (reference it, don't duplicate) or vacuous (fix the spec or test).
   - Never edit a generated test to make it pass.
3. **Verify** *(`→ Verify: run tests → weed → allium analyse`)* — actually run it: the project's test command, then `weed` for spec↔code alignment, then `allium analyse` for semantic gaps (dead ends, unreachable states). The spec's *structure* is already validated on every edit (§2.1), so verify adds the behavioural checks: tests, drift, and semantic analysis. Parse the results; never narrate a pass you didn't execute.
4. **Route the outcome:**
   - test fails → fix the code;
   - a test is wrong → `tend` the spec, then `propagate` again;
   - `weed` says the spec is wrong → `tend` the spec;
   - open question → classify and handle (§5).
5. **Record state** in the ledger (§8), **append a trace entry** for the tick (§13), and print a one-line summary: `tick n · tests x/y · weed clean/dirty · openQ blocking k / parked m`. If the trace shows the run has stopped making progress, say so out loud this tick (§13) — don't wait for the cap.

## 3. Convergence (when to stop)

Stop when **all** hold:

- tests pass,
- `weed` reports no divergence,
- no blocking open questions remain (only parked, non-blocking ones),
- (code-first) a fresh `distill` pass finds nothing new,
- the **witness** attests convergence: an independent `witness` pass returns `PASS` (§11).

The first four are the run's own reading of its state; the witness re-derives them from ground truth and confirms nothing was falsified on the way to green. Convergence is declared on the witness's verdict, not the run's self-report.

## 4. Stop conditions & safety

- **Hard cap** — stop after **6** iterations.
- **No-progress cap** — stop after **2** iterations with no change in tests / weed verdict / open-question count (catches thrashing against a test you can't satisfy).
- **Surface the stall early** — don't let a flattening run grind to that cap in silence. The trace (§13) shows the trajectory each tick; the moment a tick makes no progress, say so out loud. The cap is the backstop, not the first sign.
- **Escalate** on a blocking open question (§5).
- **Anti-cheat (non-negotiable, and witnessed)** — never weaken or edit a generated test to pass; honour `config` (no magic numbers in code the spec parameterises). This is not left to good behaviour: the witness (§11) re-derives it from ground truth — a generated test whose recorded hash changed with no intervening `propagate` fails the witness and blocks convergence.
- On hitting a cap or an unrecoverable error, **stop and report** — don't spin.

Caps default to 6 / 2 and may be overridden per invocation or via a `config` block.

## 5. Open questions: park or escalate

Classify every question the loop surfaces:

- **Blocking / direction-changing** — the answer reshapes the spec, and therefore the tests and code. → **Escalate to the user now**, before doing dependent work. Deferring these creates throwaway.
- **Non-blocking / peripheral** — doesn't affect what's already built or what's next. → **Park** it (spec `open questions` section + ledger) and continue; batch all parked questions into the final report.

Rule: a question is *blocking* iff the next unit of work depends on its answer. Do everything independent of unresolved questions first. If you must proceed past a parked question, log the assumption and prefer cheap-to-revise work — never expensive or irreversible work that hangs off an unresolved structural question.

## 6. Large goals: decompose, then integrate

If the goal spans more than one independent behavioural slice, decompose along the spec's seams — one sub-goal per **entity lifecycle**, **surface**, or **independent rule / data-flow chain**. Order sub-goals topologically by the data-flow / trigger graph (producers before consumers). Run each sub-goal as its own loop, and witness each slice at its own convergence gate (§11) before you count it converged, so a falsified slice cannot be assembled into the whole.

After the slices converge, run a **whole-spec integration pass** — cross-entity / data-flow / reachability tests plus a full `weed`, and a final `witness` over the assembled spec — so the seams *between* slices converge too. Run this autonomously without blocking to confirm the plan, and produce one consolidated summary at the end.

## 7. Delegate each phase to an isolated sub-agent (default)

By default, run each phase as an isolated sub-agent — `distill`, `weed`, `tend`, `propagate` and `witness` all ship as agents — and keep this orchestrator **thin**: it holds only the loop state (goal, ledger, current verdicts) and **reads no source files itself**. Hand each phase only what it needs to find its own inputs on disk — the spec's path and the ledger, never code you have read into your own context. Each phase reads the spec and the code it needs in *its own* fresh context and returns a **typed result record** — a JSON object conforming to that phase's schema (§12), not prose. That record is all you carry forward. The shared interface between phases is the on-disk artefacts (spec, tests, code) plus the ledger — never in-memory state.

This is what keeps a long or large run within budget: the orchestrator's context stays flat (loop state only) while each phase's reading is bounded to that phase and then discarded. An inline run, by contrast, accumulates every phase's reads into one context that grows tick over tick until it is slow, expensive, or overflows the window.

**When to run inline instead.** Delegation has a fixed per-phase cost — each sub-agent starts cold and loads its runbook. For a *small* scope (a single file or a few hundred lines, one entity, a spec that sits comfortably in context) that overhead outweighs the saving, so run the phases inline in your own context. Switch to delegation when the scope is large, the loop will run several ticks, or you are already carrying a lot of context. Rule of thumb: **if reading the whole in-scope surface once would dominate your context, delegate; otherwise inline is cheaper.** When you delegate, invoke each phase by its agent name (`allium:distill`, `allium:weed`, `allium:tend`, `allium:propagate`, `allium:witness`) so the routing is deterministic rather than left to description-matching.

## 8. The ledger

Keep loop state in `.allium-loop/<goal-slug>.json`: goal, mode, tick count, active inner loop, last verdicts, completed sub-goals, and parked (non-blocking) open questions. This makes the loop resumable — a fresh run reads it and continues where it left off.

The ledger is itself typed — it conforms to [ledger.schema.json](./schemas/ledger.schema.json), so a resuming run reads structured state rather than re-parsing prose. It also carries the evidence the witness (§11) re-derives convergence from, so record it as the phases produce it: `generated_test_hashes` (a content hash per generated test file, written by `propagate`) and the `reconciliation` line, the recorded `weed` verdict, and — for spec-first — the red-before-green observations per new test. The witness reads these; it does not take them on trust, but it needs them to exist. The witness writes its own artefact alongside the ledger, `.allium-loop/<goal-slug>.witness.json` — the durable convergence record, keep it out of git the same way. The run trace (§13) lives beside them at `.allium-loop/<goal-slug>.trace.jsonl`; ignore it the same way.

Git-ignore it: resolve the repo root (`git rev-parse --show-toplevel`; skip if not a git repo), then ensure `.allium-loop/` is ignored there — create `.gitignore` if absent, append if missing, no-op if already ignored (`git check-ignore` first). Best-effort: if it can't be written, continue and say so. Mention it once; don't prompt.

## 9. Verification must be real

The loop is only as good as its verification. Discover the project's test command (framework, runner, test paths — reuse the `propagate` discovery checklist). If the `allium` CLI is not on PATH, run with the reduced signal you have and say so. If verification cannot actually run, **degrade loudly to assisted mode** — tell the user; never claim a pass you did not execute.

## 10. Report

End with: what converged, per–sub-goal status, tests and weed verdict, the witness verdict and its record path, anything escalated, all parked questions consolidated, and the run's **trajectory** from the trace (§13) — how the metrics moved tick over tick, and any stall that was surfaced.

## 11. Witness the convergence (the gate)

The loop's phases run inside isolated sub-agents (§7) and report their results as prose the orchestrator cannot see behind. Left there, convergence would rest on the actor's own word that tests pass, no test was weakened, and no blocking question was quietly parked. The **witness** closes that gap: at the convergence gate, spawn the `allium:witness` agent to re-derive the claim from ground truth and gate convergence on *its* verdict.

The witness is independent and **deterministic** — it re-runs the cheap, deterministic tools (the test command, `allium check`/`analyse`, file hashing, `grep`) and reads the machine output the phases already emitted; it does **not** re-run the model-heavy phases (`propagate`, `distill`, `weed` reasoning). That is what keeps it to one light pass per converged run rather than a second loop. It checks: tests genuinely pass (the runner's exit status, not the reported count); no generated test's hash changed without a `propagate` (the anti-cheat rule of §4, enforced); coverage has no unexplained gap; the `weed` verdict matches the claim; no blocking question was downgraded; and — best-effort — red-before-green held. Its verdict and evidence land in `.allium-loop/<goal-slug>.witness.json`.

- **PASS** → convergence is real; stop and report (§10).
- **FAIL** → route each violation to the phase that fixes it (edited test → revert + `propagate`; claimed-pass-but-failing → implement; downgraded question → escalate; unexplained coverage gap → `propagate`) and continue the loop. The witness never fixes anything itself.
- **INCONCLUSIVE** (no evidence to witness — e.g. verification could not run, §9) → do not declare convergence; degrade loudly.

Run the witness at the convergence gate, not every tick — the phases already verify each tick; the witness confirms the *final* claim (and each slice's claim, §6). On a small inline scope where you ran the phases in your own context, you may witness inline too; the checks are the same, only the isolation differs.

## 12. Typed hand-offs and routing

Each phase returns a **typed result record**, not prose — a JSON object conforming to that phase's schema in [`schemas/`](./schemas/). Prose has to be *interpreted*; a typed record is *parsed*, so the loop routes and decides convergence as a deterministic function of fields rather than a read of a summary. The phases stay probabilistic inside; the control flow around them does not.

The schemas: [`distill`](./schemas/distill-result.schema.json), [`weed`](./schemas/weed-result.schema.json), [`tend`](./schemas/tend-result.schema.json), [`propagate`](./schemas/propagate-result.schema.json), [`witness`](./schemas/witness-result.schema.json), and the [`ledger`](./schemas/ledger.schema.json). Each record carries a one-line `summary` for the human report, with the decision-bearing detail in structured fields. (Interactively, the skills still speak prose — the typed record is the machine hand-off, not the conversation.)

**Routing** is a lookup on those fields, not a judgement:

| Field | Route |
|---|---|
| `weed.verdict = clean` | no divergence; proceed |
| `weed.divergences[].classification = spec-bug` | `tend` the spec, then `propagate` |
| `weed.divergences[].classification = code-bug` | fix the code |
| `weed.divergences[].classification = aspirational` \| `intentional-gap` | leave both; note it |
| `propagate.uncovered_obligations` non-empty | not converged; back to `propagate` (or escalate if `infrastructure-gap`) |
| `tend.open_questions` / `distill.open_questions` non-empty | classify each (§5): blocking → escalate, else park |
| `witness.verdict = FAIL` | route each `violation` by its `routing` field (§11) |
| any record fails schema validation | reject the hand-off; the phase must re-emit — a malformed record is never treated as a result |

**Convergence** is the boolean over the typed fields: `tests.failed = 0` ∧ `weed.verdict = clean` ∧ no blocking open questions ∧ `propagate.uncovered_obligations` empty ∧ (code-first) a fresh `distill` finds nothing new ∧ `witness.verdict = PASS`. When every conjunct reads from a field, "are we done" stops being a vibe and becomes an evaluation.

## 13. Trace the run (observability)

A long autonomous run can fail without failing. Nothing errors, but the loop stops converging — tests stick, `weed` stays dirty, obligations don't shrink — and it grinds tick after tick until a cap trips. The trace makes that visible while it is happening instead of after.

**Append one entry per tick.** After recording state (§2 step 5), append a line to `.allium-loop/<goal-slug>.trace.jsonl` conforming to [trace-entry.schema.json](./schemas/trace-entry.schema.json): the tick number, the `phases` run **and why each was chosen** (the routing decision, so a wrong or repeatedly ineffective call is visible), the tick's `tests` (passed / failed), `weed` verdict, `uncovered_obligations`, and blocking / parked `open_questions`. These come straight from the phases' typed records (§12) — you already hold them, so this is bookkeeping, not new work. Carry a metric forward when its phase didn't run this tick.

**Which calls, and were they the right ones.** Recording the phase *and its reason* each tick, next to whether that tick made progress, makes the routing auditable: a phase that keeps running and never moves a metric is a wrong or wasted call, and now it shows in the trace rather than hiding in a long run. This is the routing half of the telemetry, and the orchestrator records it directly — it knows which subagent it chose and why.

**Real per-call timing comes from the hook, not from you.** A subagent call isn't a Bash call you can wrap in `date`, and you can't read your own latency, so precise timing is captured outside the model: the `loop-trace` hook stamps each subagent call's start and end and appends `{agent, duration_ms}` to `.allium-loop/timings.jsonl`. When that file is present, fold its durations into the trace (`durations_s`) and the end report. Where hooks don't run, there is simply no wall-clock — the trajectory and routing above still stand. Don't hand-time calls yourself; trust the hook or omit timing.

**Watch the trajectory.** A tick makes **progress** if any convergence metric improved: fewer failing tests, `weed` went dirty → clean, fewer uncovered obligations, or fewer blocking questions. A tick with none of those, while not yet converged, is a **no-progress tick**.

**Surface a stall out loud.** The moment a no-progress tick lands, say so in the run output — name what is stuck and for how long:

```
⚠ tick 4 · no progress — tests stuck at 5/10 for 2 ticks, weed still dirty, 3 uncovered
```

This is the whole point: the silent slow-down becomes a line you cannot miss. Keep surfacing it each further flat tick; the no-progress cap (§4) is the backstop that finally stops the run, not the first signal. The threshold for the first warning is `config.stall_warning_ticks` (default **1**, so the first flat tick warns); raise it in a `config` block if a run is legitimately slow and the early warning is noise.

**The rule is simple on purpose.** Deciding "did any metric improve across the last N ticks" is counting over a short log, so the orchestrator applies it directly — no tool required, nothing to install. The same rule is pinned as a deterministic function in the test suite (`detectStall`) so it can't drift, and so it can later move into a script or the CLI as an accelerator, with the orchestrator as the always-present floor (§ the pattern `allium check` already uses: CLI when present, fall back otherwise).

**Report the trajectory.** At the end (§10), summarise how the metrics moved across the run and call out any stall that was surfaced. A converged run reads as a clean descent to zero; a rescued one shows where it flattened and what unstuck it.
