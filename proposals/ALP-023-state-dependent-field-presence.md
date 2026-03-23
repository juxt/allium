# ALP-23: State-dependent field presence

**Status**: adopt (Position B: checker-level suppression)
**Depends on**: ALP-22 (cross-rule data dependencies, adopted)
**Related**: ALP-20 (transition graph syntax, adopted), ALP-18 (finite state machine declarations, adopted)
**Constructs affected**: `entity`, `variant`, field declarations, `?` (optional modifier), `requires`, `ensures`, derived values
**Sections affected**: entities and variants, field types, derived values, validation rules

## Problem

Allium's type system treats field presence as a static property. A field is either always present (no `?` modifier) or potentially absent (`?`). This is correct for fields whose presence is independent of the entity's state: a `User` may or may not have a `middle_name`, regardless of any lifecycle position. But in lifecycle entities, many fields are coupled to state. Their presence is not a fixed property of the entity; it varies with the entity's lifecycle position.

Consider a document with soft-delete semantics:

```
entity Document {
    status: active | deleted

    deleted_at: Timestamp?
    deleted_by: User?

    transitions status {
        active -> deleted
        deleted -> active
        terminal: deleted
    }
}

rule SoftDelete {
    when: DeleteDocument(document, actor)
    requires: document.status = active
    produces: deleted_at, deleted_by
    ensures:
        document.status = deleted
        document.deleted_at = now
        document.deleted_by = actor
}

rule Restore {
    when: RestoreDocument(document)
    requires: document.status = deleted
    ensures:
        document.status = active
        document.deleted_at = null
        document.deleted_by = null
}
```

The fields `deleted_at` and `deleted_by` are typed `Timestamp?` and `User?` because they have no value when the document is `active`. But when the document is `deleted`, both fields are guaranteed present: the only path to `deleted` passes through `SoftDelete`, which sets both. The `?` modifier is correct at the entity level but misleading at the state level. A rule operating on a deleted document must treat `deleted_at` as potentially absent even though it structurally cannot be.

ALP-22's `produces`/`consumes` declarations address part of this gap. The checker can now verify that `deleted_at` is guaranteed non-null when `status = deleted` by computing state-level guarantees from per-rule `produces` sets. But the type of the field does not change. In any context where `document.deleted_at` is referenced, its type remains `Timestamp?`. Derived values computed from it are implicitly optional. Rules that read it must account for null. The checker knows the field is present; the type system does not.

This creates three concrete problems:

**1. Derived values inherit false optionality.** A derived value that depends on a state-dependent field is implicitly optional, even when it is computed only in contexts where the field is guaranteed present:

```
retention_expires_at: deleted_at + config.retention_period
```

This derived value is `Timestamp?` because `deleted_at` is `Timestamp?`. But in any state where `retention_expires_at` is meaningful (i.e. `deleted`), `deleted_at` is guaranteed present. The optionality is an artefact of the declaration, not of the domain.

**2. Defensive null checks that structurally cannot fail.** A temporal trigger that fires when a deleted document's retention period expires must guard against null even though the guard is tautological:

```
rule RetentionExpires {
    when: document: Document.retention_expires_at <= now
    requires:
        document.status = deleted
        document.retention_expires_at != null  -- structurally redundant
    ensures: ...
}
```

The `!= null` check is correct according to the type system but meaningless according to the lifecycle. Authors who omit it are technically wrong; authors who include it obscure the rule's real preconditions with noise.

**3. Variants solve shape-per-kind but not shape-per-state.** Allium's variant mechanism allows different field sets per discriminator value. A `Node` with `kind: Branch | Leaf` can have `children` on `Branch` and `data` on `Leaf`. Variant-specific fields are only accessible within type guards. Variant discriminators are typically immutable: a `Branch` does not become a `Leaf`. Lifecycle status fields are mutable by definition: an `Order` in `pending` transitions to `confirmed` transitions to `shipped`. The same entity instance passes through multiple states, gaining and losing field guarantees as it goes. Whether and how the variant mechanism relates to mutable lifecycle discriminators is an open question.

## Evidence

The patterns file contains several lifecycle entities that exhibit this problem. The password authentication pattern declares `locked_until: Timestamp?` on `User`, which is guaranteed non-null when `status = locked` and null otherwise. The soft-delete pattern declares `deleted_at: Timestamp?` and `deleted_by: User?`, guaranteed present when `status = deleted`. The invitation pattern uses `responded_at: Timestamp?`, guaranteed present when `status = accepted` or `status = declined`. In each case the field type overapproximates: it declares potential absence across all states when absence is only possible in some states.

ALP-22's panel identified this problem independently. Multiple panellists noted a tension between the checker's state-level knowledge (which fields are guaranteed present at each lifecycle stage) and the type system's static declarations (which treat those fields as unconditionally optional). All nine panellists acknowledged the gap, and the panel explicitly requested a follow-up ALP.

TypeScript's discriminated unions allow different field shapes per discriminator value: `type Order = { status: "pending" } | { status: "shipped"; tracking: string }`. Each branch of the union carries its own field set, and a type guard on `status` narrows the type to the appropriate branch. The parallel to Allium's lifecycle entities is direct, though TypeScript's unions describe immutable values where Allium's entities mutate through states.

Rust's enum variants carry different associated data per variant. A `Result<T, E>` is either `Ok(T)` or `Err(E)`, and pattern matching ensures the correct fields are accessed in each case. The structural guarantee is enforced at the type level, not by runtime checks.

Domain-driven design literature distinguishes aggregate consistency boundaries per lifecycle stage. An order in the "placed" stage must have a shipping address but need not have a tracking number. An order in the "shipped" stage must have both. These are modelled as invariants tied to lifecycle position, and the persistence layer typically enforces them through state-specific validation. Allium can express the invariants as prose (`@invariant`) but cannot enforce them structurally through the type system.

## Design tensions

**Mutation vs immutability.** Variant discriminators are typically immutable: an entity's kind is fixed at creation. Lifecycle status fields are mutable by design. Any mechanism that ties field presence to a discriminator value must account for the fact that the discriminator changes over time, which means the entity's shape changes over time. This is fundamentally different from variants, where the shape is fixed at creation. A mechanism that works for immutable discriminators may not generalise to mutable ones, and a mechanism that handles mutation may introduce complexity that immutable cases do not need.

**Checker knowledge vs type knowledge.** ALP-22's `produces`/`consumes` declarations give the checker enough information to verify field presence at each lifecycle stage. The gap is that this knowledge does not propagate into the type system: derived values, temporal triggers and downstream rules still see the static `?` type. The checker and the type system operate at different levels of precision. Whether that gap is acceptable or needs closing is a question for the committee, and the answer depends on how much weight the false-optionality and redundant-guard problems carry in practice.

**Granularity of presence guarantees.** Field presence can be tied to individual state values ("present when `status = shipped`"), to sets of states ("present when `status` is any of `shipped`, `delivered`"), or to reachability ("present in any state reachable from a rule that sets it"). Each granularity captures different information. Per-state guarantees are the most readable but may require enumerating every state. Reachability-based guarantees are more concise but harder to reason about when transitions are added or removed.

**Interaction with derived values.** Derived values computed from state-dependent fields inherit false optionality. Narrowing the field type in certain contexts would change the derived value's type in those contexts, which means derived value types become context-dependent rather than fixed. This interacts with how derived values are referenced outside the entity: a consumer that reads `document.retention_expires_at` must know the document's lifecycle position to know the field's type. The scope of the narrowing (entity-internal vs cross-entity) affects how far this complexity propagates.

**Audience.** Allium specifications are read by domain experts, not only by developers. Any mechanism that ties field presence to lifecycle state must be legible to non-technical readers. Domain experts already reason in these terms ("a deleted document has a deletion timestamp"), so the concept is natural. The question is whether the surface form that expresses it reads as domain language or as type-system machinery. A construct that domain experts skip or misread has failed its communicative purpose even if it gives the checker new power.

**Interaction with ALP-22.** ALP-22 adopted per-rule `produces`/`consumes` declarations as opt-in annotations with universal post-condition semantics. Any mechanism that addresses state-dependent field presence must compose with these declarations. If the mechanism subsumes `produces`/`consumes`, the migration path from annotations to the new mechanism must be mechanical (not requiring human judgement per instance). If it complements rather than subsumes them, the two mechanisms must not create conflicting or redundant guarantees.

**Field absence vs field presence.** The problem is framed as fields that become present at certain states. But some fields become absent: `deleted_at` is present when `deleted` and absent when `active` (cleared by `Restore`). A mechanism that only handles fields gaining presence across the lifecycle is incomplete. One that handles both gain and loss of presence is more general but must account for fields that oscillate between present and absent as the entity moves through states.

## Scope

This ALP concerns the gap between Allium's static field-presence declarations and the state-dependent field-presence guarantees that lifecycle entities exhibit. It covers the false-optionality problem in derived values, the redundant-guard problem in rules, and the mismatch between checker-level guarantees (from ALP-22) and type-level representation.

This ALP does not concern transition graph topology (ALP-20) or per-rule data dependency declarations (ALP-22), both of which are adopted. It does not propose changes to the variant mechanism for immutable discriminators, which works as designed. It does not concern cross-entity field presence guarantees, which would require reasoning about aggregate boundaries beyond a single entity's lifecycle. It does not concern the `produces`/`consumes` keyword naming question raised as a reservation in ALP-22.

## Panel debate

### Summary

The panel unanimously acknowledged the problem: static `?` modifiers overstate optionality for fields whose presence is guaranteed by lifecycle position. However, the panel could not converge on whether the problem warrants a new mechanism or is adequately addressed by ALP-22's `produces`/`consumes` declarations combined with the existing checker. The verdict is a split, deferred to the language author.

### Key tensions

**Severity of the problem.** The simplicity advocate and developer experience advocate argued the practical cost is modest (one redundant guard per rule) and any mechanism risks being worse than the disease. The machine reasoning advocate and domain modelling advocate argued the cost compounds through derived value chains and misrepresents the domain.

**Scope of the fix.** Multiple panellists converged on checker-level suppression (the checker accepts field references without null guards when `produces`/`consumes` guarantees presence) as a narrow intervention. The rigour advocate demanded a formal proof obligation for such suppression. The creative advocate argued any narrow fix is a patch over a structural gap that mutable variants would resolve at the root.

**Composability of type narrowing.** The composability advocate demonstrated that state-dependent field types propagate context-dependence virally through derived values and cross-entity references, effectively ruling out a type-level solution. The readability advocate agreed that a purely checker-level mechanism would avoid this concern.

### Rebuttals

The machine reasoning advocate challenged the simplicity advocate's characterisation of the problem as cosmetic, arguing that false optionality cascades through derived value dependency graphs rather than appearing as isolated redundant guards. The simplicity advocate countered the creative advocate's mutable variants proposal as orders of magnitude more complexity than the problem warrants. The domain modelling advocate pushed back on the developer experience advocate's "one rule for optionality" heuristic, arguing that teaching newcomers a false model (presence is static) is worse than teaching a slightly more complex correct one. The rigour advocate sharpened the machine reasoning advocate's checker-suppression idea by demanding a formal proof obligation: the checker must demonstrate that every path to the current state passes through a rule that sets the field. The backward compatibility advocate rejected mutable variants on migration cost grounds.

### Verdict: split

**Position A (no action needed).** ALP-22's `produces`/`consumes` already gives the checker the information it needs to verify field presence per state. The remaining gap is cosmetic: derived values show `?` and rules carry redundant null guards. This noise is modest, well-understood and preferable to any mechanism that introduces context-dependent field types or new surface syntax. Newcomers benefit from the simplicity of a single rule for optionality. The proposal's own design tensions section catalogues enough unsolved interactions to justify waiting.

**Position B (mechanism warranted).** False optionality is not cosmetic; it cascades through derived values, temporal triggers and downstream rules, producing a growing body of null guards that structurally cannot fail. The checker knows these fields are present; the spec should not contradict that knowledge. A checker-level suppression mechanism, where the checker silently accepts field references without null guards when lifecycle analysis proves presence, would close the gap without changing the type system or the surface syntax. This requires specifying a formal proof obligation (every path to the current state passes through a rule that sets the field) but does not require new keywords or constructs.

### Deferred items

- **Mutable variants** (raised by the creative advocate): the idea that lifecycle entities could declare their status field as a mutable variant discriminator, with field sets that change on transition, was acknowledged as intellectually coherent but rejected as too disruptive for near-term adoption. Recorded for possible future exploration as a separate ALP.
