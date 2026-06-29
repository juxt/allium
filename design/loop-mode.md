# Loop mode (`/allium:loop`) — design note

> **Status: MVP built** — implemented as the `loop` skill (`skills/loop/SKILL.md`); Layer 1 (in-session) only. Living document — update as the design evolves.
> **Lifecycle:** internal design note, not user-facing. To be retired when `/allium:loop` ships — its content graduates into the skill itself and the recommended-loops reference. Keep it out of the user-facing vendored plugin until then (split onto its own branch, or exclude `design/` from the marketplace sync, before any release that would otherwise ship it).
> Companion to the shipped [recommended loops](../skills/allium/references/recommended-loops.md) reference, which documents the loop *pattern*. This note designs a skill that *drives* it.
> **Reviewers:** to run `/allium:loop` from this branch on your own machine, follow [Trying loop mode locally](./loop-mode-local-testing.md).

## 1. Purpose

Drive the Allium loop — gather context → take action → verify → repeat — to convergence on a stated goal, with a trustworthy (behavioural) verification signal and safe termination. Allium already owns the two hardest ingredients of a trustworthy autonomous loop: **durable context** (the spec persists) and a **behavioural verification signal** (`propagate` tests + `weed` + CLI checks trace back to intent, not to the agent's own output). Loop mode packages those into a driver.

## 2. Two layers (substrate-agnostic by design)

- **Layer 1 — in-session procedure.** `/allium:loop` is a skill the agent follows within a single session, iterating by calling tools until convergence or a cap. Needs nothing special from the harness; portable across all skills-capable editors. This is the foundation and the MVP.
- **Layer 2 — unattended re-invocation.** A harness primitive (a self-paced `/loop`, cron, a background agent, a Ralph-style `while` script) re-fires the *same* skill across sessions/time until the goal is met. The substrate is editor-specific; Allium plugs into it rather than reimplementing it.

The skill is designed so the identical procedure serves both: run once and it self-iterates in-session; re-fire it and it resumes from the ledger (§10). Full autonomy is the destination; Layer 1 is how we get there portably.

## 3. Invocation

- `/allium:loop <goal>` — e.g. `/allium:loop add gift cards to checkout`.
- Optional: entry-point override (`from-intent` | `from-code`), iteration cap, target area/scope.
- No goal → infer from context or ask one question.

## 4. Entry-point detection — announce, then proceed

Choose the starting mode from project state **and goal intent**, then **announce the chosen path in one line (naming the override) and proceed — no blocking confirmation.** The user can interrupt and redirect; an explicit entry argument (e.g. `/allium:loop distill <area>`) skips detection.

- No spec, no code → **spec-first** (`elicit`).
- No spec, code present, goal captures/verifies existing behaviour → **code-first** (`distill`).
- No spec, code present, goal adds **new** behaviour → **spec-first** (`elicit`) — distilling would capture what exists, not what you're adding.
- Spec present, goal **changes** behaviour → **tend**, then continue the loop.
- Spec present, code may have **drifted** → **weed**-first.

State answers "spec? code?"; **intent** answers capture-vs-add and change-vs-reconcile — both matter, so read the goal, not just the file tree. The announce-and-proceed applies to the *entry path only*; genuine blocking open questions still pause and escalate (§7).

## 5. The tick (one iteration)

1. **Gather/refresh context** — elicit/distill/tend, *only if* the spec needs to change this tick (each may be an inner loop; see §6).
2. **Act** — `propagate` (if spec changed) → **red-check** new tests → implement.
3. **Verify** — run the project's test command; `weed`; `allium check`/`analyse`. Executed and parsed, never narrated.
4. **Evaluate** the convergence invariant: tests pass ∧ weed clean ∧ no open questions (or only parked, non-blocking ones; §7) ∧ (code-first) distill finds nothing new.
5. **Route the fix** — test fails → fix code; test wrong → tend spec + re-propagate; weed says spec wrong → tend; open question → classify and handle (§7).
6. **Record state** — one-line ledger entry: `tick n · tests x/y · weed: clean/dirty · openQ: blocking k / parked m`.

## 6. Nested loops (inner loops within phases)

The outer convergence loop is **not flat** — several phases are themselves loops, each with its own local exit condition that must be met before the outer loop advances. The design (and eventually the skill) must explicitly model loops-within-loops; treating a phase as a single atomic call is wrong.

- **Elicitation inner loop (`/elicit:loop`)** — question ↔ user answer until the model judges the spec covers the edge cases ("I have enough to specify this"). This is the gather-context phase's inner loop, and it **front-loads structural decisions** before any code is written.
- **Distillation** — multi-pass (Ralph-style) until a pass surfaces nothing new.
- **TDD inner loop** — implement ↔ run tests until green.
- **Weed/verify clarification** — may spawn its own small clarification loop.

The ledger (§10) records which inner loop is active so an unattended resume (§2, Layer 2) re-enters at the right place.

## 7. Open questions: scheduling & escalation

**The tension.** Maximal autonomy says: do everything you can on your own and **park** open questions to batch at the end (fewer interruptions — our goal). But a late answer can **change direction** and make completed work throwaway. Neither "always ask now" nor "always defer" is right.

**Resolution — classify, don't pick a single policy.**

- **Blocking / direction-changing** — the answer reshapes the spec, and therefore the tests and code. → **Escalate eagerly**, before doing dependent work. Deferring these is what creates throwaway.
- **Non-blocking / peripheral** — doesn't affect what's already built or what's next. → **Park** in the spec's `open questions` section + the ledger, and batch at the end. This is where deferring is safe and buys autonomy.

**Decision rule:** a question is *blocking* iff the next unit of work depends on its answer (proceeding would require assuming one). The loop does all work independent of unresolved questions, and escalates a question only when it gates further independent progress.

**Minimise throwaway when proceeding past a parked question:**
- Log the assumption explicitly (in the spec / ledger).
- Prefer **cheap-to-revise** work; defer expensive or irreversible work that hangs off an unresolved structural question.

**Natural front-loading.** Elicit's inner loop (§6) already resolves the structural questions up front, so in spec-first the direction-changers are largely settled before propagate/implement. Park-and-batch then mostly applies to the smaller questions that surface later during distill, weed or verify — which is exactly the safe case.

## 8. Verification harness (load-bearing)

- **Discover the test command** — reuse `propagate`'s discovery checklist (framework, runner, test paths). Unknown → ask once.
- **CLI presence** — needs `allium` on PATH for structural checks. Absent → run with a reduced signal and *say so* (this is why the first-run install notice matters).
- If verification can't actually run, the loop **degrades loudly to assisted mode** — it never narrates a pass it didn't execute.

## 9. Stop conditions & safety

- **Hard cap** — default **6** iterations.
- **No-progress cap** — default **2** ticks with no measurable change (test pass count, weed verdict, open-question count). Catches thrashing against a test it can't satisfy.
- **Escalate on blocking open question** (§7).
- **Anti-cheat (non-negotiable)** — never edit a generated test to pass; a wrong-looking test means tend the spec + re-propagate, logged.
- Honour `config` (no magic numbers); decompose a too-big goal into sub-goals rather than blowing the context budget (§12).

## 10. State & resumability (ledger)

- The **loop ledger lives in a dotfile** (e.g. `.allium-loop/<goal-slug>.json`): goal, mode, tick count, active inner loop, last verdicts, and parked (non-blocking) open questions. Blocking questions are escalated, not parked.
- The ledger is what makes the same skill resumable unattended (§2, Layer 2): a fresh context reads it and continues idempotently.
- The ledger dir `.allium-loop/` is **git-ignored** — transient, per-developer, per-run state (like a build artefact), not shared source; same reasoning as the install-notice marker. Mechanics: resolve the repo root with `git rev-parse --show-toplevel` (**not a git repo → skip**, don't create a `.gitignore`); ensure `.allium-loop/` is ignored at that root — create `.gitignore` if absent, append if missing, **no-op if already ignored** (check `git check-ignore` first so global excludes or existing entries aren't duplicated); in a monorepo or worktree use the nearest enclosing project root. **Best-effort**: if `.gitignore` can't be written, continue (the ledger still works locally) and say so. Mention the change once; don't prompt.

## 11. Output / reporting

- Per-phase one-line marker as each phase begins (e.g. `→ Verify: tests → weed → allium check`) so the run stays legible; the harness shows the underlying commands, so don't narrate every command — just the phase boundaries.
- Per-tick one-line state summary.
- Final report: what converged, what was escalated, residual parked questions, test/weed status.

## 12. Decomposition & roll-up

A goal too big for one tick is split into sub-goals, each run as its own loop (with its own delegated, context-isolated phases per §13). Decomposition follows Allium's own structural seams rather than arbitrary task slicing:

- **Unit** — one sub-goal per **entity lifecycle**, **surface**, or **independent rule / data-flow chain**. The spec defines the seams; `allium plan`/`analyse` enumerate obligations per construct.
- **Ordering** — topological by the spec's **data-flow / trigger graph**: producers before consumers (the same graph `propagate` uses for data-flow and cross-module tests).
- **When to split** — when the goal spans more than one independent behavioural slice. Judgment guided by the seams, not a magic obligation count.
- **Integration pass** — per-slice convergence is not enough: decomposing by entity splits cross-entity processes and data-flow chains. After the slices converge, run a **whole-spec integration pass** — the cross-entity / data-flow / reachability tests plus a full `weed` — so the seams *between* slices converge too.
- **Roll-up** — each sub-goal loop returns a structured mini-report (converged? tests, escalations, residual parked questions). The orchestrator aggregates into one final summary: per-slice status, totals, consolidated and deduped parked questions, overall convergence. The ledger records which sub-goals are done, so an unattended resume skips completed ones.

## 13. Decisions

- **Ledger** — dotfile `.allium-loop/<goal-slug>.json`, git-ignored (§10).
- **No auto-commit** — loop mode never commits on its own; it leaves the working tree for the user (who can always instruct the agent to commit). Committing is a user prerogative with too many valid styles to default.
- **Orchestration: delegate, don't inline** — loop *delegates* each phase to the existing skills/agents rather than re-implementing them. This is DRY (phase logic stays in one place), more agentic (an orchestrator over sub-agents — the trees-of-agents pattern), and — because `tend`/`weed` already run in their own context — delegation provides **context isolation**: the orchestrator holds only the ledger + convergence state while each phase runs in a clean context, which is what lets a long loop stay within budget. The shared interface between phases is the on-disk artefacts (spec, tests, code) plus the ledger. *Implication:* every phase should be spawnable as an isolated sub-agent — today only `tend`/`weed` are agents, so `elicit`/`distill`/`propagate` would need to be agent-invocable (or loop spawns a generic sub-agent that loads the relevant skill).
- **Interactive phases — worker/orchestrator split.** `propagate` is non-interactive and runs as a plain isolated worker. `elicit` and `distill` are human-in-the-loop (they need the user's judgment on intent), so split each into: (a) the existing **user-facing interactive skill** (unchanged, main context), and (b) an **internal isolated worker** the loop spawns. The worker does all autonomous work in its own context and **returns its open questions** instead of conversing; the **orchestrator** (main context) escalates the blocking ones (§7), writes the answers into the spec/ledger, and **re-spawns the worker** with a fresh context that reads the updated spec. The inner elicitation loop (§6) thus runs *orchestrator ↔ user* with a stateless worker re-spawned each round — preserving interactivity, keeping the context-isolation budget win, and fitting the artefacts+ledger-only interface. Workers are kept **loop-internal by convention** — not registered as user skills, absent from the routing table, no `/command` or auto-trigger, described as internal. *Caveat:* this is discoverability, not a permission boundary — the skill/agent model has no per-caller ACL, so a determined user could still invoke a worker; it is simply not surfaced.
- **Auto-decompose, summarise at the end** — a goal too big for one tick is decomposed into sub-goals and run autonomously (no blocking to confirm a plan), with a single consolidated summary at the very end. Blocking open questions still escalate mid-run per §7.
- **Caps: defaults, overridable** — sensible fixed defaults (hard cap 6, no-progress 2; §9), overridable per-invocation (flags) and via a `config` block.
- **Interface: artefacts + ledger only** — phases share state *exclusively* through on-disk artefacts (spec, tests, code) and the ledger; nothing essential passes only in memory. This is what guarantees context isolation and Layer-2 resumability — anything not reconstructable from disk would break an unattended restart. Derived data (`allium plan`/`model` JSON) is regenerable from the spec, so it is at most *cached* in `.allium-loop/`, never a separate source of truth. A sub-agent may *return* a structured result for immediate orchestration, but it must also be written to the ledger — the return value is a convenience, never the source of truth.

**Still open:** none outstanding from review. Revisit when building the skill — likely the ledger JSON schema and exact decomposition thresholds.

## 14. Out of scope / risks

- **Out of scope (for the MVP):** building an Allium-owned scheduler/runner for Layer 2 — lean on the harness.
- **Risks:** verification not runnable (degrade loudly); context limits on large goals (decompose); cheating toward green (anti-cheat rule); runaway cost (caps); throwaway from deferred structural questions (classification, §7).
