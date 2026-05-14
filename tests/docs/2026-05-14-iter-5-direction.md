# Iteration 5: direction

**Date:** 2026-05-14. **Status:** changes-under-test only — no variance run yet.

## Why iter-5 exists

The iter-4 variance assessment ([2026-05-13-variance-distill-stability-after-iteration-4.md](./2026-05-13-variance-distill-stability-after-iteration-4.md)) is the strongest convergence result of the experiment so far: 5/10 zero-diagnostic specs, a five-run cluster, range narrowed to 24 lines. But the convergence came partly through **spec minimisation** — the cheapest way to silence a `warning` or `info` diagnostic from `allium check` is to delete the construct that produced it. Three concrete cases:

1. **External entities dropped (9/10).** `missing-source-hint` warns when an `external entity` is declared without a source-module import. The model's path of least resistance: don't introduce them at all. Sometimes correct (the node-todo source has no auth boundary), sometimes a loss of fidelity.
2. **ExpireOverdue rule shape collapsed (10/10 → temporal trigger).** The action-trigger-with-comprehension form trips `unreachable-status` because the CLI's reachability check doesn't enter `for…where` comprehension bodies. The model converged on the form that doesn't get flagged.
3. **Declarative timestamp form contested (6/10 vs 4/10 optional).** `Timestamp when status = X` requires the matching assignment to appear directly in some rule's `ensures` — which interacts with the same comprehension-walking gap.

Fundamentally: the CLI is doing two jobs at once — **correctness checker** (does the spec parse, are references resolved, are states reachable?) and **implicit style judge** (is this the canonical shape?). When the skills were told to "address every diagnostic," the LLM couldn't tell those jobs apart, so it treated style pressure as correctness pressure and reached for deletion as the cheapest fix.

This was foreshadowed in the project's own thoughts doc ("if the cli reports on a diagnostic error it deletes it from the spec rather than solve") — iter-4 made it measurable.

## Direction

**CLI stays strict; skills mediate.** No new in-spec suppression mechanism, no severity re-grading. The two prongs of iter-5:

### Prong 1 — fix three demonstrably-narrow CLI checks (allium-tools)

Three diagnostic-emission sites in `crates/allium-parser/src/analysis.rs` are not "strict" — they are **narrower than the construct they're analysing**, and the variance run shows specs being deformed around the gaps. Each fix is small and ships with a regression test.

| Fix | Diagnostic | Gap | Fix |
|-----|------------|-----|-----|
| A1 | `allium.externalEntity.missingSourceHint` | Doesn't count surface `facing` references when deciding whether the entity is "referenced" | Iterate surface blocks too in `check_external_entity_source_hints` |
| A2 | `allium.status.unreachableValue` | Doesn't walk `Expr::For` comprehension bodies | Add an `Expr::For` arm to `visit_status_assignments` |
| A3 | `allium.rule.unreachableTrigger` | `extract_trigger_names` (rule side) doesn't handle `Expr::WhenGuard`, but `collect_call_names` (surface side) does — pure asymmetry | Add a `WhenGuard` arm to `extract_trigger_names` |

### Prong 2 — re-tune the iter-4 closing-checklist prompt (allium)

Replace the "address every error, warning, and info entry" framing across distill/weed/tend skills and the weed/tend agent variants with a two-tier framing:

- **Errors must be zero.** Fix the spec until they are.
- **Warnings and info are advisory.** Read them; if they reflect a real spec problem, fix it; but if the construct that produced the diagnostic makes the spec more truthful, keep it. Note in the response which advisories you saw and why you kept the spec as-is.
- **Do not delete a construct solely to silence a warning or info** — that's the failure mode this guidance exists to prevent.

The goal is to give the LLM explicit license to push back on advisory diagnostics when the spec is more truthful with the construct than without it.

## Expected directional effects

When the next variance run is taken, vs the iter-4 baseline, the prediction is:

| Axis | Iter-4 | Iter-5 prediction | Reasoning |
|------|--------|--------------------|-----------|
| Errors per run | 0 | 0 | Errors-only zero-tolerance is unchanged |
| Warning/info count | 0–4 | flat or higher | Advisories now allowed when spec is more truthful |
| External entities used | 1/10 | 1/10 to 3/10 | Some recovery if any node-todo distillation legitimately wants `Client`/`Operator`; A1 fix removes one false positive |
| ExpireOverdue rule shape | 10/10 temporal trigger | mostly temporal trigger, possibly 1–2 comprehension form | A2 fix lets the comprehension form be safe; prompt change permits it |
| Timestamp form | 6 declarative / 4 optional | similar split | Not directly addressed; may shift via A2's secondary effects |
| Cluster size | 5-run cluster | possibly smaller | Variety returning is the success signal, not a regression |

A drop in cluster size accompanied by an increase in spec truthfulness is the **success signal**. The iter-5 variance doc — written after the next run — should explain this trade-off so it isn't read as a regression.

## Out of scope for iter-5

- **Teaching skills `-- allium-ignore`.** The existing inline-suppression mechanism in the CLI stays; we deliberately do not point the model at it. Reason: prompt-level mediation keeps the spec free of LLM-authored suppression noise.
- **Severity re-grading or `--lint` separation.** Considered and declined in favour of "CLI stays strict; skills mediate."
- **Surface-naming convergence.** Named as a candidate in iter-4's report but addresses a different concern; iter-5 stays focused on the coupling problem.
- **A new variance run.** This document records the changes-under-test only. The variance run is a separate operation; its report will be a new file dated to the run day.

## Reproduction (when ready)

```bash
# Run the distill-stability scenario (10 runs, concurrency 3, ~50 min)
node scripts/tier4-run.mjs distill-stability --oauth   # confirm exact invocation against tests/scenarios/

# Compare per-spec diagnostic counts to iter-4 baseline
for i in 01 02 03 04 05 06 07 08 09 10; do
  echo "run-$i:"
  allium check tests/.tier4-runs/<new-run-id>/runs/$i/final/spec.allium 2>&1 \
    | jq -r '.diagnostics[] | "  \(.severity) \(.code): \(.message)"'
done
```

When the variance assessment is written, key axes to compare against iter-4:
- Per-spec diagnostic counts (errors must be 0; advisories may be flat or higher)
- ExpireOverdue rule shape distribution
- External entity presence
- Pairwise judge cluster size and cluster membership
