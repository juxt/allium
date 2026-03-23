# ALP-9: Module-level obligation blocks

**Status**: adopt (evolved into ALP-15 contracts)

## Problem

Obligation blocks (`expects`/`offers`) are currently scoped to surfaces. When multiple surfaces share the same capability contract (e.g. a serialisation interface, a storage adapter, an event handler), the signatures and invariants must be duplicated in each surface. This duplication creates a maintenance burden and a consistency risk: if one surface's copy is updated and another is not, the spec silently diverges from itself.

The panel reviewing ALP-3 (trait declarations) agreed this reuse problem is real but rejected `trait` as the solution, finding that it duplicates obligation block machinery under a different keyword. The panel converged on extending the existing obligation block system to support module-level declaration and cross-surface referencing.

## Proposed construct

A new top-level declaration, `contract`, that defines a named obligation block at module level. Surfaces reference contracts by name in their `expects` and `offers` clauses.

### Declaration syntax

```allium
contract Codec {
    serialize: (value: Any) -> ByteArray
    deserialize: (bytes: ByteArray) -> Any

    invariant: Roundtrip
        -- deserialize(serialize(value)) produces a value
        -- equivalent to the original for all supported types.

    guidance:
        -- Implementations should handle versioned payloads
        -- by inspecting a version prefix in the byte array.
}
```

Contracts appear in a new section between Value Types and Enumerations:

```
------------------------------------------------------------
-- Contracts
------------------------------------------------------------
```

### Referencing syntax

Surfaces reference contracts by name. The `expects` or `offers` keyword is still required to indicate the direction of the obligation:

```allium
surface DomainIntegration {
    facing framework: FrameworkRuntime

    expects Codec
    offers EventSubmitter
}
```

The surface inherits all signatures, invariants and guidance from the referenced contract. A surface may also add surface-specific invariants alongside the reference:

```allium
surface DomainIntegration {
    facing framework: FrameworkRuntime

    expects Codec
    expects DeterministicEvaluation

    offers EventSubmitter

    guarantee: AllOperationsIdempotent
}
```

### Inline obligation blocks remain valid

Surfaces may still declare inline obligation blocks with `expects BlockName { ... }` for one-off contracts that do not need reuse. The two forms cannot share a name within the same surface.

### Contract contents

Contracts permit exactly the same contents as inline obligation blocks:

1. Typed signatures
2. `invariant:` declarations (PascalCase name, prose description)
3. `guidance:` blocks

Entity, value, enum and variant declarations are prohibited inside contracts, consistent with the rule for inline obligation blocks (validation rule 37). Types referenced in signatures must be declared at module level or imported via `use` (validation rule 39).

## Type parameters

Contracts do not support type parameters in this proposal. The motivating examples from ALP-2 and ALP-3 used `<T>` on infrastructure types like `Codec<T>` and `EntityMap<T>`, but the ALP-2 panel found that type parameters at the declaration level impose disproportionate cost for a narrow use case. Signatures within a contract may use `Any` where type generality is needed, with invariants expressing the type relationships in prose:

```allium
contract Codec {
    serialize: (value: Any) -> ByteArray
    deserialize: (bytes: ByteArray) -> Any

    invariant: TypePreservation
        -- The type of the value returned by deserialize
        -- matches the type of the value passed to serialize.
}
```

A future ALP may introduce scoped type parameters within contracts if the need becomes concrete and recurring, per ALP-2's resubmission guidance.

## Interaction with existing constructs

### Surface-level `guarantee:`

`guarantee:` remains a surface-level assertion about the boundary as a whole. Contracts carry `invariant:` declarations scoped to their operations. These are complementary: a surface may reference a contract (inheriting its invariants) and declare its own guarantees.

### Cross-surface composition

The existing rule applies: same-named obligation blocks across composed surfaces are a structural error (validation rule 42). This extends to contract references. If two composed surfaces both declare `expects Codec`, they reference the same contract definition, which is not a conflict. If they declare `expects Codec` with different contracts of the same name (from different modules), the checker reports the collision.

### Naming

Contract names follow PascalCase convention. A contract name must be unique at module level. A contract name may coincide with an entity or value name only if they are in different modules and accessed via qualified names.

## Validation rules to add

43. `contract` declarations must have a PascalCase name followed by a brace-delimited block body
44. Contract bodies may contain only typed signatures, `invariant:` declarations and `guidance:` blocks
45. Contract names must be unique at module level
46. A surface `expects`/`offers` clause referencing a contract name must resolve to a `contract` declaration in scope (local or imported via `use`)
47. A surface may not have both an inline obligation block and a contract reference with the same name

## Error catalogue

### E4: Unresolved contract reference

**Trigger**: `expects Foo` or `offers Foo` in a surface where `Foo` does not match any in-scope `contract` declaration or inline obligation block.

**Diagnostic**: "No contract or obligation block named 'Foo' found. Declare it as `contract Foo { ... }` at module level, or define it inline as `expects Foo { ... }` in this surface."

### E5: Name collision between inline block and contract reference

**Trigger**: A surface declares both `expects Foo { ... }` (inline) and `expects Foo` (contract reference).

**Diagnostic**: "Surface declares both an inline obligation block and a contract reference named 'Foo'. Use one or the other."

## Questions for the committee

1. Is `contract` the right keyword? Alternatives considered: `obligation` (matches the glossary term but is longer), `interface` (programming-language connotation), `protocol` (Apple/Swift connotation). `contract` reads naturally in domain conversation ("the surface expects the Codec contract") and does not collide with existing keywords.
2. Should a surface be able to extend a referenced contract with additional inline signatures, or should it be all-or-nothing? This proposal takes the simpler position: contract references inherit everything, and additional obligations require a separate block.
3. Should contracts be importable across modules via `use`, following the same coordinate system as entity imports? This proposal assumes yes but does not specify the syntax for selective contract imports.

## Committee review

**Status: adopted with amendments.**

All nine panellists supported the core mechanism. No panellist objected. Three amendments are required before the proposal is finalised.

### Amendments

1. **Contract identity.** Contract identity is determined by module-qualified name, consistent with entity and value type identity rules. Two contracts are "the same" if and only if they resolve to the same module-qualified declaration. This resolves the interaction with validation rule 42: composed surfaces referencing the same module-qualified contract are not in conflict; surfaces referencing identically named contracts from different modules are a structural error.

2. **Whole-unit imports.** Contract imports via `use` are atomic. A contract is imported as a complete unit. Partial imports (importing individual signatures from a contract) are not supported.

3. **No conditional obligations.** Contract bodies are unconditional. Signatures, invariants and guidance apply to every surface that references the contract. Surface-specific conditions belong in inline obligation blocks alongside the contract reference, not inside the contract itself.

### Answers to committee questions

1. `contract` is the right keyword. The panel found it reads naturally in domain conversation and avoids the programming-language connotations of `trait`, `interface` and `protocol`.
2. All-or-nothing is the right default. Surfaces that need additional obligations beyond a contract should declare them in a separate inline block. This preserves the property that a contract means the same thing everywhere it is referenced.
3. Yes, contracts should be importable via `use`, following the same coordinate system as entities. Import granularity is whole-contract only (see amendment 2).

### Key tensions

**Section placement.** The domain modelling advocate argued contracts describe capabilities, not data structures, and belong near surfaces. The machine reasoning advocate countered that contracts are declarations consumed by surfaces, and the language's top-down ordering places declarations before consumers. The panel accepted the proposed placement (between Value Types and Enumerations) as defensible, noting the tension without resolving it.

**Inline blocks vs contract references coexisting.** The simplicity advocate pushed toward eventual unification, deprecating inline blocks in favour of single-use contracts. The readability advocate defended both forms, arguing inline blocks serve single-use cases without unnecessary indirection. The panel accepted coexistence as the right default, with the simplicity advocate recording a reservation that the two-form design should be revisited if it causes confusion in practice.

### Noted for future ALPs

- Contract composition (`contract A includes B`) as a mechanism for sharing common signatures across related contracts.
- Whether inline obligation blocks should eventually be deprecated in favour of single-use contracts. No action now; revisit if the two-form coexistence causes confusion in practice.
