# ALP-12: `.indexed` collection method

**Status**: reject (prerequisite: ordered collection semantics)

## Problem

When a specification needs to associate a positional offset with each element during iteration, the language offers no built-in way to do it. The workaround is to model the offset as an explicit field on the entity, which conflates a coordination concern (position in a sequence) with the domain model. This is most common when downstream behaviour depends on ordering: publishing messages at specific offsets, numbering steps in a workflow, or assigning ranks.

The current `for` loop binds a single variable per element. Without `.indexed`, specs that need positional data must either pollute the entity with an `index` field that exists only to support iteration, or rely on prose to convey ordering intent.

## Proposed construct

A new collection method, `.indexed`, that returns a collection of named records pairing each element with its zero-based position.

```allium
for item in payloads.indexed:
    KafkaPublishRequested(state.input_offset, item.index, item.value)
```

`.indexed` returns a collection where each element has two fields:

- `index`: `Integer` — the zero-based position in the collection.
- `value`: the original element.

These are named fields accessed with standard dot notation, consistent with every other field access pattern in the language. No new binding form or tuple type is required.

## Design decisions

**Named fields, not positional tuples.** The ALP-8 review concluded that anonymous positional types are inconsistent with Allium's named-field type system. `.indexed` returns records with `index` and `value` fields, accessed via the existing dot-access syntax.

**Zero-based indexing.** Offsets in downstream systems (Kafka, arrays, protocol buffers) are conventionally zero-based. A one-based alternative would require constant `- 1` adjustments in the most common use cases.

**Ordered collections only.** `.indexed` is valid on ordered collections (lists, ordered projections). Calling `.indexed` on an unordered set is a validation error — positional indexing on an unordered collection is meaningless.

**No implicit type declaration.** The return type is structural: a collection of records with `index: Integer` and `value: T` where `T` is the element type of the source collection. This does not require declaring a named value type in the spec. The fields are fixed by the language, not user-defined.

## Interaction with existing constructs

`.indexed` composes with existing collection operations:

```allium
-- Filtering before indexing (indices reflect post-filter positions)
for item in payloads where status = ready.indexed:
    emit(item.index, item.value)

-- Indexing in derived values
step_count: workflow.steps.indexed.count    -- same as workflow.steps.count

-- Nested access
for item in payloads.indexed:
    item.value.content    -- access fields on the original element
```

`.indexed` does not compose with `.count`, `.any()`, `.all()`, `.first`, or `.last` in ways that would be useful — `payloads.indexed.first.index` is always `0`. These are not errors, just pointless. The validator need not warn about them.

## What this does not include

- **Destructuring syntax.** `for (index, value) in ...` was proposed in ALP-8 and rejected. If `.indexed` usage reveals that `let` bindings create recurring friction, destructuring can be revisited as a separate proposal.
- **Keyed iteration.** `.indexed` provides positional offsets. Iteration over key-value pairs (e.g. from a map-like structure) is a different feature with different design constraints.
- **Reverse indexing.** No `.reverse_indexed` or similar. If needed, derive it: `collection.count - 1 - item.index`.

## Questions for the committee

1. Should `.indexed` be valid on `where`-filtered projections, and if so, do indices reflect pre-filter or post-filter positions?
2. Is the structural return type acceptable, or should the language define a named value type (e.g. `IndexedItem`) in the reference?
3. Are there collection operations that should be prohibited after `.indexed` (beyond the validator's existing type checks)?

## Committee review

**Status: rejected.** The panel agreed unanimously that the problem is real but the proposed solution has a missing prerequisite: Allium has no formal concept of ordered collections, and `.indexed` is meaningless without one.

### Key objections

- **No formal concept of ordered collections.** Allium collections are relationally defined sets (`EntityName with relationship = this`). They have no inherent order. `.indexed` assigns positional indices to elements of a set, which is meaningless without a defined ordering. The validator cannot enforce the "ordered collections only" restriction because the language has no way to distinguish ordered from unordered collections. Six panellists identified this independently.
- **No domain-level use cases demonstrated.** None of the nine patterns in the patterns file uses positional indexing. The motivating example (Kafka offsets) is an infrastructure concern. When ordering matters in a domain, it is expressed through explicit fields with domain names (`sequence_number`, `priority`, `rank`), which carry meaning that a generic `index` erases.
- **Implicit structural return type.** `.indexed` would introduce the first implicit structural type in a language where all types are explicitly declared. If the feature is eventually adopted, the return type should be a named built-in value type (`IndexedElement<T>`), not an implicit record.

### Resubmission guidance

The panel converged on a two-step path:

1. **Propose ordered collections first.** A separate ALP should introduce ordered sequences as a first-class concept, making ordering a property of the collection declaration (e.g. `steps: ordered Step with workflow = this`). This ALP should define what makes a collection ordered, how ordering interacts with `where` projections, and what collection operations are valid on ordered vs unordered collections.
2. **Then resubmit `.indexed`.** Once ordered collections exist, `.indexed` becomes a natural method on ordered collections with well-defined semantics. The resubmission should address the return type (named value type vs implicit structural type) and demonstrate domain-level use cases alongside infrastructure ones.

### Reservation

The readability advocate noted the risk of indefinite deferral: if ordered collections prove hard to design, the current workaround (explicit index fields) persists. The domain modelling advocate countered that explicit index fields are not a workaround but the correct domain modelling approach when ordering is a domain concept.
