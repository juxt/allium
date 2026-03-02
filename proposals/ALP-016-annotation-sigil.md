# ALP-16: Annotation sigil for prose constructs

**Status**: adopt
**Constructs affected**: `invariant:` (prose-only form), `guidance:`, `guarantee:`
**Sections affected**: contracts, rules, surfaces, validation rules, patterns, SKILL.md

## Problem

Allium has several prose-only constructs that use `keyword: ...` syntax: `invariant:` inside contracts, `guidance:` inside contracts and rules, and `guarantee:` inside surfaces. These constructs share three properties:

1. Their content is prose the checker cannot evaluate for correctness.
2. They carry normative or advisory weight (they are not mere comments).
3. They use the same `name:` syntax as structural constructs, creating grammar ambiguity.

The ambiguity is sharpest inside contracts, where `invariant: Determinism` is syntactically indistinguishable from a typed signature like `evaluate: (String) -> Result`. The distinction relies on implicit keyword reservation, which constrains the domain namespace and is not formally declared. But the same category confusion exists wherever prose constructs share syntax with structural ones.

These constructs sit in a middle ground: more than comments (they have names, uniqueness constraints, checker-enforced structure) but less than expression-bearing constructs (the checker validates the label, not the claim). The language has no syntactic marker for this category.

## Proposal

Introduce the `@` sigil to mark prose annotations throughout the language. Every construct whose content is prose the checker does not evaluate for correctness gets the `@` prefix.

### Affected constructs

| Current syntax | New syntax | Where it appears |
|---|---|---|
| `invariant: Name` | `@invariant Name` | contract bodies |
| `guidance:` | `@guidance` | contract bodies, rules, surfaces |
| `guarantee: Name` | `@guarantee Name` | surfaces |

### What stays the same

- Expression-bearing `invariant Name { expr }` at top-level and entity-level scope is unchanged. It is a structural construct, not a prose annotation.
- The `@` prefix is the syntactic signal that the construct's content is prose. When a prose invariant or guarantee is promoted to an expression-bearing form, the `@` is dropped and a `{ expr }` body is added.
- Checker enforcement of PascalCase naming and uniqueness on `@invariant` and `@guarantee` is preserved.
- `@guidance` remains opaque and non-normative.

### Grammar

The `@` sigil introduces an annotation. Three annotation keywords are defined: `invariant`, `guidance` and `guarantee`. Annotations are followed by comment lines (`--`) that form the annotation body.

```
annotation       = "@" annotation_keyword [PascalCaseName] NEWLINE comment_block
annotation_keyword = "invariant" | "guidance" | "guarantee"
comment_block    = (INDENT "--" prose_line NEWLINE)+
```

`@invariant` and `@guarantee` require a PascalCase name. `@guidance` does not take a name.

### Examples

Contract with annotations:

```
contract DeterministicEvaluation {
    evaluate: (event_name: String, payload: ByteArray, current_state: ByteArray) -> EventOutcome

    @invariant Determinism
        -- For identical inputs, evaluate must produce
        -- byte-identical EventOutcome values across all instances.

    @invariant Purity
        -- evaluate must not perform I/O, read the system clock,
        -- access mutable state outside its arguments.

    @guidance
        -- Avoid allocating during evaluation where possible.
}
```

Rule with annotation:

```
rule InvitationExpires {
    when: invitation: Invitation.expires_at <= now
    requires: invitation.status = pending
    ensures: invitation.status = expired

    @guidance
        -- Non-normative implementation advice.
}
```

Surface with annotations:

```
surface EventSourcingIntegration {
    facing runtime: FrameworkRuntime

    context module: DomainModule where status = active

    contracts:
        demands DeterministicEvaluation
        fulfils EventSubmitter

    @guarantee ModuleBoundaryIsolation
        -- Events from one module are never visible to
        -- another module's evaluate function.

    @guidance
        -- Latency-sensitive: framework polls at 10ms intervals.
}
```

### Promotion path

When a prose annotation becomes formally expressible, it is promoted to the unsigilled, expression-bearing form:

Before (prose):

```
contract DeterministicEvaluation {
    evaluate: (event_name: String, payload: ByteArray, current_state: ByteArray) -> EventOutcome

    @invariant Determinism
        -- For identical inputs, evaluate must produce
        -- byte-identical EventOutcome values.
}
```

After (expression-bearing):

```
invariant Determinism {
    for e1, e2 in Evaluations where e1.inputs = e2.inputs:
        e1.outcome = e2.outcome
}
```

The `@` disappearing is the signal that the assertion has graduated from prose to a checkable expression.

## Rationale

**Why `@`?** The sigil is familiar from Java, Swift and Kotlin where it marks metadata and annotations. Allium's usage is aligned: `@` marks constructs whose structure (name, placement, uniqueness) the checker validates, but whose prose content it does not evaluate. This is close to how `@Override` works in Java — the compiler checks the annotation is correctly applied, not the implementation it annotates.

**Why not comments?** ALP-16 originally proposed stripping prose constructs to comments with a naming convention (`-- Invariant: Name`). This loses checker-enforced naming and uniqueness, makes structural identity depend on discipline rather than grammar, and is unlike anything else in the language. Comments are for text the language ignores entirely. These annotations are text the language acknowledges structurally.

**Why not keep `keyword:` syntax?** The colon-delimited syntax collides with structural constructs (typed signatures in contracts, clauses in surfaces and rules). A distinct sigil eliminates the ambiguity without reserving words in any namespace.

## Interactions

- **Contract body grammar simplifies.** A contract body contains typed signatures and `@`-prefixed annotations. No reserved words in the signature namespace. Any valid snake_case name is a valid signature name.
- **Rule grammar.** `@guidance` replaces `guidance:` as the final clause in rules. No interaction with other rule clauses.
- **Surface grammar.** `@guarantee` and `@guidance` replace `guarantee:` and `guidance:`. No interaction with `exposes`, `provides` or `contracts:`.
- **Expression-bearing invariants.** Unchanged. The absence of `@` marks them as structural, checkable constructs. The two forms (`@invariant Name` and `invariant Name { expr }`) are syntactically distinct.
- **Future annotations.** The `@` sigil establishes a general mechanism. Future ALPs could introduce additional annotation keywords without consuming structural syntax space.

## Validation rules

Replace existing rules with:

1. `@invariant` requires a PascalCase name. Names must be unique within their containing construct (contract or surface).
2. `@guarantee` requires a PascalCase name. Names must be unique within their surface.
3. `@guidance` must not have a name. Must appear after all structural clauses and after all other annotations in its containing construct.
4. Annotations must be followed by at least one comment line, indented relative to the `@` sigil. Unindented comment lines after an annotation are not part of the annotation body.
5. Contract bodies may contain only typed signatures and annotations.
6. Within a construct, `@invariant` and `@guarantee` annotations may appear in any order relative to each other but must appear after all structural clauses. `@guidance` must appear last.

## Migration

Mechanical find-and-replace:

- `invariant: Name` inside contracts → `@invariant Name`
- `guidance:` inside contracts, rules, surfaces → `@guidance`
- `guarantee: Name` inside surfaces → `@guarantee Name`

No human judgement required. The installed base is pre-publication, so the migration cost is zero.

## Cost

- **New syntax.** The `@` sigil is new to Allium. This is a permanent addition to the grammar.
- **Learning cost.** Low. The sigil is familiar from other languages, and the rule is simple: `@` means "prose annotation the checker validates structurally but does not evaluate".
- **Reversibility.** Moderate. Removing the sigil later would require migrating all annotations back to `keyword:` syntax or to some other form. But the sigil is general enough that removal seems unlikely.
