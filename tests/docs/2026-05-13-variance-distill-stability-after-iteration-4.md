# Variance assessment: `distill-stability-2026-05-13T15-54-29-533Z` (after iteration 4)

**Scenario:** `distill-stability` (node-todo fixture, `claude-opus-4-7`, pipeline distill → weed → weed → weed → tend, repeat 10).

**Run:** 2026-05-13T15:54:29Z, completed 2026-05-13T16:44:29Z (~50 min wall, concurrency 3).

**Compared against:**
- Original baseline: `distill-stability-2026-05-12T10-39-00-388Z` (see [`2026-05-12-variance-distill-stability.md`](./2026-05-12-variance-distill-stability.md)).
- Iteration 1: `distill-stability-2026-05-12T16-15-17-168Z` (see [`2026-05-12-variance-distill-stability-after-prompt-change.md`](./2026-05-12-variance-distill-stability-after-prompt-change.md)).
- Iteration 2: `distill-stability-2026-05-12T23-52-21-981Z` (see [`2026-05-13-variance-distill-stability-after-iteration-2.md`](./2026-05-13-variance-distill-stability-after-iteration-2.md)).
- Iteration 3: `distill-stability-2026-05-13T12-58-38-134Z` (see [`2026-05-13-variance-distill-stability-after-iteration-3.md`](./2026-05-13-variance-distill-stability-after-iteration-3.md)).

**Changes under test in this iteration (commit `44d5801`):**
- All three skills (distill, weed, tend) and the two agent variants (weed, tend) now say plainly: do **not** rely on `allium check`'s exit code as the validated/done signal — it exits 0 even when warnings and info diagnostics are reported. Read the diagnostics list and address every error, warning, and info entry, or note in the response which were considered acceptable and why.
- A matching item added to distill's "Checklist: Code literalism": `allium check` produces zero diagnostics, OR every warning/info entry is explicitly listed with a one-line rationale.

## Summary

The diagnostic-discipline change is the single largest convergence event in the experiment so far. Five runs produce zero diagnostics from `allium check`. **For the first time, the cluster algorithm reports a substantial cluster — five runs (r01, r02, r03, r04, r07) — plus five singletons.** Previous iterations topped out at one 2-run cluster.

A secondary behavioural shift: nine of ten runs dropped external entities entirely, and ten of ten now use the temporal-trigger form for `ExpireOverdue` (`when: todo: Todo.due_at <= now`) instead of the action-trigger-with-comprehension form. Both shifts trace back to the diagnostic discipline — the previous forms tripped CLI warnings (`missing-source-hint` for unimported external entities; `unreachable-status` because the assignment lived inside a `for ... where` comprehension the reachability check doesn't enter).

A new visible variance axis emerged: `Timestamp when status = X` (declarative, 6 runs) vs `Timestamp?` (optional, 4 runs). This is the contrast highlighted in the previous standalone-spec analysis, now playing out across the full N=10. The two forms interact with the diagnostic discipline differently — declarative form requires the matching `status = X` assignment to appear directly in some rule's `ensures` (which the model satisfies by also choosing the temporal-trigger ExpireOverdue), while the optional form sidesteps the question. Both can produce zero-diagnostic specs.

## What the data shows

### Line counts across the five runs

| Run | Original | Iter 1 | Iter 2 | Iter 3 | Iter 4 |
|-----|----------|--------|--------|--------|--------|
| run-01 | 81 | 126 | 118 | 127 | 129 |
| run-02 | 128 | 118 | 139 | 127 | 115 |
| run-03 | 138 | 124 | 135 | 117 | 123 |
| run-04 | 164 | 99 | 102 | 129 | 129 |
| run-05 | 115 | 127 | 97 | 105 | 115 |
| run-06 | 135 | 131 | 136 | 117 | 120 |
| run-07 | 137 | 132 | 139 | 110 | 129 |
| run-08 | 158 | 110 | 126 | 138 | 105 |
| run-09 | 200 | 116 | 119 | 88 | 118 |
| run-10 | 149 | 100 | 137 | 138 | 129 |
| **min / median / max** | 81 / 138 / 200 | 99 / 121 / 132 | 97 / 131 / 139 | 88 / 122 / 138 | **105 / 122 / 129** |
| **range** | 119 | 33 | 42 | 50 | **24** |

Range reaches a new low of 24 lines — narrower than every prior iteration. Consistent with the strong convergence elsewhere.

### `allium check` diagnostics (the new measurable axis)

| Run | Diagnostics | Severity breakdown |
|-----|-------------|--------------------|
| run-01 | **0** | — |
| run-02 | 3 | 3 info |
| run-03 | **0** | — |
| run-04 | **0** | — |
| run-05 | 4 | 4 info |
| run-06 | 2 | 2 warning |
| run-07 | **0** | — |
| run-08 | 3 | 3 info |
| run-09 | 3 | 3 info |
| run-10 | **0** | — |

**5/10 produce zero diagnostics. 4/10 produce info-only. 1/10 produces warnings. Zero errors.**

The zero-diagnostic specs (r01, r03, r04, r07, r10) are exactly the ones that internalised the discipline — each chose the spec shapes that satisfy every check the CLI runs.

### Pairwise judge verdicts and clustering

| Severity | Original | Iter 1 | Iter 2 | Iter 3 | Iter 4 |
|----------|----------|--------|--------|--------|--------|
| cosmetic | 0 | 0 | 0 | 0 | 0 |
| structural | 0 | 1 | 1 | 1 | **4** |
| semantic | 45 | 44 | 44 | 44 | **41** |

**Cluster A: r01, r02, r03, r04, r07** (5 runs) plus 5 singletons. The cluster algorithm grouped these because they form a connected component under structural-or-cosmetic equivalence. Up from "1 cluster of 2 runs" in iter-2 and iter-3, and from "10 singletons" in the original baseline.

The four structural pairs are r01↔r03, r01↔r07, r02↔r04, r03↔r04 — all within cluster A. The fifth member (r02) joins the cluster transitively (r02 has structural pair to r04, r04 has structural pairs to r01 and r03, r01 has structural pair to r07).

## Per-axis convergence

| Axis | Original | Iter 1 | Iter 2 | Iter 3 | Iter 4 | Source rule |
|------|----------|--------|--------|--------|--------|-------------|
| `due_at` validation | split | 10/10 `>=` | 10/10 `>=` | 10/10 `>=` | **10/10** | iter-1 |
| Title trim presence | split | 9/10 trim | 10/10 | 10/10 | **10/10** | iter-1 + iter-2 |
| Title trim FORM | n/a | n/a | 4 forms | 10/10 `length(trim(t)) > 0` | **10/10** | iter-3 |
| ReviveTodo clears `expired_at` | split | 9/10 | 10/10 | 8/10 | **8/10** | iter-1 |
| `owner_id` field | split | 9/10 | 10/10 | 9/10 | **10/10** | iter-1 |
| `@guidance` count | variable | 0/10 | 0/10 | 0/10 | **0/10** | iter-1 |
| Invariants count | inconsistent | 0/10 | 0/10 | 0/10 | **0/10** | iter-1 |
| Rule naming | mostly consistent | 10/10 | 10/10 | 10/10 | **10/10** | (unchanged) |
| Transitions block | 5/10 | 4/10 | 10/10 | 8/10 | **8/10** | iter-2 |
| Surface count | 6/10 split | 6/10 with 2 | 1/2/3 split | 10/10 with 2 | **10/10 with 2** | iter-3 |
| Config naming | split | n/a | n/a | 10/10 | **10/10** | iter-3 |
| **ExpireOverdue rule shape** | varies | varies | varies | varies | **10/10 temporal trigger** | **iter-4 (indirect: diagnostic discipline)** |
| **External entities used** | yes (mixed) | yes | yes | yes | **9/10 NO** | **iter-4 (indirect)** |
| **Timestamp form** | n/a | n/a | n/a | n/a | **6/10 declarative, 4/10 optional** | (new variance axis) |
| **`allium check` diagnostics** | n/a | n/a | n/a | n/a | **5/10 zero, 4/10 info-only, 1/10 warnings** | iter-4 |
| Surface naming | n/a | dominant TodoMaintenance | 6 second-surface names | 6 second-surface names | **9 second-surface names** ↘ | (still no rule) |

**Direct effects of the iter-4 change:** 5/10 zero-diagnostic specs, plus owner_id moved from 9/10 → 10/10.

**Indirect effects of the iter-4 change** (both driven by the model finding shapes that satisfy `allium check`): 10/10 ExpireOverdue temporal trigger; 9/10 dropped external entities.

## Wins from iteration 4

### `allium check` discipline holds — 5/10 zero diagnostics

Five runs produced specs that pass `allium check` cleanly. The other five all flagged at most a small number of advisory diagnostics (3-4 info or 2 warnings) — never errors.

This confirms the meta-pattern from iterations 1-3: when a rule is named in the closing checklist, the model follows it ~50-90% of the time, and the rule that *also* says "or note why each diagnostic is acceptable" gives the model an explicit escape hatch when the diagnostic genuinely doesn't apply (which it took for the info-only runs).

### Five-run cluster (r01, r02, r03, r04, r07)

Up from the previous iterations' best of one 2-run cluster. The cluster represents a substantial group of behaviourally-equivalent specs that differ only on shape/refactor — a synthesise-skill input set this size is genuinely tractable to merge.

The cluster is essentially "the runs that picked the declarative timestamp form, the temporal-trigger ExpireOverdue, and produced zero or near-zero diagnostics." Inter-cluster member differences are concentrated on:

- minor variations in surface naming and divider style,
- whether the `due_at` parameter on `CreateTodo` is marked optional with `?`,
- ArchiveTodo's `requires` form (positive enumeration vs negated set membership).

### ExpireOverdue rule shape: 10/10 temporal trigger

For the first time, every run wrote `ExpireOverdue` (or `ExpireOverdueTodo`) as a temporal trigger directly on `Todo`:

```
when: todo: Todo.due_at <= now
requires: todo.status = pending
ensures: todo.status = expired
ensures: todo.expired_at = now
```

Previous iterations had three or more variants — temporal trigger, action trigger with for-loop in ensures, action trigger with `provides` invocation in surface. The diagnostic-discipline change pushed all 10 to the same form because the action-trigger-with-comprehension form trips `unreachable-status` (the CLI's reachability check doesn't enter the comprehension to find the assignment).

### External entities: 9/10 dropped

Iter-3 had a mix (some runs declared `external entity Client` and `external entity Operator`, threaded them through every rule and surface). Iter-4 has 9/10 with no external entities at all — slimmer rule signatures (`when: CompleteTodo(todo)` instead of `when: CompleteTodo(client, todo)`), surfaces with `context todo: Todo` instead of `facing client: Client`.

The driver was the `missing-source-hint` warning the CLI emits on un-imported external entities. The model's path of least resistance to a clean check: don't introduce them.

This is closer to the source: the node-todo code has no auth, no notion of distinct clients beyond a string `ownerId`. The single holdout (run-06) declared both entities and got hit with the two warnings.

## Persistent and new variance

### Timestamp form: 6 declarative / 4 optional

The previously-uniform `Timestamp when status = X` choice is now split:

| Form | Runs |
|------|------|
| `Timestamp when status = X` (declarative) | r02, r03, r04, r05, r06, r09 (6) |
| `Timestamp?` (optional) | r01, r07, r08, r10 (4) |

Both can produce zero-diagnostic specs. The declarative form is more informative (it captures the invariant that the timestamp is set iff the status applies) but requires the matching `status = X` assignment to be direct. The optional form is simpler and trivially passes the unreachable-status check.

The distill checklist says to prefer the declarative form. The model is following it ~60% of the time, but the diagnostic-discipline rule's pull is strong enough to push 40% of runs toward the simpler optional form.

If we want 10/10 declarative, we'd need to restate the preference in the closing checklist (the meta-pattern says checklist-named axes converge reliably). If we're OK with the optional form, we'd remove the declarative-form preference from the existing prose.

### Surface naming: still 9 different name combinations

Same story as iter-2 and iter-3, possibly slightly worse:

| Second-surface name | Runs |
|---------------------|------|
| `TodoMaintenance` | r04, r05, r06, r07 (4) |
| `TodoSweep` | r02, r10 (2) |
| `TodoExpirySweep` | r01, r09 (2) |
| `TodoOps` | r08 (1) |
| `OverdueSweep` | r03 (1) |

And the user-surface name varies too: `TodoApi` (most), `TodoAPI` (r02 — caps), `TodoManagement` (r03, r09), `TodoLifecycle` (r10).

The naming-rule gap is the most leverage-rich open axis: a single checklist line ("operator-facing surfaces are named `<Entity>Maintenance`; the user surface is named `<Entity>Api`") would close it.

### Transitions block and ReviveTodo cleanup: stuck at 8/10

Both axes are at 8/10 — same as iter-3, where I noted likely LLM variance noise. Two iterations of stuck-at-8/10 suggests there might be a real prompt issue:

- Transitions block: 8/10 yes (r03, r06 omit it). The pin-down rule reads "include when 3+ enum values + rule-attributable transitions" — both criteria met, both runs missed. The criteria might need to move into the closing checklist to convert reliably.
- ReviveTodo `expired_at` cleanup: 8/10 clear (r06, r10 leave it). The code-literalism checklist item names this directly. The two outliers had different numbers of diagnostics (r06 with warnings, r10 with zero) — no clear pattern.

These are candidate iter-5 targets if you want them at 10/10.

## Mergeability — first cluster makes synthesise tractable

Working from cluster A (5 runs):

1. **Pick a canonical surface naming pair.** `TodoApi` + `TodoMaintenance` is the most popular. (r07 uses these; r01 uses `TodoExpirySweep`; r02 uses `TodoAPI` + `TodoSweep`; r03 uses `TodoManagement` + `OverdueSweep`; r04 uses `TodoApi` + `TodoMaintenance`.)
2. **Resolve `due_at?` parameter optionality** in `CreateTodo` — some runs mark it optional in the rule signature, some don't.
3. **Pick `ArchiveTodo` requires form** — `pending or expired` (r01, r04) vs `not in {done, archived}` (r02, r03, r07).
4. **Standardise transition order in the transitions block** (cosmetic).

That's four spec-form choices, no behavioural disagreements. The merge of just cluster A's 5 specs would produce a single, complete, CLI-clean canonical spec.

The five singletons (r05, r06, r08, r09, r10) each fall outside the cluster on one axis:
- r05: declarative timestamps but ArchiveTodo/CompleteTodo `requires` differ from cluster A
- r06: external entities (the only run still using them; produces the 2 warnings)
- r08: optional timestamps + own surface naming
- r09: declarative timestamps + smaller spec (no transitions block)
- r10: optional timestamps + adds an `id` field to Todo (not present in any other run) + doesn't clear `expired_at`

A merge that targets cluster A as the canonical and notes singletons as "alternative interpretations" would be both small and informative.

## Operational implication

After four iterations, the convergence pattern is very clear:

| Mechanism | Effect on named axes | Effect on related axes |
|-----------|---------------------|-----------------------|
| Closing checklist with named rule | 10/10 | sometimes pushes related shapes |
| Pin-down with numeric/binary closure | 10/10 | minimal |
| Continuous-prose guidance only | 8-9/10 | minimal |
| **CLI-as-judge** (iter-4) | drives convergence on all CLI-checked axes | **substantial pull on related shapes** (ExpireOverdue, external entities) |

The CLI-as-judge mechanism is qualitatively different from the others. Where checklist rules pin specific axes, the CLI's diagnostics indirectly push the model toward whole categories of structural choice. This is high-leverage but also less predictable — the iter-4 result includes a behavioural shift (external entities dropped) that wasn't directly asked for, just implied by the diagnostic-avoidance pressure.

Concrete iter-5 candidates (in priority order):

1. **Surface naming** — close the most-fragmented remaining axis with one checklist line.
2. **Decide on Timestamp form** — either restate the declarative preference in the checklist (push to 10/10 declarative) or drop the preference (let the model pick optional consistently and let weed normalise later).
3. **Move transitions-block and ReviveTodo cleanup rules into the closing checklist** — both are at 8/10 stuck, both are checklist-eligible.

Two more iterations of this shape would plausibly bring the cluster size from 5 to 8+ and remaining variance to almost entirely cosmetic.

## Reproduction

```bash
# Cached judges — free, all 45 pair verdicts already computed
node scripts/tier4-variance.mjs tests/.tier4-runs/distill-stability-2026-05-13T15-54-29-533Z --oauth --judge

# Drill into the smallest delta in cluster A (r04 vs r07, delta 10)
node scripts/tier4-variance.mjs tests/.tier4-runs/distill-stability-2026-05-13T15-54-29-533Z --oauth --judge --pair 4,7

# Compare the cluster to a singleton (r04 vs r10, both with zero diagnostics)
node scripts/tier4-variance.mjs tests/.tier4-runs/distill-stability-2026-05-13T15-54-29-533Z --oauth --judge --pair 4,10

# Per-spec diagnostic counts:
for i in 01 02 03 04 05 06 07 08 09 10; do
  echo "run-$i:"
  allium check tests/.tier4-runs/distill-stability-2026-05-13T15-54-29-533Z/runs/$i/final/spec.allium 2>&1 \
    | jq -r '.diagnostics[] | "  \(.severity) \(.code): \(.message)"'
done
```

Cached verdicts: `tests/.tier4-runs/distill-stability-2026-05-13T15-54-29-533Z/.variance-judges.json` (45 entries).
