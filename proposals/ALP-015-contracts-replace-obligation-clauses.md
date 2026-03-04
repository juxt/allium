# ALP-15: Contracts replace obligation clauses

**Status**: adopted (Option D, with modifications)
**Keywords removed**: `expects`, `offers`
**Keywords added**: `demands`, `fulfils` (as direction markers within `contracts:` clause)
**Sections affected**: contracts, surfaces, validation rules, glossary, patterns, migration guide

## Problem

Surfaces have two mechanisms for expressing what happens at a boundary: `exposes`/`provides` for data visibility and rule triggers, and `expects`/`offers` for typed API contracts. The second pair was introduced in v2 to handle programmatic integration boundaries.

The two pairs cause three problems:

1. **Vocabulary collision.** `provides` and `offers` are near-synonyms. ALP-14 debated this at length and converged on renaming the v2 pair, but renaming treats a symptom. The deeper question is whether surfaces need two keyword pairs at all.

2. **Redundancy with `contract`.** Module-level `contract` declarations already exist. `expects`/`offers` are a binding mechanism that attaches contracts to surfaces with directionality. This is a second way of saying what `contract` already says, plus one bit of information (who implements).

3. **No tooling payoff.** The TODO roadmap items (structural validator, property-based test generation, runtime trace validation, model checking) all work from `exposes`, `provides`, rules and invariants. None of them consume obligation blocks. The obligation blocks serve documentation and the weed agent's static comparison, both of which would work equally well with contract references.

The opportunity: v2 has not shipped. `expects`/`offers` have no installed base, no public documentation and no existing specs. Removing them is free — there is no backward compatibility consideration.

## Design space

### Option A: Keep the status quo

`expects` and `offers` remain as surface clauses. Accept ALP-14's recommendation to rename them.

**For:** No change required. The vocabulary problem is addressed by renaming.

**Against:** Renaming fixes the naming collision but preserves the structural redundancy. The language carries two ways of saying "typed operations with invariants": `contract` at module level and inline obligation blocks inside surfaces. The inline form exists solely because `expects`/`offers` permit it, and removing the keywords removes the need.

### Option B: Move directionality to `contract`, reference contracts from surfaces

Eliminate `expects` and `offers`. Add a `direction` clause to `contract` declarations. Surfaces reference contracts with a plain `contracts:` list.

```
contract DeterministicEvaluation {
    direction: demanded

    evaluate: (event_name: String, payload: ByteArray, current_state: ByteArray) -> EventOutcome

    invariant: Determinism
        -- For identical inputs, evaluate must produce
        -- byte-identical outputs across all instances.

    invariant: Purity
        -- No I/O, no clock, no mutable state outside arguments.
}

contract EventSubmitter {
    direction: supplied

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
        DeterministicEvaluation
        EventSubmitter

    guarantee: AllOperationsIdempotent
}
```

The `direction` clause takes one of two values:

- `demanded` — the counterpart must implement these operations. (Replaces `expects`.)
- `supplied` — this surface supplies these operations to the counterpart. (Replaces `offers`.)

**For:**
- Removes two keywords and the inline obligation block form, reducing the surface vocabulary from six clause types to four (`facing`, `exposes`, `provides`, `contracts`).
- Dissolves the ALP-14 naming problem entirely. There is no `offers` to confuse with `provides`.
- Forces contracts to be module-level declarations, which makes them reusable, importable and independently testable.
- The `direction` clause is local to the contract declaration. A reader does not need surface context to understand what a contract demands.

**Against:**
- Inline obligation blocks disappear. Every typed contract must be a module-level declaration, even one-off contracts used by a single surface. This adds top-level declarations for contracts that were previously local.
- `direction` is a property of the relationship between a contract and a surface, not of the contract itself. The same set of operations might be demanded at one boundary and supplied at another. Baking direction into the contract declaration limits reuse.
- Two new enum values (`demanded`/`supplied`) replace two keywords (`expects`/`offers`). The vocabulary shrinks but doesn't vanish.

### Option C: Directionality on the surface binding, not the contract

Like Option B, but the contract itself is direction-agnostic. The surface specifies the direction when referencing the contract.

```
contract Codec {
    serialize: (value: Any) -> ByteArray
    deserialize: (bytes: ByteArray) -> Any

    invariant: Roundtrip
        -- deserialize(serialize(value)) produces a value
        -- equivalent to the original for all supported types.
}

surface DomainIntegration {
    facing framework: FrameworkRuntime

    demands:
        Codec
        DeterministicEvaluation

    fulfils:
        EventSubmitter

    guarantee: AllOperationsIdempotent
}
```

Here the surface uses `demands:` (what the counterpart must implement) and `fulfils:` (what this surface supplies). The contract declaration carries no directional information.

**For:**
- Contracts are fully reusable. The same `Codec` contract can be demanded at one surface and fulfilled at another.
- Contract declarations are simpler (no `direction` clause).
- The surface remains the single place where boundary shape is defined.

**Against:**
- Introduces two new keywords (`demands`/`fulfils`) rather than eliminating keywords. The net keyword count doesn't decrease.
- `demands`/`fulfils` have the same "two clause types for contracts" structure as `expects`/`offers`, just with different names. This reopens the ALP-14 vocabulary question for the new pair.
- The relationship between ALP-14's rejected `demands`/`supplies` candidate and this proposal's `demands`/`fulfils` may confuse reviewers.

### Option D: A single `contracts:` clause with inline direction markers

Contracts are direction-agnostic. The surface lists contracts under a single `contracts:` clause, with a per-entry direction marker.

```
surface DomainIntegration {
    facing framework: FrameworkRuntime

    exposes:
        EntityKey
        EventOutcome

    contracts:
        demands Codec
        demands DeterministicEvaluation
        fulfils EventSubmitter

    guarantee: AllOperationsIdempotent
}
```

**For:**
- One clause (`contracts:`) instead of two (`expects`/`offers`). The colon-delimited list groups all contract bindings visually.
- Contracts remain direction-agnostic and reusable.
- `demands`/`fulfils` appear as modifiers within the list, not as top-level clause keywords. The surface structure is simpler.
- The grouping makes it easy to see all contracts at a glance, with direction as a per-entry annotation rather than a structural division.

**Against:**
- `demands` and `fulfils` are still vocabulary that must be learned, even as list-level modifiers.
- The modifier syntax (`demands Codec` inside a colon-delimited list) is a pattern that doesn't appear elsewhere in the language. `exposes` and `provides` list bare names or expressions; `contracts` would list modifier-name pairs.

## Recommendation

This proposal recommends **Option D** as the starting point for debate, for three reasons:

1. It eliminates `expects`/`offers` and the inline obligation block form, which dissolves ALP-14's naming problem.
2. It preserves contract reusability by keeping directionality on the binding, not the declaration.
3. It groups all contract references under a single clause, reducing the number of top-level surface clauses.

The sharpest question for the panel: is the loss of inline obligation blocks a real cost, or does forcing module-level declarations improve spec hygiene?

The secondary question: do `demands`/`fulfils` as list-level modifiers carry enough of the old `expects`/`offers` confusion to reopen the vocabulary problem, or does the structural change (one clause with modifiers vs two separate clauses) make the distinction self-evident?

## Panel verdict

**Consensus: adopt Option D**, with three validation constraints added during debate.

All nine panellists converged on Option D. The simplicity advocate initially preferred Option B (direction on the contract declaration) but conceded during rebuttals that baking direction into the contract entangles two logically separate concerns. The machine reasoning advocate flagged the modifier-name syntax as a novel pattern but accepted it given a strict grammar rule. The backward compatibility advocate noted that `expects`/`offers` have no installed base, making this the cheapest possible time to make the change.

### Adopted changes

1. Remove the `expects` and `offers` keywords from surfaces.
2. Remove inline obligation blocks (the `expects BlockName { ... }` and `offers BlockName { ... }` forms).
3. Add a `contracts:` clause to surfaces. Each entry takes the form `demands ContractName` or `fulfils ContractName`.
4. Contract declarations remain unchanged (module-level, direction-agnostic).

### Validation rules

Added at the rigour advocate's request:

1. Each contract name appears at most once per surface.
2. A direction modifier (`demands` or `fulfils`) is mandatory for every entry in the `contracts:` clause.
3. The same contract may appear with different directions in different surfaces.

### Before and after

Before:

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

After:

```
contract DeterministicEvaluation {
    evaluate: (event_name: String, payload: ByteArray, current_state: ByteArray) -> EventOutcome

    @invariant Determinism
        -- For identical inputs, evaluate must produce
        -- byte-identical outputs across all instances.

    @invariant Purity
        -- No I/O, no clock, no mutable state outside arguments.
}

contract EventSubmitter {
    submit: (idempotency_key: String, event_name: String, payload: ByteArray) -> EventSubmission

    @invariant AtMostOnceProcessing
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

    @guarantee AllOperationsIdempotent
}
```

This change also supersedes ALP-14. Eliminating `expects`/`offers` dissolves the vocabulary collision between `provides` and `offers` that ALP-14 sought to address.
