# Variance assessment: `distill-stability-2026-05-14T15-53-36-215Z` (after iteration 5)

**Scenario:** `distill-stability` (node-todo fixture, `claude-opus-4-7`, pipeline distill → weed → weed → weed → tend, repeat 10).

**Run:** 2026-05-14T15:53:36Z, completed 2026-05-14T16:16:10Z (~22 min wall, concurrency 5). Total cost $32.52 (mean $3.25/run, range $2.49–$3.83).

**Compared against:**
- Original baseline: `distill-stability-2026-05-12T10-39-00-388Z` (see [`2026-05-12-variance-distill-stability.md`](./2026-05-12-variance-distill-stability.md)).
- Iteration 1: `distill-stability-2026-05-12T16-15-17-168Z` (see [`2026-05-12-variance-distill-stability-after-prompt-change.md`](./2026-05-12-variance-distill-stability-after-prompt-change.md)).
- Iteration 2: `distill-stability-2026-05-12T23-52-21-981Z` (see [`2026-05-13-variance-distill-stability-after-iteration-2.md`](./2026-05-13-variance-distill-stability-after-iteration-2.md)).
- Iteration 3: `distill-stability-2026-05-13T12-58-38-134Z` (see [`2026-05-13-variance-distill-stability-after-iteration-3.md`](./2026-05-13-variance-distill-stability-after-iteration-3.md)).
- Iteration 4: `distill-stability-2026-05-13T15-54-29-533Z` (see [`2026-05-13-variance-distill-stability-after-iteration-4.md`](./2026-05-13-variance-distill-stability-after-iteration-4.md)).

**Changes under test in this iteration:**
- *Prompts (allium repo, commit `8035533`):* All three skills (distill, weed, tend) and the two agent variants (weed, tend) replace the iter-4 "address every error, warning, and info entry" framing with a two-tier framing: errors must be zero; warnings/info are advisory; **do not delete a construct solely to silence a warning or info**. The spec author's judgement about whether the construct makes the spec more truthful takes precedence over the diagnostic count. Distill's checklist item is replaced in the same spirit.
- *CLI false-positive fixes (allium-tools repo, commits `bc0c631`, `c189fe5`, `074d458` on `test-suite`):* Three demonstrably-narrow checks in `analysis.rs` are widened — surface `facing` references now count as "referenced" for `missingSourceHint`; `Expr::For` comprehension bodies are walked by `unreachableValue`; `Expr::WhenGuard` is handled symmetrically by the rule-side trigger collector. The `allium` binary on PATH is symlinked to the locally-built target, so these fixes were active during the run even though the version string still reports `3.2.3` (no version bump).

## Summary

**Both prongs of the iter-5 change held, and the most interesting finding is what *didn't* change.** With the false-positive-reducing CLI fixes active and the prompt explicitly licensing advisory retention, the model still:

- avoided external entities in 9/10 runs (same as iter-4),
- chose the temporal-trigger ExpireOverdue form in 10/10 runs (same as iter-4).

The iter-4 doc attributed both convergences to indirect effects of the iter-4 diagnostic discipline — i.e. the model picking shapes that satisfied a strict CLI. With iter-5 simultaneously relaxing the CLI's strictness on those exact patterns *and* removing the prompt-side deletion pressure, those convergences should have weakened if they were primarily artefacts of CLI pressure. They didn't. So both shape choices are now characterised more accurately as **stable preferences of the model on this fixture**, not coerced behaviour.

The prompt re-tune *did* show up clearly in a different category: 4 of 10 runs (r07, r08, r09, r10) ship with info or warning diagnostics that previous iterations would have driven the model to delete. None of the prior four iterations produced a single such retention. This is the iter-5 prompt's success signal, and it's distinct from the cluster size or zero-diagnostic count.

The cluster picture changed shape but kept similar magnitude. Iter-4 had one 5-run cluster + 5 singletons (5 runs in non-singleton clusters). Iter-5 has one 4-run cluster (r03, r05, r08, r10) + one 2-run cluster (r02, r07) + 4 singletons (6 runs in non-singleton clusters). The first cosmetic-only pair appears (r03↔r05).

Line-count range narrows further (24 → 20). Surface-naming convergence improved informally (3 second-name variants vs 4 in iter-4).

## What the data shows

### Line counts across the iterations

| Run | Original | Iter 1 | Iter 2 | Iter 3 | Iter 4 | Iter 5 |
|-----|----------|--------|--------|--------|--------|--------|
| run-01 | 81 | 126 | 118 | 127 | 129 | 131 |
| run-02 | 128 | 118 | 139 | 127 | 115 | 129 |
| run-03 | 138 | 124 | 135 | 117 | 123 | 129 |
| run-04 | 164 | 99 | 102 | 129 | 129 | 131 |
| run-05 | 115 | 127 | 97 | 105 | 115 | 129 |
| run-06 | 135 | 131 | 136 | 117 | 120 | 122 |
| run-07 | 137 | 132 | 139 | 110 | 129 | 130 |
| run-08 | 158 | 110 | 126 | 138 | 105 | 111 |
| run-09 | 200 | 116 | 119 | 88 | 118 | 115 |
| run-10 | 149 | 100 | 137 | 138 | 129 | 118 |
| **min / median / max** | 81 / 138 / 200 | 99 / 121 / 132 | 97 / 131 / 139 | 88 / 122 / 138 | 105 / 122 / 129 | **111 / 129 / 131** |
| **range** | 119 | 33 | 42 | 50 | 24 | **20** |

Range reaches a new low of 20 lines. The narrowing is partly a centring effect — runs 8/9/10 (the smallest specs) now sit closer to the median because the iter-5 prompt let them keep fields they would previously have dropped. Median rises slightly (122 → 129) for the same reason.

### `allium check` diagnostics (model's view, with iter-5 CLI fixes active)

| Run | Diagnostics | Severity breakdown | Source of advisories |
|-----|-------------|--------------------|----------------------|
| run-01 | **0** | — | |
| run-02 | **0** | — | |
| run-03 | **0** | — | |
| run-04 | **0** | — | |
| run-05 | **0** | — | |
| run-06 | **0** | — | |
| run-07 | 4 | 2 warning, 2 info | external entities (info); unused surface bindings (warning) |
| run-08 | 3 | 3 info | unused fields: `Todo.title`, `Todo.owner_id`, `Todo.created_at` |
| run-09 | 3 | 3 info | unused fields: `Todo.title`, `Todo.owner_id`, `Todo.created_at` |
| run-10 | 3 | 3 info | unused fields: `Todo.title`, `Todo.owner_id`, `Todo.created_at` |

**6/10 produce zero diagnostics. 3/10 produce info-only. 1/10 produces warnings + info. Zero errors.**

The iter-4 vs iter-5 contrast on this axis is more informative than the count itself.

Iter-4's four non-zero runs were *all* flagged on `missing-source-hint` for external entities (i.e. the same advisory across all of them, on a CLI that emitted those as warnings). Iter-5's four non-zero runs are flagged on **different** advisories — three on `field.unused` for source-faithful field retention, one on a mix of `unusedBinding` + `missingSourceHint` for an external-entity-with-surface-binding pattern. Each represents a distinct authorial decision to keep a construct over silencing the diagnostic.

Note also that r07's `missing-source-hint` diagnostics fire as **info** in iter-5 (not warning) because the iter-5 A1 fix downgrades `missingSourceHint` when the entity is referenced from a surface `facing` clause. The two warnings r07 still emits (`unused-binding` for the surface bindings) are a separate check the iter-5 plan didn't touch — they reflect that r07 declared `facing user: User` and `facing operator: Operator` but didn't use those bindings inside the surface body. The model accepted both warnings rather than deleting the bindings.

### Pairwise judge verdicts and clustering

| Severity | Original | Iter 1 | Iter 2 | Iter 3 | Iter 4 | Iter 5 |
|----------|----------|--------|--------|--------|--------|--------|
| cosmetic | 0 | 0 | 0 | 0 | 0 | **1** |
| structural | 0 | 1 | 1 | 1 | 4 | **4** |
| semantic | 45 | 44 | 44 | 44 | 41 | **40** |

**Cluster A: r03, r05, r08, r10** (4 runs).
**Cluster B: r02, r07** (2 runs).
**Singletons: r01, r04, r06, r09**.

The five equivalence pairs (cosmetic + structural):
- r03↔r05 (cosmetic — first cosmetic pair across any iteration)
- r03↔r10 (structural)
- r05↔r10 (structural)
- r08↔r10 (structural)
- r02↔r07 (structural)

The first four form cluster A via union-find on r10. r02↔r07 forms cluster B. Six runs land in non-singleton clusters (vs five in iter-4), and the first cosmetic verdict appears — r03 and r05 differ only on a refactor that didn't change observable behaviour.

## Per-axis convergence

| Axis | Iter 4 | Iter 5 | Source rule |
|------|--------|--------|-------------|
| `due_at` validation | 10/10 `>=` | **10/10 `>=`** | iter-1 |
| Title trim presence | 10/10 | **10/10** | iter-1 + iter-2 |
| Title trim FORM | 10/10 `length(trim(t)) > 0` | **10/10** | iter-3 |
| ReviveTodo clears `expired_at` | 8/10 | **8/10** ↔ | iter-1 (still stuck) |
| `owner_id` field | 10/10 | **10/10** | iter-1 |
| `@guidance` count | 0/10 | **0/10** | iter-1 |
| Invariants count | 0/10 | **0/10** | iter-1 |
| Rule naming | 10/10 | **10/10** | (unchanged) |
| Transitions block | 8/10 | **10/10** ↗ | iter-2 (incidental shift) |
| Surface count | 10/10 with 2 | **10/10 with 2** | iter-3 |
| Config naming | 10/10 | **10/10** | iter-3 |
| ExpireOverdue rule shape | 10/10 temporal trigger | **10/10 temporal trigger** | iter-4 (now characterised as stable preference, see Summary) |
| External entities used | 1/10 (r06) | **1/10 (r07)** ↔ | iter-4 (now characterised as stable preference, see Summary) |
| Timestamp form | 6 declarative / 4 optional | **4 declarative / 6 optional** ↘ | (still no checklist rule) |
| `allium check` diagnostics | 5/10 zero, 4/10 info-only, 1/10 warn | **6/10 zero, 3/10 info-only, 1/10 warn+info** | iter-5 |
| Surface naming (second name) | 4 forms | **3 forms** ↗ | (still no rule) |
| **Spec-truthfulness retention** | n/a | **4/10 keep advisory-flagged constructs** | **iter-5 (new)** |

**Direct effects of the iter-5 change:** 4/10 specs retain advisory-flagged constructs that previous iterations would have deleted (unused fields in r08/r09/r10; external entities + unused surface bindings in r07).

**Plausible indirect effects:** transitions block from 8/10 → 10/10; surface naming converging from 4 to 3 second-name variants. Both could be variance noise — the iter-5 prompt didn't name either axis.

**Persistent variance:** Timestamp form (declarative vs optional) tilted slightly toward optional (4/10 declarative vs 6/10 in iter-4); ReviveTodo `expired_at` cleanup still 8/10.

## Wins from iteration 5

### Spec-truthfulness retention is observable in 4/10 runs

**This is the iter-5 success signal**: four of ten runs demonstrably "use" the new escape hatch by keeping a construct that triggers an advisory diagnostic.

- **r08, r09, r10** all keep `Todo.title`, `Todo.owner_id`, and `Todo.created_at` as fields even though no rule references them. The previous prompt would have driven the model to delete them, since `field.unused` info diagnostics were treated as constraints. With the iter-5 framing, the model kept them — the source code defines these fields, so the spec is more truthful with them present. (Each of the three runs lists the three info diagnostics in its `allium check` output but ships the fields anyway.)

- **r07** keeps `external entity User` and `external entity Operator`, used only in surface `facing` clauses. This produces *both* `unused-binding` warnings (the entities are bound but not referenced in the surface body) *and* `missing-source-hint` info (no governing module imported). Once again the iter-5 framing gave the model license to keep the constructs.

40% of runs is direct measurable evidence that the prompt change reached the model. None of the previous iterations produced a spec that intentionally retains an advisory-triggering construct.

### First cosmetic pair across any iteration (r03↔r05)

The judge returned `cosmetic` for r03↔r05, indicating purely-formatting differences with no observable behavioural delta. This is the first such verdict across all five iterations of the experiment — every prior pair was either zero-delta, structural, or semantic. r03 and r05 differ on 5 lines but those 5 lines describe identical behaviour.

### Surface naming converges further (4 forms → 3)

| Second-surface name | Iter 4 | Iter 5 |
|---------------------|--------|--------|
| `TodoMaintenance` | 4 | **6** |
| `TodoSweep` / `TodoSweepApi` | 2 | 2 |
| `TodoExpirySweep` | 2 | 1 |
| `TodoOps` / `TodoOperations` | 1 | 2 |
| `OverdueSweep` | 1 | 0 |

The user-surface name `TodoApi` is now 9/10 (only r01 picks `TodoOperations`).

The iter-5 prompt didn't name surface naming, so this is incidental — possibly the broader "be truthful to the source" framing reduced the model's incentive to invent novel decorative names. Could equally be noise.

### Transitions block: 8/10 → 10/10

Every run now includes `transitions status { ... }` for `Todo`. Iter-4 had two omissions (r03, r06). Iter-5 has none. Either real convergence or noise — the iter-5 prompt didn't name this axis.

## Persistent and new variance

### Timestamp form tilted toward optional (6/10 vs 4/10)

| Form | Iter 4 | Iter 5 |
|------|--------|--------|
| Declarative `Timestamp when status = X` | 6/10 (r02–06, r09) | 4/10 (r01, r04, r06, r09) |
| Optional `Timestamp?` | 4/10 (r01, r07, r08, r10) | 6/10 (r02, r03, r05, r07, r08, r10) |

The iter-5 prompt didn't mention this axis. The shift is probably noise within a 10-sample experiment, but it leans the opposite way to iter-4's slight majority. Iter-4's note still applies: closing this axis to 10/10 needs a checklist rule (either declarative or optional).

### ReviveTodo `expired_at` cleanup: still 8/10

r06 and r09 omit the cleanup. Same axis stuck at 8/10 across iter-3, iter-4, and iter-5. Three iterations of stuck-at-8/10 strongly suggests this axis isn't reachable via prompt-rule weight alone — possibly the model genuinely doesn't see "clearing `expired_at`" as part of "reviving" in those runs (semantic interpretation rather than rule misapplication).

### External entity adoption unchanged (1/10) — and now meaningful

The iter-5 prompt removed the deletion pressure, *and* the iter-5 A1 CLI fix downgrades `missing-source-hint` to info when the entity is referenced from a surface `facing` clause. With both changes active, an external entity used solely in a surface produces only an info diagnostic — not the warning iter-4 emitted. The model nonetheless still avoided external entities in 9/10 runs.

This shifts the interpretation. Iter-4's 9/10 absence was attributable to the model dodging the warning; iter-5's 9/10 absence cannot be — there's no warning to dodge. r07's two external entities are arguably aspirational and the model kept them, but the other nine runs simply don't see node-todo as needing the construct. This is a stable preference of the model on this fixture, not a coerced behaviour.

The same logic applies to the temporal-trigger ExpireOverdue (10/10): the iter-5 A2 CLI fix makes the comprehension form safe (no false-positive `unreachableValue` warning), and the prompt no longer pushes against it — yet 10/10 runs still chose temporal trigger. Stable preference, not coercion.

### A2 and A3 fixes not exercised by this fixture

The iter-5 CLI fixes were active during the run, but two of them didn't trip anything because no spec contained the relevant pattern:

- **A2** (comprehension walking) requires `for x in Entity where ...:` inside a rule's `ensures:`. 10/10 runs use the temporal-trigger ExpireOverdue, so no comprehension-form status assignment was written.
- **A3** (WhenGuard symmetry on the rule side) requires a rule's `when:` to contain a guarded trigger like `Trigger(args) when condition`. None of the runs use this form.

A1 (surface `facing` reference counting) is the only one that materially changed what r07 reported (its two `missingSourceHint` items would be warnings on the as-shipped 3.2.3, are info here). A2 and A3 are still valuable for other fixtures and other prompts; node-todo simply doesn't exercise them.

## Mergeability — slightly more cluster mass than iter-4

Working from cluster A (r03, r05, r08, r10) — the four-run cluster:

1. **Surface naming**: all four pick `TodoApi` + `TodoMaintenance`. No choice needed.
2. **Timestamp form**: all four pick optional `Timestamp?`. Internally consistent.
3. **Field retention**: r08, r10 keep `title`/`owner_id`/`created_at` as unused fields (info diagnostics). r03, r05 don't. The merged spec needs to pick one position; per the iter-5 framing, "more truthful" argues for keeping them.
4. **ArchiveTodo `requires`**: form differs across r03/r05 (one uses positive enumeration, the other negated set membership).

Cluster B (r02, r07) — the two-run cluster:
- r02 has no external entities; r07 has User + Operator. r07 also has the unused-binding warnings.
- Both pick optional timestamps and `TodoApi` user surface; their second-surface names are `TodoSweepApi` (r02) vs `TodoMaintenance` (r07).

The merge of cluster A's 4 specs would produce a single spec with 3–4 variation points. Cluster B is too small to merge without external input.

The four singletons (r01, r04, r06, r09) each fall outside the clusters on multiple axes:
- r01 picks declarative timestamps + the only `TodoOperations` user surface naming.
- r04 picks declarative timestamps + `TodoMaintenance` (close to cluster A but on declarative timestamps).
- r06 picks declarative timestamps + omits ReviveTodo's `expired_at` cleanup + names the rule `TodoExpires` (everyone else picks `ExpireOverdue` or `ExpireOverdueTodo`).
- r09 picks declarative timestamps + omits ReviveTodo's `expired_at` cleanup.

## Operational implication

After five iterations, the convergence pattern is now well-characterised on two dimensions:

| Mechanism | Effect on named axes | Effect on related axes |
|-----------|---------------------|-----------------------|
| Closing checklist with named rule | 10/10 | sometimes pushes related shapes |
| Pin-down with numeric/binary closure | 10/10 | minimal |
| Continuous-prose guidance only | 8–9/10 | minimal |
| CLI-as-judge (iter-4) | drives convergence on all CLI-checked axes | substantial pull on related shapes |
| **Spec-truthfulness escape hatch (iter-5)** | **40% of runs use it** | **opens the model to advisory diagnostics, restoring source fidelity** |

The iter-5 mechanism is qualitatively different from prior iterations: it doesn't force convergence on any one axis, it *removes* an artificial convergence force (deletion-to-silence) that the iter-4 prompt accidentally created, and it relaxes three CLI checks that were narrower than the constructs they evaluated. The success metric isn't "more uniform specs" — it's "fewer specs that lost a construct to a CLI advisory." On that metric, iter-5 succeeded (4/10 runs visibly retain advisory-flagged constructs; zero prior iterations did).

A second-order finding worth flagging: the convergences iter-4 attributed to the diagnostic-discipline pressure (no externals, temporal-trigger ExpireOverdue) survived the removal of that pressure. They're now characterised as stable preferences of the model on this fixture, which is a more useful claim — it tells the user the merged spec can rely on those shapes without the CLI propping them up.

Concrete iter-6 candidates (in priority order):

1. **Surface naming closure** — the rule still doesn't exist. With the user-surface now informally at 9/10 `TodoApi` and the second surface at 6/10 `TodoMaintenance`, a single checklist line ("operator-facing surfaces are named `<Entity>Maintenance`; the user surface is named `<Entity>Api`") would close it.
2. **Resolve the Timestamp form question** — three iterations of split, currently tilted optional. Either restate the declarative preference in the checklist (push to 10/10 declarative) or drop the preference (let the optional form dominate consistently).
3. **ReviveTodo cleanup** — three iterations stuck at 8/10. May need a different mechanism than the existing checklist line; possibly reframing as "every transition that exits a status with a `Timestamp when status = X` field clears that timestamp" rather than naming `expired_at` directly.
4. **Run on a fixture that exercises A2 and A3** — the iter-5 CLI fixes for comprehension walking and WhenGuard symmetry are unverified end-to-end on a real workload. A fixture with action-trigger comprehensions or guarded triggers would close that loop.

The five-iteration arc has shown that the experiment can reliably move 60–80% of runs onto a named axis with one prompt rule and 90–100% with a closing checklist line. The remaining open axes are now primarily ones where the experiment hasn't tried hard enough yet (surface naming, timestamp form), not ones where the prompt mechanism has hit a ceiling.

## Reproduction

```bash
# Cached judges — free, all 45 pair verdicts already computed
node scripts/tier4-variance.mjs tests/.tier4-runs/distill-stability-2026-05-14T15-53-36-215Z --judge

# Drill into the smallest delta in cluster A (r03 vs r05, delta 5 — the cosmetic pair)
node scripts/tier4-variance.mjs tests/.tier4-runs/distill-stability-2026-05-14T15-53-36-215Z --judge --pair 3,5

# Compare the cluster to a singleton (r03 vs r09, both with optional vs declarative timestamps)
node scripts/tier4-variance.mjs tests/.tier4-runs/distill-stability-2026-05-14T15-53-36-215Z --judge --pair 3,9

# Per-spec diagnostic counts (with iter-5 CLI fixes — A1 affects r07; A2/A3 unexercised on this fixture):
for i in 01 02 03 04 05 06 07 08 09 10; do
  echo "run-$i:"
  allium check tests/.tier4-runs/distill-stability-2026-05-14T15-53-36-215Z/runs/$i/final/spec.allium 2>&1 \
    | jq -r '.diagnostics[] | "  \(.severity) \(.code): \(.message)"'
done
```

Cached verdicts: `tests/.tier4-runs/distill-stability-2026-05-14T15-53-36-215Z/.variance-judges.json` (45 entries).
