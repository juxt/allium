# Loop mode (`/allium:loop`) — design note

> **Status: Proposed, not implemented.** Living document — update as the design evolves.
> Companion to the shipped [recommended loops](../skills/allium/references/recommended-loops.md) reference, which documents the loop *pattern*. This note designs a skill that *drives* it.

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

## 4. Entry-point detection (decision tree)

Pick the starting mode; confirm with the user only if ambiguous:

- Spec for the area **absent**, behaviour described → **spec-first** (`elicit`).
- Spec absent, **existing code** in the area → **code-first** (`distill`).
- Spec **present**, requirements changed → **tend**, then continue.
- Spec present, code may have drifted → **weed-first** maintenance loop.

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
- Honour `config` (no magic numbers); decompose a too-big goal into sub-goals rather than blowing the context budget.

## 10. State & resumability (ledger)

- The **loop ledger lives in a dotfile** (e.g. `.allium-loop/<goal-slug>.json`): goal, mode, tick count, active inner loop, last verdicts, and parked (non-blocking) open questions. Blocking questions are escalated, not parked.
- The ledger is what makes the same skill resumable unattended (§2, Layer 2): a fresh context reads it and continues idempotently.
- Open follow-on: should the dotfile be `.gitignore`-d by default? (See §12.1 — mirrors the install-notice marker debate.)

## 11. Output / reporting

- Per-tick one-line state summary.
- Final report: what converged, what was escalated, residual parked questions, test/weed status.

## 12. Open design questions

1. **Ledger dotfile + `.gitignore`** — decided it lives in a dotfile (§10); still to settle whether loop mode offers to gitignore it.
2. **Auto-commit per converged tick**, or leave the working tree to the user?
3. **Relationship to the `tend`/`weed` agents** — does `loop` *call* them, or inline their procedures?
4. **Auto-decompose** large goals vs. surface a plan and ask.
5. **Configurable caps** — flags, a `config` block, or fixed defaults?

## 13. Out of scope / risks

- **Out of scope (for the MVP):** building an Allium-owned scheduler/runner for Layer 2 — lean on the harness.
- **Risks:** verification not runnable (degrade loudly); context limits on large goals (decompose); cheating toward green (anti-cheat rule); runaway cost (caps); throwaway from deferred structural questions (classification, §7).
