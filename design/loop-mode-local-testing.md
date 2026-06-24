# Trying loop mode locally (for PR reviewers)

> Companion to the [loop-mode design note](./loop-mode.md). This is a reviewer
> recipe: run `/allium:loop` from **this PR branch** against a throwaway project,
> watch it drive a goal to convergence, and feed back. Like the rest of `design/`
> it is internal and not shipped to end users.

`/allium:loop` is a plugin skill, so it only exists once Claude Code loads the
plugin. This repo is the plugin's **source**, not an installed plugin — and it
contains nothing to loop on. So testing has two parts: **load the plugin from
your checkout**, then **point it at a target project**.

---

## Prerequisites

- **Claude Code ≥ 2.1** (needs the `--plugin-dir` flag — `claude --version`).
- **The `allium` CLI** (strongly recommended). The loop's verification signal
  leans on it (`allium check` gates propagation; `allium plan` derives test
  obligations; `allium analyse` finds semantic gaps). Without it the loop
  **degrades to assisted mode** with a weaker signal — fine for a smoke test,
  but you won't see the CLI-driven phases.
  ```
  brew tap juxt/allium && brew install allium
  ```
- `allium-lsp` is optional (live diagnostics); without it checking falls back to
  CLI `allium check`, which is all the loop needs.

---

## 1. Load the plugin from this branch

`--plugin-dir` loads the plugin **directly from the working tree** — no
marketplace, no cache, nothing persisted. Point it at your checkout, but launch
Claude Code from inside your *target* project:

```bash
# in one terminal: check out the PR
git -C /path/to/allium-pr-review checkout loop-mode

# then start Claude Code in a SCRATCH project, loading the plugin from the checkout
mkdir -p /tmp/loop-demo && cd /tmp/loop-demo
claude --plugin-dir /path/to/allium-pr-review
```

Inside the session, `/allium:loop` (and `allium:distill`, `tend`, `weed`, …)
are now available. Quick non-interactive sanity check:

```bash
claude --plugin-dir /path/to/allium-pr-review \
  -p "List the skills starting with 'allium', one per line."
# → allium:allium, allium:distill, allium:elicit, allium:loop, allium:propagate, allium:tend, allium:weed
```

**Editing the skill while testing?** `--plugin-dir` reads live from the working
tree — run `/reload-plugins` to pick up your edits in the same session.

> Don't run the loop *inside* `allium-pr-review` itself — it's the plugin source,
> there's no spec or product code to loop on. Always use a separate target dir.

---

## 2. Give it something to loop on

Pick one track. Both run inside the scratch project from step 1.

### Track A — spec-first, from scratch (most representative)

An empty dir + a new-behaviour goal exercises the whole loop (entry detection →
elicit → propagate → implement → verify):

```
/allium:loop build a coffee loyalty stamp card: a stamp per purchase; every
10th stamp issues a reward that expires 30 days after it's earned
```

Elicit is interactive — expect it to ask you a couple of edge-case questions
(reopen a closed card? claim flow? expiry cascade?) before it propagates.

### Track B — bounded run from a ready spec

For a shorter, more deterministic pass, drop the reference spec from the
[appendix](#appendix-reference-spec) into the dir as `loyalty.allium` and run:

```
/allium:loop propagate tests and an implementation for loyalty.allium, then
reconcile until tests, spec and code agree
```

---

## 3. What to watch for (so feedback is targeted)

The loop should make each of these observable — flag any that's missing or wrong:

- **Entry detection (announce-and-proceed).** One line naming the chosen path
  *and* the override, then it proceeds **without** waiting for confirmation.
- **Phase markers.** `→ Gather` / `→ Act` / `→ Verify` boundaries, not a wall of
  narrated commands.
- **Spec checked before propagating.** `allium check` runs on every spec edit;
  errors/warnings resolved before tests are generated.
- **Fail-first (anti-cheat).** Newly generated tests are shown **RED before**
  implementation; a generated test is **never** edited to make it pass; `config`
  values aren't hard-coded as magic numbers in the code.
- **Verify is real.** Tests actually run; `weed` runs for drift; `allium analyse`
  runs for semantic gaps — and an analyse/weed finding **routes back into a
  `tend`**, not a shrug.
- **Caps & ledger.** Hard cap **6** ticks; **no-progress** cap of **2** identical
  ticks; resumable ledger under `.allium-loop/<goal>.json` (git-ignored).
- **Convergence report** at the end: what converged, tests/weed verdict, escalated
  vs parked open questions.

---

## 4. Feedback worth gathering

- Did **entry detection** pick the right starting mode for your goal?
- Were the **caps** (6 / 2) hit appropriately, or did it stop too early / spin?
- Did **escalation vs parking** of open questions feel right (§7 of the design note)?
- Two spots the author already flagged as possibly under-specified:
  - §2.1 says "resolve any reported issues before propagating," but `allium check`
    emits **info-level** notes and **by-design advisories** (e.g. the external-entity
    reminder) that arguably shouldn't block. Does the skill draw that line clearly?
  - The **no-progress** signal keys on tests / weed / open-question count — it does
    **not** include `allium analyse` finding count. A loop that only moves the
    analyse needle could trip the cap despite genuinely converging.

File feedback on the PR; quote the tick summary line where relevant.

---

## Cleanup

`--plugin-dir` persists nothing, so there's nothing to uninstall. Remove the
scratch dir (`rm -rf /tmp/loop-demo`); `.allium-loop/` is git-ignored if you
looped inside a repo.

---

## Appendix: reference spec

A known-good converged spec for Track B. Driving the loop manually against this
(spec-first) reached convergence in **2 ticks** — tests 13/13, `weed` clean,
`allium analyse` 0 findings (one by-design external-entity advisory on `Barista`
remains). Tick 1 implemented the rules; tick 2 added the surfaces after `analyse`
flagged the triggers as having no boundary.

```allium
-- allium: 3
-- Coffee loyalty card: a stamp per purchase; every N stamps issues a
-- reward that expires after a fixed validity window.

------------------------------------------------------------
-- External Entities
------------------------------------------------------------

external entity Barista {}

------------------------------------------------------------
-- Config
------------------------------------------------------------

config {
    stamps_per_reward: Integer = 10
    reward_validity: Duration = 30.days
}

------------------------------------------------------------
-- Entities and Variants
------------------------------------------------------------

entity LoyaltyCard {
    holder: String
    stamps: Integer
    status: active | closed
}

entity Reward {
    card: LoyaltyCard
    issued_at: Timestamp
    expires_at: Timestamp
    status: unclaimed | expired
}

------------------------------------------------------------
-- Rules
------------------------------------------------------------

rule IssueCard {
    when: IssuesCard(staff, holder)
    ensures: LoyaltyCard.created(holder: holder, stamps: 0, status: active)
}

rule CloseCard {
    when: ClosesCard(staff, card)
    requires: card.status = active
    ensures: card.status = closed
}

rule RecordPurchase {
    when: RecordsPurchase(staff, card)
    requires: card.status = active

    let new_count = card.stamps + 1

    ensures:
        if new_count >= config.stamps_per_reward:
            card.stamps = new_count - config.stamps_per_reward
            Reward.created(
                card: card,
                issued_at: now,
                expires_at: now + config.reward_validity,
                status: unclaimed
            )
        if new_count < config.stamps_per_reward:
            card.stamps = new_count
}

rule RewardExpires {
    when: reward: Reward.expires_at <= now
    requires: reward.status = unclaimed
    ensures: reward.status = expired
}

------------------------------------------------------------
-- Invariants
------------------------------------------------------------

invariant StampsWithinCycle {
    for card in LoyaltyCards:
        card.stamps >= 0 and card.stamps < config.stamps_per_reward
}

------------------------------------------------------------
-- Surfaces
------------------------------------------------------------

surface CardRegistration {
    facing staff: Barista

    provides:
        IssuesCard(staff, holder)
}

surface CardActions {
    facing staff: Barista

    context card: LoyaltyCard where status = active

    exposes:
        card.holder
        card.stamps

    provides:
        RecordsPurchase(staff, card)
        ClosesCard(staff, card)
}
```
