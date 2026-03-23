# ALP-20: Transition graph syntax

**Status**: adopt
**Constructs affected**: `entity`, `enum`, `rule`, `requires`, `ensures`, `invariant`
**Sections affected**: entities and variants, enumerations, rules, invariants, validation rules, file structure (section ordering)

## Problem

ALP-19's panel adopted six design constraints for transition graph declarations: authoritative and opt-in, structural edges only, explicit terminal states, two completeness obligations, deferred multi-dimensional state, and enum-first with preserved generality. The language has no syntax to express any of this. The constraints are precise enough to validate a design against but do not determine a unique surface form, and several of the syntactic choices interact with existing language structure in ways that require deliberate resolution.

The construct must bind to a specific field on a specific entity, declare directed edges between that field's enum values, mark terminal states, and integrate into the existing file structure without disrupting the fixed section ordering that readers and tooling depend on. Each of these requirements admits multiple realisations, and the choices are not independent: where the declaration lives affects how it references its field, which affects whether terminal marking is a property of the state or of the graph, which affects how the checker reports errors.

```
entity Order {
    status: pending | confirmed | shipped | delivered | cancelled
}

rule ConfirmOrder {
    when: ConfirmOrder(order)
    requires: order.status = pending
    ensures: order.status = confirmed
}
```

A reader today sees enum values declared on the entity field and transition logic in rules. The transition graph must fit between these without duplicating the enum declaration, contradicting the rule structure, or requiring the reader to hold three separate locations in mind to understand a single lifecycle.

## Evidence

The six constraints from ALP-19's panel review are the primary evidence. The panel reached consensus after one rebuttal round, with all nine panellists converging on the authoritative opt-in model. The constraints are recorded in the panel review section of ALP-19.

Allium's fixed section ordering (use declarations, given, external entities, value types, contracts, enumerations, entities and variants, config, defaults, rules, invariants, actor declarations, surfaces, deferred specifications, open questions) is a structural property that readers and tooling rely on. The language reference specifies that sections follow this order and that empty sections are omitted. A new construct must either fit within an existing section or establish a new section position, and either choice has consequences for discoverability and reading flow.

The existing entity syntax declares fields, relationships, projections and derived values within the entity body. Rules are top-level. Invariants are top-level. The transition graph has properties of both: it is structurally bound to an entity's field (like a relationship or derived value) but imposes validation obligations across rules (like an invariant). Where it belongs depends on which of these properties the language treats as primary.

The patterns file contains nine worked examples. Several model lifecycle entities with status fields and transition logic spread across rules (password auth, soft delete, invitation). These would be the first candidates for transition graph adoption and would test whether the chosen syntax reads naturally in context.

## Design tensions

**Locality vs separation.** The graph is structurally bound to a field on a specific entity, which argues for co-location inside the entity body. But it imposes cross-cutting validation on rules defined elsewhere in the file, which argues for a top-level declaration alongside invariants. Co-location means a reader finds the lifecycle where they find the entity. Separation means a reader finds the lifecycle where they find other cross-cutting constraints. The entity body currently contains data structure (fields, relationships, projections, derived values) but not behavioural constraints.

**Field binding.** The graph must identify which field it governs. If the graph lives inside the entity, the field is in scope and can be named directly. If the graph lives at top level, it must qualify the field with the entity name. The binding syntax affects how natural the construct reads and whether it generalises cleanly to entities with multiple status fields.

**Edge notation.** Edges are directed pairs of enum values. The notation must be unambiguous, readable to non-technical stakeholders, and parseable without context-dependent interpretation. It must not collide with existing expression syntax (the language already uses `=` for assignment, `->` does not currently appear in Allium, `=>` is used in lambda expressions for collection operations). The edge notation also determines how compact or verbose a graph with many transitions reads.

**Terminal marking.** Terminal states can be marked as a property of the state within the graph, as a separate clause in the graph declaration, or as a modifier on the enum value at the entity field declaration site. The first two keep the information inside the graph. The third distributes it to where the state is defined. The choice affects whether a reader can understand the lifecycle from the graph alone or must cross-reference the entity declaration.

**Enum value duplication.** The enum values already appear on the entity field. The graph references those same values as edge endpoints. If every value appears in both places, the graph partially restates the enum. If the graph introduces new values not present on the field, it contradicts the entity declaration. The relationship between the enum declaration and the graph's use of its values must be clear to the checker and to the reader.

**Section ordering.** A new section needs a position in the fixed ordering. Placing it near entities groups it with the data structure it governs. Placing it near rules or invariants groups it with the behavioural constraints it enforces. Placing it in a new position between these creates a section that has no existing neighbour to anchor expectations. Alternatively, if the graph lives inside the entity body, no new section is needed, but the entity body gains a construct type it has never had.

**Error reporting identity.** When the checker rejects a rule for producing a transition not in the graph, the error must reference both the rule and the graph. The syntax determines how the graph is identified in error messages: by entity and field name, by a declared name on the graph itself, or by position. Named constructs produce clearer diagnostics but add a naming obligation the author must satisfy.

## Scope

This ALP concerns the concrete syntax for transition graph declarations within the constraints established by ALP-19. It covers the declaration form, edge notation, terminal-state marking, field binding, placement in the file structure, and interaction with existing entity and rule syntax.

This ALP does not revisit the authority model, completeness obligations, or other constraints settled by ALP-19's panel. It does not concern multi-dimensional state coupling, generality beyond enum fields, or data-flow dependencies, all of which were deferred by prior panel decisions. It does not propose changes to rule syntax, trigger syntax, or enum syntax beyond what is necessary to integrate the transition graph declaration.

## Panel review

### Summary

The nine-member design review panel debated ALP-20 across seven design tensions. The panel reached consensus on all seven after one round of rebuttals. Edge notation (`->`) was unanimous from the start. Inline placement, separate block syntax, the `transitions` keyword, `terminal:` clause marking and field-derived error identity all converged after rebuttals, with machine-reasoning, creative and backward-compatibility conceding their initial positions. One reservation was recorded from rigour on the keyword choice.

### Responses

**Simplicity advocate.** Graph inside the entity body, bound to its field with `transitions status { ... }`. A top-level declaration duplicates the field reference, introduces a naming problem and creates an unnecessary section-ordering question. `->` for edges, `terminal:` clause for sink states. Enum value duplication is acceptable: the field declares what values exist, the graph constrains how they relate. Collapsing them would overload the field declaration with structural semantics it should not carry.

**Machine reasoning advocate.** Initially argued for a top-level named declaration (`graph OrderFlow for Order.status { ... }`) on the grounds that a named top-level construct gives the checker a stable identity, keeps entity bodies predictable in shape and avoids introducing a new nesting context. `->` for edges. Preferred inline `[terminal]` marking co-located with the state name. Biggest concern: enum value duplication, where models will drift between two lists.

**Composability advocate.** Graph inside the entity body as a separate `transition_graph status { ... }` block. Field binding follows from placement. `->` for edges. `terminal:` clause. The graph should reference the field's existing enum values without redeclaring them. The checker should verify that every enum value appears in at least one edge or terminal marking, making the graph a pure constraint overlay. This composes with named enums, generalises to multiple fields and keeps each block understandable in isolation.

**Readability advocate.** Graph inside the entity body, right beneath the field, because that is where a product owner will look. `->` reads naturally as "leads to". Favoured `terminal:` clause so a reader can answer "how does this end?" in one place. Biggest concern: enum value duplication creating maintenance drift.

**Rigour advocate.** Graph inside the entity body. Endorsed `transition_graph` as keyword because it is unambiguous, self-documenting and grep-friendly, where `transitions` reads as either noun or verb and could collide with future constructs. `->` for edges. Initially favoured inline `[terminal]` marking. Primary concern: the checker must enforce exact correspondence between the field's enum literals and the graph's node set as a hard error.

**Domain modelling advocate.** Graph inside the entity body, using `transitions status { ... }`. Stakeholders already say "pending goes to confirmed" and `->` reads naturally as directed flow. Error identity comes from the field path (`Order.status`). Raised the question of whether enum values could be declared only once, inside the transitions block, with the field type inferred from the graph.

**Developer experience advocate.** Graph inside the entity body for discoverability. `->` for edges. Biggest risk: embedding the graph makes longer entities harder to scan, but the alternative (top-level cross-referencing) is worse for discoverability and produces confusing errors on rename.

**Creative advocate.** Initially proposed attaching the graph directly to the field declaration: `status: pending | confirmed | shipped | delivered | cancelled { pending -> confirmed, ... }` where braces open a transition block annotating the existing enum. `->` for edges, `[terminal]` for sink states. This keeps field, values and transitions in one place. Biggest risk: inline graphs becoming unwieldy for large enums.

**Backward compatibility advocate.** Initially proposed a similar field-attached syntax to creative. `->` for edges. Biggest concern: any syntax requiring authors to re-enumerate states outside the entity will drift out of sync with the field declaration.

### Rebuttals

**Machine-reasoning conceded** inline placement to the supermajority. Error-reporting identity is solvable via entity name plus field name without a separate top-level declaration. Strongly opposed creative and backward-compatibility's field-attached syntax: merging edge syntax into the field's type position creates a context-dependent parse where braces after a pipe-delimited enum mean something different from braces elsewhere, exactly the kind of high-surprisal construct that causes misgeneration. A separate `transitions status { ... }` block keeps field declaration and graph structurally distinct.

**Creative conceded** the separate block. A `transitions status { ... }` block still names the field twice (a cost creative noted) but avoids the context-dependent parse problem machine-reasoning identified. Also conceded `terminal:` clause over inline `[terminal]` once a dedicated block is adopted, since the clause reads better in that context.

**Backward-compatibility conceded** to the separate block, provided enum values inside the graph reference the field's existing declaration rather than redeclaring them.

**Rigour conceded** `terminal:` clause over inline `[terminal]`. A collected list is easier for the checker to validate completeness against: verifying that every non-terminal node has at least one outgoing edge is a single set-difference operation rather than a scan for annotations scattered across edges. Maintained `transition_graph` over `transitions` as a keyword preference.

**Readability rebutted** machine-reasoning on top-level placement: an inline block can carry identity through the field path without scattering behaviour across the file. Rebutted rigour and creative on `[terminal]`: a gathered `terminal:` clause gives the reader one place to answer "how does this end?" rather than scanning every edge.

**Composability rebutted** machine-reasoning: a top-level declaration creates action-at-a-distance and sets a precedent where every future constraint type gets its own section. Rebutted creative and backward-compatibility: attaching the graph to the field declaration conflates two concerns, meaning you cannot have an enum field without a graph, or a graph over a named enum, without special cases.

**Simplicity rebutted** machine-reasoning: error identity comes free from field binding, so a top-level named declaration solves a problem that does not exist. Noted that `terminal:` clause is necessary as a single consistent mechanism because a terminal state with no inbound edges declared has nowhere to attach an inline `[terminal]` annotation.

**Domain-modelling rebutted** machine-reasoning on naming: `Order.status` already provides a unique stable reference without inventing a second name. Rebutted creative on field-attached syntax: two different syntactic shapes for field declarations based on whether transitions exist makes the language harder to teach.

**Developer-experience rebutted** machine-reasoning: a newcomer reading an entity has no indication its status field is constrained until they find a separate declaration elsewhere. Rebutted creative: merging two concerns into one syntactic form makes the field line unreadable beyond four or five states.

### Key tensions

**Edge notation (resolved).** Unanimous from the initial round. `->` is unused in the language, universally understood as a directed edge and visually distinct from `=>` (lambdas) and `=` (assignment).

**Placement (resolved).** Eight panelists initially favoured inline placement. Machine-reasoning initially favoured top-level for error-reporting identity. After rebuttals, machine-reasoning conceded that entity name plus field name provides sufficient stable identity. All nine converge on inline placement inside the entity body.

**Block syntax (resolved).** Three initial camps: separate block (six panelists), field-attached (creative, backward-compatibility) and top-level (machine-reasoning). Machine-reasoning's argument against field-attached syntax (context-dependent parse, high surprisal) was decisive. Creative and backward-compatibility both conceded. All nine converge on a separate `transitions` block inside the entity body, below the field declaration.

**Keyword (resolved with reservation).** Seven panelists use `transitions`. Rigour and composability prefer `transition_graph` for unambiguity and grep-friendliness. The majority finds `transitions` sufficiently clear, more concise and a natural match for how stakeholders describe lifecycle behaviour. Rigour records a reservation but does not block.

**Terminal marking (resolved).** Five panelists initially favoured a `terminal:` clause. Three favoured inline `[terminal]`. After rebuttals, rigour conceded that a collected list is easier for completeness validation (single set-difference). Creative conceded once the separate block was adopted. Simplicity noted that `terminal:` is the only mechanism that handles terminal states with no inbound edges. Eight of nine converge on `terminal:` clause; machine-reasoning's weaker preference for inline does not block.

**Enum value duplication (resolved).** Universal concern. Consensus that the graph references existing enum values without redeclaring them. The checker enforces exact correspondence: every value in the graph must exist on the field, and every field value must appear in at least one edge or terminal marking. Drift is a hard error. Domain-modelling's suggestion to declare values only inside the graph is noted but changes field-declaration semantics and would need a separate proposal.

**Error reporting identity (resolved).** Machine-reasoning's top-level naming concern dissolved when the panel converged on entity name plus field name as a stable identifier. No separate naming obligation is needed.

### Verdict

**Consensus: adopt** the following syntax for transition graph declarations:

1. **Inline placement.** The transition graph lives inside the entity body, below the field it governs. No new top-level section is needed.

2. **Separate `transitions` block.** The graph is a distinct block introduced by the `transitions` keyword followed by the field name: `transitions status { ... }`. It is not attached to the field declaration and does not alter field-declaration syntax.

3. **`->` edge notation.** Directed edges use `->`, which is unused in the language and universally legible. Each edge is a line: `pending -> confirmed`.

4. **`terminal:` clause.** Terminal states are declared with a `terminal:` clause inside the graph block, listing the terminal values: `terminal: delivered, cancelled`. This is the sole mechanism for terminal marking.

5. **Field-derived identity.** The graph is identified by its entity and field (`Order.status`) for error reporting. No separate name is required.

6. **Enum reference, not redeclaration.** The graph references enum values already declared on the field. The checker enforces exact correspondence: every value in the graph must exist on the field, every field value must appear in at least one edge or terminal marking. Drift is a hard error.

The converged syntax:

```
entity Order {
    status: pending | confirmed | shipped | delivered | cancelled

    transitions status {
        pending -> confirmed
        confirmed -> shipped
        shipped -> delivered
        pending -> cancelled
        confirmed -> cancelled
        terminal: delivered, cancelled
    }
}
```

**Rigour advocate reservation.** `transitions` is ambiguous between noun and verb, and could collide with future constructs. `transition_graph` is self-documenting and grep-friendly. The panel should revisit if the shorter keyword proves problematic.
