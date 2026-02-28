# ALP-2: Type parameters and wildcards

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
