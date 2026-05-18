# A/B harness report

- results dir: `/Users/yavorpanayotov/IdeaProjects/allium-4.0/eval/results/2026-05-16T20-01-07-179Z`
- started: 2026-05-16T20:01:07.179Z
- model: (user default)
- prompt hash: `5ec924c8`

## Per-variant summary

### experimental (6 samples)

- `allium check` pass: **6/6**
- structural counts: _entities/fields from `allium model`; rule-likes & others from text regex_
- entity-like (entity / external entity / variant) median: **6** — per-sample: 6, 6, 6, 6, 6, 6
- rule-like (rule / trigger / invariant) median: **21** — per-sample: 21, 21, 21, 21, 21, 21
- field count (median): **38** — per-sample: 38, 38, 40, 38, 39, 38
- other top-level constructs (totals across samples): config=5, contract=12, enum=30, surface=12, value=18
- pairwise unified-diff lines: 279, 236, 323, 333, 383, 287, 358, 285, 260, 217, 237, 295, 295, 342, 234 (median **287**)
- entity-name Jaccard across pairs (median): **1.00**
- rule-name Jaccard across pairs (median): **1.00**

  - sample-1: pass (0E / 2W / 28I)
    - info@8:17: External entity 'IncidentReport' has no obvious governing specification import i
    - info@184:11: Rule 'CompleteAssessment' listens for trigger 'CompleteAssessment' but no local 
    - info@203:11: Rule 'MarkPayoutFailed' listens for trigger 'MarkPayoutFailed' but no local surf
    - … and 27 more
  - sample-2: pass (0E / 2W / 27I)
    - info@8:17: External entity 'IncidentReport' has no obvious governing specification import i
    - info@171:11: Rule 'RegisterPolicy' listens for trigger 'RegisterPolicy' but no local surface 
    - info@182:11: Rule 'RegisterAssessor' listens for trigger 'RegisterAssessor' but no local surf
    - … and 26 more
  - sample-3: pass (0E / 2W / 29I)
    - info@8:17: External entity 'IncidentReport' has no obvious governing specification import i
    - info@168:11: Rule 'CompleteAssessment' listens for trigger 'CompleteAssessment' but no local 
    - info@185:11: Rule 'MarkPayoutFailed' listens for trigger 'MarkPayoutFailed' but no local surf
    - … and 28 more
  - sample-4: pass (0E / 2W / 32I)
    - info@8:17: External entity 'IncidentReport' has no obvious governing specification import i
    - info@226:11: Rule 'CompleteAssessment' listens for trigger 'CompleteAssessment' but no local 
    - info@243:11: Rule 'MarkPayoutFailed' listens for trigger 'MarkPayoutFailed' but no local surf
    - … and 31 more
  - sample-5: pass (0E / 2W / 33I)
    - info@8:17: External entity 'IncidentReport' has no obvious governing specification import i
    - info@194:11: Rule 'CompleteAssessment' listens for trigger 'CompleteAssessment' but no local 
    - info@225:11: Rule 'SchedulePayout' listens for trigger 'SchedulePayout' but no local surface 
    - … and 32 more
  - sample-6: pass (0E / 2W / 41I)
    - info@8:17: External entity 'IncidentReport' has no obvious governing specification import i
    - info@168:11: Rule 'RegisterPolicy' listens for trigger 'RegisterPolicy' but no local surface 
    - info@179:11: Rule 'RegisterAssessor' listens for trigger 'RegisterAssessor' but no local surf
    - … and 40 more

