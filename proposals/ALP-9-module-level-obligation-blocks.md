# ALP-9: Module-level obligation blocks

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
