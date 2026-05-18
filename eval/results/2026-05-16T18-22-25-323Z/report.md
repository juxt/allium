# A/B harness report

- results dir: `/Users/yavorpanayotov/IdeaProjects/allium-4.0/eval/results/2026-05-16T18-22-25-323Z`
- started: 2026-05-16T18:22:25.323Z
- model: (user default)
- prompt hash: `5ec924c8`

## Per-variant summary

### experimental (6 samples)

- `allium check` pass: **6/6**
- structural counts: _entities/fields from `allium model`; rule-likes & others from text regex_
- entity-like (entity / external entity / variant) median: **6** — per-sample: 8, 6, 6, 6, 8, 6
- rule-like (rule / trigger / invariant) median: **19** — per-sample: 19, 24, 22, 17, 19, 15
- field count (median): **41** — per-sample: 41, 40, 42, 41, 41, 41
- other top-level constructs (totals across samples): actor=10, config=7, contract=8, enum=26, surface=24, value=4
- pairwise unified-diff lines: 549, 429, 515, 466, 469, 428, 498, 498, 504, 388, 350, 399, 409, 457, 439 (median **457**)
- entity-name Jaccard across pairs (median): **0.75**
- rule-name Jaccard across pairs (median): **0.41**

  - sample-1: pass (0E / 4W / 26I)
    - warning@446:12: Surface 'AdjusterClaimWorkbench' binding 'adjuster' is not used in the surface b
    - warning@481:12: Surface 'IncidentReportIngest' binding 'feed' is not used in the surface body.
    - warning@18:17: External entity 'FasterPaymentsService' has no obvious governing specification i
    - … and 27 more
  - sample-2: pass (0E / 2W / 21I)
    - info@12:17: External entity 'IncidentReport' has no obvious governing specification import i
    - info@13:5: Field 'IncidentReport.report_id' is declared but not referenced elsewhere.
    - info@14:5: Field 'IncidentReport.source' is declared but not referenced elsewhere.
    - … and 20 more
  - sample-3: pass (0E / 2W / 45I)
    - info@16:17: External entity 'IncidentReport' has no obvious governing specification import i
    - info@177:11: Rule 'RegisterPolicy' listens for trigger 'RegisterPolicy' but no local surface 
    - info@188:11: Rule 'RegisterAssessor' listens for trigger 'RegisterAssessor' but no local surf
    - … and 44 more
  - sample-4: pass (0E / 4W / 23I)
    - warning@382:12: Surface 'AdjusterClaimIntake' binding 'adjuster' is not used in the surface body
    - warning@422:12: Surface 'IncidentReportWebhook' binding 'feed' is not used in the surface body.
    - info@19:17: External entity 'IncidentReport' has no obvious governing specification import i
    - … and 24 more
  - sample-5: pass (0E / 2W / 32I)
    - info@19:17: External entity 'IncidentReport' has no obvious governing specification import i
    - warning@30:17: External entity 'Adjuster' has no obvious governing specification import in this
    - warning@36:17: External entity 'IncidentFeed' has no obvious governing specification import in 
    - … and 31 more
  - sample-6: pass (0E / 0W / 10I)
    - info@258:11: Rule 'MarkPayoutFailed' listens for trigger 'PayoutMarkedFailed' but no local su
    - info@80:5: Field 'Claim.assessments' is declared but not referenced elsewhere.
    - info@81:5: Field 'Claim.payouts' is declared but not referenced elsewhere.
    - … and 7 more

