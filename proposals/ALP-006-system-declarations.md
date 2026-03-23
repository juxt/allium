# ALP-6: `system` declarations

**Status**: reject

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

## Committee review

**Status: rejected.** The panel unanimously recognised the singleton problem but rejected `system` as the solution.

### Key objections

- **`default` already covers the need.** The existing `default` mechanism creates unconditionally existing named instances available to all rules, which is the singleton semantics this proposal requests. The remaining gap (preventing additional instance creation) is a cardinality constraint, not a new semantic category.
- **Surface similarity masking deep divergence.** `system` uses entity field syntax but follows none of entity's rules: no `.created` triggers, no collection semantics, direct name-based reference instead of variable binding. This is the pattern most likely to produce generation errors in LLMs and false intuitions in human readers.
- **Ambiguous keyword.** Stakeholders use "system" to mean the whole application. `system Warden` reads as though the spec is naming the system itself, not declaring a piece of internal state.
- **Implementation leakage.** The motivating examples (idempotency keys, persistence watermarks) are infrastructure coordination concerns, not domain state. A language feature that makes implementation leakage more convenient moves in the wrong direction.
- **Composition unspecified.** The proposal does not address how `system` declarations interact with `use`, `given`, relationships or `external entity`.

### Alternatives the panel identified

1. **`default` with convention.** `default Warden warden = { entries: {} }` plus a convention (or validation rule) against creating additional instances.
2. **Cardinality annotations on `entity`.** `entity Warden [1] { ... }` would solve the singleton case and generalise to bounded collections, composing with existing entity machinery rather than requiring a parallel declaration kind.

### Resubmission guidance

A revised proposal should: (a) provide motivating examples drawn from domain state rather than infrastructure bookkeeping, (b) evaluate `default unique` or a cardinality annotation as alternative designs, (c) specify how the construct composes with the module system, and (d) explain why `default` with a convention against additional instance creation is insufficient.
