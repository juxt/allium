# ALP-15 debate report: Contracts replace obligation clauses

## Summary

One proposal was debated. All nine panellists supported Option D (a single `contracts:` clause with `demands`/`fulfils` direction markers) or raised concerns that were resolved through validation rules during rebuttals. The panel reached consensus to adopt Option D with three validation constraints specified by the rigour advocate.

## Items debated

### Contracts replace obligation clauses

**Proposal.** Surfaces currently use two keyword pairs: `exposes`/`provides` for data visibility and actions, and `expects`/`offers` for typed API contracts. The second pair is redundant with module-level `contract` declarations and creates vocabulary confusion with `provides`/`offers` (the ALP-14 problem). Option D eliminates `expects` and `offers`, removes inline obligation blocks, and introduces a single `contracts:` clause on surfaces where each entry carries a `demands` or `fulfils` direction marker.

**Key tensions.**

The simplicity advocate questioned whether `demands`/`fulfils` modifiers earn their keep, suggesting Option B (direction on the contract declaration) might be simpler. The developer experience advocate and readability advocate pushed back: direction at the binding site is more intuitive because the reader sees the boundary relationship in the surface itself, without consulting the contract declaration. The simplicity advocate conceded the entanglement argument, noting that baking direction into the contract mixes two logically separate concerns.

The machine reasoning advocate flagged that `demands Name` / `fulfils Name` entries are a novel syntactic pattern: other colon-delimited lists contain bare names or expressions, not modifier-name pairs. The composability advocate countered that the language already has modifier-name patterns (e.g. `facing role: Type`), making this less irregular than claimed. The machine reasoning advocate accepted Option D on the condition that the grammar is strict and narrow.

The rigour advocate asked whether a surface can reference the same contract under both directions, and whether duplicate references are permitted. The readability advocate and simplicity advocate agreed these are validation rules, not design flaws. The rigour advocate specified three constraints that resolve the concern.

The creative advocate raised the possibility of contract composition as a future extension enabled by Option D's clean separation. The composability advocate cautioned against designing for hypothetical futures, and the creative advocate withdrew composition as a primary justification.

The backward compatibility advocate noted that `expects`/`offers` have no installed base, making this the cheapest possible time to make the change. No panellist disagreed.

**Verdict: consensus adopt.**

All panellists converged on Option D. The simplicity advocate's initial preference for Option B was resolved during rebuttals. Remaining concerns are addressed by validation rules, not design changes.

**Adopted changes:**

1. Remove the `expects` and `offers` keywords from surfaces.
2. Remove inline obligation blocks (the `expects BlockName { ... }` and `offers BlockName { ... }` forms).
3. Add a `contracts:` clause to surfaces. Each entry takes the form `demands ContractName` or `fulfils ContractName`.
4. Contract declarations remain unchanged (module-level, direction-agnostic).

**Validation rules** (specified by the rigour advocate, accepted by the panel):

1. Each contract name appears at most once per surface.
2. A direction modifier (`demands` or `fulfils`) is mandatory for every entry in the `contracts:` clause.
3. The same contract may appear with different directions in different surfaces.

**Before:**

```
surface DomainIntegration {
    facing framework: FrameworkRuntime

    exposes:
        EntityKey
        EventOutcome

    expects DeterministicEvaluation {
        evaluate: (event_name: String, payload: ByteArray, current_state: ByteArray) -> EventOutcome

        invariant: Determinism
            -- For identical inputs, evaluate must produce
            -- byte-identical outputs across all instances.

        invariant: Purity
            -- No I/O, no clock, no mutable state outside arguments.
    }

    offers EventSubmitter {
        submit: (idempotency_key: String, event_name: String, payload: ByteArray) -> EventSubmission

        invariant: AtMostOnceProcessing
            -- Within the TTL window, duplicate submissions
            -- receive the cached response.
    }

    guarantee: AllOperationsIdempotent
}
```

**After:**

```
contract DeterministicEvaluation {
    evaluate: (event_name: String, payload: ByteArray, current_state: ByteArray) -> EventOutcome

    invariant: Determinism
        -- For identical inputs, evaluate must produce
        -- byte-identical outputs across all instances.

    invariant: Purity
        -- No I/O, no clock, no mutable state outside arguments.
}

contract EventSubmitter {
    submit: (idempotency_key: String, event_name: String, payload: ByteArray) -> EventSubmission

    invariant: AtMostOnceProcessing
        -- Within the TTL window, duplicate submissions
        -- receive the cached response.
}

surface DomainIntegration {
    facing framework: FrameworkRuntime

    exposes:
        EntityKey
        EventOutcome

    contracts:
        demands DeterministicEvaluation
        fulfils EventSubmitter

    guarantee: AllOperationsIdempotent
}
```

## Deferred items

None. The creative advocate's suggestion of contract composition as a future extension was noted but is out of scope for this proposal.
