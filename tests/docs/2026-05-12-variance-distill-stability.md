# Variance assessment: `distill-stability-2026-05-12T10-39-00-388Z`

**Scenario:** `distill-stability` (node-todo fixture, `claude-opus-4-7`, pipeline distill → weed → weed → weed → tend, repeat 10).

**Generated:** 2026-05-12.

## Summary

Across 10 independent runs of the same pipeline against the same starting state, the LLM produces 10 specs that all capture the same domain core but disagree pervasively on naming, structural enrichment, and a small number of behaviour-changing details. The pairwise judge classifies every one of the 45 pairs as `semantic / investigate`, so clustering produces 10 singletons. This sounds bleak but is misleading — the disagreements concentrate on a small enumerable set of axes, almost all of which the JavaScript source code itself can resolve.

A merge into a single canonical spec is possible but it is **curation, not union**: a few mutually exclusive choices need to be decided against the code, and the structural enrichments need to be unioned across runs. Estimated merged size ~220–280 lines.

## What the data shows

### Line counts

| Run | Lines |
|-----|-------|
| run-01 | 81 |
| run-02 | 128 |
| run-03 | 138 |
| run-04 | 164 |
| run-05 | 115 |
| run-06 | 135 |
| run-07 | 137 |
| run-08 | 158 |
| run-09 | 200 |
| run-10 | 149 |

Min 81, median 138, max 200. The smallest spec (run-01) has no surfaces, no invariants, no actor declarations; the largest (run-09) has external entities, transitions block, two surfaces, two actors, and two invariants.

### Pairwise judge verdicts

All 45 pairs come back `semantic / investigate`. The clustering algorithm (groups runs whose pair verdicts are `cosmetic` or zero-delta) reports 10 singletons.

### Domain core that's consistent across all 10 runs

- `Todo` entity with `status: pending | done | archived | expired`.
- Five rules: `CreateTodo`, `CompleteTodo`, `ArchiveTodo`, `ReviveTodo`, `ExpireOverdue` (a few rename it to `ExpireOverdueTodo` or `TodoExpires` but the trigger and effect are the same).
- Config: `revive_grace: Duration = 7.days`.
- Status workflow: `pending → done`, `pending → archived`, `pending → expired`, `expired → pending`, `expired → archived`. Done and archived are terminal.
- Per-status timestamps: `created_at`, `completed_at`, `archived_at`, `expired_at`.

Distill is reliable for this skeleton.

## What's varying — by axis

| Axis | Variants observed | Mutually exclusive? | Resolvable from code? |
|------|-------------------|---------------------|----------------------|
| **Owner naming** | `owner: String` vs `owner_id: String` vs `owner: Owner` (with external entity) | yes | partly (code uses `ownerId`) |
| **Timestamp fields** | `Timestamp when status = X` (declarative) vs `Timestamp?` (optional with explicit nulls in `ensures`) | logically equivalent; declarative form is tighter | spec choice, not code-resolvable |
| **Title validation** | `trim(title) != ""` vs `title != ""` vs `length(title) > 0` | trim variant rejects whitespace-only; the other two are equivalent | yes |
| **due_at validation** | `due_at > now` vs `due_at >= now` | yes — off-by-one | yes |
| **ArchiveTodo `requires`** | `in {pending, expired}` vs `not in {done, archived}` | logically equivalent now, semantically different against future states | yes |
| **ReviveTodo cleanup** | clears `expired_at = null` vs leaves it | yes — affects post-revive state | yes |
| **Derived values** | inlines `is_overdue` / `is_revive_window_open` vs declares them on entity | refactor only | spec choice |
| **Transitions block** | present in 5/10 runs vs absent | additive | spec choice |
| **Surfaces** | full `TodoApi` + separate `TodoMaintenance` (run-09) vs single surface vs none (run-01) | additive | spec choice |
| **Invariants** | `TitleNonEmpty`, `ExpiredImpliesDue`, etc. — inconsistent which appear | additive | yes (some are derivable from rules) |
| **Actor declarations** | only present when Owner is modelled as an entity | additive | spec choice |
| **Comment / preamble density** | wildly variable | cosmetic | n/a |

## Why the judge flags every pair `semantic`

Three behavioural axes (`>=` vs `>`, trim-or-not, expired_at cleanup) cause behaviour-changing disagreements. As soon as any pair trips one of those, the judge correctly grades the pair `semantic` even when the rest is structural or cosmetic. With 10 runs each making independent choices on each axis, the probability of any pair agreeing on all three is low — hence 10 singletons.

These are not genuine domain ambiguities. They are choices the LLM made that the JavaScript source code resolves unambiguously:

- `service.js` either does or doesn't `trim(title)` before validation.
- The createTodo path either accepts `due_at == now` or rejects it (`>` vs `>=` on the comparison).
- The revive path either clears `expired_at` or doesn't.

The variance is in the LLM's interpretation, not in the source.

## Selected example: 1 vs 2 verdict

The judge's per-change list for the smallest pair gap (run-01 vs run-02, 87-line delta, both small specs):

> 1. *cosmetic* — Scope documentation updated to reference node-todo backend and HTTP surfaces
> 2. *structural* — External entity `Client` added to specify API boundary
> 3. *structural* — Field `owner` renamed to `owner_id` and config `revive_grace` renamed to `revive_grace_window`
> 4. *semantic* — Timestamp fields changed from conditional (`when status = X`) to optional (`Timestamp?`)
> 5. *structural* — Derived values refactored: `is_overdue` and `is_revive_window_open` removed, `is_terminal` added
> 6. *semantic* — `CreateTodo` validation changed from `trim(title) != ""` to `title != ""` — removes whitespace trimming
> 7. *structural* — `ArchiveTodo` refactored from explicit state check to negated `is_terminal` — logically equivalent
> 8. *semantic* — `ReviveTodo` adds explicit status and grace-window checks, and adds `expired_at = null` side effect
> 9. *structural* — `ExpireOverdueTodo` rule renamed to `TodoExpires` with trigger refactored to inline `due_at` comparison
> 10. *structural* — Surfaces section added with `TodoCreation` and `TodoLifecycle` surfaces

Three semantic items (#4, #6, #8) — all reflect the axes above. The rest is naming, refactoring, and structural enrichment.

## Mergeability: yes, but as curation

A pure mechanical merge fails because the semantic axes are mutually exclusive. You cannot include both `>=` and `>` in the same `requires` clause; you cannot have both `trim(title)` and raw `title` in the same `ensures`; you cannot both clear and not clear `expired_at` on revive. Producing a coherent merged spec needs three stages:

### 1. Resolve behavioural disagreements against the code

For each of the ~3 semantic axes, read `service.js` and pick the variant the code implements. The 45 cached judge verdicts already enumerate every disagreement axis as a `change` entry — the work is bounded. A sweep across the cache, dedup the "behavioural choice" descriptions, decide each one against the code.

### 2. Take the union of additive enrichments

- Transitions block (yes, from any run that has it).
- Invariants (all of them — the additional ones from any run that thought to assert them).
- Full surfaces — `TodoApi` plus a separate `TodoMaintenance` for the expire sweep, modelled on run-09's structure.
- Actor declarations — `TodoClient` and `SystemOperator`.
- External entities — `Owner`, `Operator`.
- Derived values — `is_overdue`, `is_revive_window_open` extracted to entity-level.

### 3. Normalise naming conventions

Pick one of `{owner, owner_id}` and one of `{Owner-as-entity, Owner-as-String}`, apply uniformly. Validate the result with `allium check spec.allium`.

The output should land at ~220–280 lines — bigger than the median (138) because it is the union of structural insights, but no larger than the largest run (200) plus the structural pieces that run is missing.

## Operational implication

This is the use case for a new skill. Call it `synthesise` or `merge`. It takes:

- **Input:** N candidate specs of the same code, plus the code itself.
- **For each axis of disagreement** (the per-pair judge `change` lists are the raw material, already cached): decide against the code.
- **Union the structural enrichments**.
- **Normalise naming**.
- **Validate**.

A side observation worth noting: this run also confirms the bounded weed prompt change is doing useful work. The structural skeleton is consistently captured across all 10 distills, so **distill is already reliable for the skeleton**. The variance concentrates in interpretation of validation rules and the extent of structural enrichment — both areas where a more focused pass (a `synthesise` skill, or a targeted weed-pass with explicit "decide each behavioural rule against the code" framing) would land more reliably than open-ended weeding.

## Reproduction

```bash
# Re-render this report's data — free, all verdicts cached
node scripts/tier4-variance.mjs tests/.tier4-runs/distill-stability-2026-05-12T10-39-00-388Z --oauth --judge

# Drill into one specific pair
node scripts/tier4-variance.mjs tests/.tier4-runs/distill-stability-2026-05-12T10-39-00-388Z --oauth --judge --pair 1,9
```

Cached pair verdicts: `tests/.tier4-runs/distill-stability-2026-05-12T10-39-00-388Z/.variance-judges.json` (45 entries).
