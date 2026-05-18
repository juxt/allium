# A/B harness report

- results dir: `/Users/yavorpanayotov/IdeaProjects/allium-4.0/eval/results/2026-05-16T18-45-00-249Z`
- started: 2026-05-16T18:45:00.249Z
- model: (user default)
- prompt hash: `5ec924c8`

## Per-variant summary

### experimental (6 samples)

- `allium check` pass: **6/6**
- structural counts: _entities/fields from `allium model`; rule-likes & others from text regex_
- entity-like (entity / external entity / variant) median: **6** — per-sample: 6, 6, 6, 6, 6, 6
- rule-like (rule / trigger / invariant) median: **21** — per-sample: 20, 22, 23, 20, 22, 17
- field count (median): **38.5** — per-sample: 39, 38, 41, 38, 39, 38
- other top-level constructs (totals across samples): config=6, contract=11, enum=25, surface=9, value=2
- pairwise unified-diff lines: 378, 413, 307, 230, 249, 298, 264, 395, 220, 319, 392, 253, 340, 178, 262 (median **298**)
- entity-name Jaccard across pairs (median): **1.00**
- rule-name Jaccard across pairs (median): **0.68**

  - sample-1: pass (0E / 0W / 31I)
    - info@7:17: External entity 'IncidentReport' has no obvious governing specification import i
    - info@161:11: Rule 'RegisterPolicy' listens for trigger 'RegisterPolicy' but no local surface 
    - info@172:11: Rule 'RegisterAssessor' listens for trigger 'RegisterAssessor' but no local surf
    - … and 28 more
  - sample-2: pass (0E / 2W / 40I)
    - info@17:17: External entity 'IncidentReport' has no obvious governing specification import i
    - info@198:11: Rule 'RegisterPolicy' listens for trigger 'RegisterPolicy' but no local surface 
    - info@210:11: Rule 'RegisterAssessor' listens for trigger 'RegisterAssessor' but no local surf
    - … and 39 more
  - sample-3: pass (0E / 2W / 27I)
    - warning@13:17: External entity 'IncidentReport' has no obvious governing specification import i
    - info@14:5: Field 'IncidentReport.report_id' is declared but not referenced elsewhere.
    - info@15:5: Field 'IncidentReport.source' is declared but not referenced elsewhere.
    - … and 26 more
  - sample-4: pass (0E / 0W / 38I)
    - info@17:17: External entity 'IncidentReport' has no obvious governing specification import i
    - info@180:11: Rule 'RegisterPolicy' listens for trigger 'RegisterPolicy' but no local surface 
    - info@191:11: Rule 'RegisterAssessor' listens for trigger 'RegisterAssessor' but no local surf
    - … and 35 more
  - sample-5: pass (0E / 0W / 31I)
    - info@16:17: External entity 'IncidentReport' has no obvious governing specification import i
    - info@153:11: Rule 'RegisterPolicy' listens for trigger 'RegisterPolicy' but no local surface 
    - info@164:11: Rule 'RegisterAssessor' listens for trigger 'RegisterAssessor' but no local surf
    - … and 28 more
  - sample-6: pass (0E / 0W / 42I)
    - info@14:17: External entity 'IncidentReport' has no obvious governing specification import i
    - info@151:11: Rule 'RegisterPolicy' listens for trigger 'RegisterPolicy' but no local surface 
    - info@162:11: Rule 'RegisterAssessor' listens for trigger 'RegisterAssessor' but no local surf
    - … and 39 more

