# A/B harness report

- results dir: `/Users/yavorpanayotov/IdeaProjects/allium-4.0/eval/results/2026-05-16T21-05-05-981Z`
- started: 2026-05-16T21:05:05.981Z
- model: (user default)
- prompt hash: `a69de20f`

## Per-variant summary

### experimental (6 samples)

- `allium check` pass: **0/6**
- structural counts: _entities/fields from `allium model`; rule-likes & others from text regex_
- entity-like (entity / external entity / variant) median: **6** — per-sample: 6, 6, 6, 6, 6, 6
- rule-like (rule / trigger / invariant) median: **21** — per-sample: 20, 21, 21, 21, 25, 21
- field count (median): **38** — per-sample: 38, 38, 38, 38, 35, 38
- other top-level constructs (totals across samples): config=6, contract=12, enum=30, surface=12, value=18
- pairwise unified-diff lines: 54, 36, 72, 94, 54, 50, 90, 94, 68, 72, 92, 42, 130, 52, 110 (median **72**)
- entity-name Jaccard across pairs (median): **1.00**
- rule-name Jaccard across pairs (median): **0.95**

  - sample-1: FAIL (12E / 2W / 39I)
    - error@252:24: expected block item (name: value, let name = value, when:/requires:/ensures: cla
    - error@361:5: expected block item (name: value, let name = value, when:/requires:/ensures: cla
    - error@362:5: expected block item (name: value, let name = value, when:/requires:/ensures: cla
    - … and 50 more
  - sample-2: FAIL (24E / 2W / 40I)
    - error@182:25: expected block item (name: value, let name = value, when:/requires:/ensures: cla
    - error@189:25: expected block item (name: value, let name = value, when:/requires:/ensures: cla
    - error@208:25: expected block item (name: value, let name = value, when:/requires:/ensures: cla
    - … and 63 more
  - sample-3: FAIL (10E / 2W / 38I)
    - error@258:24: expected block item (name: value, let name = value, when:/requires:/ensures: cla
    - error@367:5: expected block item (name: value, let name = value, when:/requires:/ensures: cla
    - error@368:5: expected block item (name: value, let name = value, when:/requires:/ensures: cla
    - … and 47 more
  - sample-4: FAIL (12E / 2W / 34I)
    - error@259:24: expected block item (name: value, let name = value, when:/requires:/ensures: cla
    - error@373:5: expected block item (name: value, let name = value, when:/requires:/ensures: cla
    - error@374:5: expected block item (name: value, let name = value, when:/requires:/ensures: cla
    - … and 45 more
  - sample-5: FAIL (16E / 2W / 35I)
    - error@246:27: expected field name, found '('
    - error@257:31: expected block item (name: value, let name = value, when:/requires:/ensures: cla
    - error@273:24: expected block item (name: value, let name = value, when:/requires:/ensures: cla
    - … and 50 more
  - sample-6: FAIL (11E / 2W / 34I)
    - error@249:26: expected field name, found '('
    - error@373:5: expected block item (name: value, let name = value, when:/requires:/ensures: cla
    - error@374:5: expected block item (name: value, let name = value, when:/requires:/ensures: cla
    - … and 44 more

