# A/B harness report

- results dir: `/Users/yavorpanayotov/IdeaProjects/allium-4.0/eval/results/2026-05-16T19-29-47-784Z`
- started: 2026-05-16T19:29:47.785Z
- model: (user default)
- prompt hash: `5ec924c8`

## Per-variant summary

### experimental (6 samples)

- `allium check` pass: **6/6**
- structural counts: _entities/fields from `allium model`; rule-likes & others from text regex_
- entity-like (entity / external entity / variant) median: **6** — per-sample: 6, 6, 6, 6, 6, 6
- rule-like (rule / trigger / invariant) median: **18.5** — per-sample: 20, 23, 17, 20, 17, 17
- field count (median): **38** — per-sample: 38, 40, 35, 38, 39, 35
- other top-level constructs (totals across samples): config=6, contract=12, enum=30, surface=12, value=18
- pairwise unified-diff lines: 473, 322, 415, 339, 247, 329, 316, 270, 404, 328, 189, 297, 202, 328, 250 (median **322**)
- entity-name Jaccard across pairs (median): **1.00**
- rule-name Jaccard across pairs (median): **0.85**

  - sample-1: pass (0E / 2W / 25I)
    - info@8:17: External entity 'IncidentReport' has no obvious governing specification import i
    - info@219:11: Rule 'CompleteAssessment' listens for trigger 'CompleteAssessment' but no local 
    - info@238:11: Rule 'MarkPayoutFailed' listens for trigger 'MarkPayoutFailed' but no local surf
    - … and 24 more
  - sample-2: pass (0E / 4W / 31I)
    - warning@8:17: External entity 'IncidentReport' has no obvious governing specification import i
    - info@197:11: Rule 'RegisterPolicy' listens for trigger 'RegisterPolicy' but no local surface 
    - info@209:11: Rule 'RegisterAssessor' listens for trigger 'RegisterAssessor' but no local surf
    - … and 32 more
  - sample-3: pass (0E / 4W / 27I)
    - warning@8:17: External entity 'IncidentReport' has no obvious governing specification import i
    - info@218:11: Rule 'CompleteAssessment' listens for trigger 'CompleteAssessment' but no local 
    - info@280:11: Rule 'MarkPayoutFailed' listens for trigger 'MarkPayoutFailed' but no local surf
    - … and 28 more
  - sample-4: pass (0E / 2W / 32I)
    - info@8:17: External entity 'IncidentReport' has no obvious governing specification import i
    - info@183:11: Rule 'RegisterAssessor' listens for trigger 'RegisterAssessor' but no local surf
    - info@191:11: Rule 'RegisterPolicy' listens for trigger 'RegisterPolicy' but no local surface 
    - … and 31 more
  - sample-5: pass (0E / 2W / 37I)
    - info@8:17: External entity 'IncidentReport' has no obvious governing specification import i
    - info@213:11: Rule 'CompleteAssessment' listens for trigger 'CompleteAssessment' but no local 
    - info@259:11: Rule 'MarkPayoutFailed' listens for trigger 'MarkPayoutFailed' but no local surf
    - … and 36 more
  - sample-6: pass (0E / 2W / 29I)
    - info@8:17: External entity 'IncidentReport' has no obvious governing specification import i
    - info@200:11: Rule 'CompleteAssessment' listens for trigger 'CompleteAssessment' but no local 
    - info@217:11: Rule 'MarkPayoutFailed' listens for trigger 'MarkPayoutFailed' but no local surf
    - … and 28 more

