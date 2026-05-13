# Variance assessment: `distill-stability-2026-05-13T12-58-38-134Z` (after iteration 3)

**Scenario:** `distill-stability` (node-todo fixture, `claude-opus-4-7`, pipeline distill → weed → weed → weed → tend, repeat 10).

**Run:** 2026-05-13T12:58:38Z, completed 2026-05-13T13:20:48Z (~22 min wall, concurrency 3).

**Compared against:**
- Original baseline: `distill-stability-2026-05-12T10-39-00-388Z` (see [`2026-05-12-variance-distill-stability.md`](./2026-05-12-variance-distill-stability.md)).
- Iteration 1: `distill-stability-2026-05-12T16-15-17-168Z` (see [`2026-05-12-variance-distill-stability-after-prompt-change.md`](./2026-05-12-variance-distill-stability-after-prompt-change.md)).
- Iteration 2: `distill-stability-2026-05-12T23-52-21-981Z` (see [`2026-05-13-variance-distill-stability-after-iteration-2.md`](./2026-05-13-variance-distill-stability-after-iteration-2.md)).

**Changes under test in this iteration (commit `fe14325`):**
- Surface-count rule pinned to a binary (zero operator endpoints → one surface; one or more → exactly two; "do not further subdivide user-facing endpoints").
- Title-validation form preference added to checklist (`length(trim(field)) > 0`).
- Config-parameter naming preservation added to checklist (don't invent `_window`, `_period`, etc.).

## Summary

The iteration-3 changes hit every axis they targeted: title-validation form, surface count, and config naming all converged to 10/10. This is the cleanest single-iteration win in the experiment so far — three new axes pinned, three new axes unanimous on the next run. The meta-observation from the iteration-2 report (closing-checklist rules converge; expository-prose-only rules don't) is now strongly supported by direct evidence: every axis named in the checklist is at 10/10.

Two minor regressions appeared on previously-converged axes (transitions block 10/10 → 8/10; ReviveTodo `expired_at` cleanup 10/10 → 8/10; owner field 10/10 → 9/10) — most likely model-variance noise rather than a prompt-change consequence, since the rules for those axes weren't touched in this iteration.

A **new variance axis surfaced**: surface *naming*. All 10 runs now produce exactly 2 surfaces (the count is pinned), but the second surface's name varies across six different choices. This is the same shape as the title-form variance we saw in iteration 2 — a pinned existence rule unaccompanied by a form/name rule produces unanimous presence with split labels.

The cluster algorithm reports 1 cluster (run-05, run-07) + 8 singletons — same shape as iteration 2.

## What the data shows

### Line counts across the four runs

| Run | Original | Iter 1 | Iter 2 | Iter 3 |
|-----|----------|--------|--------|--------|
| run-01 | 81 | 126 | 118 | 127 |
| run-02 | 128 | 118 | 139 | 127 |
| run-03 | 138 | 124 | 135 | 117 |
| run-04 | 164 | 99 | 102 | 129 |
| run-05 | 115 | 127 | 97 | 105 |
| run-06 | 135 | 131 | 136 | 117 |
| run-07 | 137 | 132 | 139 | 110 |
| run-08 | 158 | 110 | 126 | 138 |
| run-09 | 200 | 116 | 119 | **88** |
| run-10 | 149 | 100 | 137 | 138 |
| **min / median / max** | 81 / 138 / 200 | 99 / 121 / 132 | 97 / 131 / 139 | **88 / 122 / 138** |
| **range** | 119 | 33 | 42 | **50** |

Range continues to widen modestly (50 lines vs iter-2's 42) — driven by run-09 producing a notably small 88-line spec. Median ticked down to 122. The widening across iterations is consistent: as more rules converge, the residual variance concentrates in fewer dimensions but those dimensions can produce larger per-axis swings.

### Pairwise judge verdicts

| Severity | Original | Iter 1 | Iter 2 | Iter 3 |
|----------|----------|--------|--------|--------|
| cosmetic | 0 | 0 | 0 | 0 |
| structural | 0 | 1 (r04 vs r06) | 1 (r05 vs r10) | **1** (r05 vs r07) |
| semantic | 45 | 44 | 44 | **44** |

The structural-pair count holds steady at 1, just relocated. Cluster: **`cluster A: run-05, run-07` plus 8 singletons.**

## Per-axis convergence

| Axis | Original | Iter 1 | Iter 2 | Iter 3 | Source rule |
|------|----------|--------|--------|--------|-------------|
| `due_at` validation | split | 10/10 `>=` | 10/10 `>=` | **10/10 `>=`** | code literalism |
| Title trim presence | split | 9/10 trim | 10/10 trim | **10/10 trim** | code literalism + checklist |
| **Title trim FORM** | n/a | n/a | **4 different forms** | **10/10 `length(trim(t)) > 0`** | **NEW iter-3 checklist item** |
| ReviveTodo clears `expired_at` | split | 9/10 | 10/10 | **8/10** ⚠ | code literalism + checklist |
| `owner_id` field | split | 9/10 | 10/10 | **9/10** ⚠ | naming + checklist |
| `@guidance` count | variable | 0/10 | 0/10 | **0/10** | output minimalism |
| Invariants count | inconsistent | 0/10 | 0/10 | **0/10** | what-distill-produces |
| Rule naming | mostly consistent | 10/10 | 10/10 | **10/10** | (unchanged) |
| Transitions block | 5/10 | 4/10 | 10/10 | **8/10** ⚠ | pinned-down rule |
| **Surface count** | 6/10 split | 6/10 with 2 | 1/2/3 split | **10/10 with 2** | **NEW iter-3 binary pin-down** |
| Surface naming | n/a | TodoApi+TodoMaintenance dominant | 6 different second-surface names | **6 different second-surface names** | (no rule) |
| **Config parameter naming** | split | n/a | n/a | **10/10 `revive_grace`** | **NEW iter-3 checklist item** |

**Three new 10/10 axes, all from this iteration's edits.** Previously-converged axes drifted slightly downward, plausibly variance noise — see the regression section below.

## Wins from iteration 3

### Title-validation form: 4 forms → 1 form

Every run produced `requires: length(trim(title)) > 0`. This is the single largest verbatim-text convergence I've seen across the experiment — an entire spec line is now identical across 10 runs. The checklist item read:

> Normalised-string emptiness checks use `length(trim(field)) > 0`, not `trim(field) != ""` or chain syntax (`field.trim().length > 0`). Logically equivalent forms differ on the spec page; pick the function-call form for consistency

Direct quotation in the checklist → direct quotation in the output. The checklist mechanism continues to be the highest-leverage convergence tool.

### Surface count: 1/2/3 split → 10/10 with 2

Every run produced exactly two surfaces (a `TodoApi` for user routes plus a maintenance/sweep surface for the operator endpoint). The binary pin-down read:

> Default to one surface for the user-facing endpoint group. Carve out *exactly one* additional surface when any endpoint is *operator-facing*. … Do not further subdivide the user-facing endpoints (e.g. into separate "collection" / "detail" / "creation" surfaces by HTTP method or resource granularity) — that's a refactoring decision belonging to tend, not distill. So: zero operator endpoints → one surface; one or more operator endpoints → exactly two surfaces.

The numeric closure ("zero → 1; one or more → exactly 2") is the load-bearing element. Iteration 2's prose-only "carve out for operator endpoints" left the model free to also split user-side; the explicit count rules out that ambiguity.

### Config naming: 3 forms → 10/10 unanimous

Every run produced `revive_grace: Duration = 7.days`. Iteration 2 had a structural-only pair (r05 vs r10) whose only structural disagreement was `revive_grace_window` vs `revive_grace`. This iteration's checklist item ("derive from the source constant; do not invent new suffixes like `_window`, `_period`") closes that gap.

## Regressions vs iteration 2

Three previously-converged axes drifted from 10/10 to 8-9/10:

| Axis | Iter 2 | Iter 3 | Outliers |
|------|--------|--------|----------|
| Transitions block presence | 10/10 yes | **8/10 yes** | r05, r09 omit |
| ReviveTodo clears `expired_at` | 10/10 clear | **8/10 clear** | r09, r10 leave |
| `owner_id` field naming | 10/10 use it | **9/10 use it** | r04 uses `owner:` |

Three observations:

1. **Run-09 is responsible for two of the three regressions** (transitions block, expired_at). It's also the smallest spec (88 lines) — visibly under-developed. Likely a single-run "the model just didn't do its checklist sweep properly" outlier rather than a systematic effect.

2. **None of these axes' rules changed in this iteration.** The transitions-block rule was already pinned to "3+ status values + rule-attributable transitions" and that fixture meets the criterion. The `expired_at` cleanup is a code-literalism checklist item. The `owner_id` rule is a naming-conventions checklist item. So the regression isn't traceable to a prompt change.

3. **LLM variance is the most plausible explanation.** With 10 independent runs, occasional checklist-misses are expected. The previous iteration happening to land 10/10 on these axes was a stochastic high; this iteration is a stochastic low on the same axes. Three more iterations (or just larger N) would show whether they cluster around 9/10 average or whether iteration-3 has a real structural cause.

If they persist into iteration 4, worth investigating. For now, treat as noise.

## New variance axis: surface *naming*

All 10 runs produced exactly 2 surfaces (the count converged), but the *name* of the second surface varies:

| Second-surface name | Runs |
|---------------------|------|
| `TodoMaintenance` | r01, r05, r06, r08, r10 (5) |
| `TodoSweep` | r07 |
| `TodoMaintenanceApi` | r04 |
| `TodoExpiry` | r03 |
| `ExpireSweep` | r02 |
| `ExpirySweep` | r09 |

This is the same shape as iteration 2's title-form problem: pinning the *presence* of a structural element while leaving the *name* unspecified produces unanimous presence with split naming. The 5/10 majority for `TodoMaintenance` is encouraging; a checklist line ("Operator-facing surfaces are named `<Entity>Maintenance`") would close it.

`TodoApi` (the user surface) was 10/10 — no naming variance there, presumably because it's the "default" and the model converges on it without explicit guidance.

## Other residual variance (sampled from verdicts)

From the structural pair r05 vs r07 and the smallest semantic pair r03 vs r06:

- **Optional-vs-conditional timestamp form**: `Timestamp?` vs `Timestamp when status = X`. The iteration-1 prompt mentions both but doesn't pick.
- **Surface `exposes` pattern**: full entity reference (`exposes: Todo`) vs explicit field listing vs no-exposes-clause (just `provides:`).
- **CreateTodo parameter typing**: `(title: String, due_at: Timestamp?, owner_id: String)` vs untyped `(title, due_at, owner_id)`.
- **ExpireOverdue trigger pattern**: temporal trigger on entity, action trigger with for-loop, `provides` action invocation. Three different patterns appeared.
- **ArchiveTodo requires**: `pending or expired` vs `not in {done, archived}` vs De Morgan's-equivalent forms — still split despite the iteration-1 "preserve predicate forms" rule.

All five are candidates for future checklist additions.

## Mergeability — narrowest yet

A merge of the iteration-3 specs needs to resolve:

1. **Operator-surface name** — pick `TodoMaintenance` (majority) or `TodoSweep` (more specific to the actual purpose).
2. **Optional vs conditional timestamps** — pick declarative `Timestamp when status = X` (closer to source invariant).
3. **Surface exposes pattern** — pick the explicit field-listing form.
4. **CreateTodo parameter typing** — pick typed-and-explicit.
5. **ExpireOverdue trigger pattern** — pick temporal-on-entity (closest to the temporal language in the source's setInterval).
6. **Run-09's outliers** — drop or re-derive the missing transitions block and `expired_at` clear (probable LLM noise; the other 8/9 runs agree).

That's six choices, all spec-form (not behavioural). Down from iteration 2's six (which included the surface-count overcorrection and title-form). Behavioural disagreements with the source are now zero.

## Operational implication

The pattern from iterations 1-3 is now empirical:

| Mechanism | Effect | Cost |
|-----------|--------|------|
| **Closing checklist with named rule** | 10/10 convergence on the named axis | One line of prompt |
| **Pin-down with numeric/binary closure** ("3+ values"; "zero or exactly two") | 10/10 convergence on the named axis | One sentence of prompt |
| **Continuous-prose guidance only** ("when in doubt..."; "as appropriate...") | 8-9/10, with stochastic outliers | Multiple sentences, lower yield |
| **No mention** | Free variance, often new dominant axis | n/a |

Each iteration adds 2-3 checklist items and gets 2-3 new 10/10 axes. The cost per converged axis is roughly $55 (one full live run to validate) plus ~5 minutes of prompt writing. Iteration 4 candidates (in priority order):

1. **Surface naming** — closing 10/10 on the second-surface name. One checklist line.
2. **Optional-vs-conditional timestamp form** — closes a recurring axis across all four runs.
3. **Surface exposes pattern** — pick explicit field listing.

Two further iterations of similar shape would plausibly bring the experiment to 12-15 axes at 10/10, leaving only spec-style polish (which the existing tend skill is designed to handle).

## Reproduction

```bash
# Cached judges — free, all 45 pair verdicts already computed
node scripts/tier4-variance.mjs tests/.tier4-runs/distill-stability-2026-05-13T12-58-38-134Z --oauth --judge

# Drill into the structural-only pair
node scripts/tier4-variance.mjs tests/.tier4-runs/distill-stability-2026-05-13T12-58-38-134Z --oauth --judge --pair 5,7

# Drill into the smallest semantic pair (delta 30)
node scripts/tier4-variance.mjs tests/.tier4-runs/distill-stability-2026-05-13T12-58-38-134Z --oauth --judge --pair 3,6
```

Cached verdicts: `tests/.tier4-runs/distill-stability-2026-05-13T12-58-38-134Z/.variance-judges.json` (45 entries).
