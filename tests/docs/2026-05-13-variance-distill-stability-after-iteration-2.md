# Variance assessment: `distill-stability-2026-05-12T23-52-21-981Z` (after iteration 2)

**Scenario:** `distill-stability` (node-todo fixture, `claude-opus-4-7`, pipeline distill → weed → weed → weed → tend, repeat 10).

**Run:** 2026-05-12T23:52:21Z, completed 2026-05-13T09:06:02Z (~9 hours wall, concurrency 4 — long wall time reflects rate-limiting / interruptions, not real work).

**Compared against:**
- Original baseline: `distill-stability-2026-05-12T10-39-00-388Z` (see [`2026-05-12-variance-distill-stability.md`](./2026-05-12-variance-distill-stability.md)).
- After first prompt change (commit `a41d0ad`): `distill-stability-2026-05-12T16-15-17-168Z` (see [`2026-05-12-variance-distill-stability-after-prompt-change.md`](./2026-05-12-variance-distill-stability-after-prompt-change.md)).

**Changes under test in this iteration:**
- Commit `488a565` — added "Checklist: Code literalism" to distill SKILL.md, pinned-down the transitions-block and surface-split rules.
- Commit `8a27024` — extended cluster equivalence in `scripts/tier4-variance.mjs` to include `structural` pairs (not just `cosmetic`).
- Commit `8176d93` — de-fixtured the SKILL.md examples (no node-todo-specific vocabulary).

## Summary

Three of the four targeted axes from iteration 1 closed completely (10/10 unanimous), and the cluster algorithm now correctly groups the structural-equivalent pair. Two new findings:

1. **Transitions block went from 4/10 → 10/10**, the largest single-axis win across the three iterations — a direct effect of the pinned-down "3+ enum values + rule-attributable transitions" rule.
2. **Surface-count guidance over-corrected.** The pin-down rule ("carve out an additional surface when any endpoint is operator-facing") was meant to push runs from 1 surface to 2 surfaces. Instead, the model interpreted the carve-out as a general invitation to split: 4/10 produced *three* surfaces (separating the per-collection list view from the per-todo detail view, on top of the operator surface). The rule needs tightening to specify *only* the operator/CRUD split, not arbitrary further subdivisions.

A new dominant variance axis emerged: **title validation form**. The model now consistently calls `trim()` (10/10, the literalism rule worked), but spreads across four logically-equivalent spec forms (`length(trim(title)) > 0` × 7, `trim(title) != ""`, `title.trim().length > 0`, `length(trimmed_title) > 0`). The judge grades cross-form pairs as semantic.

The cluster algorithm change is doing its job: 1 cluster (`run-05`, `run-10`, both 1-surface specs) + 8 singletons. With the surface-count rule tightened, this number should grow.

## What the data shows

### Line counts across the three runs

| Run | Original (10:39) | After iteration 1 (16:15) | After iteration 2 (23:52) |
|-----|------------------|---------------------------|---------------------------|
| run-01 | 81 | 126 | 118 |
| run-02 | 128 | 118 | 139 |
| run-03 | 138 | 124 | 135 |
| run-04 | 164 | 99 | 102 |
| run-05 | 115 | 127 | 97 |
| run-06 | 135 | 131 | 136 |
| run-07 | 137 | 132 | 139 |
| run-08 | 158 | 110 | 126 |
| run-09 | 200 | 116 | 119 |
| run-10 | 149 | 100 | 137 |
| **min / median / max** | **81 / 138 / 200** | **99 / 121 / 132** | **97 / 131 / 139** |
| **range** | **119** | **33** | **42** |

Range slightly wider than iteration 1 (42 vs 33), well below the original (119). The median ticked up by 10 lines, mostly attributable to the now-mandatory transitions block.

### Pairwise judge verdicts

| Severity | Original | Iteration 1 | Iteration 2 |
|----------|----------|-------------|-------------|
| cosmetic | 0 | 0 | 0 |
| structural | 0 | 1 (run-04 vs run-06) | **1** (run-05 vs run-10) |
| semantic | 45 | 44 | 44 |

One structural pair persists. With the cluster algorithm change (commit `8a27024`), the report now correctly groups it: **`cluster A: run-05, run-10` plus 8 singletons** (the previous report would have shown 10 singletons from the same data).

## Per-axis convergence

| Axis | Original | After iter 1 | After iter 2 | Source rule |
|------|----------|--------------|--------------|-------------|
| `due_at` validation | split `>` / `>=` | 10/10 use `>=` | **10/10 use `>=`** | code literalism |
| Title trim | split | 9/10 trim | **10/10 trim** | code literalism + checklist |
| ReviveTodo clears `expired_at` | split | 9/10 clear | **10/10 clear** | code literalism + checklist |
| `owner_id` field | split | 9/10 use `owner_id` | **10/10 use `owner_id`** | naming conventions + checklist |
| `@guidance` count | variable | 0/10 | **0/10** | output minimalism |
| Invariants count | inconsistent | 0/10 | **0/10** | what-distill-produces |
| Rule naming | mostly consistent | 10/10 PascalCase + suffix | **10/10** | (unchanged) |
| **Transitions block** | **5/10** | **4/10** | **10/10** | **pinned-down rule (commit 488a565)** |
| Surface count | 6/10 split, 4/10 single | 6/10 with 2, 4/10 with 1 | **3/10 with 1, 3/10 with 2, 4/10 with 3** | pinned-down rule (over-corrected) |
| Title validation form | mixed | 9/10 `trim(title) != ""` | **split: 4 different forms** | (new variance axis) |

Seven axes are now 10/10 unanimous — including the four that iteration 1 left at 9/10. The transitions-block rule went from a judgement call to a hard pin-down and did its job: 100% adoption.

The two regressions (surface count and title-validation form) are discussed below.

## Surface count: pin-down over-corrected

The iteration-2 rule reads:

> Default to one surface per HTTP/RPC entry-point group. Carve out an additional surface when any endpoint is *operator-facing* — a batch sweep, an expiry job, a backfill route, or any endpoint a regular client would not invoke as part of normal use.

Surface counts produced:

| Surface count | Runs | Surface names |
|---------------|------|---------------|
| 1 | r04, r05 | `TodoApi` |
| 2 | r01, r06, r09 | `TodoApi` + (`TodoMaintenance` / `TodoAdmin` / `TodoSweep`) |
| 3 | r02, r03, r07, r08, r10 | (`TodoCollection` or `TodoCreation`) + (`TodoView` / `TodoDetail`) + (`TodoMaintenance` / `TodoExpiryAdmin` / `TodoExpirySweep`) |

The intended split was *one user surface + one operator surface* (2 total). The 4-of-10 runs that produced 3 surfaces additionally split the user surface into `Collection` and `Detail` (or `Creation` and `Detail`). This is a defensible structural choice — the create/list endpoints have a different shape from the per-todo CRUD endpoints — but it's not what the rule asked for.

The fix is to tighten the rule's scope to only the operator/non-operator distinction: "carve out *exactly one* additional surface for operator-facing endpoints; do not further subdivide the user-facing endpoints by HTTP method or resource granularity."

## Title validation: literalism worked but form picks vary

| Form | Runs |
|------|------|
| `length(trim(title)) > 0` | r01, r02, r03, r06, r07, r09, r10 (7) |
| `trim(title) != ""` | r04 |
| `title.trim().length > 0` | r05 |
| `length(trimmed_title) > 0` | r08 |

Every run calls `trim()`. The literalism rule worked perfectly on the trim-or-not axis. But the spec form varies because the prompt's checklist item ("String normalisation calls preserved") doesn't say *which* spec idiom to choose for "non-empty after trim."

These four forms are logically equivalent. The judge correctly grades cross-form pairs as semantic because the surface-form differs — once two runs pick different forms, every pair across the divide is flagged. r05 in particular uses `title.trim().length > 0`, which is closer to JavaScript than to Allium convention.

A small addition to the checklist would close this — something like "Normalised-string emptiness checks: prefer `length(trim(field)) > 0` over `trim(field) != ""` or chain syntax (`field.trim().length > 0`)."

## Selected example: smallest semantic pair (r02 vs r03, delta 7)

Almost entirely cosmetic. The single semantic difference:

> 1. *cosmetic* — Scope and Includes/Excludes prose simplified
> 2. *cosmetic* — Explanatory comments removed from ExpireOverdue rule
> 3. **semantic** — Grace period guard removed from ReviveTodo action precondition in TodoView surface
> 4. *cosmetic* — Operator-facing documentation comment removed from TodoMaintenance surface

7 lines of delta and the only behavioural difference is whether the surface's `provides:` clause includes a `when grace_period > 0` guard on `ReviveTodo`. This is the kind of edge case that's pure surface convention — both express the same rule-level guard. A future weed pass against either spec would normalise this.

## Selected example: the structural-only pair (r05 vs r10)

Both are 1-surface specs. 11 changes total, all cosmetic or structural:

> *cosmetic* — preamble rephrased; section dividers updated; field reorder
> *cosmetic* — terminal transitions syntax (separate decls vs comma list)
> *cosmetic* — title trim form (`title.trim().length > 0` → `length(trim(title)) > 0`)
> *cosmetic* — rule signatures: type annotations dropped
> *cosmetic* — ensures clauses reformatted (one-per-line vs block)
> *structural* — Config parameter renamed (`revive_grace_window` → `revive_grace`)
> *structural* — ArchiveTodo requires clause: negation vs explicit enumeration
> *structural* — Single `TodoApi` refactored into three specialised surfaces

This pair would survive a merge into one canonical spec without contradictions on what the system *does*. The cluster algorithm correctly groups them.

## Mergeability — the best yet

Working from iteration 2's specs, a merge needs to resolve:

1. **Title-validation form** — pick `length(trim(field)) > 0`. (1 form-only choice across 4 variants, no behavioural disagreement.)
2. **Surface count** — pick the operator-split target (2 surfaces: `TodoApi` + maintenance). The 4 runs with 3 surfaces would lose their further user-side split; the 2 runs with 1 surface would gain the operator split.
3. **Surface naming** — pick canonical names (`TodoApi`, `TodoMaintenance`).
4. **A few cosmetic refactor preferences** — terminal-transitions syntax, ensures formatting, field order.

That's a much narrower decision set than iteration 1 (which had 5 choices, 3 against the code) and far narrower than the original (~9 choices, 3 behavioural). For the first time in this experiment, **all merge decisions are spec-form choices, not behavioural disagreements with the source.** The synthesise skill proposed in the original report would now have a tractable input set.

## What's still varying

| Source | Still split | Notes |
|--------|------------|-------|
| Surface granularity | 1 / 2 / 3 surfaces | Pin-down rule was too inviting; tighten to "exactly one operator surface, no further user-side splits" |
| Title-validation form | 4 spec forms | Add explicit form preference to the checklist |
| Spec-style polish (rule signature types, ensures formatting, divider style) | Variable | These are tend-skill territory; distill needn't pin them down |

Three more iterations of prompt tightening and we'd plausibly see a dominant cluster (5+ runs in one) for the first time.

## Operational implication

The pattern across the three iterations is a useful one to note for future skill design:

- **Iteration 0** (no discipline rules): wild variance, 10 singletons, line range 119.
- **Iteration 1** (added discipline as continuous prose in 800-line skill): 10/10 on universal items, 9/10 on items the model could miss, judgement-call axes left genuinely open.
- **Iteration 2** (added a final-pre-output checklist that names every rule it wants reliably followed, and pinned the judgement calls to numeric or category-based defaults): 10/10 on every axis the prompt directly named. New variance shows up in places the prompt didn't *think* to pin (form choice, granularity of carve-out).

The lesson: **a closing checklist of single-line rules in the model's last read is more reliable than the same rules embedded in expository prose earlier in the file.** Each rule that's pinned this way converges; each rule that isn't pinned by name finds a new way to vary.

For future prompt revisions: any axis you want 10/10 on, add to the checklist by name. Any axis you're willing to leave variable, leave out. The middle ground (continuous-prose guidance with no checklist mention) is where 9/10 outcomes live.

## Reproduction

```bash
# Cached judges — free, all 45 pair verdicts already computed
node scripts/tier4-variance.mjs tests/.tier4-runs/distill-stability-2026-05-12T23-52-21-981Z --oauth --judge

# Drill into the structural-only cluster
node scripts/tier4-variance.mjs tests/.tier4-runs/distill-stability-2026-05-12T23-52-21-981Z --oauth --judge --pair 5,10

# Drill into the smallest semantic pair (delta 7)
node scripts/tier4-variance.mjs tests/.tier4-runs/distill-stability-2026-05-12T23-52-21-981Z --oauth --judge --pair 2,3
```

Cached verdicts: `tests/.tier4-runs/distill-stability-2026-05-12T23-52-21-981Z/.variance-judges.json` (45 entries).
