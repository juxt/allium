# ALP-4: Reverse relationship declarations

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
