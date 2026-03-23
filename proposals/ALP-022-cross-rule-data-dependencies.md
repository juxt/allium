# ALP-22: Cross-rule data dependencies

**Status**: adopt
**Depends on**: ALP-20 (transition graph syntax)
**Related**: ALP-21 (transition edge triggers, split — outcome may inform design)
**Constructs affected**: `entity`, `rule`, `requires`, `ensures`, `let`, derived values, `transitions`
**Sections affected**: entities and variants, rules, derived values, validation rules

## Problem

Allium rules read and write entity fields, but the dependency structure across rules is implicit. A rule's `requires` clause reads fields to determine whether the rule can fire. Its `ensures` clause writes fields to effect a state change. Derived values compute fields from other fields within the same entity. `let` bindings introduce local names within a single rule. None of these mechanisms declare which fields a rule consumes or produces as a structural property of the rule itself.

This matters most in lifecycle entities where data flows through a sequence of states. Consider an order fulfilment pipeline:

```
entity Order {
    status: pending | payment_verified | picking | shipped | delivered
    payment_reference: text?
    warehouse_assignment: Warehouse?
    tracking_number: text?
    delivery_confirmation: DeliveryProof?
}

rule VerifyPayment {
    when: PaymentConfirmed(order, reference)
    requires: order.status = pending
    ensures:
        order.status = payment_verified
        order.payment_reference = reference
}

rule AssignWarehouse {
    when: AssignWarehouse(order)
    requires: order.status = payment_verified
    ensures:
        order.status = picking
        order.warehouse_assignment = Warehouse.nearest(order.shipping_address)
}

rule ShipOrder {
    when: ShipOrder(order, tracking)
    requires: order.status = picking
    ensures:
        order.status = shipped
        order.tracking_number = tracking
}
```

Each rule consumes data that earlier rules produced. `AssignWarehouse` depends on `payment_reference` existing (implied by the status guard, not declared). `ShipOrder` depends on `warehouse_assignment` existing. The data flows through the lifecycle in a directed graph: `payment_reference` is produced by `VerifyPayment` and implicitly available to all subsequent states; `warehouse_assignment` is produced by `AssignWarehouse` and consumed downstream. A reader discovers these dependencies by reading every rule and tracing which fields each one reads and writes. The checker cannot verify that the data a rule needs is guaranteed to exist at the point in the lifecycle where the rule fires.

The gap between the status guard and the data guarantee illustrates the problem. `requires: order.status = picking` implies that `warehouse_assignment` has been set, because the only path to `picking` passes through `AssignWarehouse`, which sets it. But this implication chain is invisible to the checker and fragile under maintenance. If a new rule introduces a second path to `picking` that does not set `warehouse_assignment`, downstream rules that depend on it will read a null field. The checker has no way to detect this because the dependency between the status value and the field population is undeclared.

The same pattern appears in processing pipelines, approval workflows and agent loops: each stage consumes what the previous stage produced, but the production and consumption relationships are implicit in the rule bodies rather than declared as structural properties.

## Evidence

The Pathom3 library (Clojure) addresses this problem directly for data resolution. Each Pathom resolver declares its inputs and outputs as sets of attribute keywords. The framework builds a dependency graph from these declarations and can automatically chain resolvers when a downstream attribute is requested. This enables three capabilities that Allium's implicit model cannot provide: automatic detection of missing resolvers (a requested attribute has no path from available inputs), cycle detection in the dependency graph, and gap analysis (attributes that are produced but never consumed, or consumed but never reliably produced).

The structural parallel to Allium is precise. A Pathom resolver's input set corresponds to the fields a rule reads in its `requires` clause and the field values it references in `ensures` expressions. A resolver's output set corresponds to the fields a rule sets in its `ensures` clause. Pathom makes these sets explicit at the resolver declaration; Allium leaves them implicit in the rule body.

ALP-18's panel identified this gap independently. The creative advocate argued that control flow and data flow are coupled but separately implicit, and that solving transition graphs while leaving data flow implicit solves half the problem. The readability advocate countered that data dependency graphs are developer artefacts rather than stakeholder-legible structures. The panel deferred the question to a separate ALP, with the constraint that any transition graph design (ALP-19) should not foreclose later extension to data dependencies.

Domain-driven design literature distinguishes between the lifecycle of an aggregate (which states it passes through) and the consistency boundaries of that aggregate (which data must be present and valid at each state). Allium can express the former through status fields and transition rules. It cannot express the latter except through nullable field types and scattered null checks in `requires` clauses, which encode the constraint without naming it.

Processing pipelines in production systems (ETL workflows, CI/CD stages, ML training pipelines) routinely declare stage inputs and outputs as part of their configuration. Apache Airflow tasks declare `provide` and `consume` XCom keys. GitHub Actions steps declare `outputs` that downstream steps reference. The recurrence of this pattern across pipeline frameworks suggests that implicit data flow between stages is a structural problem, not a convenience issue.

## Design tensions

**Granularity of declaration.** Data dependencies can be declared at different levels: per rule (this rule reads field X and writes field Y), per state (entering this state guarantees fields X and Y are populated), or per transition (this transition requires field X and produces field Y). Each level captures different information. Per-rule declarations are the most precise but the most verbose. Per-state declarations are the most readable but cannot express conditional data production within a state. The right granularity depends on what the checker should verify and what readers need to see. ALP-21's panel debate sharpened this tension: the per-transition level requires a stable way to identify individual transitions, which is straightforward for single-rule edges (source-target pairs suffice) but ambiguous when multiple rules drive the same edge with different data production. Per-rule declarations avoid this ambiguity entirely by attaching data contracts to the locus of data production.

**Derivable vs declared.** A sufficiently powerful checker could infer which fields each rule reads and writes by analysing the `requires` and `ensures` clauses. This is simpler than the transition graph case (where intent cannot be inferred) because field reads and writes are syntactically visible in the rule body. The question is whether the inferred dependencies are sufficient for the analysis the language wants to enable, or whether declared dependencies carry information that inference cannot recover, such as "this field is guaranteed non-null in this state" as distinct from "this field happens to be set by every rule that reaches this state".

**Relationship to nullable fields.** Allium uses `?` to mark optional fields. In lifecycle entities, many fields are structurally optional (null at creation) but guaranteed to be populated by the time the entity reaches a certain state. `tracking_number: text?` is nullable because it has no value when the order is created, but it is guaranteed non-null when the status is `shipped`. This state-dependent nullability is a data dependency: the field's population is coupled to the lifecycle position. The language currently cannot express this coupling, so authors either omit the `?` (incorrect at creation) or include it (requires defensive null checks in downstream rules that structurally cannot encounter a null).

**Independence from transition graphs.** ALP-18's panel insisted that data-flow declarations and transition graph declarations should be orthogonal concerns that compose independently. A data dependency mechanism that only works in conjunction with a transition graph is not independently useful. A mechanism that works without a transition graph but composes with one when present is more general but may be harder to design. ALP-21's split reinforces this constraint: since edge trigger labels may not exist, any data dependency mechanism that requires them would be blocked by an unresolved upstream proposal. Per-rule declarations satisfy the orthogonality constraint by default, since they attach to rules regardless of whether a transition graph exists.

**Spec as communication vs spec as analysis input.** Data dependency declarations serve two audiences: human readers who want to understand what data flows where, and automated tools that want to verify consistency. These audiences may want different things. A human reader may want to see "this state guarantees these fields" as a summary. An automated tool may want per-rule input/output sets for precise dependency tracking. A declaration that serves both may be verbose; one that serves only the tool may be illegible; one that serves only the reader may be too imprecise to check.

**Scope of the dependency graph.** Data dependencies within a single entity's lifecycle are the common case, but dependencies also cross entity boundaries. A `Shipment` entity's `tracking_number` may depend on a `Carrier` entity's `assign_tracking` operation. Cross-entity data dependencies raise questions about module boundaries, aggregate consistency and the scope of what the checker can verify. The question is whether this ALP addresses only intra-entity data flow or also the cross-entity case.

## Scope

This ALP concerns the implicit data dependency structure across rules within lifecycle entities: which fields each rule consumes, which it produces, and what guarantees hold at each point in the lifecycle. It covers the relationship between status-field values and field population guarantees (state-dependent nullability).

This ALP does not concern transition graph topology, which is addressed by ALP-20. It does not concern derived values within a single entity, which already have explicit dependency tracking through expression analysis. It does not concern cross-entity data dependencies except to identify them as a boundary question. It does not propose changes to `let` binding syntax, nullable field syntax, or rule structure.

ALP-21 (transition edge triggers) proposed labelling graph edges with the rules that drive them. ALP-21's panel split: four panellists favoured adoption, three favoured rejection in favour of tooling-inferred labels, and two favoured deferral. The split has two implications for this ALP. First, this proposal cannot assume that edges carry trigger labels. It must work with source-target pairs as edge identifiers, which are unambiguous for single-rule edges but become ambiguous when multiple rules drive the same transition with different data production profiles. Second, ALP-21's panel identified an alternative path: data dependencies could attach to rules directly (per-rule `produces`/`consumes` clauses, following Pathom's resolver model) rather than to graph edges. This approach sidesteps edge identification entirely, aligns with the evidence this ALP cites, and satisfies ALP-18's orthogonality constraint (data-flow declarations independent of transition graph declarations). The panel should evaluate both attachment points: rule-level and edge-level.

---

## Panel report

### Summary

One item debated. The panel unanimously agrees the problem is real: state-dependent nullability is a genuine gap that forces authors to either misrepresent field types or scatter defensive null checks that structurally cannot fail. The panel converged on per-rule declarations as the correct attachment point, with state-level guarantees derived from those declarations rather than independently authored. A minority position (creative advocate, with partial support from simplicity) argues that state-dependent types indexed by lifecycle position would be a more fundamental solution. The verdict is **refine**: the direction is sound but the formal semantics of `produces` need specification before adoption.

### The proposal

Cross-rule data dependencies are implicit in rule bodies. The language cannot express that a field is structurally absent before a lifecycle stage and structurally present after it. Authors encode this through nullable types and status guards, but the checker cannot verify that the data a rule needs is guaranteed to exist at the point where the rule fires.

### Key tensions

**Declaration vs inference.** The simplicity advocate argued that field reads and writes are already syntactically visible in rule bodies and that per-rule annotations merely restate what inference provides. The machine reasoning, rigour, composability and developer experience advocates countered that inference recovers what a rule *happens to set*, not what it *guarantees it sets*. The convergent-transition case was decisive: when multiple rules reach the same state with different production profiles, inference cannot detect the gap that a new path introduces. The simplicity advocate's concern was not fully resolved but was substantially narrowed by this argument.

**Per-rule vs per-state declarations.** The readability and domain modelling advocates initially favoured per-state guarantees ("when status is `shipped`, `tracking_number` is guaranteed present") as the primary declaration surface, arguing this maps to how stakeholders reason about aggregate consistency. The composability advocate argued that independently declared state guarantees create a second source of truth that drifts under maintenance. After rebuttals, readability, domain modelling, rigour and machine reasoning converged on per-rule declarations as the authoring surface with derived state-level summaries as the reading surface. No panellist opposed this formulation.

**Per-rule annotations vs state-dependent types.** The creative advocate proposed that Allium's deeper gap is the absence of state-dependent types: if an entity's shape narrowed with its lifecycle position, data dependencies would be structurally enforced rather than annotated. The rigour advocate responded that refinement types require a dependent type system whose decidability is non-trivial in a language interpreted by LLMs and humans. The composability, developer experience and backward compatibility advocates argued that per-rule declarations are a valid stepping stone that composes with future refinement types rather than competing with them. The simplicity advocate was sympathetic to the creative position but acknowledged it exceeds this ALP's scope.

**Formal semantics.** The rigour advocate raised two unresolved questions. First, does `produces: field_name` assert that the field is non-null in every post-state of every execution of the rule, or only in some executions? The panel favours the stronger reading (every execution) but this needs formal specification. Second, when multiple rules converge on a target state, the state-level guarantee is the intersection of what all inbound rules produce. If one inbound rule does not produce a field, the guarantee at that state is weakened. The checker must surface this clearly.

**Migration cost.** The backward compatibility advocate confirmed that per-rule declarations are cleanly opt-in: existing specs that omit them remain valid, the checker treats absent declarations as "unchecked" rather than "empty", and authors can adopt incrementally. The per-state alternative would force all-or-nothing annotation of lifecycle entities. This concern is resolved by the per-rule approach.

### Verdict: refine

The panel agrees on the problem and the broad direction. The following points require resolution before adoption:

1. **Formal semantics of `produces`.** Specify whether `produces: field_name` is a universal guarantee (the field is non-null in every post-state of every execution) or an existential claim. The panel favours the universal reading.

2. **Convergent-transition semantics.** Specify that the state-level guarantee at a given lifecycle position is the intersection of the `produces` sets of all rules whose transitions reach that state. If the intersection is empty or excludes a field that a downstream rule consumes, the checker must report the gap with a lifecycle-aware error message identifying which inbound path lacks the production.

3. **Derived state-level summaries.** The design should specify how per-rule `produces`/`consumes` declarations are aggregated into state-level guarantees that readers and tooling can inspect. These summaries should be derivable artefacts, not independently declared constructs.

4. **Relationship to state-dependent types.** The creative advocate's position should be recorded as a future direction. Per-rule declarations should be designed so that a future state-dependent type mechanism could subsume them without breaking existing specs. The declarations should not foreclose this path.

### Reservation

The **simplicity advocate** records a reservation: per-rule `produces`/`consumes` annotations add ceremony to every rule in lifecycle entities, and the distinction between declaration and inference has been demonstrated only for the convergent-transition case. If the language later adopts state-dependent types, these annotations become redundant scaffolding. The reservation is noted but does not block refinement.

### Deferred items

**State-dependent types.** The creative advocate's proposal for refinement types indexed by lifecycle position. Multiple panellists acknowledged this as a compelling long-term direction that would subsume per-rule annotations, the nullable-field problem, and defensive guard boilerplate. Deferred as a separate ALP given its scope (type system redesign, migration cost, decidability questions).

---

## Panel report — refinement cycle

### Summary

One item debated across a refinement cycle (cycle 2 of 2). The panel reached **consensus: adopt**. All nine panellists agree on universal semantics for `produces`, intersection-based state guarantees at convergent transitions, derived state-level summaries as tooling output and compatibility with future state-dependent types. The simplicity advocate records a standing reservation but does not block.

### Refinement points resolved

**1. Formal semantics of `produces`.** Unanimous: `produces: field_name` is a universal post-condition. The field is guaranteed non-null in every post-state of every execution of the rule. An existential reading (non-null in some executions) would make the declaration useless for downstream reasoning. `produces` is a non-null assertion only; it must not acquire type-narrowing semantics (e.g. `produces: tracking_number as text` rather than `text?`), preserving the boundary with a future state-dependent type system.

**2. Convergent-transition semantics.** Unanimous: when multiple rules transition an entity to the same target state, the state-level guarantee at that state is the intersection of the `produces` sets of all inbound rules. If the intersection excludes a field that a downstream rule's `consumes` or `requires` clause references, the checker reports the gap. Error diagnostics must identify the specific inbound rule that lacks the production, the missing field, and the downstream rules affected, using domain terms rather than graph notation.

**3. Derived state-level summaries.** Unanimous: state-level guarantees ("when status is `shipped`, `tracking_number` and `warehouse_assignment` are guaranteed present") are derived mechanically from per-rule `produces` declarations and the transition structure. They are tooling output (queryable, displayable in IDE hover or documentation generators), not independently declared language constructs. No second source of truth.

**4. Relationship to state-dependent types.** Unanimous: per-rule `produces`/`consumes` declarations are strictly weaker than refinement types indexed by lifecycle position. A future state-dependent type mechanism can subsume them by interpreting each `produces` clause as a narrowing assertion, making the upgrade path mechanical promotion rather than rewrite. The future ALP on state-dependent types should be scoped and numbered rather than left as a vague future direction.

### What to change

Per-rule `produces` and `consumes` clauses, added as optional structural properties of rules. Syntax, validation rules and worked examples (including a convergent-transition case with checker error output) to be specified in the language reference. Key properties:

- `produces: field_name, field_name, ...` — universal guarantee that these fields are non-null in every post-state of every execution of the rule.
- `consumes: field_name, field_name, ...` — declaration that the rule reads these fields, enabling the checker to verify they are guaranteed present given the rule's `requires` guard and the state-level guarantees at that lifecycle position.
- Absent declarations are treated as "unchecked", not "empty". Existing specs remain valid with zero migration cost. Authors adopt incrementally.
- The checker computes state-level guarantees as the intersection of `produces` sets of all rules whose transitions reach that state.
- The checker reports convergent-transition gaps with lifecycle-aware diagnostics naming the offending rule, missing field and affected downstream rules.

### Reservations

The **simplicity advocate** maintains the reservation from the first cycle: per-rule annotations add ceremony justified primarily by the convergent-transition case, and an inference-first alternative (checker infers production sets from `ensures` clauses, flags convergent-transition gaps without new syntax) was not explored. The panel notes this alternative but observes that inference recovers what a rule happens to set, not what it commits to setting; the distinction between observation and obligation is the value the declaration provides. The reservation is recorded but does not block adoption.

The **domain modelling advocate** notes that `produces`/`consumes` is pipeline vocabulary rather than domain vocabulary. The concern is mitigated by derived state-level summaries expressed in domain terms, but alternative keyword naming may be worth revisiting during specification drafting.

The **creative advocate** accepts per-rule declarations as a stepping stone but requests that the future ALP on state-dependent types be recorded with enough specificity to prevent indefinite deferral.

### Deferred items

**State-dependent types.** Refinement types indexed by lifecycle position, where an entity's shape narrows as it moves through its lifecycle (e.g. an Order in state `shipped` has `tracking_number: text` rather than `tracking_number: text?`). Would subsume per-rule `produces`/`consumes` annotations, resolve state-dependent nullability at the type level, and eliminate defensive null guards for fields guaranteed present by lifecycle position. Requires a separate ALP addressing: type system foundations, decidability of subtyping, surface syntax accessible to non-technical readers, migration path from per-rule declarations, and interaction with variants and value types. To be numbered and scoped as a concrete proposal rather than left as an open-ended future direction.
