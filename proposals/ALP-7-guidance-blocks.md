# ALP-7: `guidance:` as a rule clause and standalone declaration

## Problem

The language documents `guidance:` as a surface clause for non-normative implementation advice. In practice, guidance is needed in two additional positions: inside rules (after `ensures:`, advising on how to implement the rule's postconditions) and as standalone top-level blocks (advising on cross-cutting concerns that don't belong to any single rule or surface).

## Proposed constructs

### 1. `guidance:` as a rule clause

```allium
rule ArbiterPartitionsBatch {
    when: cycle: ArbiterCycle.status becomes partitioning

    ensures:
        cycle.groups = PartitionIntoCausalGroups(all_events)
        cycle.status = processing

    guidance:
        -- Union-find with path compression and union by rank.
        -- For a batch of 10,000 events averaging 2 entity keys
        -- each, this is ~20,000 effectively-constant-time operations.
}
```

### 2. Standalone `guidance:` as a top-level declaration

```allium
guidance: StreamTime
    -- Stream time is derived from Kafka record timestamps rather
    -- than wall clocks. Because all instances consume the same
    -- partition with the same timestamps, stream time advances
    -- identically on every instance, preserving determinism.
```

## Rationale

Rules describe what must be true after they execute. They deliberately omit how. But some rules have non-obvious implementation strategies that affect performance, correctness or both. A `guidance:` clause after `ensures:` gives the spec author a place to record this advice without polluting the normative postconditions. Comments could serve this purpose, but `guidance:` is semantically distinct: it signals "this is implementation advice" rather than "this clarifies the spec text". Tooling can extract guidance blocks for implementation checklists, suppress them for formal analysis, or present them separately in documentation.

Standalone guidance blocks serve a similar purpose at module scope. A concept like "stream time" or "federation startup ordering" affects multiple rules. Attaching the advice to one rule would be arbitrary; a standalone block names the concept and explains it once.

## Questions for the committee

1. Should `guidance:` be permitted on all block types (rules, entities, deferred specs, config blocks), or limited to rules and surfaces?
2. Should standalone guidance blocks be required to have a name (`guidance: StreamTime`) or also permitted unnamed (`guidance:` with just an indented body)?
3. Should the checker treat guidance content as opaque (comment-like) or parse it for structure (e.g. references to entities and rules)?
