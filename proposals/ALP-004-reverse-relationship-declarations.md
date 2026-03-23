# ALP-4: Reverse relationship declarations

**Status**: reject

## Problem

When two entities have a bidirectional relationship and are declared in different modules, the second module needs to add a navigation field to the first entity without reopening its declaration.

## Proposed construct

Dot-path field declaration with a cardinality suffix.

```allium
Shard.shard_cache: ShardCache for this shard
```

This declares that each `Shard` (defined in another module) has a `shard_cache` field of type `ShardCache`, with one-to-one cardinality implied by `for this shard`.

## Rationale

Bidirectional navigation is common in entity-rich specs. The alternative is to require all fields on an entity to be declared in its original definition, which either forces everything into one module or requires the owning module to anticipate all future relationships. Dot-path declarations let the module that understands the relationship declare both directions.

## Questions for the committee

1. Can any module extend any entity, or should there be a visibility/ownership mechanism (e.g. only modules that `use` an entity can extend it)?
2. What cardinality forms should be supported? `for this x` (one-to-one), `for each x` (one-to-many), bare (unspecified)?
3. Should the checker enforce that the target entity is imported via `use`?
4. Is this better handled by declaring the relationship on the owning entity and inferring the reverse navigation?

## Committee review

**Status: rejected.** The panel unanimously rejected the proposal. The underlying problem is organisational, not syntactic, and is better solved by co-locating tightly coupled entities than by cross-module extension.

### Key objections

- **Breaks entity shape locality.** Allium currently guarantees that reading an entity's declaration block reveals all its fields. Dot-path declarations scatter an entity's shape across every module that imports it, forcing readers and LLMs to aggregate field definitions from multiple files.
- **Redundant with `with` syntax.** The existing `with X = this` clause already declares relationships from the owning entity. Dot-path declarations add a second syntax for the same semantic content with weaker validation guarantees.
- **Incoherent cardinality grammar.** The `for this x` / `for each x` syntax is orthogonal to the existing singular/plural naming convention for cardinality, creating two systems for the same concept.
- **Unaddressed conflicts.** Field name collisions across modules, interaction with validation rules 1-3, cardinality enforcement and whether the mechanism generalises to derived values and projections were all unspecified.
- **Irreversible precedent.** Open entity modification across module boundaries would be difficult to walk back and would constrain every future language change.

### Panel recommendation

Tightly coupled entities that need bidirectional navigation belong in the same module. Where they must be separated, the `with` clause on the owning entity already expresses the relationship and qualified names provide cross-module navigation. The panel concluded this is better addressed by module organisation guidance than by new syntax. No resubmission path recommended.
