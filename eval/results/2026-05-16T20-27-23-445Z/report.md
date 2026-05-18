# A/B harness report

- results dir: `/Users/yavorpanayotov/IdeaProjects/allium-4.0/eval/results/2026-05-16T20-27-23-445Z`
- started: 2026-05-16T20:27:23.445Z
- model: (user default)
- prompt hash: `5ec924c8`

## Per-variant summary

### experimental (6 samples)

- `allium check` pass: **6/6**
- structural counts: _entities/fields from `allium model`; rule-likes & others from text regex_
- entity-like (entity / external entity / variant) median: **6** — per-sample: 6, 6, 6, 6, 6, 6
- rule-like (rule / trigger / invariant) median: **21** — per-sample: 21, 21, 21, 21, 21, 21
- field count (median): **38** — per-sample: 38, 37, 38, 38, 38, 38
- other top-level constructs (totals across samples): config=6, contract=12, enum=30, surface=12, value=18
- pairwise unified-diff lines: 217, 304, 295, 286, 217, 213, 212, 201, 164, 107, 318, 275, 313, 256, 215 (median **217**)
- entity-name Jaccard across pairs (median): **1.00**
- rule-name Jaccard across pairs (median): **1.00**

  - sample-1: pass (0E / 2W / 28I)
    - info@8:17: External entity 'IncidentReport' has no obvious governing specification import i
    - info@170:11: Rule 'RegisterPolicy' listens for trigger 'RegisterPolicy' but no local surface 
    - info@181:11: Rule 'RegisterAssessor' listens for trigger 'RegisterAssessor' but no local surf
    - … and 27 more
  - sample-2: pass (0E / 2W / 34I)
    - info@8:17: External entity 'IncidentReport' has no obvious governing specification import i
    - info@201:11: Rule 'CompleteAssessment' listens for trigger 'CompleteAssessment' but no local 
    - info@226:11: Rule 'SchedulePayout' listens for trigger 'SchedulePayout' but no local surface 
    - … and 33 more
  - sample-3: pass (0E / 2W / 29I)
    - info@8:17: External entity 'IncidentReport' has no obvious governing specification import i
    - info@205:11: Rule 'CompleteAssessment' listens for trigger 'CompleteAssessment' but no local 
    - info@222:11: Rule 'MarkPayoutFailed' listens for trigger 'MarkPayoutFailed' but no local surf
    - … and 28 more
  - sample-4: pass (0E / 2W / 32I)
    - info@8:17: External entity 'IncidentReport' has no obvious governing specification import i
    - info@205:11: Rule 'CompleteAssessment' listens for trigger 'CompleteAssessment' but no local 
    - info@222:11: Rule 'MarkPayoutFailed' listens for trigger 'MarkPayoutFailed' but no local surf
    - … and 31 more
  - sample-5: pass (0E / 4W / 31I)
    - warning@8:17: External entity 'IncidentReport' has no obvious governing specification import i
    - info@179:11: Rule 'RegisterPolicy' listens for trigger 'RegisterPolicy' but no local surface 
    - info@191:11: Rule 'RegisterAssessor' listens for trigger 'RegisterAssessor' but no local surf
    - … and 32 more
  - sample-6: pass (0E / 2W / 31I)
    - info@8:17: External entity 'IncidentReport' has no obvious governing specification import i
    - info@179:11: Rule 'RegisterPolicy' listens for trigger 'RegisterPolicy' but no local surface 
    - info@190:11: Rule 'RegisterAssessor' listens for trigger 'RegisterAssessor' but no local surf
    - … and 30 more

