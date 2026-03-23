# ALP-11: Expression-bearing invariants

**Status**: adopt

## Problem

Allium specifications capture domain rules as `requires`/`ensures` pairs, but some properties span multiple rules and have no home in the current language. "Account balance never goes negative." "No two interviews overlap for the same candidate." These are properties domain experts state in conversation. They are system-wide assertions, not preconditions on individual rules.

ALP-1 introduced `invariant:` declarations with prose descriptions, scoped to obligation blocks within surfaces. The language reference notes that the same `invariant:` construct will appear at other scopes (top-level, entity-level) in future versions. TODO.md item 2 (property-based test generation) explicitly motivates this addition, showing `invariant` blocks with Allium expressions that PBT frameworks can exercise after sequences of rule applications. Without expression-bearing invariants, the PBT generator has no machine-readable system-wide properties to check, and the model checker (TODO.md item 4) has no formal assertions to verify against exhaustive state exploration.

This proposal delivers the construct that TODO.md item 2 calls for. It is the highest-priority language addition for the tooling roadmap, since the parser (TODO.md item 1) should include invariant expressions in its AST from the start rather than retrofitting them.

## Proposed construct

Top-level and entity-level `invariant` blocks containing named assertions with Allium expressions.

### Top-level invariants

Top-level invariants assert properties over entity collections. They appear in a new section after Rules and before Actor Declarations:

```
------------------------------------------------------------
-- Invariants
------------------------------------------------------------
```

```allium
invariant NonNegativeBalance {
    for account in Accounts:
        account.balance >= 0
}

invariant NoOverlappingInterviews {
    for a in Interviews:
        for b in Interviews:
            a != b and a.candidate = b.candidate
                implies not (a.start < b.end and b.start < a.end)
}

invariant UniqueEmail {
    for a in Users:
        for b in Users:
            a != b implies a.email != b.email
}
```

Each invariant has a PascalCase name and a body containing an Allium expression that evaluates to a boolean. The expression uses the existing expression language: navigation, comparisons, boolean logic, collection operations, quantifiers.

### Entity-level invariants

Entity-level invariants assert properties scoped to a single entity type. They appear inside entity declarations alongside fields, relationships and derived values:

```allium
entity Account {
    balance: Decimal
    credit_limit: Decimal
    status: active | frozen | closed

    invariant SufficientFunds {
        balance >= -credit_limit
    }

    invariant FrozenAccountsCannotTransact {
        status = frozen implies pending_transactions.count = 0
    }
}
```

Within an entity-level invariant, field names resolve to the enclosing entity's fields without qualification. `this` refers to the entity instance.

### Obligation block invariants (existing, unchanged)

ALP-1's prose-only `invariant:` declarations within obligation blocks remain valid. This proposal does not change their syntax or semantics. The colon-delimited form (`invariant: Name` followed by indented prose) continues to serve as the prose-only variant. The brace-delimited form (`invariant Name { expression }`) is the expression-bearing variant.

The two forms are syntactically distinct:
- `invariant: Name` (colon, then prose) — prose-only, as introduced by ALP-1
- `invariant Name { ... }` (no colon, braces) — expression-bearing, introduced by this proposal

When expression support is added to obligation blocks (a future ALP, per ALP-1's staging plan), the brace-delimited form will be available there as well. This proposal does not introduce it inside obligation blocks; it introduces it at top-level and entity-level scopes only.

## Expression language

Invariant expressions use Allium's existing expression language without extension. The permitted constructs:

| Construct | Example |
|-----------|---------|
| Navigation | `account.balance`, `slot.interview.candidate` |
| Optional navigation | `parent?.status` |
| Comparisons | `balance >= 0`, `status = active`, `status in {active, pending}` |
| Boolean logic | `a and b`, `a or b`, `not a`, `a implies b` |
| Arithmetic | `balance + pending`, `count * rate` |
| Collection operations | `slots.count`, `slots.any(s => s.status = confirmed)`, `slots.all(s => s.time != null)` |
| Quantification | `for x in Collection: expression` (universal — all elements must satisfy) |
| Existence | `exists entity`, `not exists entity` |
| Null coalescing | `field ?? default` |

### `implies`

One addition to the expression language: `implies` as a boolean operator. `a implies b` is equivalent to `not a or b` but reads more naturally in invariant assertions. It has the lowest precedence of any boolean operator, binding looser than `and` and `or`.

```allium
invariant ClosedAccountsHaveNoBalance {
    for account in Accounts:
        account.status = closed implies account.balance = 0
}
```

`implies` is available in all expression contexts, not only invariants, but its primary use case is invariant assertions.

### Quantification semantics

`for x in Collection: expression` in an invariant body is a universal quantifier: the invariant holds when the expression is true for every element. This reuses the existing `for` iteration syntax but with assertion semantics rather than ensures semantics.

Nested quantification is permitted:

```allium
invariant NoOverlappingInterviews {
    for a in Interviews:
        for b in Interviews:
            a != b and a.candidate = b.candidate
                implies not (a.start < b.end and b.start < a.end)
}
```

### What invariant expressions cannot do

- No side effects. Invariants are pure assertions; they cannot use `.add()`, `.remove()` or `.created()`.
- No `now`. Invariants assert state properties, not temporal ones. `now` is prohibited because it is volatile (re-evaluates on each read). Timestamp fields like `created_at` are permitted because they are stored state. The distinction is volatility, not temporality. See open questions for discussion.
- `let` bindings are permitted. Bindings in invariant bodies must be pure expressions, subject to the same restrictions as the invariant body itself (no side effects, no `now`).

## Interaction with tooling roadmap

### PBT generation (TODO.md item 2)

The PBT generator converts each invariant into a checkable property. After applying a sequence of rule firings to generated entity states, the generator asserts that all invariants still hold. Entity-level invariants constrain individual instances; top-level invariants constrain the system state. Together, they define the property space the PBT framework explores.

### Model checking (TODO.md item 4)

The model checker translates invariants into assertions in the target formalism (TLA+ invariants, Alloy facts/assertions, P monitors). Counter-examples are reported as sequences of rule firings that violate a named invariant, translated back into Allium terms.

### Trace validation (TODO.md item 3)

The trace validator can check invariants against production traces by evaluating invariant expressions against the entity state reconstructed from trace events. This extends the surface-contract validation with system-wide property checking.

## Validation rules to add

51. Top-level `invariant` blocks must have a PascalCase name followed by a brace-delimited expression body
52. Entity-level `invariant` blocks must have a PascalCase name followed by a brace-delimited expression body
53. Invariant names must be unique within their scope (module-level for top-level invariants, entity declaration for entity-level invariants)
54. Invariant expressions must evaluate to a boolean type
55. Invariant expressions must not contain side-effecting operations (`.add()`, `.remove()`, `.created()`, trigger emissions)
56. Invariant expressions must not reference `now`
57. Entity collection references in top-level invariants (e.g. `Accounts`, `Interviews`) must correspond to declared entity types

## Error catalogue

### E9: Non-boolean invariant expression

**Trigger**: An invariant body evaluates to a non-boolean type.

**Diagnostic**: "Invariant 'NonNegativeBalance' must evaluate to a boolean. The expression evaluates to Integer."

### E10: Side effect in invariant

**Trigger**: An invariant body contains `.created()`, `.add()`, `.remove()` or a trigger emission.

**Diagnostic**: "Invariant expressions must be pure assertions. '.created()' is a side effect and cannot appear in an invariant."

### E11: Temporal reference in invariant

**Trigger**: An invariant body references `now`.

**Diagnostic**: "Invariants assert state properties, not temporal conditions. Use a rule with a temporal trigger instead."

## Questions for the committee

1. Should invariants support temporal assertions (`now`)? TODO.md item 2 asks this as an open question. The simpler position is state-only: invariants assert what must always be true about the entity graph, regardless of time. Temporal properties ("every pending invitation expires within 7 days") are better expressed as rules with temporal triggers and `requires` guards.
2. Should `let` bindings be permitted inside invariant bodies for readability? This proposal prohibits them for simplicity, but complex invariants (e.g. those requiring join lookups) may benefit from local bindings.
3. Should the brace-delimited expression form be available inside obligation blocks now, or should that wait for a future ALP per ALP-1's staging plan? This proposal defers it to maintain ALP-1's staging discipline.
4. Does `implies` warrant addition to the general expression language, or should it be restricted to invariant contexts?

## Committee review

**Status: adopted with amendments.**

All nine panellists supported the core construct. No panellist objected. Three amendments were required, all resolved during rebuttals.

### Amendments

1. **Permit `let` bindings in invariant bodies.** The prohibition creates an irregularity: `let` exists in rules and derived values but was artificially excluded from invariants. `let` bindings in invariant bodies must be pure expressions, subject to the same purity restrictions as the invariant body itself (no side effects, no `now`).

2. **State invariant checking semantics explicitly.** Invariants are logical assertions over entity state, not runtime checks. Checking frequency and strategy are tooling concerns: PBT checks after rule sequences, the model checker checks exhaustively, the trace validator checks against reconstructed state. The semantics section should state this rather than leaving it implicit in the tooling discussion.

3. **Clarify the `now`/timestamp boundary.** `now` is prohibited because it is volatile (re-evaluates on each read). Timestamp fields like `created_at` are permitted because they are stored state. The distinction is volatility, not temporality. Validation rule 56 should state this.

### Answers to committee questions

1. **Temporal invariants (`now`).** The panel supports the state-only boundary for this ALP. The `now` prohibition creates a clean extension point: a future ALP can introduce temporal invariants where the presence of `now` is the syntactic signal distinguishing them from state invariants. The creative advocate recorded a strong recommendation for this follow-up, motivated by the model checker's need to verify liveness properties. The domain modelling advocate noted that temporal properties are a tooling concern rather than a domain modelling concept, supporting separate evaluation.
2. **`let` bindings.** Permitted, with purity constraints (see amendment 1).
3. **Expression-bearing form in obligation blocks.** Deferred per ALP-1's staging plan. The panel did not challenge this.
4. **`implies` scope.** Available in all expression contexts, not only invariants. The panel endorsed this unanimously. `implies` reads naturally in `requires` guards and derived boolean values as well as invariant assertions.

### Key tensions

**`for`-as-quantifier overloading.** The simplicity and machine reasoning advocates flagged that `for x in Collection:` has side-effecting semantics in rule `ensures` clauses but pure assertion semantics in invariants. The simplicity advocate initially suggested `all` as an alternative keyword. The readability advocate argued that `for` reads as natural language ("for every account, the balance is non-negative") and that a second keyword creates a different learning cost. The developer experience advocate added that the invariant block itself provides sufficient disambiguation, and error E10 catches anyone who attempts side effects. The simplicity advocate withdrew the suggestion, accepting that the cost of overloading is tolerable given the clear syntactic context.

**Temporal invariants.** The creative advocate argued that the model checker needs temporal invariants for liveness properties and that properties like "no pending invitation older than 7 days" are assertions, not triggers for action. The domain modelling advocate countered that domain experts think about temporal properties in terms of rules, not invariants, and that temporal invariants are a tooling concept warranting separate evaluation. The panel agreed to defer.

### Noted for future ALPs

- Temporal invariants with `now`, for model checker liveness properties. Should use an explicit marker (`temporal invariant` or separate section) to distinguish from state invariants.
- Expression-bearing invariants inside obligation blocks, per ALP-1's staging plan.
