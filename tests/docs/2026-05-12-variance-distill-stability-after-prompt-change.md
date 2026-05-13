# Variance assessment: `distill-stability-2026-05-12T16-15-17-168Z` (after prompt change)

**Scenario:** `distill-stability` (node-todo fixture, `claude-opus-4-7`, pipeline distill → weed → weed → weed → tend, repeat 10).

**Run:** 2026-05-12T16:15:17Z, completed 16:54:52Z (~40 min wall, concurrency 3).

**Compared against:** `distill-stability-2026-05-12T10-39-00-388Z` (see [`2026-05-12-variance-distill-stability.md`](./2026-05-12-variance-distill-stability.md)).

**Changes under test:** commit `c046a2e` ("Distill: code literalism + naming + scope discipline") added four new sections to [skills/distill/SKILL.md](../../skills/distill/SKILL.md) — code literalism, naming conventions, what-distill-produces-vs-what-weed-adds, and output minimalism.

## Summary

The prompt change produced strong measurable convergence on the axes it directly addressed, but the headline cluster count is unchanged: 10 singletons in both runs. This is misleading. The line-count range tightened by 72% (33 lines vs 119 lines before), three previously-variable axes are now unanimous, three more are 9/10 unanimous, and the very first non-semantic pair in the project's history appeared (run-04 vs run-06: structural-only). The cluster algorithm groups on `cosmetic` or zero-delta only, so a single structural-only pair doesn't merge clusters — but the underlying variance has dropped substantially.

The remaining disagreements concentrate on three categories: (a) three outlier runs each missing one disciplinary point the prompt asks for; (b) the `Timestamp when status = X` vs `Timestamp?` form choice, which the prompt addressed but only as a preference; (c) the transitions-block-and-surface-shape axis, where the prompt explicitly leaves room for the model's judgement.

A merge of these 10 specs is markedly easier than before: fewer behavioural axes to resolve, smaller files to integrate, no `@guidance` to strip, no spurious invariants to consider.

## What the data shows

### Line counts (vs baseline)

| Run | After (lines) | Before (lines) |
|-----|---------------|----------------|
| run-01 | 126 | 81 |
| run-02 | 118 | 128 |
| run-03 | 124 | 138 |
| run-04 |  99 | 164 |
| run-05 | 127 | 115 |
| run-06 | 131 | 135 |
| run-07 | 132 | 137 |
| run-08 | 110 | 158 |
| run-09 | 116 | 200 |
| run-10 | 100 | 149 |
| **min / median / max** | **99 / 121 / 132** | **81 / 138 / 200** |
| **range** | **33** | **119** |

Range tightened by 72%. The largest run (132) is now closer to the smallest (99) than the median of the baseline (138) was to either of its extremes. Output minimalism is biting: no run produced a >135-line spec where the baseline had four such runs.

### Pairwise judge verdicts

All 45 pairs are still graded `investigate`, but the severity distribution shifted:

| Severity | Before | After |
|----------|--------|-------|
| cosmetic | 0 | 0 |
| structural | 0 | **1** (run-04 vs run-06) |
| semantic | 45 | 44 |

The first non-semantic pair the project has ever produced. The cluster algorithm groups runs whose pair verdicts are `cosmetic` or zero-delta only, so this single structural pair doesn't reduce singleton count — a clustering-algorithm tweak (treat `structural` as equivalent too, with appropriate caveats) would now produce one 2-run cluster.

## Per-axis convergence — what worked

The four addition sections each target specific axes. Direct verification across all 10 runs:

| Axis | Baseline | After | Source rule |
|------|----------|-------|-------------|
| `due_at` validation | split: `>` vs `>=` | **10/10 use `>=`** | code literalism |
| Title validation | split: `trim`/`length`/raw | **9/10 use `trim(title) != ""`** (run-10 lone outlier with `title != ""`) | code literalism |
| ReviveTodo clears `expired_at` | split: clears vs leaves | **9/10 clear** (run-01 lone outlier) | code literalism |
| `@guidance` annotations | variable | **0/10 — all absent** | what-distill-produces / output minimalism |
| Invariants added | inconsistent | **0/10 — all absent** | what-distill-produces |
| Rule naming | mostly consistent | **10/10 use `CreateTodo`/`CompleteTodo`/...** | (no rule change needed) |
| Owner field | split: `owner`/`owner_id`/entity | **9/10 use `owner_id: String`** (run-07 lone outlier with `owner: User` entity) | naming conventions |

Seven of the eight axes the prompt directly targeted are unanimous or near-unanimous. The three lone outliers each disagree on exactly one axis — they're not "rogue" runs, they're runs that missed one disciplinary point.

### Per-axis convergence — what's still split

| Axis | Distribution | Comment |
|------|--------------|---------|
| Transitions block | 4/10 include | The prompt says "include only when the workflow is small and unambiguous" — model judgement varies on whether five transitions counts as "small" |
| Surface count | 6/10 have 2 surfaces (`TodoApi` + `TodoMaintenance`-like split), 4/10 have 1 surface | Code has separate route patterns for the sweep endpoint, which is enough to argue for the split — but the prompt's "only when the code has a separate entry point with distinct auth or context" leaves room because auth doesn't actually differ |

These two axes are correctly identified as "judgement calls" by the prompt — they're not failures of code literalism. A future tightening could specify: "if any HTTP endpoint is administrative (operator-facing, e.g. expiry sweeps), model it as a separate surface."

## Selected example: the new structural-only pair

run-04 vs run-06 — the first ever non-semantic pair on this fixture:

> 1. *structural* — Named enum `TodoStatus` extracted in run-06; inlined on `status` field in run-04
> 2. *structural* — run-06 includes an explicit transitions state machine; run-04 does not
> 3. *structural* — `revive_grace` vs `revive_grace_period` parameter naming (no code authority — both invented)
> 4. *structural* — Rule when-clause parameters: explicit type signatures vs implicit inference
> 5. *structural* — Single `TodoApi` (run-04) vs split into `TodoCreation`+`TodoLifecycle` (run-06)
> 6. *structural* — Surface exposes pattern: entity reference vs explicit field listing
> 7. *cosmetic* — Section divider style, ensures-block consolidation

Every behavioural decision agrees. Every disagreement is shape or naming refactor at the spec level. This pair would survive a merge into a coherent canonical spec with no contradictions on what the system *does*.

## Selected example: the smallest still-semantic pair

run-01 vs run-05 (delta 35):

> 1. *cosmetic* — section dividers and scope wording
> 2. *semantic* — `expired_at` field type: conditional `Timestamp when status = expired` vs optional `Timestamp?` with explicit nulls
> 3. *structural* — `revive_window_open` derived value extracted in r05; inlined in r01
> 4. *semantic* — ReviveTodo: r05 ensures `expired_at = null`; r01 does not
> 5. *semantic* — TodoLifecycle surface in r05 includes a `timeout:` clause declaring ExpireOverdueTodo; r01 does not

The two real semantic differences both centre on r01 — it's the run that "leaves" `expired_at` after revive and that omits the timeout clause. Removing r01 from the dataset eliminates 9 of the 45 semantic pairs.

## Mergeability — much easier now

Of the original buckets:

- **A. Code-literalism failures** — substantially resolved. Three of the original three axes (off-by-one, trim/no-trim, expired_at cleanup) are now 9/10 or 10/10 unanimous against the code.
- **B. Equivalent-form choice** — partially resolved. The `requires: in {...}` vs `not in {...}` axis no longer appears in the sampled verdicts. The `Timestamp when status = X` vs `Timestamp?` axis is still there but argued in only some pairs.
- **C. Naming conventions** — substantially resolved. 9/10 use `owner_id`; the lone outlier (r07) is the only run treating Owner as an entity.
- **D. Optional structural enrichment** — partially resolved. Invariants and `@guidance` are now 0/10 across the board; transitions block and surface count remain judgement calls.
- **E. Comment density** — resolved by output minimalism. No run produces a verbose preamble; section dividers vary in style but only cosmetically.

A merge needs to resolve:

1. Three outlier-run choices against the code (r01's `expired_at`, r07's `owner` entity, r10's no-trim).
2. Two judgement-call axes (transitions block, single vs split surface).
3. Minor formatting normalisation.

That is a much smaller decision set than the original report's "~3 behavioural axes + ~6 enrichment axes + naming." The number of mutually-exclusive choices the merger has to make has dropped from ~9 to ~5, and three of those are now trivially decidable against the code.

## What the cluster algorithm should learn

The fact that we went from "0 structural pairs" to "1 structural pair" but the cluster count stayed at 10 is a cluster-algorithm artefact. Two runs whose disagreements are *all structural* are equivalent for merge purposes — neither describes different behaviour. A simple tweak in [scripts/tier4-variance.mjs](../../scripts/tier4-variance.mjs)' `unionFind` predicate to treat `structural` as equivalent (in addition to `cosmetic` and zero-delta) would surface this convergence in future runs. With that change, the current data would produce: one 2-run cluster (r04, r06) plus 8 singletons.

This is worth doing once the algorithm has more `structural` pairs to operate on — premature now (one pair, one cluster). When a future run shows 5+ structural-only pairs, the tweak becomes worth its complexity.

## Operational implication

The prompt change was sufficient for the axes it directly named. The remaining variance is in two places:

1. **Three outlier runs**, each missing one disciplinary point. This is a normal LLM tail — the prompt is being followed 9/10 times. Worth investigating whether a small reorder of the SKILL.md sections (making the literalism rules more prominent or repeating them in the "When to stop" pattern from weed) would close the gap, but probably not worth a deeper structural change.

2. **Two judgement-call axes** (transitions block, surface shape) that the prompt explicitly leaves open. If these need to be pinned down, the prompt change would be in the "what distill produces vs what weed adds" section — explicitly choosing "transitions blocks always" or "transitions blocks never" rather than "when small and unambiguous."

The original report proposed a `synthesise` skill for merging N candidate specs. That proposal is now lower priority: with this much convergence at distill time, the merge target is much narrower. A single targeted weed-pass against any one of these specs (with the code in scope) would land most of the remaining union — which is exactly what weed is designed for.

## Reproduction

```bash
# Cached judges — free, all 45 pair verdicts already computed
node scripts/tier4-variance.mjs tests/.tier4-runs/distill-stability-2026-05-12T16-15-17-168Z --oauth --judge

# Drill into the structural-only pair
node scripts/tier4-variance.mjs tests/.tier4-runs/distill-stability-2026-05-12T16-15-17-168Z --oauth --judge --pair 4,6

# Drill into the outlier semantic differences
node scripts/tier4-variance.mjs tests/.tier4-runs/distill-stability-2026-05-12T16-15-17-168Z --oauth --judge --pair 1,5    # expired_at outlier
node scripts/tier4-variance.mjs tests/.tier4-runs/distill-stability-2026-05-12T16-15-17-168Z --oauth --judge --pair 1,7    # owner-entity outlier
node scripts/tier4-variance.mjs tests/.tier4-runs/distill-stability-2026-05-12T16-15-17-168Z --oauth --judge --pair 9,10   # title-trim outlier
```

Cached verdicts: `tests/.tier4-runs/distill-stability-2026-05-12T16-15-17-168Z/.variance-judges.json` (45 entries).
