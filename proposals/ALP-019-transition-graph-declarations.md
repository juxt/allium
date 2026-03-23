# ALP-19: Transition graph declarations

**Status**: adopt
**Constructs affected**: `entity`, `enum`, `rule`, `requires`, `ensures`, `transitions_to`, `becomes`, `invariant`
**Sections affected**: entities and variants, enumerations, rules, trigger types, invariants, validation rules

## Problem

ALP-18 established that implicit transition graphs are a structural gap in the language. The panel unanimously agreed the problem is real: transition graphs are the most important structural property of lifecycle entities, yet they exist only as a scattered collection of `requires`/`ensures` pairs across multiple rules. ALP-18's verdict directed the language to address this with a declaration, not just tooling. This ALP concerns the specific constraints that a transition graph declaration must navigate.

The central difficulty is the authority relationship between the transition graph and the rules. Currently, rules are the sole authority on valid transitions. A rule's `requires` clause prevents illegal transitions, and its `ensures` clause effects legal ones. The transition graph is a consequence of the rules, not a separate declaration. Introducing a declared graph creates a second structural element that describes valid transitions, and the relationship between these two sources must be precise.

If the graph is authoritative, rules that produce transitions outside the declared graph are invalid. This gives the checker a new class of errors (rules that violate the intended lifecycle) but means every lifecycle entity needs a graph declaration before any rule can touch its status field. If the graph is a checked summary derived from the rules, it adds no new authority but enables completeness and reachability analysis. If the graph is a narrowing constraint that limits what rules may express without replacing their role, it occupies a middle ground that must be precisely defined to avoid ambiguity about which element has the final say.

```
entity Order {
    status: pending | confirmed | shipped | delivered | cancelled
}

rule ConfirmOrder {
    when: ConfirmOrder(order)
    requires: order.status = pending
    ensures: order.status = confirmed
}

rule ShipOrder {
    when: ShipOrder(order)
    requires: order.status = confirmed
    ensures: order.status = shipped
}
```

A reader examining these two rules can infer that `pending -> confirmed` and `confirmed -> shipped` are valid transitions. But nothing in the spec declares whether `pending -> shipped` is forbidden by design or simply has no rule yet. Nothing distinguishes `delivered` as an intentional terminal state from a state whose outbound transitions were accidentally omitted. The checker cannot verify completeness because there is no declaration of what "complete" means.

The authority question determines what errors become catchable. Under an authoritative graph, a rule whose `ensures` clause sets `order.status = delivered` without a corresponding `confirmed -> delivered` edge in the graph is a validation failure. Under a checked summary, the same rule is valid but the graph marks `delivered` as reachable only from whatever states the rules happen to define. Under a narrowing constraint, the answer depends on what "narrowing" means, and that definition must be precise enough to implement.

## Evidence

ALP-18's panel review provides the direct evidence. Eight of nine panellists concluded the problem belongs in the language rather than in tooling, with the simplicity advocate conceding the verification point: an inferred graph cannot distinguish an intentionally terminal state from an accidentally orphaned one, because that distinction requires declared intent. The machine reasoning advocate added a generation argument: when an LLM writes a new spec, there is no existing rule set to infer from, so a declared graph gives the model something to write first and validate rules against.

The authority relationship is the question that external frameworks answer differently, and their divergence illustrates why the choice is non-trivial. UML state diagrams and Harel statecharts treat the diagram as authoritative: transitions not in the diagram are forbidden. XState takes the same approach: the state machine definition is the source of truth, and events that would produce undefined transitions are silently dropped. TLA+ treats state predicates as constraints that the specification must satisfy, a narrowing model where the predicates and the actions must be consistent but neither is derived from the other. These frameworks made different choices because they serve different audiences and have different priorities. Allium's choice must account for its own priorities: behavioural specification read by both humans and machines, with no runtime to enforce the graph.

The authority question also appears in existing Allium specs. The interview scheduling spec has a status enum with seven values and nine rules. Some transitions are guarded by `requires` clauses that reference fields other than the status (e.g. requiring a minimum number of confirmed interviewers before moving to `scheduled`). A transition graph that declares `confirmed -> scheduled` as valid captures the lifecycle structure but not the data-dependent guard. The relationship between the graph's structural claim ("this transition is valid") and the rule's conditional claim ("this transition is valid when these data conditions hold") must be defined.

## Design tensions

**Authority vs redundancy.** If the graph is authoritative, every valid transition appears in both the graph declaration and at least one rule's `requires`/`ensures` pair. The graph says "pending -> confirmed is structurally valid" and the rule says "pending -> confirmed happens when ConfirmOrder is received and payment is verified". This duplication is the cost of having two elements that describe the same phenomenon at different levels of abstraction. Eliminating the duplication means either the graph replaces rules for transition validity (and rules handle only the conditional logic) or the graph is derived from rules (and adds no new information, only analysis).

**Structural validity vs conditional validity.** The graph declares which transitions are structurally possible. Rules declare under what conditions those transitions actually occur. These are different claims. `pending -> confirmed` in the graph means the lifecycle admits this edge. `requires: order.status = pending and order.payment_verified` in the rule means this specific transition happens only when payment is verified. The graph and the rule are not redundant; they operate at different levels. But the language must make this distinction legible, or readers will expect the graph to encode conditions it cannot express.

**Completeness obligations.** A declared graph enables the checker to ask whether every state has at least one outbound transition (or is explicitly terminal), whether every transition in the graph has at least one rule that can produce it, and whether any rule produces a transition not in the graph. Each of these checks has value, but each also imposes an obligation on the spec author. The question is which obligations are worth imposing and which become busywork that discourages adoption.

**Terminal states.** The current language has no way to mark a state as intentionally terminal. A state with no outbound transitions and no rules that transition away from it could be a terminal state by design or an incomplete spec. A transition graph declaration must address this, either by requiring terminal states to be marked or by treating the absence of outbound edges as an implicit terminal declaration. The choice affects how the checker reports missing transitions.

**Multi-dimensional state.** An entity with two status fields (e.g. `review_status` and `payment_status`) has two transition dimensions. These may be independent (either can transition without regard to the other) or coupled (transitioning `payment_status` to `refunded` requires `review_status = completed`). A single transition graph per status field cannot express cross-field dependencies. Invariants can assert valid combinations after the fact, but they cannot express the directionality of the dependency. The question is whether the transition graph mechanism addresses multi-dimensional state or defers it.

**Generality beyond enums.** Enum status fields are the common case, but lifecycle behaviour also appears with variant discriminators and boolean flags. A construct structurally limited to enum fields is an incomplete abstraction. A construct general enough to cover all lifecycle-bearing fields may be more complex than the common case warrants. The tension is between targeting the 80% case cleanly and designing for the full range at the cost of a more complex construct.

**Additive adoption.** ALP-18's panel required the construct to be opt-in: existing specs that omit a transition graph must remain valid and must not fail new checker rules. This means the graph cannot be a required element of entities with enum status fields. The checker may offer enhanced analysis when a graph is present, but it must not penalise specs that lack one.

## Scope

This ALP concerns the declaration of transition graphs for entity status fields and the authority relationship between those declarations and existing rule-level transition logic. It covers the structural representation of valid transitions, terminal states and the checker's completeness analysis.

This ALP does not concern data-flow dependencies across lifecycles. ALP-18's panel explicitly deferred that concern to a separate proposal. This ALP does not propose changes to `transitions_to` or `becomes` trigger syntax, which would continue to function as they do today. It does not propose changes to enum syntax. It does not concern temporal triggers or any rule machinery beyond the interaction between transition graph declarations and `requires`/`ensures` clauses.

## Panel review

### Summary

The nine-member design review panel debated ALP-19 with the authority relationship as the central question. Six panelists initially favoured an authoritative graph, one favoured a checked summary, and two favoured a narrowing constraint. After one round of rebuttals, all nine converged on the authoritative model with an opt-in adoption constraint. The panel also reached consensus on explicit terminal-state marking, two completeness obligations, deferral of multi-dimensional state, and targeting enum fields first with extensibility preserved. Two reservations were recorded.

### Responses

**Simplicity advocate.** Initially argued for a checked summary: an authoritative graph creates redundancy between the graph declaration and rule `requires`/`ensures` pairs, "a standing invitation for the two declarations to drift apart". Proposed terminal-state annotations as the only addition needed, since inference cannot distinguish intentional terminals from omissions. Advocated deferring multi-dimensional state entirely.

**Machine reasoning advocate.** Argued for an authoritative graph as a single lookup table. The checked summary and narrowing constraint models both require LLMs to hold two partially overlapping representations, which is the scattered-global-property reconstruction that ALP-18 identified as the problem. An authoritative graph enables two-phase generation: write the structural skeleton first, then fill in rules as conditional logic. Explicit terminal states via keyword, not absence inference. Defer multi-dimensional state and generality beyond enums.

**Composability advocate.** Initially argued for a narrowing constraint: the graph declares structural edges, rules supply conditional logic, and the checker validates consistency without the graph needing to know about rule internals. Opposed the authoritative model on grounds that it forces every lifecycle entity to declare a graph before any rule can touch its status field, violating additive adoption. Favoured field-parametric design for future generality. Independent single-field graphs with cross-field invariants for multi-dimensional state.

**Readability advocate.** Argued for an authoritative graph. A product owner needs to open one block and see every valid move, without wondering whether some rule elsewhere quietly adds another path. Terminal states should use an explicit keyword because "nothing listed" is invisible and invisible things do not communicate. Defer multi-dimensional state; a product owner reading two status fields already thinks of them as two separate lifecycles.

**Rigour advocate.** Argued for an authoritative graph as the only model that creates a genuinely new class of validation errors. A checked summary is "semantically vacuous": it tells the checker what the rules already say, so every completeness finding reduces to "you haven't written a rule yet" rather than "you've violated your declared intent". Two completeness checks: every non-terminal state must have at least one outbound edge, every declared edge must be witnessable by at least one rule. Defer multi-dimensional state because cross-field transition dependencies require product-graph semantics whose decidability properties need separate analysis.

**Domain modelling advocate.** Argued for an authoritative graph matching how domain experts draw state machine diagrams: the lifecycle diagram comes first, transition logic is subordinate. Initially suggested terminal states need no keyword, since they are simply states with no outbound edges in the declared graph. One graph per status field with invariants for cross-field coupling. Syntax must not structurally prevent extension to variant discriminators.

**Developer experience advocate.** Argued for an authoritative graph to catch the two mistakes newcomers actually make: transition typos and forgotten terminal states. A checked summary gives no new errors. Explicit terminal marking because implicit "no outbound edges means terminal" is silent-by-default behaviour that lets omissions hide. Defer multi-dimensional state and generality beyond enums to keep day-one complexity low.

**Creative advocate.** Argued for an authoritative graph. A narrowing constraint is "two half-authorities that share a boundary nobody can point to". The graph declares which edges exist, rules declare when and why those edges fire, cleanly separating topology from conditional logic. Multi-dimensional state should use independent graphs by default, but the design must leave room for a future ALP to declare coupling between dimensions. Completeness checking should not require that every rule's guard conditions are derivable from the graph, since that conflates structural and conditional validity.

**Backward compatibility advocate.** Initially argued for a narrowing constraint: an authoritative graph forces every lifecycle entity to declare a graph before any rule can touch its status field, breaking existing specs the moment someone enables new checker rules. Explicit terminal marking because inference changes its answer when a rule is added.

### Rebuttals

**Simplicity conceded** the authoritative model after rigour and developer experience argued that a checked summary adds ceremony without adding errors, the exact failure mode the simplicity advocate guards against. Recorded a condition: the graph must declare only structural edges, never conditions, so it remains a strict superset check rather than a partial duplicate of rule logic. Sharpened the ALP-18 reservation: the proposal should state explicitly that the graph declares which transitions are possible, not when or why they occur.

**Composability conceded** the authoritative model, provided the construct remains opt-in. Rigour's argument that a narrowing constraint leaves the boundary between graph and rules under-specified, and machine reasoning's generation argument (a single authoritative declaration is easier to write first and validate against than two partial views) outweighed the composability concern. If the graph is opt-in and self-contained, the composability objection dissolves.

**Backward compatibility conceded** the authoritative model under the opt-in framing: no graph means current behaviour, declaring a graph means rules must conform to it. Recorded one insistence: the checker must not emit warnings or suggestions about missing graphs on specs that lack them, because "you should add a transition graph" nudges are a soft mandate that erodes opt-in over time.

**Domain modelling conceded** explicit terminal-state marking. Absence-as-intent reproduces the exact ambiguity this proposal exists to eliminate. A `terminal` annotation makes intent legible to the checker, to readers and to LLMs generating against the graph.

**Rigour rebutted** simplicity's drift concern: drift between graph and rules is the point, not a defect. Every divergence the checker catches is a case where the spec author's intent and implementation disagree. On additive adoption, the authoritative graph should only activate its checker obligations when present.

**Machine reasoning rebutted** simplicity's redundancy concern: the two representations operate at different abstraction levels and serve different phases of generation. The graph is a structural skeleton; rules are conditional flesh. Drift is not a risk but the entire point of the checker.

**Readability rebutted** domain modelling on terminal states: in a text declaration a reader scanning edges has to notice what is absent, and noticing absence is hard. One word (`terminal`) makes intent impossible to miss. On false confidence: the graph tells a product owner "these are the possible moves" and the rules tell them "here is what must be true for each move". That is natural layering, not a trap.

**Developer experience rebutted** simplicity's redundancy concern: stating intent twice at different levels of abstraction is the same pattern as type signatures and function bodies. On adoption pressure: if someone feels pressured to add a graph, that pressure comes from wanting the checker to catch their mistakes, which is exactly the incentive structure the language should create.

**Creative rebutted** on coupling: composability's position (independent single-field graphs plus cross-field invariants) satisfies the requirement. These are orthogonal primitives that a future coupling ALP could compose without redesigning the transition graph itself. On drift: the authoritative model does not describe the same thing twice; the graph says "this edge exists" and the rule says "this edge fires under these conditions", which are different claims at different levels of abstraction.

### Key tensions

**Authority model (resolved).** The central question of the proposal. Six panelists initially favoured an authoritative graph, one a checked summary, two a narrowing constraint. After rebuttals, all nine converged on the authoritative model. The decisive arguments were rigour's point that only an authoritative graph creates a genuinely new class of validation errors, machine reasoning's generation argument (write graph first, validate rules against it), and the recognition that a checked summary or narrowing constraint adds ceremony without adding errors. The opt-in framing resolved the additive-adoption concern: entities without a declared graph continue to validate exactly as they do today.

**Terminal states (resolved).** Domain modelling initially suggested absence of outbound edges is sufficient. Eight panelists argued for explicit `terminal` marking. Domain modelling conceded: absence-as-intent is the ambiguity this proposal exists to eliminate, and a `terminal` annotation costs one word while making intent impossible to miss.

**Redundancy and drift (resolved).** Simplicity raised the concern that the graph and rules describe overlapping phenomena, creating an invitation for drift. Machine reasoning, rigour, developer experience and creative all rebutted that the graph and rules operate at different abstraction levels (structural topology vs conditional logic), and that drift between them is a validation error the checker catches, not a defect of the model. Simplicity conceded with the condition that the graph must declare only structural edges, never conditions.

**False confidence (noted).** Simplicity's reservation from ALP-18 stands sharpened: a product owner who reads the graph and stops there has a structural overview but not a complete understanding of lifecycle behaviour. Readability rebutted that this is natural layering (a map without traffic conditions is still useful), not a trap. The panel notes the concern without treating it as blocking.

### Verdict

**Consensus: adopt** the following design constraints for transition graph declarations:

1. **Authoritative and opt-in.** The transition graph, when declared, is the sole authority on which transitions are structurally valid. Rules whose `ensures` clauses produce transitions not in the graph are validation errors. Entities without a declared graph continue to derive transition validity from rules alone, with no change in checker behaviour. The checker must not emit warnings or suggestions about missing graphs on specs that lack them.

2. **Structural edges only.** The graph declares which transitions are possible (structural topology), not when or why they occur (conditional logic). Conditions remain in rules. The graph and rules are different claims at different levels of abstraction: the graph says "this edge exists", the rule says "this edge fires under these conditions".

3. **Explicit terminal states.** Terminal states must be explicitly marked with a `terminal` keyword or equivalent annotation, not inferred from the absence of outbound edges. Absence-as-intent is the ambiguity this construct exists to eliminate.

4. **Two completeness obligations.** When a graph is declared, the checker enforces: (a) every non-terminal state has at least one outbound edge in the graph, and (b) every declared edge is witnessable by at least one rule. The converse (every rule transition appears in the graph) is enforced by the authoritative relationship itself.

5. **Defer multi-dimensional state.** Entities with multiple status fields should use independent single-field graphs, with cross-field invariants handling coupling. A dedicated coupling mechanism, if warranted, belongs in a follow-on ALP. The transition graph design does not foreclose this extension.

6. **Target enums first, preserve generality.** The construct should initially target enum status fields (the 80% case) but should not structurally prevent extension to variant discriminators or other lifecycle-bearing fields.

**Simplicity advocate reservation.** The graph declares structural topology, which is necessary and sufficient for its verification role. But the proposal should explicitly document that the graph is not a complete description of lifecycle behaviour: conditions, side-effects and data dependencies remain in rules and must be read there. A product owner who reads only the graph has an accurate but incomplete picture.

**Backward compatibility advocate reservation.** The opt-in framing is essential to this consensus. No checker warnings, suggestions or linting nudges should encourage graph adoption on specs that lack one. The construct earns its adoption through demonstrated value, not through tooling pressure.
