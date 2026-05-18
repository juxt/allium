# A/B harness report

- results dir: `/Users/yavorpanayotov/IdeaProjects/allium-4.0/eval/results/2026-05-16T19-43-09-600Z`
- started: 2026-05-16T19:43:09.601Z
- model: (user default)
- prompt hash: `5ec924c8`

## Per-variant summary

### experimental (6 samples)

- `allium check` pass: **6/6**
- structural counts: _entities/fields from `allium model`; rule-likes & others from text regex_
- entity-like (entity / external entity / variant) median: **6** — per-sample: 6, 6, 6, 6, 6, 6
- rule-like (rule / trigger / invariant) median: **21** — per-sample: 21, 21, 23, 21, 21, 21
- field count (median): **38** — per-sample: 38, 36, 38, 38, 38, 38
- other top-level constructs (totals across samples): config=5, contract=12, enum=30, surface=12, value=18
- pairwise unified-diff lines: 307, 322, 230, 209, 328, 167, 303, 296, 329, 310, 351, 316, 232, 261, 349 (median **307**)
- entity-name Jaccard across pairs (median): **1.00**
- rule-name Jaccard across pairs (median): **1.00**

  - sample-1: pass (0E / 2W / 31I)
    - info@8:17: External entity 'IncidentReport' has no obvious governing specification import i
    - info@187:11: Rule 'CompleteAssessment' listens for trigger 'CompleteAssessment' but no local 
    - info@204:11: Rule 'MarkPayoutFailed' listens for trigger 'MarkPayoutFailed' but no local surf
    - … and 30 more
  - sample-2: pass (0E / 2W / 30I)
    - info@8:17: External entity 'IncidentReport' has no obvious governing specification import i
    - info@170:11: Rule 'RegisterPolicy' listens for trigger 'RegisterPolicy' but no local surface 
    - info@181:11: Rule 'RegisterAssessor' listens for trigger 'RegisterAssessor' but no local surf
    - … and 29 more
  - sample-3: pass (0E / 2W / 28I)
    - info@8:17: External entity 'IncidentReport' has no obvious governing specification import i
    - info@171:11: Rule 'RegisterPolicy' listens for trigger 'RegisterPolicy' but no local surface 
    - info@182:11: Rule 'RegisterAssessor' listens for trigger 'RegisterAssessor' but no local surf
    - … and 27 more
  - sample-4: pass (0E / 2W / 32I)
    - info@8:17: External entity 'IncidentReport' has no obvious governing specification import i
    - info@180:11: Rule 'CompleteAssessment' listens for trigger 'CompleteAssessment' but no local 
    - info@197:11: Rule 'MarkPayoutFailed' listens for trigger 'MarkPayoutFailed' but no local surf
    - … and 31 more
  - sample-5: pass (0E / 2W / 34I)
    - info@8:17: External entity 'IncidentReport' has no obvious governing specification import i
    - info@235:11: Rule 'CompleteAssessment' listens for trigger 'CompleteAssessment' but no local 
    - info@256:11: Rule 'MarkPayoutFailed' listens for trigger 'MarkPayoutFailed' but no local surf
    - … and 33 more
  - sample-6: pass (0E / 2W / 27I)
    - info@8:17: External entity 'IncidentReport' has no obvious governing specification import i
    - info@184:11: Rule 'CompleteAssessment' listens for trigger 'CompleteAssessment' but no local 
    - info@203:11: Rule 'MarkPayoutFailed' listens for trigger 'MarkPayoutFailed' but no local surf
    - … and 26 more

