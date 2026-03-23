# ALP-25: Ordered collection semantics

**Status**: adopt
**Constructs affected**: relationships, projections, collection operations, field types
**Sections affected**: Entities (relationships, projections), Expression language (collection operations), Field types, Validation rules

## Problem

Allium has two collection-bearing constructs: relationships (`slots: InterviewSlot with candidacy = this`) and projections (`confirmed_slots: slots where status = confirmed`). Neither carries ordering information. The language also provides `Set<T>` and `List<T>` as compound field types, where `List<T>` is described as "ordered collection (use when order matters)" in the reference, but the relationship and projection system has no equivalent distinction.

This creates a gap when specifications need to express that items in a collection have a meaningful sequence. Consider:

```
entity Workflow {
    steps: WorkflowStep with workflow = this
}
```

Nothing in this declaration tells the reader whether the steps have a defined order. The relationship produces a collection, but the language does not say whether it is ordered or unordered. If step ordering matters to the domain (and for workflows, it almost certainly does), the spec author has two options, both unsatisfying.

The first is to add an explicit ordering field:

```
entity WorkflowStep {
    workflow: Workflow
    position: Integer
    ...
}
```

This works but forces the domain model to carry ordering as data rather than expressing it as a property of the relationship. Every rule that inserts, removes or reorders steps must manually maintain `position` values. The spec says nothing about whether `position` must be contiguous, what happens to gaps after removal, or whether two steps can share a position.

The second is to use prose:

```
entity Workflow {
    -- Steps are ordered by their position in the workflow
    steps: WorkflowStep with workflow = this
}
```

This communicates intent to human readers but is invisible to the checker. The collection operations `.first` and `.last` are documented as valid "for ordered collections", yet the checker has no way to verify that a collection is ordered before these operations are used on it. Calling `.first` on an unordered relationship is currently accepted without warning.

The ALP-12 panel identified this gap when evaluating the `.indexed` proposal. The panel unanimously concluded that `.indexed` was meaningless without a formal concept of ordered collections, because assigning positional indices to elements of an unordered set is undefined. Six of the panellists identified the absence of ordered collection semantics independently.

## Evidence

**ALP-12 rejection.** The panel's key objection was that "Allium collections are relationally defined sets. They have no inherent order." The panel recommended that ordered collections be proposed as a prerequisite before `.indexed` could be reconsidered.

**Language reference inconsistency.** The field types section defines `List<T>` as an "ordered collection (use when order matters)" and `Set<T>` as an "unordered collection of unique items". The collection operations section documents `.first` and `.last` as valid "for ordered collections". But relationship declarations and projections, which produce the majority of collections in real specifications, have no mechanism to express ordering. The distinction between ordered and unordered exists at the field-type level but not at the relationship level.

**Patterns file.** Several patterns implicitly rely on ordering without declaring it. Pattern 5 (Notification Preferences) uses `recent_pending_notifications` and creates digest batches from them, but the notification ordering (by `created_at`) is unstated. Pattern 7 (Comments with Mentions) uses `thread_depth` to impose hierarchy, which is an ordering concern handled through a workaround. Pattern 9 (Framework Integration) has an `@invariant OrderPreservation` inside the `EventSubmitter` contract, stating "Events submitted by a single module are processed in submission order." The language cannot express this ordering constraint formally.

**Domain frequency.** Ordered sequences appear across many common domains: workflow steps, processing pipelines, message queues, ranked search results, playlist tracks, form fields, approval chains, migration sequences. These are not edge cases. A specification language that cannot distinguish "these items have a sequence" from "these items are a bag" loses information that matters to the people reading and implementing the spec.

**Other specification languages.** TLA+ distinguishes sequences (ordered tuples) from sets. Sequences support operations like `Head`, `Tail`, `Append` and indexing. Alloy models ordered collections through the `util/ordering` module, which imposes a total order on a signature. UML class diagrams annotate association ends with `{ordered}` to indicate sequence. The Z notation distinguishes between sets, bags and sequences as fundamental collection types. Each of these languages found the ordered/unordered distinction necessary enough to represent formally.

## Design tensions

**Collection type vs relationship modifier.** Ordering could be expressed as a property of the collection type itself (analogous to `List<T>` vs `Set<T>`), as a modifier on relationship declarations (some annotation on the `with` clause), or as a derived property computed from entity fields (e.g. declaring that a relationship is ordered by `position`). Each approach has different consequences for the expression language, the checker and the spec author's mental model. A type-level distinction changes how collections propagate through projections and derived values. A relationship modifier keeps the type system simpler but introduces a new concept at the declaration level. A derived-ordering approach avoids new syntax but pushes maintenance burden onto the spec author, which is the current workaround.

**Intrinsic order vs sort order.** Some collections are intrinsically ordered: the sequence of steps in a workflow, the order of items in a queue. Others are unordered but can be sorted by a field: notifications sorted by timestamp, candidates sorted by score. These are different concepts. Intrinsic order means the position itself is meaningful, independent of any field value. Sort order is a view over data that could be presented differently. A solution that conflates the two will mislead in one direction: either it will allow people to treat a sorted view as a stable sequence, or it will force people to model every sort-by-field scenario as an intrinsic ordering.

**Projection interaction.** When a `where` clause filters an ordered collection, what happens to the ordering? If a workflow has ten steps in sequence and the projection `active_steps: steps where status = active` removes three of them, are the remaining seven still ordered? Preserving order through projections seems natural but has implications for how the checker reasons about collection types. If the source is ordered, is every projection of it also ordered? Or can filtering break the ordering guarantee (e.g. if the filter regroups items by a different criterion)?

**Impact on `.first` and `.last`.** These operations are already documented but lack enforcement. Formalising ordered collections creates an opportunity to restrict `.first` and `.last` to ordered collections, making the checker catch a class of errors it currently misses. But it also means that existing specs using `.first` or `.last` on relationships would need to declare ordering, which is a migration concern.

**`for` loop iteration order.** If a collection is ordered, does `for item in collection:` iterate in that order? Currently, iteration order over relationships is unspecified. Formalising ordering would create an expectation that `for` respects it, which constrains implementations. If a collection is unordered, iteration order remains unspecified, which is correct but may surprise spec authors who assume a default ordering.

**Uniqueness and ordering.** `Set<T>` is defined as a collection of unique items. If a relationship produces an ordered collection, is it an ordered set (unique items in sequence) or a list (potentially duplicates in sequence)? Relationships inherently produce unique entity instances because each entity has identity, so this tension may not arise for entity relationships. But for projections that extract fields (`confirmed_interviewers: confirmations where status = confirmed -> interviewer`), duplicates could appear if multiple confirmations reference the same interviewer. Whether ordering interacts with deduplication matters.

## Scope

This ALP addresses only the foundational question: how does the Allium language formally distinguish ordered from unordered collections? It concerns the semantics, not a specific syntax or keyword.

This ALP does not propose:

- **`.indexed` or positional access.** Those are downstream features that depend on ordered collections existing. ALP-12 should be reconsidered after this ALP is resolved.
- **Destructuring syntax.** ALP-8 was rejected on separate grounds and remains a distinct concern.
- **Sort expressions or ordering clauses.** Whether the language needs a `sorted by` construct is a design decision for the panel, not a problem this ALP defines.
- **Changes to `List<T>` or `Set<T>` field types.** These already exist and work at the field level. This ALP concerns the relationship and projection system, which is where the gap exists.

## Panel review (cycle 1)

**Status**: refine (superseded by cycle 2)
**Date**: 2026-03-19

### Summary

One proposal debated. The panel unanimously agrees the gap is real and type-level encoding is the right direction, but the proposal must commit to an ordering model and specify projection interaction before adoption.

### Key tensions

**Problem reality (resolved).** Unanimous agreement. The ALP-12 rejection identified the gap, the patterns file demonstrates it, and the `position: Integer` workaround is acknowledged as unsatisfying by all panellists. The simplicity advocate called it "ugly but honest"; the domain modelling advocate called it "domain-blind". Both characterisations are accurate.

**Type-level vs modifier (resolved).** The panel converged on type-level encoding. The composability advocate argued that modifiers do not compose and that type-level encoding gives each combination a name. The readability advocate initially preferred a modifier like `ordered` but did not rebut the composability argument. The domain modelling advocate supported starting with type-level and extending later.

**General trait system vs narrow ordering (resolved).** The creative advocate argued for a general collection-property system (ordering, uniqueness, boundedness). The simplicity advocate called this "scope creep dressed as vision". The machine reasoning and backward compatibility advocates argued that ordering is the most immediately needed property and delaying it for a general system means the gap persists indefinitely. The panel converged on solving ordering narrowly first, with the design forwards-compatible with a future general mechanism.

**Ordering model (unresolved).** The rigour advocate identified six interaction points that must be specified: (1) does `where` on an ordered collection preserve order, (2) does field extraction through projections preserve order, (3) does `for` iterate in declared order, (4) can ordering be lost and is that loss visible in the type, (5) how does ordering interact with `Set` deduplication, and (6) do collection arithmetic operators produce ordered results. The simplicity advocate and rigour advocate both insist the proposal is incomplete without answers to these questions. The machine reasoning advocate's requirement that propagation be "uniform and exceptionless" remains unaddressed.

**Intrinsic vs sort order (unresolved).** The domain modelling advocate and readability advocate agree the distinction matters: intrinsic order (the sequence is meaningful) differs from sort order (a view over data). No concrete mechanism for either was discussed, and the panel did not decide whether sort order belongs in this ALP or is a separate concern.

**Migration path (unresolved but tractable).** Existing `.first`/`.last` on unordered collections would start failing. The simplicity advocate argued this is a bugfix, not a breaking change, since the current behaviour is silently nondeterministic. The backward compatibility advocate requires an explicit migration path (warn-then-error or equivalent).

### Verdict: refine

The gap is real, type-level encoding is the right direction, and narrowly scoped ordering is the right unit of work. The next cycle must:

1. Commit to a concrete ordering model, answering at minimum the six interaction points identified by the rigour advocate.
2. Specify whether projection of an ordered collection preserves ordering by default.
3. Distinguish intrinsic order from sort order, or explicitly defer sort order to a subsequent ALP.
4. Provide a migration path for existing `.first`/`.last` usage on unordered collections.

---

## Refinement: ordering model

This section addresses the four requirements from the panel's refine verdict.

### 1. The ordering model

Relationships may be declared as ordered sequences. Ordering is a type-level property: an ordered relationship produces a `Sequence` rather than a `Set`. The distinction is visible at the declaration site and propagates through the type system.

Ordered relationships denote intrinsic ordering: the position of each element in the sequence is meaningful to the domain, independent of any field value. This is the ordering of steps in a workflow, items in a queue, or fields on a form. It is not sort order (a view derived from comparing field values), which is deferred to a subsequent ALP.

The six interaction points:

**(1) `where` on an ordered collection preserves order.** Filtering removes elements but does not reorder the survivors. `active_steps: steps where status = active` produces an ordered sub-sequence in the same relative order as the source. The result is a `Sequence`, not a `Set`. This is the conservative rule the machine reasoning advocate required: ordering propagates through projections without exception.

**(2) Field extraction through projections preserves order.** A projection that navigates through a relationship (`slot.interviewer` for each slot in an ordered collection) produces an ordered result in the same order as the source. If the navigation produces duplicates (two slots with the same interviewer), the ordered result retains duplicates in sequence order. This means field-extracted projections of ordered collections produce `Sequence` (which allows duplicates), not `Set` (which deduplicates).

**(3) `for` iterates in declared order.** When the source collection is ordered, `for item in collection:` iterates in sequence order. When the source is unordered, iteration order remains unspecified (no change from current behaviour).

**(4) Ordering can be lost, and the loss is visible in the type.** Set operations (`+`, `-`) on ordered collections produce unordered results. The union of two ordered sequences has no natural ordering, and inventing one (concatenation, interleaving) would be a design choice disguised as a default. The checker reports the type change: if `a` is ordered and `b` is ordered, `a + b` is unordered. An author who needs ordered union must specify the ordering explicitly (a future concern, potentially addressed by sort-order syntax). Assigning an ordered collection to an unordered field, or passing it where an unordered collection is expected, is valid (ordered is a subtype of unordered).

**(5) Ordering does not interact with `Set` deduplication.** Entity relationships inherently produce unique instances (each entity has identity). Ordered entity relationships are ordered sets: unique items in sequence. For field-extracted projections that may produce duplicates (see point 2), the result is a `Sequence` that retains duplicates. If the author wants deduplication, they use an explicit `.unique` operation, which produces an unordered `Set` (since deduplication discards the information about which duplicate held which position).

**(6) Collection arithmetic on ordered collections produces unordered results.** As stated in point 4. This is the one case where ordering is lost. The loss is visible in the type and flagged by the checker if the result is used where ordering is expected.

### 2. Projection preserves ordering by default

Yes. `where` clauses and field navigation on ordered collections produce ordered results. This is the uniform rule: ordering propagates through all projections and is lost only through explicit set operations or `.unique`.

### 3. Intrinsic order vs sort order

This ALP addresses intrinsic order only. Sort order (deriving a sequence from comparing field values, such as "notifications ordered by created_at") is a distinct concept requiring different syntax and semantics. Sort order is deferred to a subsequent ALP. The design here does not foreclose sort order: a future `sorted by` expression could produce a `Sequence` from a `Set`, using the same type-level machinery this ALP introduces.

### 4. Migration path

Existing specs that call `.first` or `.last` on unordered relationships are silently nondeterministic today. Under this proposal, the checker would reject `.first` and `.last` on unordered collections.

The migration uses a two-version approach:
- **Version N (introduction):** The checker emits a warning (not an error) when `.first` or `.last` is used on a collection that lacks ordering. The warning message explains the issue and suggests either declaring the relationship as ordered or removing the operation.
- **Version N+1:** The warning becomes an error.

Existing specs that do not use `.first` or `.last` are unaffected. Existing specs that use them on `List<T>` fields (already typed as ordered) are unaffected. Only `.first`/`.last` on unordered relationships require action.

---

## Panel review (cycle 2)

**Status**: adopt
**Date**: 2026-03-19

### Summary

One proposal debated in its second refinement cycle. The panel adopts the ordered collection semantics as specified in the refinement, with one reservation noted. All four requirements from the cycle 1 verdict are addressed. The ordering model is sound, the propagation rules are uniform and the migration path is proportionate.

### Present

The refinement commits to a concrete ordering model for Allium collections. Ordered relationships produce `Sequence` rather than `Set` at the type level. The model answers the six interaction points from cycle 1: `where` preserves order, field extraction preserves order, `for` iterates in declared order, set arithmetic drops order (visible in the type), ordering does not interact with deduplication, and an ordered collection is a subtype of an unordered one. Intrinsic order only; sort order is deferred. Migration is warn-then-error across two versions.

### Responses

**Simplicity advocate.** The model has one propagation rule (ordering flows through projections) and one loss rule (set arithmetic drops it). That is the right ratio. The subtyping direction (ordered assignable to unordered, not the reverse) prevents accidental misuse without requiring explicit conversion. No objection.

**Machine reasoning advocate.** The uniform propagation rule satisfies my cycle 1 requirement. No exceptions, no context-dependent behaviour: `where` preserves, field extraction preserves, `+` and `-` drop. A model can learn this with two rules rather than a table of special cases. The `.unique` producing unordered output is consistent since deduplication destroys positional information. No objection.

**Composability advocate.** The `Sequence` type composes well with existing operations. Projections of ordered collections produce ordered results, which means derived values built from projections inherit ordering transitively. The subtyping relationship (ordered is a subtype of unordered) means existing code that accepts unordered collections works unchanged. The design leaves room for a future `sorted by` to produce `Sequence` from `Set`, which is the right integration point. No objection.

**Readability advocate.** A product owner reading a spec can see that `steps` is ordered and `slots` is not, right at the declaration site. The distinction maps to how people talk about domains: "the steps are in order" versus "the slots are a pool". My concern is that `Sequence` is a more technical term than `List`, which is already in the language. The refinement should clarify how `Sequence` relates to `List<T>` for readers encountering both.

**Rigour advocate.** All six interaction points are answered, and each answer is consistent with the others. One edge case deserves attention: the refinement says field extraction on ordered collections retains duplicates. This means the result type is `Sequence` (which allows duplicates), not an ordered set (which does not). The proposal handles this correctly by introducing `.unique` as the explicit deduplication path. The type algebra is sound. I want to confirm one thing: if `a` is an ordered `Sequence` and I do `a - {x}`, the result is unordered per rule 6. This is correct, since set difference on a sequence is not well-defined without deciding whether to remove the first occurrence, the last or all. No objection.

**Domain modelling advocate.** The distinction between intrinsic order and sort order is the right call. Workflow steps have intrinsic order; notifications sorted by timestamp do not. Conflating them would be worse than having neither. Deferring sort order to a subsequent ALP keeps this proposal focused. The design does not foreclose the future addition. No objection.

**Developer experience advocate.** The migration path is well-designed. Warn in version N, error in version N+1. Authors who see the warning get a clear message: either declare ordering or remove the `.first`/`.last` call. The fact that `List<T>` fields are unaffected means the migration only touches relationship declarations, which is a smaller surface. My one concern is the naming overlap between `List<T>` (field type, ordered) and `Sequence` (relationship type, ordered). A newcomer might ask why there are two names for "ordered collection". The answer is that `List<T>` is a compound field type and `Sequence` is the collection type produced by ordered relationships, but this should be documented clearly.

**Creative advocate.** The model is sound but narrow by design, which I respect after the cycle 1 discussion. The one missed opportunity is that the refinement does not address how ordering is declared at the syntax level. The semantic model is complete, but a spec author reading this still does not know what keyword or annotation to write. That is intentionally out of scope (the ALP says "semantics, not a specific syntax"), and I accept that. But the follow-up ALP that introduces the syntax should be prioritised, since semantics without syntax is a specification of a specification.

**Backward compatibility advocate.** The warn-then-error approach is the standard migration path and is proportionate here. The refinement correctly identifies that only `.first`/`.last` on unordered relationships require action. Existing specs without those operations are untouched. The subtyping direction (ordered assignable to unordered) means existing function signatures and field types that expect unordered collections accept ordered ones without change. No objection.

### Rebuttals

**Simplicity advocate to readability advocate.** The `Sequence` vs `List<T>` naming concern is real but not a design problem. `List<T>` is a field type you declare explicitly; `Sequence` is the type the checker infers when a relationship is ordered. They occupy different positions in the grammar. The language reference should explain this in one sentence. It does not require a design change.

**Developer experience advocate to creative advocate.** The creative advocate is right that semantics without syntax is incomplete for the practitioner. But the proposal explicitly scopes itself to the foundational question. The syntax ALP should follow promptly, and the migration path cannot begin until both ALPs are adopted. This is acceptable sequencing.

**Rigour advocate to readability advocate.** On the naming point: `List<T>` already carries "ordered" semantics in the language reference. If we renamed `Sequence` to `List`, the type produced by an ordered relationship would collide with the compound field type `List<T>`. Keeping the names distinct avoids a real ambiguity at the cost of a small learning burden.

**Readability advocate to rigour advocate.** Accepted. The names need to be distinct. My concern is about documentation, not design. As long as the language reference explains the relationship between the two, I withdraw the objection.

### Synthesis

All four requirements from the cycle 1 verdict are satisfied. The ordering model answers the six interaction points with two uniform rules: ordering propagates through projections; set arithmetic drops it. The intrinsic/sort distinction is cleanly drawn, with sort order deferred. The migration path is proportionate and targets only the specs that are already silently nondeterministic.

The readability and developer experience advocates raised a documentation concern about the relationship between `Sequence` and `List<T>`. This was resolved in rebuttals: the names are necessarily distinct, and the language reference should explain the distinction. This is a documentation task, not a design change.

The creative advocate noted that the ALP provides semantics without syntax. This is by design and accepted. A follow-up ALP for declaration syntax should be prioritised.

No substantive objection survived rebuttals.

### Verdict: adopt

The ordered collection semantics are adopted as specified in the refinement. The key commitments:

1. Ordered relationships produce `Sequence` at the type level. Unordered relationships produce `Set`. `Sequence` is a subtype of `Set` (ordered collections are assignable where unordered ones are expected).
2. Ordering propagates through `where` projections, field extraction and `for` iteration. Set arithmetic (`+`, `-`) and `.unique` produce unordered results. These are the only two propagation rules.
3. This ALP addresses intrinsic order only. Sort order is deferred to a subsequent ALP, which can produce `Sequence` from `Set` using the same type-level machinery.
4. Migration is warn-then-error across two language versions, targeting `.first`/`.last` on unordered collections only.

**Implementation notes:**
- Update the language reference to document `Sequence` as a collection type alongside `Set<T>` and `List<T>`, and explain the relationship between `Sequence` and `List<T>`.
- Add validation rules for `.first`/`.last` restricted to ordered collections (warning in version N, error in version N+1).
- A follow-up ALP for declaration syntax (how an author marks a relationship as ordered) should be prioritised. The semantic model adopted here is incomplete without it.

**Reservation (creative advocate):** The semantic model is adopted, but the language cannot use it until declaration syntax is specified. The follow-up syntax ALP should not be deferred indefinitely.
