# ALP-1: Named obligation blocks in surfaces

**Status**: adopted (incorporated into language version 2)
**Keywords introduced**: `expects`, `offers`, `invariant`
**Sections affected**: surfaces, validation rules, glossary

## Problem

Surfaces describe boundaries between actors and applications: what data is visible (`exposes`), what actions are available (`provides`), what constraints hold (`guarantee`). This works for user-facing boundaries but cannot express programmatic integration contracts where one party must supply typed implementations and the other offers typed services in return. Framework-to-module boundaries, service-to-plugin contracts, and cross-context integration points all need a way to say "you must supply X with these properties" and "we give you Y with these guarantees".

## Adopted constructs

### Obligation blocks: `expects` and `offers`

Two new surface clauses. `expects Name { ... }` declares what the surface requires from its counterpart. `offers Name { ... }` declares what the surface provides to its counterpart. Each named block contains typed field signatures, `invariant:` declarations and optional `guidance:` blocks. Nothing else.

```allium
surface DomainIntegration {
    exposes:
        EntityKey
        EventOutcome

    expects DeterministicEvaluation {
        evaluate: (event: T, entities: EntityMap) -> EventOutcome

        invariant: Determinism
            -- For identical inputs, evaluate must produce
            -- byte-identical outputs across all instances.

        invariant: Purity
            -- No I/O, no clock, no mutable state outside arguments.
    }

    offers EventSubmitter {
        submit: (idempotency_key: String, event: T) -> Future<ByteArray?>

        invariant: AtMostOnceProcessing
            -- Within the TTL window, duplicate submissions
            -- receive the cached response.
    }
}
```

### Keyword rationale

`expects`/`offers` was chosen over `requires`/`provides` (which collide with existing rule preconditions and surface action lists) and `demands`/`supplies` (which carries a transactional, coercive tone that maps poorly to integration contracts). `expects`/`offers` sits furthest from any existing Allium keyword, reads naturally in domain conversation ("the surface expects a deterministic evaluation", "the framework offers event submission"), and is the safest long-term commitment.

### Obligation block contents: closed set

Obligation blocks permit exactly three kinds of content:

1. **Typed signatures**: named operations with typed parameters and return types.
2. **Invariant declarations**: named, scoped assertions (see below).
3. **Guidance blocks**: non-normative implementation advice, same as existing `guidance:` elsewhere.

Type declarations, entity declarations, value types and all other constructs are prohibited inside obligation blocks. Types must be declared at module level and referenced by name. This keeps blocks referentially transparent and avoids scoping complications.

### Nested type declarations: prohibited

Obligation blocks cannot contain `entity`, `value`, `enum` or `variant` declarations. All types referenced in signatures must be declared at module level or imported via `use`. This preserves domain clarity (types belong to the ubiquitous language, not buried inside an integration surface) and avoids migration liabilities if scoping rules change later.

## Invariants

### Structure

`invariant:` is a named, scoped assertion. It has the same shape wherever it appears:

```
invariant: Name
    -- Prose description of the property.
```

When expression support is added (see staging below), the full form will be:

```
invariant: Name
    -- Prose description of the property.
    expression: <Allium expression>
```

The prose description is always present and serves human readers. The expression, when present, is the machine-checkable refinement that tooling enforces. Neither invalidates the other. Prose describes intent; the expression specifies the check.

### Naming rules

- Invariant names follow PascalCase convention (same as rules, entities, surfaces).
- Invariant names must be unique within their enclosing scope (obligation block or, in future, entity or module).
- Invariant names must also be unique across obligation blocks within the same surface. A surface is the unit a reader holds in their head, so `invariant: Determinism` cannot appear in both an `expects` block and an `offers` block within the same surface.

### Invariants are not guarantees

`invariant:` and `guarantee:` are distinct constructs. A `guarantee:` is a surface-level assertion about the boundary contract as a whole. An `invariant:` is a named assertion scoped to a specific obligation block, describing a property of the operations within that block. The distinction is load-bearing: contract invariants (inside obligation blocks) travel with the block when referenced; surface guarantees describe the boundary itself.

### Staging: prose now, expressions later

ALP-1 introduces invariants with prose descriptions only. The expression slot is reserved for a future ALP that introduces formal invariant expressions using Allium's existing expression language (motivated by TODO #2: property-based test generation).

The transition is additive:

1. **Today**: invariants carry prose descriptions. The checker accepts them without structural validation of the description content. "Normative" is a review convention: the prose is the authoritative statement of the property, but tooling cannot enforce it.
2. **When expression support lands**: the parser accepts both forms. Prose-only invariants remain valid indefinitely. Expression-bearing invariants are the machine-checkable form that test generators, trace validators and model checkers consume.
3. **Parser behaviour during transition**: when the parser detects content in an invariant body that resembles a formal expression, it may emit an informational note ("this looks like a checkable expression; expression-bearing invariants will be supported in a future version"). This prepares users without blocking them.

Prose-only invariants are non-checkable. Tooling that consumes invariants (future test generators, trace validators) should report which invariants it can exercise and which it skips due to missing expressions.

### Scope and future generality

`invariant:` is designed as a general construct that can appear at multiple scopes:

| Scope | Introduced by | Ranges over |
|-------|--------------|-------------|
| Obligation block | ALP-1 (this proposal) | Operations within the block |
| Top-level / module | Future ALP (motivated by TODO #2) | Entity state across rules |
| Entity | Future ALP | Properties of a single entity type |

The syntax is identical at every scope. Scope determines what the invariant ranges over; the shape stays the same. This means obligation-block invariants and future top-level invariants share identical syntax, avoiding a divergence that would require reconciliation later.

## Cross-surface composition

### Rule: no implicit composition

Obligation block names are scoped to their enclosing surface. When two surfaces are composed, extended, or referenced together:

- **Same-named obligation blocks across surfaces are a structural error.** If `SurfaceA` declares `expects Foo` and `SurfaceB` also declares `expects Foo`, the checker rejects the composition. The author must resolve the conflict by renaming one block.
- **No implicit merging, override, or precedence.** The checker does not attempt to combine obligation blocks from different surfaces.
- **Each surface is a closed contract.** Trace validation (TODO #3) can treat each surface's obligations as self-contained without cross-surface resolution rules.

### Rationale

This is deliberately conservative. Implicit composition semantics (merging invariant sets, establishing precedence) require machine-checkable invariant expressions to detect contradictions, which do not yet exist. The cost of choosing no implicit composition now is low (authors rename a block). The cost of choosing implicit merge semantics that prove wrong after adoption is high (every composed surface becomes a migration liability).

### Future direction

When expression-bearing invariants exist, a future ALP may introduce explicit composition. The leading candidate is conjunction semantics: same-named blocks compose by taking the union of their invariants, forming a semilattice (associative, commutative, idempotent). An implementation satisfying the composed contract satisfies each surface individually. This requires the checker to verify that no two invariant expressions within the composed set are contradictory, which is only possible with formal expressions.

## Error catalogue

The parser (TODO #1) enforces three error cases:

### E1: Colon-form confusion

**Trigger**: `expects:` or `offers:` (keyword followed by colon, no block name) inside a surface.

**Diagnostic**: "Did you mean to declare an obligation block? Use `expects BlockName { ... }` inside surfaces. `expects:` with a colon is not valid surface syntax."

**Rationale**: this is the most likely mistake for someone accustomed to clause-style syntax (`exposes:`, `provides:`). The distinct keywords `expects`/`offers` already reduce confusion with `requires:`/`provides:`, but the colon-form typo remains possible.

### E2: Duplicate obligation block name within a surface

**Trigger**: two obligation blocks (whether both `expects`, both `offers`, or one of each) with the same name in the same surface.

**Diagnostic**: "Obligation block 'Foo' is already declared in this surface. Obligation block names must be unique within a surface."

### E3: Same-named obligation block across composed surfaces

**Trigger**: two surfaces that are composed or referenced together both declare an obligation block with the same name.

**Diagnostic**: "Obligation block 'Foo' is declared in both SurfaceA and SurfaceB. Rename one to resolve the conflict."

## Validation rules to add

The following validation rules supplement the existing surface validity section:

**Structural validity (obligation blocks):**

36. Obligation blocks (`expects`, `offers`) must have a PascalCase name followed by a block body
37. Obligation block bodies may contain only typed signatures, `invariant:` declarations and `guidance:` blocks
38. Obligation block names must be unique within their enclosing surface (across both `expects` and `offers` blocks)
39. Types referenced in obligation block signatures must be declared at module level or imported via `use`
40. `invariant:` declarations within obligation blocks must have a PascalCase name and a prose description
41. Invariant names must be unique within their enclosing obligation block and across obligation blocks within the same surface
42. Same-named obligation blocks across composed surfaces are a structural error

**Warnings:**

- Obligation blocks with no invariants (may indicate an incomplete contract)
- Invariant descriptions that resemble formal Allium expressions (informational: expression-bearing invariants will be supported in a future version)

## Surface structure (updated)

```
surface SurfaceName {
    facing party: ActorType
    context item: EntityType [where predicate]
    let binding = expression

    exposes:
        item.field [when condition]
        ...

    provides:
        Action(party, item, ...) [when condition]
        ...

    expects BlockName {
        operation: (param: Type) -> ReturnType

        invariant: PropertyName
            -- Description of the property.

        guidance:
            -- Non-normative implementation advice.
    }

    offers BlockName {
        operation: (param: Type) -> ReturnType

        invariant: PropertyName
            -- Description of the property.
    }

    guarantee: ConstraintName
    guidance: -- non-normative advice

    related:
        OtherSurface(item.relationship) [when condition]
        ...

    timeout:
        RuleName [when temporal_condition]
}
```

| Clause | Purpose |
|--------|---------|
| `facing` | Who is on the other side of the boundary |
| `context` | What entity or scope this surface applies to |
| `let` | Local bindings, same as in rules |
| `exposes` | Visible data |
| `provides` | Available operations with optional when-guards |
| `expects` | Named obligation block: what the counterpart must supply (typed signatures, invariants, guidance) |
| `offers` | Named obligation block: what this surface supplies to the counterpart (typed signatures, invariants, guidance) |
| `guarantee` | Constraints that must hold across the boundary |
| `guidance` | Non-normative implementation advice |
| `related` | Associated surfaces reachable from this one |
| `timeout` | References to temporal rules that apply within this surface's context |

## Glossary additions

| Term | Definition |
|------|------------|
| **Obligation block** | A named contract element within a surface, declared with `expects` (what the counterpart must supply) or `offers` (what this surface supplies). Contains typed signatures, invariants and guidance. |
| **`expects`** | Surface clause declaring a named set of operations and properties the counterpart must implement |
| **`offers`** | Surface clause declaring a named set of operations and properties this surface provides to the counterpart |
| **Invariant** | A named, scoped assertion about a property. In obligation blocks, describes a property of the operations within the block. Prose description is always present; formal expressions are reserved for a future version. |

## Reservations recorded

- **Readability advocate**: `invariant:` is less accessible than `guarantee:` to non-technical readers. The distinction between the two constructs is justified but the naming trades accessibility for precision.
- **Domain modelling advocate**: obligation-block invariants (contract properties) and future top-level invariants (domain state assertions) are different kinds of thing. The current design relies on structural scope to distinguish them. A future ALP may introduce explicit naming (`contract_invariant` vs `invariant`) if the scope-based distinction proves insufficient.
- **Creative advocate**: the invariant design should eventually support cross-scope referencing (an obligation block's invariant importable into a test generator or top-level assertion). The current design does not foreclose this but does not enable it either. Deferred to a future ALP.

## Committee history

- **Round 1**: debated original proposal with `requires`/`provides` keywords. Verdict: refine. Key issues: keyword overloading, invariant design, nested types, error cases.
- **Round 2**: debated refined proposal. Verdict: consensus adopt with conditions. Resolved keywords (`expects`/`offers`), nested types (prohibited), obligation block contents (closed set), invariant as scoped construct.
- **Round 3**: cross-referenced with tooling roadmap (TODO.md) to resolve three open items. Resolved: normative = prose now with expression staging, composition = structural error on name collision, error catalogue = three cases.
