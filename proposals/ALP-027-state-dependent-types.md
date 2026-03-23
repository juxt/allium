# ALP-27: State-dependent types

**Status**: adopt
**Depends on**: ALP-20 (transition graph syntax, adopted), ALP-22 (cross-rule data dependencies, adopted), ALP-23 (state-dependent field presence, adopted)
**Related**: ALP-21 (transition edge triggers, split)
**Constructs affected**: `entity`, `variant`, field declarations, `?` (optional modifier), `transitions`, `produces`, `consumes`, derived values
**Sections affected**: entities and variants, field types, derived values, validation rules, sum types

## Problem

Allium's type system represents field presence as a static property of the entity declaration. A field is either always present or always optional (`?`). In lifecycle entities, this is a false dichotomy. Fields move between absent and present as the entity transitions through states, but the type system has no way to express that movement.

ALP-22 and ALP-23 addressed two consequences of this gap. ALP-22 introduced `produces`/`consumes` declarations so the checker can verify which fields are guaranteed present at each lifecycle position. ALP-23 adopted checker-level suppression so null-safety diagnostics are silenced when lifecycle analysis proves presence. Together, these give the checker knowledge the type system lacks: the checker knows that `tracking_number` is present when `status = shipped`, but the field's declared type remains `text?` everywhere.

The gap between what the checker knows and what the type system expresses has concrete costs.

**False optionality propagates through derived values.** The soft-delete pattern declares `deleted_at: Timestamp?` and computes `retention_expires_at: deleted_at + config.retention_period`. The derived value is implicitly `Timestamp?` because its input is optional. But `retention_expires_at` is only meaningful when `status = deleted`, at which point `deleted_at` is guaranteed present. Every downstream reference to `retention_expires_at` inherits false optionality from a field that is not actually optional in the contexts where it matters.

```
entity Document {
    status: active | deleted
    deleted_at: Timestamp?
    deleted_by: User?

    -- Implicitly Timestamp? even though it only makes sense
    -- when deleted_at is guaranteed present
    retention_expires_at: deleted_at + config.retention_period
}
```

**Null guards accumulate in rules that structurally cannot encounter nulls.** The password authentication pattern declares `locked_until: Timestamp?` on `User`. A temporal trigger that fires when the lockout expires must guard against null:

```
rule LockoutExpires {
    when: user: User.locked_until <= now
    requires: user.status = locked
    requires: user.locked_until != null  -- tautological given status = locked
    ensures: ...
}
```

ALP-23's checker suppression removes the diagnostic, but the type-level fiction remains. The field is `Timestamp?` and will be `Timestamp?` in IDE tooltips, documentation output and any tooling that reads the declared types rather than the checker's lifecycle analysis.

**The invitation pattern shows the same shape in a branching lifecycle.** `ResourceInvitation` declares `responded_at: Timestamp?`, which is guaranteed present when `status = accepted` or `status = declined` but absent when `status = pending`, `status = expired` or `status = revoked`. The field is not uniformly optional; its presence depends on which branch of the lifecycle the entity took.

**State-level guarantees are an artefact, not a declaration.** The checker derives per-state field presence from per-rule `produces` sets, then suppresses diagnostics based on the derivation. This works, but the spec author never declares "when an order is shipped, it has a tracking number". That fact is implicit in the `produces` clauses of the rules that reach the shipped state. A reader who wants to know what fields are guaranteed at a given state must either consult the checker's derived output or trace through every rule that reaches that state. The domain knowledge ("a shipped order has a tracking number") exists only as an inference, not as a statement in the spec.

**The cost is not limited to optional fields.** The broader issue is that an entity's shape, which fields it has and what their types are, changes as it moves through its lifecycle. `deleted_at` is not just "present when deleted"; it is meaningless when active. A field that is meaningless in certain states is a different problem from a field that might or might not have a value. The type system conflates the two by treating both as `?`.

## Evidence

The ALP-22 and ALP-23 panels identified this gap independently and converged on the same characterisation. ALP-22's creative advocate proposed that Allium's deeper gap is the absence of state-dependent types, arguing that if an entity's shape narrowed with its lifecycle position, data dependencies would be structurally enforced rather than annotated. The rigour, composability, developer experience and backward compatibility advocates agreed this was a compelling long-term direction but argued it exceeded ALP-22's scope. The panel unanimously recorded it as a deferred item and specified that it be "numbered and scoped as a concrete proposal rather than left as an open-ended future direction".

ALP-23's panel reached the same conclusion from a different angle. The creative advocate argued that checker-level suppression is a patch over a structural gap that mutable variants would resolve at the root. The composability advocate demonstrated that state-dependent field types propagate context-dependence through derived values and cross-entity references, which the panel took as evidence that the problem is real but hard. ALP-23's deferred items explicitly name "mutable variants" as a future ALP.

The patterns file contains four lifecycle entities exhibiting this problem:

- **Soft delete** (`Document`): `deleted_at: Timestamp?` and `deleted_by: User?`, both guaranteed present when `status = deleted` and cleared when `status = active`. The derived value `retention_expires_at` inherits false optionality.
- **Password authentication** (`User`): `locked_until: Timestamp?`, guaranteed present when `status = locked`, null otherwise. `is_locked` guards against it, but downstream rules still see the optional type.
- **Invitation** (`ResourceInvitation`): the lifecycle branches into accepted, declined, expired and revoked. Responded-at timestamps are present in some terminal states but not others.
- **Notification digest** (`DigestBatch`): `sent_at: Timestamp?`, guaranteed present when `status = sent`, null when `status = pending` or `status = failed`.

TypeScript's discriminated unions allow different field shapes per discriminator value. A union like `{ status: "pending" } | { status: "shipped"; tracking: string }` gives `tracking` a non-optional type within the `shipped` branch. Type guards narrow the union and eliminate optionality. The parallel is direct, though TypeScript's unions describe values that do not mutate, while Allium's entities transition between states.

Rust's enum variants carry different associated data. `enum Order { Pending, Shipped { tracking: String } }` guarantees that pattern matching on `Shipped` provides `tracking` without null checks. Again, the parallel holds for the type-level guarantee, though Rust enums are immutable values rather than mutable entities.

Allium's own variant mechanism demonstrates that the language already supports different field sets per discriminator value. `variant Branch : Node` and `variant Leaf : Node` carry different fields, and type guards control access. But variant discriminators are expected to be immutable: a `Branch` does not become a `Leaf`. Lifecycle status fields are mutable by definition. The gap is between shape-per-kind (which works) and shape-per-state (which does not).

Domain-driven design literature routinely describes aggregate consistency in terms of lifecycle-indexed invariants. An order in the "placed" state must have a shipping address. An order in the "shipped" state must have a tracking number. The consistency boundary changes with the lifecycle position. Allium can express these as prose invariants or as `produces` annotations, but it cannot express them as structural properties of the entity's type at each state.

## Design tensions

**Mutation vs immutability.** Allium's existing variant mechanism works because the discriminator is fixed at creation. An entity's kind does not change, so its field set does not change, and type guards can safely narrow. Lifecycle status fields change by design. An entity that is `pending` now will be `shipped` later, and its field set changes with that transition. Any mechanism that ties field presence to a discriminator must handle the fact that the discriminator mutates, which means the entity's shape mutates. This is fundamentally different from what variants do today. A mechanism that works for immutable discriminators may not extend to mutable ones, and a mechanism designed for mutable discriminators may introduce complexity that immutable cases do not need.

**Checker knowledge vs type knowledge.** ALP-22's `produces`/`consumes` and ALP-23's lifecycle suppression together give the checker a complete picture of which fields are present at each lifecycle state. The question is whether that knowledge needs to be promoted into the type system or whether checker-level reasoning is sufficient. If the checker can suppress false diagnostics and derive accurate state-level summaries, the remaining cost is presentation: IDE tooltips show `Timestamp?` when the checker knows it is `Timestamp` at the current state. Whether this presentation gap justifies type-system changes depends on how much weight the audience places on reading declared types directly versus consulting checker output. Promoting the knowledge into types eliminates the gap but introduces new complexity into the type system itself.

**Granularity of presence guarantees.** Field presence can vary at different levels of granularity. At the coarsest, a field is either "lifecycle-dependent" or "genuinely optional", with no further distinction. At the finest, each individual state carries its own field set. Between these extremes, fields could be present across ranges of states ("present from `shipped` onward"), or present in state sets ("present when `accepted` or `declined`"), or present along specific paths ("present when cancelled by a customer but not when cancelled by timeout"). The right granularity affects how much the mechanism costs authors to use and how much the checker can verify. Finer granularity is more precise but more verbose.

**Interaction with derived values.** Derived values computed from state-dependent fields inherit false optionality today. If field types were narrowed by lifecycle position, derived value types would become context-dependent: `retention_expires_at` would be `Timestamp` in the `deleted` context and undefined (or `Timestamp?`) elsewhere. This context-dependence could propagate: any consumer of the derived value would need to know the lifecycle position to know the type. For references within the same entity, this is manageable. For cross-entity references (`document.retention_expires_at` accessed from another entity), the propagation raises questions about what the consumer needs to know and how far the narrowing travels.

**Audience.** Allium specifications are read by domain experts alongside developers. Domain experts already reason in terms of state-dependent properties: "a deleted document has a deletion date" is natural domain language. The concept is accessible. The question is whether the form that expresses it reads as domain language or as type-system machinery. TypeScript's discriminated unions and Rust's enum variants are developer constructs. Allium needs a form that a product owner can read without skipping over it. A construct that the intended audience ignores or misinterprets has failed, regardless of its formal properties.

**Decidability of subtyping.** If entity shapes vary by lifecycle position, comparing shapes becomes a subtyping question: is the `shipped` shape a subtype of the `pending` shape (or vice versa)? The subtyping relationship depends on the transition graph. A field present in all states reachable from a given state is "at least as present" as a field present only in some states. Whether this subtyping is decidable given arbitrary transition graphs, and whether it remains decidable when combined with Allium's existing type features (variants, optional fields, collection types, named enums), is an open question. Allium is not compiled, so decidability matters for the checker and for LLM-based reasoning, not for a type inference algorithm. But undecidable subtyping would mean the checker cannot always determine whether a field access is safe.

**Composability with produces/consumes.** ALP-22's `produces`/`consumes` declarations are adopted and in the language reference. Any mechanism addressing state-dependent types must compose with them. If the mechanism subsumes `produces`/`consumes` (the ALP-22 panel's expectation), the migration path must be mechanical: an author with existing `produces` annotations should be able to promote them to the new mechanism without exercising judgement about what the annotations mean. If the mechanism complements rather than subsumes, the two must not create conflicting or redundant guarantees. The ALP-22 panel explicitly designed `produces` as a stepping stone, recording that "a future state-dependent type mechanism could subsume them by interpreting each `produces` clause as a narrowing assertion, making the upgrade path mechanical promotion rather than rewrite".

**Field absence vs field presence.** The problem is not only about fields becoming present. The soft-delete pattern clears `deleted_at` and `deleted_by` when restoring a document. These fields oscillate between present and absent as the entity moves between `active` and `deleted`. A mechanism that handles only fields gaining presence across the lifecycle is incomplete. One that handles both gain and loss must account for fields whose presence is not monotonic.

**The variant question.** Allium already has a construct for different field sets per discriminator value: variants. The temptation is to extend variants to handle mutable discriminators. But variants were designed for immutable kind discrimination, and their semantics depend on that immutability (the discriminator is set at creation, the field set is fixed, type guards narrow permanently). Extending them to mutable discriminators changes what "variant" means in the language. An alternative is a distinct construct that shares the concept (different fields per state) but has its own semantics suited to mutation. Whether to extend, repurpose or complement the existing variant mechanism is a foundational question that any solution must address.

## Scope

This ALP concerns the gap between Allium's static field-presence declarations and the state-dependent field-presence guarantees that lifecycle entities exhibit, specifically at the type-system level. It covers the false-optionality propagation through derived values, the mismatch between checker knowledge and declared types, the relationship between mutable lifecycle discriminators and the existing immutable variant mechanism, decidability of any resulting subtyping, and the migration path from `produces`/`consumes` annotations.

This ALP does not concern transition graph topology (ALP-20, adopted), per-rule data dependency declarations (ALP-22, adopted), or checker-level suppression of null-safety diagnostics (ALP-23, adopted). Those are foundational work that this ALP builds on. It does not concern the `produces`/`consumes` keyword naming question (ALP-24). It does not concern cross-entity field presence guarantees, which involve aggregate boundary reasoning beyond a single entity's lifecycle. It does not propose changes to the variant mechanism for immutable discriminators, which works as designed; however, the interaction between any new mechanism and existing variants is in scope.

## Panel review

**Status**: split (deferred to language author)
**Date**: 2026-03-19

### Summary

One item debated. The panel agrees unanimously that the problem is real but split 5-4 on whether it warrants type-level treatment. Five panellists (machine reasoning, composability, readability, domain modelling, creative) hold the gap is structural and a type-level mechanism is warranted. Four (simplicity, rigour, developer experience, backward compatibility) hold that checker suppression is sufficient or that the problem needs further sharpening.

### Responses

**Simplicity advocate.** The costs catalogued are presentation problems, not correctness problems. ALP-23 eliminates false diagnostics. The remaining gap (tooltips, documentation) is a tooling concern. Eight open design tensions signal that the mechanism is likely more complex than the problem it solves.

**Machine reasoning advocate.** The mismatch between declared types and checker guarantees is exactly what automated tooling handles worst. A model generating code from a spec sees `Timestamp?` and emits null-handling that can never execute. Checker suppression is invisible to anything reading declared types.

**Composability advocate.** False optionality propagates through derived values. Suppression operates within a rule's `requires` context, but derived values sit outside that context. `retention_expires_at` is `Timestamp?` everywhere, and suppression cannot change that without making derived value types context-dependent.

**Readability advocate.** Domain experts already reason in state-dependent terms. The `?` on `deleted_at` tells a product owner the field might be absent when the domain says it must be present. But the cure must read as domain language.

**Rigour advocate.** Decidability of state-indexed subtyping is unresolved. Cyclic transition graphs (soft-delete: `active -> deleted -> active`) make it non-obvious. Checker suppression requires only reachability analysis over a finite graph, which is decidable by construction.

**Domain modelling advocate.** The strongest argument: state-level field guarantees are artefacts, not declarations. A spec author cannot write "when shipped, it has a tracking number" as a structural property. The domain concept should lead; per-rule annotations are the implementation detail.

**Developer experience advocate.** Wants to see what authors would write. Checker suppression has zero authoring cost. A type-level mechanism adds something to learn. The benefit must justify that, and the proposal shows no authoring experience yet.

**Creative advocate.** The stepping stones are in place (ALP-20, 22, 23). Each solved a layer while recording that the type-level layer remained. The variant mechanism proves the language handles different field sets per discriminator. The missing piece is extending that to mutable discriminators.

**Backward compatibility advocate.** Does not object to the problem statement. Needs the migration from `produces`/`consumes` to be truly mechanical before endorsing the direction.

### Rebuttals

**Machine reasoning to simplicity:** Presentation is the primary interface for LLMs reading specs. A model does not invoke the checker. If declared type is `Timestamp?` and actual guarantee is `Timestamp`, reasoning diverges from reality.

**Simplicity to machine reasoning:** A model reading Allium should use checker output, not raw types. Solving a tooling gap with language complexity is the wrong trade.

**Rigour to creative:** Variants rely on immutability. Extending to mutable discriminators changes what type narrowing means from permanent to transient.

**Creative to rigour:** The answer is a distinct construct for state-indexed shapes, not extending variants. The proposal explicitly separates the two.

**Domain modelling to developer experience:** This is problem-statement evaluation, not solution design. Authoring experience is a solution-phase concern.

**Developer experience to domain modelling:** Adopting "the language should address this at the type level" forecloses checker-only approaches. Prefer to remain open to both.

**Composability to backward compatibility:** Mechanical promotion from `produces` is plausible: each clause is a narrowing assertion, and the checker already computes per-state summaries.

**Backward compatibility to composability:** The sketch is promising but incomplete for convergent-state gaps.

### Synthesis

The panel agrees unanimously that the problem is real. The disagreement is about what level of treatment it warrants.

The five areas from ALP-22:

1. **Type system foundations.** Agreement that any mechanism must be distinct from variants, not an extension. No agreement on feasibility.
2. **Decidability.** Unresolved. The rigour advocate raised that state-indexed subtyping over cyclic graphs is not obviously decidable. The creative advocate argued the construct need not involve subtyping. Open question.
3. **Surface syntax accessibility.** Solution-phase concern. Readability supports the direction if syntax reads as domain language. Developer experience withholds judgement.
4. **Migration from produces/consumes.** Composability sketched a mechanical path. Backward compatibility found it plausible but incomplete. Resolvable in solution phase.
5. **Interaction with variants.** Separation between immutable-kind (no change) and mutable-state (new mechanism) accepted.

### Verdict: split

**Position A (type-level mechanism warranted).** The gap between declared types and checker guarantees is structural, not presentational. Declared types propagate into derived values, IDE output, documentation and LLM-based code generation, none of which invoke the checker. Per-state field guarantees are domain concepts the language should express, not artefacts the checker derives. The stepping stones were designed to enable this work. The five areas from ALP-22 are addressable in a solution phase, with decidability as the hardest open question.

**Position B (checker suppression is sufficient).** ALP-23 eliminates false diagnostics. The remaining gap can be closed by tooling that exposes checker-derived guarantees. A type-level mechanism carries unknown authoring cost, unresolved decidability for cyclic graphs and the risk of permanent complexity for an audience that includes non-technical readers. The design tensions catalogue enough open questions to warrant further investigation before committing.

### Deferred questions for the language author

1. Does the gap between declared types and checker-derived guarantees justify type-system changes, or is better tooling that exposes checker output the right approach?
2. If the type-level direction is endorsed, the panel recommends a solution-phase ALP addressing: decidability of state-indexed narrowing over cyclic graphs, concrete surface syntax with readability evaluation, mechanical migration from `produces`/`consumes` including convergent-state cases, and the relationship to the existing variant mechanism.

**Language author decision:** The type-level direction is endorsed. The gap between declared types and checker-derived guarantees is structural. Allium specs are consumed by LLMs reading source text directly, not through tooling intermediation. The spec should be self-describing. A solution-phase refinement follows.

---

## Refinement: `when` clause on field declarations

The language author endorsed the type-level direction from Position A. This refinement presents a concrete mechanism for the panel to evaluate: a `when` clause on field declarations that ties field presence to lifecycle state.

### The mechanism

A field declaration may carry a `when` clause naming the status field and the states in which the field is present:

```
entity Order {
    status: pending | confirmed | shipped | delivered
    customer: Customer
    total: Money
    tracking_number: text when status = shipped | delivered
    shipped_at: Timestamp when status = shipped | delivered
    delivery_confirmed_at: Timestamp when status = delivered

    transitions status {
        pending -> confirmed
        confirmed -> shipped
        shipped -> delivered
        terminal: delivered
    }
}
```

A field without `when` is present in all states (no change from today). A field with `when` is present only when the named status field holds one of the listed values. The `?` modifier becomes reserved for fields that are genuinely optional regardless of lifecycle position (a user's middle name, a note that may or may not be attached).

### Semantics

**Presence and absence obligations.** Obligations fire when a rule crosses the boundary of a field's `when` set:

- **Entering** (source state outside the `when` set, target state inside): the rule must set the field.
- **Leaving** (source state inside the `when` set, target state outside): the rule must clear the field (set to null).
- **Moving within** (both states inside the `when` set): no obligation. The field is already present and remains present. The rule may update it but is not required to.
- **Moving outside** (both states outside the `when` set): no obligation.

This is the same obligation `produces` currently declares, but derived from the entity declaration rather than annotated per-rule. The checker enforces it: a rule whose `ensures` clause sets `order.status = shipped` without setting `order.tracking_number` is an error (entering the `when` set). A soft-delete `Restore` rule that sets `document.status = active` without clearing `deleted_at` is an error (leaving the `when` set).

**Access without guard.** Accessing a `when`-qualified field without a `requires` guard that narrows to a qualifying state is an error. `order.tracking_number` in a rule without `requires: order.status = shipped` (or `in {shipped, delivered}`) is rejected. This replaces the null-safety check with a lifecycle-state check.

**Derived value propagation.** A derived value computed from `when`-qualified fields inherits the intersection of their `when` sets. `days_in_transit: delivered_confirmed_at - shipped_at` is implicitly `when status = delivered` (the intersection of `{delivered}` and `{shipped, delivered}`). The checker infers this; the author does not declare it. If the intersection is empty, the derived value is unreachable and the checker reports an error.

An author may optionally annotate a derived value with an explicit `when` clause: `days_in_transit: delivered_confirmed_at - shipped_at when status = delivered`. When present, the checker verifies it matches the inferred set. A mismatch is an error. When absent, the inferred set applies silently. The checker exports inferred `when` sets as structured data alongside existing state-level summaries from ALP-22.

**Cross-entity access.** Accessing a `when`-qualified field on a related entity requires either a guard on the related entity's status or propagation through a projection that already narrows. `candidacy.order.tracking_number` requires that the rule's context narrows `order.status` to a qualifying state. The checker uses the same narrowing logic it uses today for optional fields.

### Multi-dimensional state

Entities with multiple status fields use the qualified form to disambiguate:

```
entity Document {
    status: draft | published | archived
    review: pending | approved | rejected

    transitions status { ... }
    transitions review { ... }

    published_at: Timestamp when status = published | archived
    reviewer_notes: text when review = rejected
}
```

Each `when` clause references a single status field. Compound conditions across multiple status fields (`when status = published and review = rejected`) are not supported in this proposal. Cross-field constraints remain in invariants, as ALP-19 specified. This keeps the mechanism simple: a `when` clause is a set of values on one field, and the checker's analysis is per-field reachability.

### Relationship to `produces`/`consumes`

ALP-22's `produces`/`consumes` declarations were adopted but have not been released. The `when` clause subsumes both constructs entirely: `produces` obligations are derived from entity-level `when` declarations, and `consumes` access checks are replaced by lifecycle-state narrowing. Since there is no installed base, `produces` and `consumes` are removed from the language rather than migrated. The language reference, validation rules, glossary and checker should be updated to remove them.

Convergent-transition case: if two rules reach state `shipped` and one sets `tracking_number` but the other does not, the checker reports the error at the rule that fails to set the field, since the entity declaration requires it in that state.

### Decidability

The checker performs three analyses, all decidable over finite transition graphs:

1. **Presence verification.** For each `when`-qualified field, verify that every rule transitioning to a qualifying state sets the field. This is a per-rule check against a finite set of states.
2. **Absence verification.** For each `when`-qualified field, verify that every rule transitioning away from all qualifying states clears the field. Same structure.
3. **Access verification.** For each access to a `when`-qualified field, verify that the rule's `requires` clause narrows the status to a qualifying state. This is set intersection: the guard's state set intersected with the field's `when` set must be non-empty.

None of these require subtype comparisons or global lattice operations. The cyclic graph concern (soft delete: `active -> deleted -> active`) is handled naturally: the checker verifies presence and absence obligations per-transition, not per-path. A cycle means the same transitions fire repeatedly, but each firing is checked independently.

### Interaction with variants

Variant discriminators are immutable. `when` clauses apply to mutable status fields with `transitions` blocks. The two mechanisms are orthogonal: an entity may have both a variant discriminator (for kind) and a `transitions` field (for lifecycle), and fields may carry type guards (for variant narrowing) or `when` clauses (for lifecycle narrowing) independently.

The base entity owns the transition graph. Variants inherit it unchanged and may not add states, edges or terminal declarations. Variants may add fields with `when` clauses referencing the base's states. If two variants need genuinely different lifecycles, they should be modelled as separate entities rather than variants of a shared base.

This is the most restrictive rule and the safest default. A future ALP could relax it to allow variant-extended transitions (adding states and edges without removing base edges) without breaking specs written under the restrictive rule.

### Interaction with `?`

The `?` modifier and `when` clauses occupy distinct roles. `?` means "this field may or may not have a value regardless of state" (genuinely optional). `when` means "this field is present in these states and absent in others" (lifecycle-dependent). A field may carry both: `reviewer_notes: text? when review = approved | rejected` means the field exists in those states but may still be null within them. The checker treats `?` and `when` as independent axes.

### What this does not address

- **Sort order.** Deferred per ALP-25. Orthogonal to field presence.
- **Cross-field compound conditions.** `when status = published and review = rejected` is out of scope. Cross-field constraints use invariants.
- **Cross-entity presence guarantees.** A field on entity A whose presence depends on entity B's state is out of scope. Cross-entity reasoning involves aggregate boundaries.
- **Ordered collection declaration syntax.** The follow-up to ALP-25. Orthogonal.

---

## Solution-phase panel review

**Status**: refine
**Date**: 2026-03-19

### Summary

One item debated: the concrete `when` clause mechanism for state-dependent field presence. The panel converges on the direction being sound but identifies two issues requiring a further refinement cycle before adoption. The `when` keyword reuse is acceptable. The decidability argument holds. The derived value inference model and the absence obligation each have edge cases that need tightening before the mechanism can be adopted.

### Responses

**Simplicity advocate.** The mechanism is cleaner than I expected. One keyword, one clause position, one analysis per status field. That is a significant improvement over the eight open tensions from the problem-statement phase. However, `when` now appears in three distinct syntactic positions: rule triggers (`when: ...`), surface guards (`when condition`), and field declarations (`field: Type when status = X`). The surface-guard and field-declaration uses are both colon-free, but they do different things. Surface guards control visibility of an action; field `when` declares structural presence. A model or newcomer seeing `when status = pending` in a `provides` clause and `when status = shipped` on a field declaration will need to learn that one is a runtime visibility filter and the other is a structural type constraint. The forms are distinguishable by position, not by syntax. That is manageable but worth naming explicitly.

**Machine reasoning advocate.** The positional disambiguation works for a parser. In a field declaration, `when` follows the type and precedes `=` in the status condition. In a surface, `when` follows an action or related clause. In a rule, `when:` has a colon. Three positions, three meanings, but the grammar is unambiguous at each site. An LLM generating specs can learn this from examples. The bigger concern for automated reasoning is derived value inference. If `retention_expires_at` is implicitly `when status = deleted`, a model must trace through the input fields to determine the inferred `when` set. That inference is local (same entity, same status field), so it is tractable. But when a derived value depends on another derived value that itself has an inferred `when` set, the model must chain inferences. The proposal should state whether inference chains are bounded and how the checker reports the inferred `when` set to the author.

**Composability advocate.** The mechanism composes well with transitions, variants and the module system. I tested it against each pattern:

The Order pattern (linear lifecycle) works straightforwardly. The soft-delete pattern (cyclic) requires the absence obligation. The invitation pattern (branching to terminal states) requires fields present in a subset of terminals. The notification digest pattern has `sent_at: Timestamp when status = sent`, which is clean.

The one compositional concern is the interaction between `when` and `?` on the same field. The proposal says `reviewer_notes: text? when review = approved | rejected` means the field exists in those states but may be null within them. This is coherent but introduces a reading order question: does the `?` modify `text` (making it `text?`) and then `when` scopes the presence, or does `when` scope the field and `?` makes it optional within that scope? The semantics are the same either way, but the syntax reads left to right as "text, optionally, when review equals..." which could parse ambiguously in natural language. The formal grammar is fine. The human reading is slightly awkward.

**Readability advocate.** `tracking_number: text when status = shipped | delivered` reads almost exactly like English: "the tracking number is text when the status is shipped or delivered". This is the best syntax proposed for any ALP I have reviewed. A product owner can read this and understand what it means without consulting documentation.

The absence obligation is less readable in its effect. When a domain expert sees `deleted_at: Timestamp when status = deleted`, they understand that a deleted document has a deletion timestamp. They may not intuit that restoring the document requires explicitly clearing that field. The obligation is mechanical, not domain-facing. The checker enforces it, so an author who forgets will get an error, but the mental model ("this field exists when deleted") does not surface the symmetric obligation ("this field must be cleared when not deleted").

**Rigour advocate.** The decidability argument is sound. All three checks (presence verification, absence verification, access verification) reduce to finite set operations over enum values. No path analysis, no fixpoint computation, no lattice. This resolves the concern I raised in the problem-statement phase.

Two edge cases need specification. First: what happens when a rule transitions to a state that is in the `when` set from a state that is also in the `when` set? For example, `shipped_at: Timestamp when status = shipped | delivered`. When the rule transitions from `shipped` to `delivered`, the field is already present. The presence obligation fires (the rule is transitioning to a qualifying state) but the field is already set. Must the rule set it again? That would be redundant. Must it leave it alone? Then the checker needs to distinguish "entering the `when` set from outside" from "transitioning within the `when` set". The proposal does not address this.

Second: the absence obligation says "when a rule transitions to a state where a `when`-qualified field must be absent, the rule must clear it". What counts as "transitioning away from all qualifying states"? If the `when` set is `{shipped, delivered}` and the rule transitions from `shipped` to `cancelled`, the field must be cleared. But if the rule transitions from `shipped` to `delivered`, the field stays. The check is: is the target state outside the `when` set? If yes, clear. That is straightforward. But the proposal phrases it as "transitioning away from all qualifying states", which reads as though the entity must leave the entire `when` set, not just one state. The phrasing needs tightening.

**Domain modelling advocate.** This is exactly what I argued for in the problem-statement phase. The spec author now writes "tracking number is text when status is shipped or delivered" as a structural property of the entity. The domain concept leads. The per-rule `produces` annotations were implementation details masquerading as specifications. This mechanism lets the entity declaration carry the domain knowledge directly.

The soft-delete walkthrough confirms the fit. `deleted_at: Timestamp when status = deleted` and `deleted_by: User when status = deleted` replace `deleted_at: Timestamp?` and `deleted_by: User?`, eliminating the false optionality. `retention_expires_at` infers `when status = deleted` from its dependency on `deleted_at`, so the derived value is `Timestamp` in the deleted state and nonexistent otherwise. That is the correct domain model: retention expiry is meaningful only for deleted documents.

**Developer experience advocate.** I was the strongest sceptic in the problem-statement phase. The authoring experience here is good. The `when` clause is short, reads naturally and sits in a predictable position (after the type, at the end of the field line). The error messages should be excellent: "rule RestoreDocument transitions Document to active, but field deleted_at has when status = deleted and is not cleared". That tells the author exactly what to do.

My remaining concern is the absence obligation for bulk operations. The `RestoreAll` rule in the soft-delete pattern iterates over documents and sets `d.status = active`, `d.deleted_at = null`, `d.deleted_by = null`. Under the `when` mechanism, the author must remember to clear every `when`-qualified field tied to the `deleted` state. If the entity gains a new `when status = deleted` field later, the author must find and update every rule that transitions away from `deleted`. The checker catches this, so it is not a correctness problem, but it is an ongoing maintenance burden. This is the practical cost of the absence obligation.

**Creative advocate.** The mechanism is clean and the stepping stones hold. ALP-20 gave us the transition graph. ALP-22 gave us `produces`/`consumes`. ALP-23 gave us lifecycle suppression. This proposal promotes the per-rule annotations into entity-level declarations, which is the natural progression.

The derived value inference is the most interesting part. It means the checker builds a dependency graph within the entity, traces `when` sets through arithmetic and boolean operations, and reports the inferred `when` set. This is a small type inference engine operating over a finite domain (enum values). It is bounded because the entity has a finite number of fields, each `when` clause references a finite set of enum values, and intersection over finite sets terminates. The concern about unbounded inference chains does not apply: every derived value depends on fields within the same entity, and derived values cannot be circular (validation rule 10). The chain depth is bounded by the number of fields.

**Backward compatibility advocate.** The migration path from `produces`/`consumes` is mechanical, which satisfies my concern from the problem-statement phase. The steps are:

1. For each entity with a transition graph, collect all `produces` declarations from rules that transition to each state.
2. For each field that appears in any `produces` clause, compute the union of states where it is produced. That becomes the `when` set.
3. Add the `when` clause to the field declaration, remove the `?` modifier (unless the field is genuinely optional within its `when` states).
4. Remove `produces` and `consumes` from rules.
5. The checker validates the result.

I tested this against the patterns file. The soft-delete pattern would need `produces` annotations added first (it has none currently), but the migration from a hypothetical annotated version is mechanical. The invitation pattern works: `responded_at` would gain `when status = accepted | declined`. The notification digest pattern works: `sent_at` would gain `when status = sent`.

The convergent-transition case (two rules reaching `cancelled`, one producing `cancelled_by` and the other not) is detected at step 2: the field is not uniformly produced across all inbound rules, so the `when` clause cannot be mechanically generated. The tool flags this for human review. This is the right behaviour; it was already an error under ALP-22.

The transition period (retaining `produces` alongside `when` with consistency checking) is well-designed. Existing specs can adopt incrementally.

### Rebuttals

**Rigour to creative:** The inference chain is bounded, granted. But the author cannot see the inferred `when` set without consulting the checker. If `days_in_transit` inherits `when status = delivered` from the intersection of its inputs, the entity declaration does not show this. The field reads as `days_in_transit: delivery_confirmed_at - shipped_at` with no visible lifecycle scope. A downstream consumer of this derived value must either trace the dependencies mentally or ask the checker. The mechanism should either require explicit `when` on derived values or provide a standard way for the checker to surface inferred sets.

**Creative to rigour:** Requiring explicit `when` on derived values defeats the purpose. The entire point is that the domain knowledge lives on the source fields, and derived values inherit it automatically. If we require the author to re-declare `when status = delivered` on `days_in_transit`, we have doubled the annotation burden. The checker should surface inferred sets in IDE tooltips and documentation output, but the inference should remain implicit in the source.

**Developer experience to rigour:** I agree with the creative advocate. Explicit `when` on derived values would make every computed field verbose. But the rigour advocate has a point: invisible `when` sets on derived values are surprising. The compromise is: inferred `when` sets are the default; the author may add an explicit `when` to a derived value as documentation, and the checker verifies it matches the inference.

**Simplicity to readability:** The English reading is good for presence but bad for absence. "tracking_number: text when status = shipped or delivered" naturally reads as "the tracking number exists when shipped or delivered", which implies it does not exist otherwise. The absence implication is there in the English. The problem readability identified (the obligation to clear) is an authoring concern, not a reading concern. A reader understands that the field is absent when not shipped or delivered. The author must remember to make it so in each rule. That is the checker's job.

**Machine reasoning to composability:** On the `?` interaction, the grammar is unambiguous because `?` is a type modifier and `when` is a clause. `text?` is the type, `when status = X` is the clause. There is no parsing ambiguity. The human reading is "text, optionally present, when review equals...", which could be improved to "optionally text when review equals..." but the modifier order is consistent with existing syntax (`field: Type?` already puts `?` on the type).

**Backward compatibility to developer experience:** The maintenance burden of clearing fields is real, but it exists today. When an author adds `deleted_at: Timestamp?` and writes a `Restore` rule that forgets to clear it, the field leaks into the `active` state. Today, nothing catches this. Under the `when` mechanism, the checker catches it. The maintenance burden is not new; the enforcement is.

### Synthesis

The panel agrees on six points:

1. The `when` clause syntax reads well and is accessible to domain experts.
2. The decidability argument is sound. All checks reduce to finite set operations.
3. The migration from `produces`/`consumes` is mechanical.
4. The mechanism is orthogonal to variants and composes with transitions.
5. The `when` keyword reuse is acceptable; positional disambiguation is sufficient for both parsers and humans.
6. The two-axis model (`?` for genuine optionality, `when` for lifecycle presence) is semantically sound.

Two issues remain:

**Issue 1: Transition within the `when` set.** When a rule transitions between two states that are both in a field's `when` set (e.g., `shipped` to `delivered` for a field with `when status = shipped | delivered`), the proposal does not specify whether the presence obligation fires. The field is already present. Requiring the rule to set it again is redundant. Not requiring it means the checker must distinguish "entering the when set" from "moving within it". The rigour advocate requires this to be specified. Resolution: the presence obligation fires only when the source state is outside the `when` set. Transitions within the `when` set have no obligation (the field is already present and remains present). The absence obligation fires only when the target state is outside the `when` set. This is the natural interpretation but must be stated explicitly.

**Issue 2: Visibility of inferred `when` sets on derived values.** The panel agrees that inference should be implicit (not requiring explicit annotation). But the panel also agrees that inferred `when` sets must be surfaceable. The compromise from the developer experience advocate: the author may optionally annotate a derived value with an explicit `when` clause, and the checker verifies it matches the inferred set. This provides documentation without mandating it. The checker must also export inferred `when` sets in its structured output (alongside the existing state-level field-presence summaries from ALP-22).

The absence obligation is acknowledged as a maintenance cost. The panel accepts it as a trade-off: the checker catches missing clears, which it cannot do today. The cost is proportionate to the benefit.

### Verdict: refine

The mechanism is sound in direction and largely sound in detail. Two specification gaps prevent adoption in this cycle:

1. The presence and absence obligations must specify their behaviour for transitions within the `when` set (source and target both qualifying). The natural rule is: obligations fire only when crossing the `when` set boundary (entering or leaving). This must be stated in the proposal.

2. The proposal must specify that explicit `when` clauses on derived values are optional annotations verified against the inference, and that the checker exports inferred `when` sets in structured output.

Neither issue challenges the mechanism's foundations. Both are resolvable by tightening the specification text. One more refinement cycle should reach adoption.

### Modifications for the next cycle

**Presence obligation, tightened.** When a rule transitions an entity from state A to state B:
- If A is outside the field's `when` set and B is inside, the rule must set the field (entering).
- If A is inside the field's `when` set and B is inside, the rule has no obligation regarding the field (it is already present and remains present, though the rule may update it).
- If A is inside the field's `when` set and B is outside, the rule must clear the field (leaving).
- If A is outside and B is outside, no obligation.

This reduces to: obligation fires when crossing the boundary of the `when` set, in either direction.

**Derived value annotation.** A derived value may carry an explicit `when` clause: `days_in_transit: delivery_confirmed_at - shipped_at when status = delivered`. When present, the checker verifies it matches the inferred set. A mismatch is an error. When absent, the inferred set applies silently. The checker exports inferred `when` sets as structured data alongside existing state-level summaries.

**No other changes.** The rest of the mechanism (syntax, migration, decidability, variant orthogonality, `?` interaction, multi-dimensional state) stands as proposed.

---

## Final panel review

**Status**: adopt
**Date**: 2026-03-19

### Summary

One item debated in its final refinement cycle. Both specification gaps from the previous cycle have been addressed. The panel reaches unanimous consensus to adopt the `when` clause mechanism for state-dependent field presence.

### Responses

All nine panellists report no new concerns. The two fixes (boundary-crossing obligation model, derived value inference with optional annotation) resolve the issues from the previous cycle. The six settled points (syntax readability, decidability, mechanical migration, keyword reuse, two-axis model, variant orthogonality) remain settled. No rebuttals were necessary.

### Verdict: adopt

The `when` clause mechanism for state-dependent field presence is adopted. The specification in the refinement section, incorporating both fixes, is authoritative.

**What changes:**

1. Field declarations may carry a `when` clause: `field: Type when status = value1 | value2`.
2. Fields without `when` are present in all states (unchanged from today).
3. `?` is reserved for genuinely optional fields, orthogonal to `when`.
4. Obligations fire on boundary crossings only: setting when entering the `when` set, clearing when leaving, no obligation when moving within or outside.
5. Derived values inherit the intersection of their inputs' `when` sets. Authors may optionally annotate with an explicit `when` clause, verified against inference.
6. The checker exports inferred `when` sets in structured output.
7. Multi-dimensional state uses the qualified form (`when status = X`, `when review = Y`), one status field per `when` clause.
8. `produces`/`consumes` declarations are subsumed. Migration is mechanical. A transition period retains both with consistency checking.
9. The mechanism is orthogonal to variants and does not change immutable-discriminator semantics.

**Files to update:** `references/language-reference.md` (field declaration syntax, `when` clause semantics, derived value inference, obligation model, `?` interaction, migration notes).
