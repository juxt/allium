# ALP-24: Produces/consumes keyword naming

**Status**: reject
**Depends on**: ALP-22 (cross-rule data dependencies, adopted)
**Related**: ALP-23 (state-dependent field presence, adopted — relies on lifecycle suppression which uses these keywords)
**Constructs affected**: `produces`, `consumes` (rule clauses)
**Sections affected**: rules, data dependencies, validation rules, glossary

## Problem

The `produces` and `consumes` keywords adopted in ALP-22 use vocabulary drawn from data pipelines and ETL systems. Apache Airflow tasks declare `provide` and `consume` XCom keys. GitHub Actions steps declare `outputs` that downstream steps reference. ALP-22's evidence section cited these systems as prior art for the construct. The keywords landed in the language carrying that lineage.

Allium specifications are read by domain experts, not only developers. The language reference states this explicitly, and the principle informed the design of surfaces, actor declarations and the `@guidance`/`@guarantee` annotation conventions. The other rule clause keywords (`when`, `requires`, `ensures`) use contract or temporal vocabulary that carries no domain-specific connotation. `produces` and `consumes` come from a different register. Whether that difference matters for the audiences who read Allium specs is the question this ALP poses.

The concern was raised as a reservation by the domain modelling advocate during ALP-22's adoption panel:

> The domain modelling advocate notes that `produces`/`consumes` is pipeline vocabulary rather than domain vocabulary. The concern is mitigated by derived state-level summaries expressed in domain terms, but alternative keyword naming may be worth revisiting during specification drafting.

The mitigation cited (state-level summaries) is real but limited. Summaries are tooling output, not part of the authored spec. Authors write the per-rule clauses; readers encounter them before any derived summary. The keywords appear directly in rule bodies, which are the primary reading surface for understanding what a rule does and what it depends on.

ALP-23 deepened the language's reliance on these keywords. Lifecycle suppression (the checker omitting null-safety diagnostics when `produces` declarations prove field presence) makes them load-bearing for the type-level experience, not just for dependency tracking. As the constructs take on more responsibility, the vocabulary that names them matters more.

The problem is falsifiable: one could argue that `produces`/`consumes` reads naturally to domain experts, or that keyword naming is a cosmetic concern outweighed by convention.

## Evidence

The language reference's worked examples show the keywords in context:

```
rule ShipOrder {
    when: ShipOrder(order, tracking)
    requires: order.status = picking
    consumes: warehouse_assignment
    produces: tracking_number, shipped_at
    ensures:
        order.status = shipped
        order.tracking_number = tracking
        order.shipped_at = now
}
```

Read aloud: "This rule consumes warehouse_assignment and produces tracking_number and shipped_at." Compare: "This rule requires order.status = picking and ensures order.status = shipped." The two sentences use different registers. Whether readers notice or care is an empirical question, but the difference is present.

ALP-22's evidence section drew explicitly from pipeline systems: Pathom3 resolvers with input/output sets, Airflow `provide`/`consume` XCom keys, GitHub Actions `outputs`. The keywords were selected for conceptual alignment with these systems. The prior art is developer-facing infrastructure. Whether that lineage is visible to readers encountering the keywords in a domain specification is part of what the committee needs to assess.

The convergent-transition diagnostic (where the checker reports which inbound rule "lacks the production") also carries the pipeline register. The checker says "CancelByTimeout does not produce cancelled_by". Whether the keyword rename changes diagnostic wording is a secondary question, but the naming permeates more than just the declaration site.

ALP-22's panel reached consensus that per-rule declarations are the correct attachment point, with state-level guarantees derived from those declarations. Nine panellists agreed on the semantic design. The domain modelling advocate's reservation was specifically about naming, not about the construct's purpose or placement. This is a narrow concern about vocabulary, not about architecture.

## Design tensions

**Domain readability vs established convention.** `produces`/`consumes` aligns with prior art in pipeline and resolver systems. Developers familiar with Pathom, Airflow or similar frameworks will recognise the intent immediately. Renaming the keywords sacrifices that recognition for domain-expert readability. The question is which audience the rule-body vocabulary primarily serves, and whether the two audiences' needs are reconcilable with a single pair of keywords.

**Stability of adopted constructs.** ALP-22 has been adopted. ALP-23 depends on it. The language reference documents the keywords, the validation rules reference them, and the glossary defines them. Renaming a recently adopted construct has a cost: documentation must change, any tooling that references the keywords must update, and authors who have learned the current vocabulary must relearn. The cost is bounded (no semantic change, mechanical find-and-replace) but not zero, and it grows as adoption spreads.

**Whether the keywords matter at the reading surface.** The domain modelling advocate's own reservation acknowledged that state-level summaries, expressed in domain terms, are the primary reading surface for non-technical stakeholders. If domain experts primarily encounter "when status is shipped, tracking_number is guaranteed present" rather than `produces: tracking_number`, the keyword choice matters less than it appears. The counter-argument is that per-rule declarations are where authors spend their time, and authors include domain experts in collaborative specification sessions.

**Consistency of register.** The rule clause keywords form a set: `when`, `requires`, `produces`, `consumes`, `ensures`. The first three and the last use contract or temporal language. `produces` and `consumes` use industrial process language. Whether this inconsistency matters depends on whether readers perceive rule clauses as a unified vocabulary or as individual keywords with independent histories.

**Semantic precision of alternatives.** Any replacement keywords must carry the same semantics: `produces` is a universal post-condition (the field is non-null in every post-state of every execution), and `consumes` declares a read dependency enabling the checker to verify presence. The replacement must not weaken, broaden or shift those meanings. Some domain-friendly words may introduce ambiguity (does "requires" already cover what "consumes" means? does "guarantees" overlap with "ensures"?). The risk of semantic collision with existing keywords constrains the set of viable replacements.

## Scope

This ALP concerns the naming of the `produces` and `consumes` keywords on rules, adopted in ALP-22. It is a keyword rename with no change to the constructs' semantics, validation rules, checker behaviour or lifecycle suppression mechanism.

This ALP does not concern the design of per-rule data dependency declarations (ALP-22, adopted). It does not concern state-dependent field presence or lifecycle suppression (ALP-23, adopted). It does not propose changes to the derived state-level summaries or their vocabulary. It does not propose changes to checker diagnostic wording, though the committee may note that keyword naming influences diagnostic language.

If the committee adopts a rename, the affected sections of the language reference are mechanical: the keywords change, the validation rule identifiers update, the glossary entries update. No structural redesign is involved.

## Panel review

**Status**: refine
**Date**: 2026-03-19

### Summary

One proposal debated. The panel converged on the problem but cannot proceed without concrete replacement keywords.

### Key tensions

**Register mismatch (resolved).** The panel agrees the register mismatch is real, not cosmetic. The domain modelling advocate's reservation from ALP-22 was reinforced by three further arguments: `consumes` implies depletion (misleading for a read dependency), the `consumes`/`requires` pairing creates confusion at two levels of the same construct, and the register gap compounds across specifications. The simplicity advocate explicitly upgraded from "no objection" to "blocked on concrete proposal", acknowledging the problem while insisting on specifics.

**Inference as alternative (resolved, closed).** The creative advocate proposed eliminating keywords entirely by having the checker infer production from `ensures`. This was rebutted decisively. The composability advocate noted that restructuring `ensures` would silently change dependency declarations. The machine reasoning advocate observed that `ensures` is conditional (branching paths) while `produces` is universal quantification, making inference unsound. The backward compatibility advocate flagged that specs relying on the checker catching missing declarations would pass silently. This line was closed.

**Candidate replacements (unresolved).** No concrete pair has survived scrutiny. The readability advocate offered "guarantees"/"needs", but the machine reasoning advocate flagged that "guarantees" collides with `@guarantee` (same root word in a different syntactic position). The rigour advocate noted that "needs" is weaker than "demands" and that "guarantees" is not synonymous with "produces". The developer experience advocate's bar, that replacements must be "harder to confuse with existing keywords" rather than "sound more natural in business English", was not contested.

**Migration cost (resolved).** ALP-23 made these keywords load-bearing for lifecycle suppression. A rename touches the language reference, glossary, validation rules and diagnostics. The backward compatibility advocate confirmed the cost is bounded (mechanical find-and-replace) and grows with adoption, favouring an earlier rename if one is warranted.

### Verdict: refine

The problem is real and acknowledged across the panel. The proposal cannot be adopted or rejected without candidate replacements. The next cycle must:

1. Present a specific keyword pair with exact denotations.
2. Demonstrate zero lemma overlap with existing keywords (`requires`, `ensures`, `demands`, `fulfils`, `@guarantee`).
3. Show that the pair is harder to confuse than the current one, per the developer experience advocate's bar.

---

## Refinement: candidate keyword pairs

The existing Allium keyword inventory (from the language reference): `requires`, `ensures`, `demands`, `fulfils`, `provides`, `exposes`, `facing`, `when`, `given`, `transitions`, `terminal`, `produces`, `consumes`, `expects`, `offers`, `@guarantee`, `@guidance`, `@invariant`.

The denotations that must be preserved:

- **`produces` replacement**: universal post-condition. The named fields are guaranteed non-null in every post-state of every execution of the rule. This is stronger than `ensures` (which effects state changes that may be conditional on branches).
- **`consumes` replacement**: read-dependency declaration. The named fields are read by this rule, enabling the checker to verify they are guaranteed present given the rule's `requires` guard and the state-level guarantees at that lifecycle position.

### Candidate A: `needs` / `provides`

```
rule ShipOrder {
    when: ShipOrder(order, tracking)
    requires: order.status = picking
    needs: warehouse_assignment
    provides: tracking_number, shipped_at
    ensures: ...
}
```

**Collision analysis.** `provides` is already a surface clause keyword (`provides: AcceptInvitation(invitation, recipient) when ...`). A rule clause and a surface clause sharing the same keyword in different syntactic positions is the collision pattern the machine reasoning advocate identified as a failure mode. `needs` has moderate proximity to `requires`: both express "this rule depends on something", but they differ in kind (`requires` guards on a boolean predicate, `needs` declares field presence). Whether that distinction is clear at a glance is the question.

**Register.** Both words sit in contract language. "This rule needs warehouse_assignment and provides tracking_number" reads naturally.

### Candidate B: `needs` / `establishes`

```
rule ShipOrder {
    when: ShipOrder(order, tracking)
    requires: order.status = picking
    needs: warehouse_assignment
    establishes: tracking_number, shipped_at
    ensures: ...
}
```

**Collision analysis.** No lemma overlap with any existing keyword. `establishes` is not used anywhere in the language.

**Register.** Contract language. "This rule establishes tracking_number" reads as a guarantee being put in place. Carries the right semantic weight: establishing a field's presence is a permanent commitment from this point in the lifecycle.

**Concerns.** `establishes` is four syllables and eleven characters, longer than any existing rule clause keyword. Whether that matters depends on whether verbosity at this position is a cost or a signal.

### Candidate C: `expects` / `establishes`

```
rule ShipOrder {
    when: ShipOrder(order, tracking)
    requires: order.status = picking
    expects: warehouse_assignment
    establishes: tracking_number, shipped_at
    ensures: ...
}
```

**Collision analysis.** `expects` appeared in older obligation block syntax (pre-ALP-15) but was removed when contracts replaced obligation clauses. It does not appear as a current keyword in any active construct. No lemma overlap with active keywords.

**Register.** "This rule expects warehouse_assignment and establishes tracking_number" reads as formal contract language. `expects` is slightly stronger than `needs`: an expectation is something the system must satisfy, not merely something desired.

**Concerns.** `expects` may carry residual confusion for readers familiar with the pre-ALP-15 obligation syntax. The rigour advocate may flag the semantic difference between "expects" (an assertion that something is present) and the actual denotation (a declaration enabling the checker to verify presence).

### Candidate D: `needs` / `assures`

```
rule ShipOrder {
    when: ShipOrder(order, tracking)
    requires: order.status = picking
    needs: warehouse_assignment
    assures: tracking_number, shipped_at
    ensures: ...
}
```

**Collision analysis.** No lemma overlap. `assures` is not used in the language.

**Register.** "This rule assures tracking_number" reads as a guarantee. Close to `ensures` in meaning, but distinct: `ensures` effects a state change, `assures` declares a field-presence guarantee.

**Concerns.** `assures`/`ensures` share a suffix and rhyme. The machine reasoning advocate's test (can a model distinguish these reliably?) is the central question. The visual similarity is higher than any other candidate pair.

## Panel review (cycle 2 of 2)

**Status**: reject
**Date**: 2026-03-19

### Present

Four candidate keyword pairs are proposed to replace `produces`/`consumes` on rules. The problem (register mismatch with pipeline vocabulary) was acknowledged as real in cycle 1. This cycle evaluates whether any candidate clears the bar established by the panel: zero lemma overlap with active keywords, harder to confuse than the current pair, and preservation of the exact denotations.

The candidates are:

- **A**: `needs`/`provides`
- **B**: `needs`/`establishes`
- **C**: `expects`/`establishes`
- **D**: `needs`/`assures`

### Respond

**The simplicity advocate.** Candidate A is dead on arrival. `provides` is a surface clause keyword with heavy usage. Sharing a keyword across rule clauses and surface clauses is precisely the collision pattern the panel identified as a failure mode. Candidates B, C and D avoid active keyword collisions, but none of them reduces confusion. `needs` sits uncomfortably close to `requires`. Both express "this rule depends on something". The difference (boolean predicate vs field presence) is real but subtle, and I do not trust authors to maintain it under time pressure.

**The machine reasoning advocate.** I verified each candidate against the active keyword inventory. Candidate A fails: `provides` is active. Candidates B and D pass on lemma overlap. Candidate C passes narrowly: `expects` was removed from the language, but residual training signal from pre-ALP-15 syntax could cause models to generate obligation-block patterns when encountering the keyword. The confusability test is more concerning. `needs`/`requires` is a near-synonym pair that differs only in what follows the colon. `assures`/`ensures` differs by a single prefix character and shares a suffix. A model generating rule clauses will swap `assures` for `ensures` at a rate I would not accept. Candidate B (`needs`/`establishes`) is the cleanest on confusability, but `needs`/`requires` remains a problem shared by all three surviving candidates.

**The composability advocate.** I am testing whether these keywords generalise. `establishes` and `assures` are verbs that name what the rule does to the fields. `produces` and `consumes` are verbs that name the rule's relationship to the data flow. Both framings compose, but they compose differently. `establishes: tracking_number` implies the rule is the agent that creates the guarantee. `produces: tracking_number` implies the rule participates in a system-level flow. The current framing is more compositional: state-level guarantees are derived by intersecting `produces` sets across rules, which is a data-flow operation, not an agency operation. Renaming to agency vocabulary does not break composability, but it misaligns the vocabulary with the underlying algebra.

**The readability advocate.** "This rule needs warehouse_assignment and establishes tracking_number" reads well. Domain experts would understand it without explanation. The register matches `requires` and `ensures`. But I must weigh this against a practical concern: "needs" and "requires" will be confused. I have watched non-technical readers stumble on subtler distinctions than this. If we rename for readability and the new names create a new confusion, we have traded one problem for another.

**The rigour advocate.** The denotations must be precise. `needs` is semantically weak. A rule does not "need" the field in a general sense; it declares a read dependency that the checker uses to verify lifecycle presence. `needs` connotes desire or necessity, not a formal declaration. `expects` is closer: an expectation can be verified or violated. `establishes` correctly denotes creating a guarantee, though it implies agency rather than declaration. `assures` is close to `ensures` in both meaning and morphology, which is a problem for formal reasoning. None of these words captures "universal post-condition" or "read-dependency declaration" with the precision that `produces` and `consumes` achieve through their pipeline ancestry. The current keywords are imprecise about register but precise about semantics. The replacements improve register at the cost of semantic precision.

**The domain modelling advocate.** I raised the original reservation. The register mismatch is real and I stand by it. But having seen the four candidates, I must acknowledge that the replacement space is more constrained than I expected. `needs`/`requires` proximity is a genuine concern that I underweighted when I raised the reservation. Candidate B (`needs`/`establishes`) is the strongest option, but the `needs`/`requires` confusion is not trivial. I would accept the rename, but I would not insist on it.

**The developer experience advocate.** Day-one test: a new author reads a rule with `needs` and `requires` side by side. They ask "what's the difference?" The answer involves lifecycle position, field presence vs boolean predicate, and checker verification semantics. That is not a day-one answer. The current `consumes`/`requires` distinction is also confusing, but in a different way: the words sound unrelated, so the reader knows they must be different and looks them up. `needs`/`requires` sound related, so the reader assumes they understand and gets it wrong. This is strictly worse for learnability.

**The creative advocate.** The constraint that the replacement for `consumes` must be a single word meaning "read-dependency declaration" may be the wrong constraint. If no single word works, perhaps the construct should use a different syntactic form entirely: `reads: warehouse_assignment` is plain, carries no false connotation and is a verb that describes exactly what happens. For the production side, `guarantees: tracking_number, shipped_at` states the commitment directly. But I recognise this is a new proposal, not an evaluation of the four candidates on the table, and this is cycle 2.

**The backward compatibility advocate.** The migration cost has not changed since cycle 1: bounded, mechanical, growing with adoption. But I note that none of the four candidates has generated enthusiasm. A rename that the panel adopts with reservations will land in the language as a compromise, and compromises in keyword naming tend to be permanent. If the panel is not confident in any candidate, deferring is cheaper than adopting the wrong one.

### Rebut

**The simplicity advocate to the creative advocate.** `reads`/`guarantees` has the same `needs`/`requires` problem in a different form: `guarantees` overlaps with `@guarantee`. The root lemma "guarantee" would appear as both a rule clause keyword and a surface annotation keyword. This is the collision pattern we are trying to avoid.

**The machine reasoning advocate to the domain modelling advocate.** The fact that you would accept but not insist is telling. The original reservation was that the concern was "worth revisiting". We have revisited it. If the strongest proponent of the change would not insist, that is evidence that the replacement space does not yield a clear improvement.

**The readability advocate to the developer experience advocate.** I accept your point about `needs`/`requires`. The near-synonym problem is worse than the register problem it was meant to solve. I withdraw my support for any candidate containing `needs`.

**The rigour advocate to the composability advocate.** Your observation about agency vocabulary versus data-flow vocabulary is well taken. The checker's algebra is intersecting sets across rules. `produces` names a contribution to a set. `establishes` names an act of creation. The former maps to the formal operation; the latter maps to a narrative about the rule. Both are defensible, but switching from the formal framing to the narrative framing introduces a gap between what the keyword says and what the checker does.

**The domain modelling advocate to the machine reasoning advocate.** Accepted. The problem is real, the solutions are worse. I would rather live with pipeline vocabulary that is semantically precise than adopt contract vocabulary that creates new confusions.

**The creative advocate to the simplicity advocate.** Fair point on `guarantees`/`@guarantee`. I note, though, that the panel has now exhausted the reasonable single-word English space for these denotations without finding a pair that clears all three criteria simultaneously. That itself is a finding.

### Synthesise

The panel resolved three questions and surfaced one finding.

**Candidate A (needs/provides): eliminated.** `provides` collides with an active surface clause keyword. No panellist defended it.

**Candidate D (needs/assures): eliminated.** `assures`/`ensures` visual and phonetic similarity was flagged by the machine reasoning advocate and not contested. The confusability is worse than the current pair.

**Candidate C (expects/establishes): marginal.** No active keyword collision, but `expects` carries residual signal from removed obligation syntax. The rigour advocate noted that `expects` is an assertion, not a dependency declaration, which shifts the denotation. No panellist championed it.

**Candidate B (needs/establishes): strongest but insufficient.** Zero lemma overlap. `establishes` is semantically appropriate for the production side. But `needs`/`requires` proximity was identified as a new confusion that is strictly worse for learnability than the problem it solves. The readability advocate withdrew support on this basis. The domain modelling advocate, who raised the original reservation, declined to insist on the change.

**Finding.** The single-word English space for these denotations is more constrained than the panel anticipated. Every candidate that clears the lemma overlap criterion introduces a new confusability problem. The current keywords (`produces`/`consumes`) carry pipeline register but are semantically precise and do not create near-synonym confusion with other rule clauses. The register mismatch is a real but bounded cost. The replacement candidates each introduce an unbounded confusion cost.

### Verdict: reject

The problem is real. No candidate clears the bar. The panel agrees that `produces`/`consumes` carries pipeline vocabulary into a domain specification language, and that this register mismatch was a reasonable concern to raise. But all four candidate pairs introduce confusions that are equal to or worse than the problem they address. The `needs`/`requires` near-synonym problem recurred across three of four candidates and was identified as strictly worse for learnability. The `assures`/`ensures` similarity was identified as a confusability hazard for both humans and models. `provides` collides with an active keyword. `expects` carries residual baggage and shifts the denotation.

The panel's recommendation is to retain `produces` and `consumes`. The register mismatch is an accepted trade-off. The keywords are semantically precise, free of near-synonym confusion with other rule clauses, and aligned with the checker's underlying algebra (set intersection across rules). State-level summaries, expressed in domain terms, remain the primary reading surface for non-technical stakeholders, which limits the practical impact of the register difference at the per-rule level.

The domain modelling advocate's original reservation is discharged. The creative advocate's observation that the single-word replacement space is exhausted is recorded. If a future ALP proposes a syntactic-form change (rather than a keyword rename), the finding from this cycle should inform that design.
