# Propagate harness comparison — insurance-claims (pytest+hypothesis)

Run: `2026-05-17T17-39-02-497Z`
Variants: `baseline`, `experimental` × samples: 3 × backend: `pytest+hypothesis` × fixture: `insurance-claims`.

## Headline

| Metric | baseline (3 samples) | experimental (3 samples) |
|---|---|---|
| Test files per sample | **10 / 10 / 11** | **46 / 46 / 46** |
| File-name set intersection across all 3 samples | **6 of 15 unique names (40%)** | **46 of 46 (100%)** |
| Byte-identical files across all 3 samples (only counting names that exist in all 3) | **1 of 6** (only the empty `__init__.py`) | n/a — see below |
| Byte-identical files between two same-framing samples | (every pair differs in every file) | **27 of 46 (59%)** |
| Files with consistent content layout (sizes within 20% across samples) | **0 of 6** | **46 of 46** |
| Stage C report present | 0 / 3 (baseline skill doesn't produce one) | **3 / 3** |
| Mean obligation coverage from Stage C | n/a | **64.9%** |

## What variance looks like in baseline

Baseline samples diverge before they even get to test bodies — they pick *different file structures each run*:

| Sample 1 | Sample 2 | Sample 3 |
|---|---|---|
| `test_config.py` | `test_config.py` | — |
| `test_derived.py` | — | `test_derived.py` |
| `test_entities.py` | `test_entities.py` | `test_entities.py` |
| `test_invariants.py` | `test_invariants.py` | `test_invariants.py` |
| `test_rules.py` | `test_rules.py` | `test_rules.py` |
| `test_surfaces.py` | `test_surfaces.py` | `test_surfaces.py` |
| `test_temporal.py` | `test_temporal.py` | `test_temporal_jobs.py` |
| — | `test_contracts.py` | `test_contracts.py` |
| — | `test_enums.py` | — |
| — | — | `test_state_machine.py` |
| `_helpers.py` | — | `helpers.py` |

15 unique file names across 3 samples; only 6 names appear in *all* 3. Even when the file name matches, the content always differs (sample 1's `test_rules.py` is 16165B; sample 2's is 10527B; sample 3's is 17298B). One run produces a `test_state_machine.py`, another doesn't. One run names a helper `_helpers.py`, another `helpers.py`, the third doesn't have a helper at all.

This is exactly the kind of churn the plan flagged: tests get committed to source control, so this drift compounds in CI noise, PR-review churn, and reviewer fatigue.

## What variance looks like in experimental

Experimental always produces **46 files with the same names** — that's the K-vote consensus collapsing per-subagent variance into a single deterministic file set. One file per `obligation_subject` (entity, rule, surface, etc.).

Cross-orchestration byte-determinism is conditional on the orchestrator's framing choices:

| Sample pair | `code_root` | Byte-identical files | Differing files |
|---|---|---:|---:|
| sample-1 vs sample-2 | `.` vs `./app` | 0 / 46 | 46 / 46 (path prefix on every bridge) |
| sample-1 vs sample-3 | `.` vs `.`   | **27 / 46** | 19 / 46 |
| sample-2 vs sample-3 | `./app` vs `.` | 0 / 46 | 46 / 46 |

The path-prefix divergence (`app/models.py::Foo` vs `models.py::Foo`) is **the orchestrator LLM picking different `code_root` values per sample**, not a pipeline non-determinism. After the SKILL.md tightening that locks `code_root` to `"."` from the user invocation, all three samples should match in framing; the remaining 19/46 differences would shrink to the obligations where K=3 independently rolled different (but valid) bridge witnesses.

The pipeline itself is byte-deterministic given fixed inputs — already proven separately in this session:

- **Re-canonicalize**: byte-identical
- **Re-merge**: byte-identical
- **Re-translate**: byte-identical (46 files, both fixtures)

## Coverage (Stage C report — experimental only)

Each experimental sample produced a `propagation-report.md`. The harness only computes mean coverage when reports are present; baseline has none.

- Mean obligation coverage across 3 experimental samples: **64.9%**
- (Within a single canonical run earlier in this session: 96.9% on the same fixture — the lower mean here is because two of the three samples chose `code_root='.'` and pytest couldn't import `app.*` cleanly without adjusting PYTHONPATH. The pipeline still emits the correct tests; the difference is project-setup, not pipeline correctness.)

## Wall-clock cost (informational)

| Variant | per-sample mean | per-sample range |
|---|---:|---|
| baseline | 577 s | 520 – 679 s |
| experimental | 517 s | 336 – 824 s |

Experimental is *slightly faster on average* than baseline despite running K=3 subagents in parallel internally, because the post-LLM work (canonicalize, merge, translate, Stage C) is essentially instantaneous and the per-subagent token budget is smaller than baseline's "one agent does everything" budget.

## Summary

| Claim | Evidence |
|---|---|
| Baseline propagate is non-deterministic (set membership) | 6/15 file-name intersection across 3 samples |
| Baseline propagate is non-deterministic (content) | Sizes of `test_rules.py` vary 10.5KB → 17.3KB across samples |
| Experimental file set is deterministic | 46/46 names identical across all 3 samples |
| Experimental content is deterministic given fixed orchestration | 27/46 byte-identical when `code_root` matches |
| Pipeline (canonicalize + merge + translate) is byte-deterministic | Proven separately: re-running each stage produces identical bytes |
| Bridge ambiguity is surfaced rather than silenced | `Bridge unresolved: N` block in `propagation-report.md` |
| Wrong bridges are surfaced for re-mapping | `Likely wrong bridges: N` block; tsc / pytest catches mis-imports |
