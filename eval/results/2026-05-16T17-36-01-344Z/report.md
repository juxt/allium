# A/B harness report

- results dir: `/Users/yavorpanayotov/IdeaProjects/allium-4.0/eval/results/2026-05-16T17-36-01-344Z`
- started: 2026-05-16T17:36:01.344Z
- model: (user default)
- prompt hash: `5ec924c8`

## Per-variant summary

### baseline (6 samples)

- `allium check` pass: **6/6**
- structural counts: _entities/fields from `allium model`; rule-likes & others from text regex_
- entity-like (entity / external entity / variant) median: **7** — per-sample: 8, 6, 8, 6, 6, 8
- rule-like (rule / trigger / invariant) median: **22.5** — per-sample: 19, 22, 24, 21, 23, 23
- field count (median): **40** — per-sample: 41, 38, 42, 37, 40, 40
- other top-level constructs (totals across samples): actor=8, config=6, contract=3, enum=22, surface=27
- pairwise unified-diff lines: 470, 544, 459, 487, 486, 584, 471, 484, 514, 584, 556, 602, 425, 478, 504 (median **487**)
- entity-name Jaccard across pairs (median): **0.75**
- rule-name Jaccard across pairs (median): **0.28**

  - sample-1: pass (0E / 4W / 26I)
    - warning@420:12: Surface 'AdjusterClaimWorkbench' binding 'adjuster' is not used in the surface b
    - warning@451:12: Surface 'IncidentReportIngest' binding 'feed' is not used in the surface body.
    - warning@22:17: External entity 'FasterPaymentsService' has no obvious governing specification i
    - … and 27 more
  - sample-2: pass (0E / 0W / 25I)
    - info@57:5: Field 'Policy.holder' is declared but not referenced elsewhere.
    - info@62:5: Field 'Policy.claims' is declared but not referenced elsewhere.
    - info@63:5: Field 'Policy.open_claims' is declared but not referenced elsewhere.
    - … and 22 more
  - sample-3: pass (0E / 2W / 24I)
    - warning@26:17: External entity 'Adjuster' has no obvious governing specification import in this
    - warning@30:17: External entity 'IncidentReportSource' has no obvious governing specification im
    - info@170:11: Rule 'RegisterPolicy' listens for trigger 'AdminRegistersPolicy' but no local su
    - … and 23 more
  - sample-4: pass (0E / 2W / 14I)
    - info@21:17: External entity 'IncidentReport' has no obvious governing specification import i
    - info@22:5: Field 'IncidentReport.source' is declared but not referenced elsewhere.
    - info@25:5: Field 'IncidentReport.description' is declared but not referenced elsewhere.
    - … and 13 more
  - sample-5: pass (0E / 2W / 19I)
    - info@17:17: External entity 'IncidentReport' has no obvious governing specification import i
    - info@178:11: Rule 'RegisterPolicy' listens for trigger 'RegisterPolicy' but no local surface 
    - info@192:11: Rule 'RegisterAssessor' listens for trigger 'RegisterAssessor' but no local surf
    - … and 18 more
  - sample-6: pass (0E / 4W / 28I)
    - warning@150:32: Status 'failed' in entity 'Payout' is never assigned by any rule ensures clause.
    - warning@91:47: Status 'approved' in entity 'Claim' has no observed transition to a different st
    - warning@23:17: External entity 'User' has no obvious governing specification import in this mod
    - … and 29 more

