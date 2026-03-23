# ALP-7: `guidance:` as a rule clause and standalone declaration

**Status**: adopt (rule-level guidance adopted; standalone top-level blocks deferred)

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

## Committee review

**Status: split.** Rule-level `guidance:` adopted by consensus. Standalone top-level `guidance:` blocks deferred to the language author.

### Part 1: `guidance:` as a rule clause — adopted

The panel unanimously endorsed adding `guidance:` as an optional final clause in rules. This extends an established pattern (`guidance:` already appears in surfaces and obligation blocks) to a third host construct without interaction effects.

#### What to change in the language reference

**Rule clause sequence.** Update the rule structure to include `guidance:` as an optional final clause. The clause sequence becomes: `when`, `for`, `let`, `requires`, `ensures`, `guidance`.

**Rule structure (updated):**

```allium
rule RuleName {
    when: trigger
    for var in collection:              -- optional
        let binding = expression        -- optional
        requires: precondition          -- optional
        ensures: postcondition

    guidance:                           -- optional, always last
        -- Non-normative implementation advice.
}
```

**Semantics.** `guidance:` in a rule is non-normative implementation advice. It carries no normative weight: the checker ignores its content, PBT generation excludes it, model checking treats it as invisible. It uses the same colon-delimited, indentation-scoped syntax as `guidance:` in surfaces. Content is opaque prose (comment lines prefixed with `--`).

**Example:**

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

**Validation rules to add:**

58. `guidance:` in a rule must appear after all other clauses (after `ensures:`)
59. `guidance:` content is opaque; the checker does not parse or validate it beyond recognising the block boundary

**Formatting note.** `guidance:` uses colon-delimited, indentation-scoped syntax (consistent with `ensures:`, `exposes:`, `provides:`). It is not brace-delimited.

#### Committee answers to questions

1. `guidance:` is permitted in rules, surfaces and obligation blocks. Not on entities, config blocks or other declarations. Restrict to constructs that describe behaviour (rules, surfaces) or contracts (obligation blocks).
2. Not applicable to rule-level guidance (it is unnamed, attached to its host rule).
3. Content is opaque. Parsing guidance for entity or rule references would create normative dependencies from non-normative text, contradicting the purpose of guidance.

### Part 2: standalone top-level `guidance:` blocks — deferred

The panel split on standalone blocks. Both positions are recorded.

**The case for.** Cross-cutting implementation advice (e.g. "stream time", "federation startup ordering") affects multiple rules. Attaching it to one rule is arbitrary. A named standalone block gives the concept a home and a label that stakeholders can reference in conversation.

**The case against.** Every other top-level declaration in Allium names something the system does or is and participates in at least one dependency relationship (entities have fields, rules have triggers, surfaces have contexts). A standalone guidance block participates in none: nothing references it, nothing depends on it, it cannot be imported via `use`. Its syntax (`guidance: StreamTime`) is visually similar to a surface-level guidance clause but occupies a different scope, creating ambiguity for both human readers and LLMs. If cross-cutting concerns deserve a top-level home, expression-bearing invariants (ALP-11) may be the better vehicle.

**If adopted in future.** The panel recommends: require a PascalCase name (no unnamed blocks), keep content opaque, and place them in a dedicated section after Invariants and before Deferred Specifications.
