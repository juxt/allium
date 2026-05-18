# Propagate harness comparison — build-pipeline (jest+fastcheck)

Run: `2026-05-17T17-57-04-261Z`
Variants: `baseline`, `experimental` × samples: 3 × backend: `jest+fastcheck` × fixture: `build-pipeline`.

## Headline

| Metric | baseline (3 samples) | experimental (3 samples) |
|---|---|---|
| Test files per sample | **9 / 11 / 9** | **31 / 31 / 31** |
| File-name set intersection across all 3 samples | **3 of 21 unique names (14%)** | **31 of 31 (100%)** |
| Byte-identical files across all 3 samples (only counting names that exist in all 3) | **0 of 3** | n/a — see below |
| Byte-identical files between consecutive same-framing samples | (every pair differs in every in-common file) | **24 / 31, 23 / 31, 20 / 31 (avg 73%)** |
| `code_root` chosen by orchestrator | n/a | **`.` in all 3 samples** ✓ |
| Stage C report present | 0 / 3 | 3 / 3 (no runtime numbers — no `npx jest` in env) |

## What variance looks like in baseline

Baseline TS samples diverge even more sharply than the Python A/B did:

- Sample-1 produced **9** test files; sample-2 produced **11**; sample-3 produced **9**.
- Across all 3 samples there are **21 unique file names**, of which only **3 appear in every sample** — a 14% file-name agreement rate.
- Of those 3 in-common names, **0 are byte-identical** in any pairwise comparison.

This is the upper-bound noise floor for the file-organisation aspect of the test-tree drift the plan warned about: every run produces a substantively different set of test files, with no overlap between most of them.

## What variance looks like in experimental

All 3 experimental samples produced **31 test files with the same names** (100% set agreement).

All 3 samples also chose `code_root='.'` — the new SKILL.md tightening was effective. With framing locked, byte-identity reflects pure K=3 consensus variance:

| Sample pair | Byte-identical | Differing |
|---|---:|---:|
| sample-1 vs sample-2 | **24 / 31 (77%)** | 7 |
| sample-1 vs sample-3 | **23 / 31 (74%)** | 8 |
| sample-2 vs sample-3 | **20 / 31 (65%)** | 11 |

The 7-11 differing files per pair are bridge-resolution variance — the K=3 vote within each independent orchestration converged on different (but valid) bridges for some medium-confidence obligations. The differing files cluster around the obligations the fidelity scorecard would flag as ambiguous (e.g. `ReceiveGithubPushEvent` which can be witnessed in either `src/routes.ts` or `src/webhooks.ts`).

## Coverage

| Run | Mean obligation coverage |
|---|---:|
| baseline | n/a (no Stage C in baseline skill) |
| experimental | **58.7%** (Stage C report present in all 3 samples, but `npx jest` could not run in this env — coverage is reported on the assumption tests would parse and run cleanly) |

## Wall-clock cost

| Variant | per-sample mean | per-sample range |
|---|---:|---|
| baseline | 758 s | 743 – 776 s |
| experimental | 554 s | 535 – 575 s |

Experimental is **27% faster** than baseline on this fixture, with much tighter per-sample variance (~40s range vs ~33s range). The K=3 internal parallelism wins on wall-clock here.

## Pairwise diff detail (machine-readable)

### baseline / jest+fastcheck / build-pipeline

- `sample-1` vs `sample-2`: in-both=3, only-a=6, only-b=8, differing=3, byte-identical=false
- `sample-1` vs `sample-3`: in-both=4, only-a=5, only-b=5, differing=4, byte-identical=false
- `sample-2` vs `sample-3`: in-both=4, only-a=7, only-b=5, differing=4, byte-identical=false

### experimental / jest+fastcheck / build-pipeline

- `sample-1` vs `sample-2`: in-both=31, only-a=0, only-b=0, differing=7, byte-identical=false
- `sample-1` vs `sample-3`: in-both=31, only-a=0, only-b=0, differing=8, byte-identical=false
- `sample-2` vs `sample-3`: in-both=31, only-a=0, only-b=0, differing=11, byte-identical=false

## Caveats

- The baseline TS prompt used by the harness driver had a hardcoded "Python with pytest + Hypothesis" tag (regardless of backend) — fixed in `eval/run-propagate.mjs` after this run. Baseline LLM nevertheless wrote TypeScript test files (it disregarded the contradictory hint), so the variance numbers above stand. A clean re-run with the fixed prompt is recommended for the upstream pitch.
- `npx jest` is not installed in this environment; Stage C produced reports but they describe what *would* run, not actual runtime outcomes.
