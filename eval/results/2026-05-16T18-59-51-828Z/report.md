# A/B harness report

- results dir: `/Users/yavorpanayotov/IdeaProjects/allium-4.0/eval/results/2026-05-16T18-59-51-828Z`
- started: 2026-05-16T18:59:51.829Z
- model: (user default)
- prompt hash: `5ec924c8`

## Per-variant summary

### experimental (6 samples)

- `allium check` pass: **5/6**
- structural counts: _entities/fields from `allium model`; rule-likes & others from text regex_
- entity-like (entity / external entity / variant) median: **6** — per-sample: 6, 6, 6, 0, 6, 6
- rule-like (rule / trigger / invariant) median: **21** — per-sample: 17, 21, 21, 0, 21, 22
- field count (median): **39** — per-sample: 39, 40, 38, 0, 39, 40
- other top-level constructs (totals across samples): config=4, contract=9, enum=21, surface=10, value=2
- pairwise unified-diff lines: 267, 235, 307, 344, 255, 243, 367, 387, 235, 382, 309, 209, 527, 395, 341 (median **309**)
- entity-name Jaccard across pairs (median): **1.00**
- rule-name Jaccard across pairs (median): **0.68**

  - sample-1: pass (0E / 0W / 32I)
    - info@8:17: External entity 'IncidentReport' has no obvious governing specification import i
    - info@177:11: Rule 'CompleteAssessment' listens for trigger 'CompleteAssessment' but no local 
    - info@224:11: Rule 'MarkPayoutFailed' listens for trigger 'MarkPayoutFailed' but no local surf
    - … and 29 more
  - sample-2: pass (0E / 0W / 31I)
    - info@16:17: External entity 'IncidentReport' has no obvious governing specification import i
    - info@162:11: Rule 'RegisterPolicy' listens for trigger 'RegisterPolicy' but no local surface 
    - info@173:11: Rule 'RegisterAssessor' listens for trigger 'RegisterAssessor' but no local surf
    - … and 28 more
  - sample-3: pass (0E / 0W / 32I)
    - info@11:17: External entity 'IncidentReport' has no obvious governing specification import i
    - info@150:11: Rule 'RegisterPolicy' listens for trigger 'RegisterPolicy' but no local surface 
    - info@161:11: Rule 'RegisterAssessor' listens for trigger 'RegisterAssessor' but no local surf
    - … and 29 more
  - sample-4: FAIL (1E / 1W / 0I)
    - warning@1:1: missing version marker; expected '-- allium: 1' as the first line
    - error@1:1: expected declaration (entity, rule, enum, value, config, surface, actor, given, 
  - sample-5: pass (0E / 2W / 32I)
    - info@13:17: External entity 'IncidentReport' has no obvious governing specification import i
    - info@270:11: Rule 'CompleteAssessment' listens for trigger 'CompleteAssessment' but no local 
    - info@338:11: Rule 'MarkPayoutFailed' listens for trigger 'MarkPayoutFailed' but no local surf
    - … and 31 more
  - sample-6: pass (0E / 0W / 30I)
    - info@13:17: External entity 'IncidentReport' has no obvious governing specification import i
    - info@140:11: Rule 'RegisterPolicy' listens for trigger 'RegisterPolicy' but no local surface 
    - info@151:11: Rule 'RegisterAssessor' listens for trigger 'RegisterAssessor' but no local surf
    - … and 27 more

