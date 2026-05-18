# A/B harness report

- results dir: `/Users/yavorpanayotov/IdeaProjects/allium-4.0/eval/results/2026-05-16T20-13-50-389Z`
- started: 2026-05-16T20:13:50.389Z
- model: (user default)
- prompt hash: `5ec924c8`

## Per-variant summary

### experimental (6 samples)

- `allium check` pass: **6/6**
- structural counts: _entities/fields from `allium model`; rule-likes & others from text regex_
- entity-like (entity / external entity / variant) median: **6** — per-sample: 6, 6, 6, 6, 6, 6
- rule-like (rule / trigger / invariant) median: **21** — per-sample: 21, 21, 21, 21, 22, 21
- field count (median): **38** — per-sample: 38, 38, 39, 39, 38, 38
- other top-level constructs (totals across samples): config=5, contract=12, enum=30, surface=12, value=18
- pairwise unified-diff lines: 336, 284, 311, 382, 398, 158, 163, 254, 296, 124, 223, 265, 205, 267, 254 (median **265**)
- entity-name Jaccard across pairs (median): **1.00**
- rule-name Jaccard across pairs (median): **1.00**

  - sample-1: pass (0E / 2W / 24I)
    - info@8:17: External entity 'IncidentReport' has no obvious governing specification import i
    - info@211:11: Rule 'CompleteAssessment' listens for trigger 'CompleteAssessment' but no local 
    - info@230:11: Rule 'MarkPayoutFailed' listens for trigger 'MarkPayoutFailed' but no local surf
    - … and 23 more
  - sample-2: pass (0E / 2W / 25I)
    - info@8:17: External entity 'IncidentReport' has no obvious governing specification import i
    - info@202:11: Rule 'CompleteAssessment' listens for trigger 'CompleteAssessment' but no local 
    - info@223:11: Rule 'MarkPayoutFailed' listens for trigger 'MarkPayoutFailed' but no local surf
    - … and 24 more
  - sample-3: pass (0E / 4W / 29I)
    - warning@8:17: External entity 'IncidentReport' has no obvious governing specification import i
    - info@181:11: Rule 'CompleteAssessment' listens for trigger 'CompleteAssessment' but no local 
    - info@198:11: Rule 'MarkPayoutFailed' listens for trigger 'MarkPayoutFailed' but no local surf
    - … and 30 more
  - sample-4: pass (0E / 2W / 32I)
    - info@8:17: External entity 'IncidentReport' has no obvious governing specification import i
    - info@219:11: Rule 'CompleteAssessment' listens for trigger 'CompleteAssessment' but no local 
    - info@240:11: Rule 'MarkPayoutFailed' listens for trigger 'MarkPayoutFailed' but no local surf
    - … and 31 more
  - sample-5: pass (0E / 2W / 33I)
    - info@8:17: External entity 'IncidentReport' has no obvious governing specification import i
    - info@179:11: Rule 'CompleteAssessment' listens for trigger 'CompleteAssessment' but no local 
    - info@200:11: Rule 'MarkPayoutFailed' listens for trigger 'MarkPayoutFailed' but no local surf
    - … and 32 more
  - sample-6: pass (0E / 2W / 34I)
    - info@8:17: External entity 'IncidentReport' has no obvious governing specification import i
    - info@173:11: Rule 'RegisterPolicy' listens for trigger 'RegisterPolicy' but no local surface 
    - info@184:11: Rule 'RegisterAssessor' listens for trigger 'RegisterAssessor' but no local surf
    - … and 33 more

