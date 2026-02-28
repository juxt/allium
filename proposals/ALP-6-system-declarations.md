# ALP-6: `system` declarations

## Problem

Some entities are module-scoped singletons: there is exactly one instance per running system, and it holds coordination state that doesn't belong to any individual domain entity. The language has `entity` (zero or more instances) and `given` (externally provided module parameters), but nothing for internally managed singleton state.

## Proposed construct

`system Name { ... }` as a top-level declaration, with the same field syntax as `entity`.

```allium
system Warden {
    entries: Map<IdempotencyKey, WardenEntry>
}

system RegistrarState {
    minimum_persistence_watermark: Offset
}
```

## Rationale

`entity Warden` would parse today, but it says the wrong thing. An entity declaration implies there can be many instances, that instances are created and deleted by rules, and that lookups need identifying fields. A system singleton is none of these: it exists unconditionally, there is exactly one, and rules reference it directly by name. Using `entity` forces the reader to infer cardinality from context. `system` makes it explicit.

`given` is close but semantically wrong: `given` declares values provided from outside the module scope (configuration, external dependencies). System singletons are internal state owned and managed by the module itself.

## Questions for the committee

1. Is `system` the right keyword, or would `singleton` or `module` be clearer?
2. Should `system` declarations support fields with defaults (since the singleton always exists)?
3. Can rules create or delete system entities, or are they always-present by definition?
