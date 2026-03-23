# ALP-2: Type parameters and wildcards

**Status**: reject

## Problem

Specs describing typed framework APIs need to express "this operation works for any entity type" without enumerating concrete types. Without type parameters, field signatures lose precision (everything becomes `Any`) or rely on comments to convey type relationships the checker cannot verify.

## Proposed constructs

Type parameters `<T>` on value fields, function signatures and declarations. Wildcard `<*>` in type positions where the concrete type is irrelevant.

```allium
value EntityMap {
    get<T>: (key: EntityKey) -> T?
    put: (key: EntityKey, value: Any) -> Unit
    keyFor<T>: (entityId: String) -> EntityKey
}

-- Wildcard: the map holds codecs for different types,
-- but the consumer doesn't need to know which.
entity_types: Map<TypeId, Codec<*>>
```

## Rationale

Type parameters appear naturally when specifying generic data structures and polymorphic operations. `EntityMap.get<T>` says something precise that `EntityMap.get` returning `Any?` does not: the return type corresponds to the entity type registered for that key. `Codec<*>` says the collection is heterogeneous without forcing the spec to enumerate every concrete codec. These are documentation constructs with well-understood semantics.

## Questions for the committee

1. Should the checker track type variables (verifying that `T` flows consistently through signatures) or treat them as opaque annotations it preserves but ignores?
2. Is `<*>` sufficient as a wildcard, or does the language need bounded wildcards (`<T : Entity>`) for useful checking?
3. Should type parameters be permitted on `entity` and `value` declarations (e.g. `value Codec<T> { ... }`), or only on field signatures within them?

## Committee review

**Status: rejected.** The panel agreed the problem is real but found the proposed solution disproportionate to the need.

### Key objections

- **Underspecified.** Three open design questions with no preferred answers. The panel cannot evaluate a design that does not yet exist.
- **Scope mismatch.** The examples are infrastructure concepts (`EntityMap`, `Codec`, `TypeId`), not domain concepts. Domain models rarely need type parameters. A general-purpose feature for a narrow use case imposes costs on the whole language.
- **Readability cost.** Type parameters are programming language machinery. Introducing `get<T>: (key: EntityKey) -> T?` into a language designed for mixed technical/non-technical audiences was not justified.
- **Composability gaps.** Even opaque type parameters raise unresolved questions about where in the grammar they can appear. If `<T>` works on field signatures but not on declarations, the feature is irregular. If it works on both, the language gains parametric polymorphism at the declaration level without having designed for it.

### Alternatives the panel favoured

1. **Scoped polymorphism within obligation blocks.** Restrict any type parameter syntax to `expects`/`offers` blocks, where the audience is exclusively developers. Would require a focused follow-up proposal with complete syntax rules for that restricted scope.
2. **Invariant-based type relationships.** Use `Any` for field types and express the type relationship as a natural-language invariant (e.g. `invariant: get returns the same type that was registered for the key`). Requires no language change.

### Resubmission guidance

A revised proposal should: (a) make a concrete decision on each of the three open questions, (b) provide a complete grammar specification for the chosen design point, (c) consider scoping the feature to obligation blocks only, and (d) include worked examples demonstrating a domain-modelling use case, not only infrastructure examples.
