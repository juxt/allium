# Migrating from Allium v1 to v2

This guide covers every change between Allium v1 and v2. It is written for both humans reviewing the release and LLMs tasked with upgrading v1 specifications.

If you are an LLM migrating a v1 spec, read this document in full, then work through the checklist at the end. The checklist verifies completeness but does not repeat the syntax rules and examples you will need from the sections above it.

---

## What changed

Version 2 adds six capabilities to the language. None of the existing v1 syntax was removed or altered; every v1 construct still means what it meant before. The changes are:

1. **Obligation blocks** (`expects`, `offers`) in surfaces, for expressing programmatic integration contracts with typed signatures and invariants.
2. **Module-level contracts** (`contract`), reusable obligation blocks that surfaces reference by name.
3. **Guidance clauses** (`guidance:`) in rules, obligation blocks and surfaces, for non-normative implementation advice.
4. **Expression-bearing invariants** (`invariant Name { expression }`), machine-readable assertions at top-level and entity-level scope.
5. **The `implies` operator**, a boolean operator available in all expression contexts.
6. **Config composition** — config parameter defaults that reference imported module parameters by qualified name, with arithmetic expressions for derived defaults.

Because all changes are additive, a v1 spec is valid v2 once the version marker is updated. No existing syntax needs rewriting.

---

## Required changes

### 1. Update the version marker

The first line of every `.allium` file must change from version 1 to version 2. This is the only change required for every spec.

v1:
```
-- allium: 1
```

v2:
```
-- allium: 2
```

### 2. Adjust section order (only when adopting new constructs)

V2 introduces two new sections. The full section order is now:

```
use declarations
Given
External Entities
Value Types
Contracts              ← new, between Value Types and Enumerations
Enumerations
Entities and Variants
Config
Defaults
Rules
Invariants             ← new, between Rules and Actor Declarations
Actor Declarations
Surfaces
Deferred Specifications
Open Questions
```

Empty sections are still omitted. No existing sections moved: the two new sections slot between existing ones. If your v1 spec does not adopt contracts or expression-bearing invariants, no section headers need adding and the existing order is already correct.

If you add contracts, place the section header after Value Types:

```
------------------------------------------------------------
-- Contracts
------------------------------------------------------------
```

If you add expression-bearing invariants, place the section header after Rules:

```
------------------------------------------------------------
-- Invariants
------------------------------------------------------------
```

---

## New constructs available in v2

These constructs did not exist in v1. They are optional: a migrated spec does not need to use them. But they are available, and specs that would benefit from them should adopt them.

### Obligation blocks in surfaces (`expects`, `offers`)

V1 surfaces had `exposes`, `provides`, `guarantee`, `related` and `timeout`. V2 adds `expects` and `offers` for programmatic integration contracts.

Use `expects` when the surface requires something from the counterpart. Use `offers` when the surface supplies something to the counterpart. Each block has a PascalCase name, contains typed signatures, optional `invariant:` declarations (prose-only, with a PascalCase name) and optional `guidance:` blocks.

```
surface DomainIntegration {
    facing framework: FrameworkRuntime

    expects DeterministicEvaluation {
        evaluate: (event_name: String, payload: ByteArray) -> EventOutcome

        invariant: Determinism
            -- For identical inputs, evaluate must produce
            -- byte-identical outputs across all instances.

        guidance:
            -- Avoid allocating during evaluation where possible.
    }

    offers EventSubmitter {
        submit: (key: String, event_name: String, payload: ByteArray) -> EventSubmission
    }
}
```

**Syntax rules:**
- `expects BlockName { ... }` and `offers BlockName { ... }` use braces, not colons.
- Do not write `expects:` or `offers:` with a colon. That is not valid surface syntax.
- Block names must be PascalCase.
- Block names must be unique within a surface, across both `expects` and `offers`.
- Only typed signatures, `invariant:` declarations and `guidance:` blocks are permitted inside obligation blocks. No entity, value, enum or variant declarations.

**When to add obligation blocks to an existing v1 surface:** if the surface describes a boundary between code (framework and module, service and plugin, API and consumer) rather than between a user and an application, and the contract involves typed operations with specific properties.

### Module-level contracts

When multiple surfaces share the same obligation block, extract it as a `contract` at module level and reference it by name.

```
-- Module-level declaration (in the Contracts section)
contract Codec {
    serialize: (value: Any) -> ByteArray
    deserialize: (bytes: ByteArray) -> Any

    invariant: Roundtrip
        -- deserialize(serialize(value)) produces a value
        -- equivalent to the original for all supported types.
}

-- Surface references the contract by name (no braces)
surface DataPipeline {
    facing processor: ProcessorModule

    expects Codec                    -- contract reference, no braces
    offers EventSubmitter {          -- inline obligation block, with braces
        submit: (event: DomainEvent) -> Acknowledgement
    }
}
```

**Syntax rules:**
- `expects ContractName` (no braces) references a module-level contract.
- `expects BlockName { ... }` (with braces) declares an inline obligation block.
- A surface cannot have both a contract reference and an inline block with the same name.
- Contract identity is determined by module-qualified name. Same-named contracts from different modules are a structural error.
- Contracts are imported atomically via `use`. Partial imports are not supported.

### Guidance clauses in rules

Rules can now end with a `guidance:` clause containing non-normative implementation advice.

```
-- v1: no guidance clause
rule ExpireInvitation {
    when: invitation: Invitation.expires_at <= now
    requires: invitation.status = pending
    ensures: invitation.status = expired
}

-- v2: guidance added as final clause
rule ExpireInvitation {
    when: invitation: Invitation.expires_at <= now
    requires: invitation.status = pending
    ensures: invitation.status = expired

    guidance:
        -- Expire in a background job rather than blocking the
        -- request path. Batch expiration where possible.
}
```

**Syntax rules:**
- `guidance:` must be the last clause in a rule, after all `ensures` clauses.
- Content is opaque prose using comment syntax (`--`). The checker does not parse it.
- `guidance:` is also valid inside obligation blocks and at surface level. In obligation blocks it provides implementation advice scoped to that block's operations. At surface level it provides advice about the boundary as a whole.

### Expression-bearing invariants

V1 had no mechanism for machine-readable assertions over entity state. V2 adds expression-bearing invariants at two scopes.

**Top-level invariants** assert system-wide properties. They go in the new Invariants section after Rules:

```
invariant NonNegativeBalance {
    for account in Accounts:
        account.balance >= 0
}

invariant UniqueEmail {
    for a in Users:
        for b in Users:
            a != b implies a.email != b.email
}
```

**Entity-level invariants** assert properties scoped to a single entity. They go inside entity declarations alongside fields:

```
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

**Syntax rules:**
- Expression-bearing invariants use `invariant Name { expression }` (no colon, braces).
- Prose-only invariants in obligation blocks use `invariant: Name` (colon, then prose). These are distinct constructs.
- Invariant names are PascalCase.
- Expressions must be pure: no `.add()`, `.remove()`, `.created()`, no trigger emissions, no `now`.
- `for x in Collection:` inside an invariant body is a universal quantifier (all elements must satisfy).

**When to add invariants to a migrated spec:** if the spec has properties that should always hold (non-negative balances, uniqueness constraints, referential integrity) and those properties are currently implicit or expressed only in prose comments.

### The `implies` operator

V2 adds `implies` to the expression language. `a implies b` is equivalent to `not a or b`. It has the lowest precedence of any boolean operator, binding looser than `and` and `or`.

`implies` is available in all expression contexts, not only invariants. It reads naturally in `requires` guards, derived boolean values and `if` conditions:

```
-- In a requires clause
requires: user.role = admin implies user.mfa_enabled

-- In a derived value
is_compliant: is_verified implies documents.count > 0

-- In an invariant
invariant ClosedAccountsEmpty {
    for account in Accounts:
        account.status = closed implies account.balance = 0
}
```

### Config parameter references and expressions

V1 config parameters could only have literal defaults. V2 allows defaults to reference parameters from imported modules, and to use arithmetic expressions.

```
use "./core.allium" as core

config {
    -- Literal default (valid in both v1 and v2)
    max_retries: Integer = 3

    -- Qualified reference default (v2 only)
    batch_size: Integer = core/config.batch_size

    -- Expression default (v2 only)
    extended_timeout: Duration = core/config.base_timeout * 2
    buffer_size: Integer = core/config.batch_size + 10
    retry_limit: Integer = max_retries - 1
}
```

**Syntax rules:**
- Qualified references use the form `alias/config.param_name`.
- Arithmetic operators: `+`, `-`, `*`, `/` with standard precedence. Parentheses for explicit precedence.
- Both local and qualified references are valid in expressions.
- The config reference graph must be acyclic.
- Type compatibility: Integer with Integer, Duration with Duration (for `+`/`-`), Duration with Integer (for `*`/`/`), Integer with Duration (for `*` only), Decimal with Decimal, Decimal with Integer (for `*`/`/`), Integer with Decimal (for `*` only). Scalar multiplication is commutative (`2 * core/config.timeout` and `core/config.timeout * 2` are both valid). Addition and subtraction require matching types.
- Expressions resolve once at config resolution time, not dynamically.

**When to use config references in a migrated spec:** when a consuming spec duplicates a library spec's config value, or derives a value from it (double the timeout, batch size minus a buffer).

---

## Naming convention additions

V2 extends PascalCase to three new constructs:

| Construct | Convention | Example |
|-----------|-----------|---------|
| Obligation block names | PascalCase | `DeterministicEvaluation` |
| Contract names | PascalCase | `Codec` |
| Invariant names | PascalCase | `NonNegativeBalance` |

All other naming conventions are unchanged from v1.

---

## Migration checklist

Use this checklist when upgrading a v1 spec to v2. Items marked **required** must be done. Items marked **optional** should be done when the spec would benefit.

- [ ] **Required.** Change `-- allium: 1` to `-- allium: 2` on the first line.
- [ ] **Required if adopting new constructs.** Verify section order matches v2 (Contracts after Value Types, Invariants after Rules). If neither section is present, existing order is already correct.
- [ ] **Optional.** If the spec has surfaces describing code-to-code boundaries, consider adding `expects`/`offers` obligation blocks.
- [ ] **Optional.** If multiple surfaces share the same obligation block, extract it as a `contract` declaration and place it in the Contracts section.
- [ ] **Optional.** If rules or surfaces have implementation-specific notes in comments, consider moving them into `guidance:` clauses (valid as the final clause in rules and at surface level).
- [ ] **Optional.** If the spec has properties that must always hold (uniqueness, non-negativity, referential constraints), express them as `invariant Name { expression }` blocks.
- [ ] **Optional.** If any expression (invariants, requires, derived values) would read more clearly with implication logic, use the `implies` operator.
- [ ] **Optional.** If config defaults duplicate or derive from imported module parameters, use qualified references and expressions.

---

## Quick reference

| V1 | V2 | Change type |
|----|-----|-------------|
| `-- allium: 1` | `-- allium: 2` | Required |
| Sections: Value Types → Enumerations | Sections: Value Types → **Contracts** → Enumerations | Required (if contracts present) |
| Sections: Rules → Actor Declarations | Sections: Rules → **Invariants** → Actor Declarations | Required (if invariants present) |
| No obligation blocks in surfaces | `expects BlockName { ... }`, `offers BlockName { ... }` | Additive |
| No module-level contracts | `contract Name { ... }` in Contracts section | Additive |
| No `guidance:` clause | `guidance:` in rules (final clause), obligation blocks and surfaces | Additive |
| No expression-bearing invariants | `invariant Name { expression }` at top-level and entity-level | Additive |
| No `implies` operator | `a implies b` (lowest boolean precedence) | Additive |
| Config defaults are literals only | Config defaults can reference `alias/config.param` and use arithmetic | Additive |
