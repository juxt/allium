# ALP-18: Implicit transition graphs

**Status**: adopt
**Constructs affected**: `entity`, `enum`, `rule`, `transitions_to`, `becomes`, `invariant`
**Sections affected**: entities and variants, enumerations, rules, trigger types, invariants, validation rules

## Problem

Allium specs routinely model entities whose behaviour is governed by a status field with constrained transitions. An `Order` moves from `pending` to `confirmed` to `shipped` to `delivered`; it never moves from `delivered` back to `pending`. The language provides the primitives to express this: an inline enum for the status values, `transitions_to` and `becomes` triggers to react to state changes, and `requires` guards to prevent illegal transitions. But the transition graph itself is never declared. It exists only as a scattered collection of preconditions across multiple rules, and a reader must mentally reconstruct the graph by surveying every rule that touches the status field.

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

rule DeliverOrder {
    when: DeliverOrder(order)
    requires: order.status = shipped
    ensures: order.status = delivered
}

rule CancelOrder {
    when: CancelOrder(order)
    requires: order.status in {pending, confirmed}
    ensures: order.status = cancelled
}
```

The valid transitions here are `pending -> confirmed -> shipped -> delivered`, with `cancelled` reachable from `pending` or `confirmed`. Nothing in the spec says this. A reader discovers it by collecting the `requires`/`ensures` pairs from four separate rules and assembling them into a mental graph. The checker cannot verify that the graph is complete (are there states with no outbound transitions by design, or by omission?) or that a rule's postcondition respects the intended flow (a typo changing `confirmed` to `delivered` in a `requires` clause silently creates a shortcut through the graph).

This reconstruction burden grows with the number of states and transitions. A moderately complex lifecycle (an interview scheduling pipeline, a claims processing workflow, a subscription billing cycle) can have eight to twelve states and twenty or more transitions. The transition graph is often the most important structural property of the entity, yet it is the one property the language cannot express directly.

The problem compounds when multiple status fields interact. An entity with both a `review_status` and a `payment_status` has two independent state dimensions whose valid combinations may be constrained (you cannot move `payment_status` to `refunded` unless `review_status` is `completed`). These cross-field constraints are expressible as invariants, but the relationship between the two state dimensions, whether they are independent, hierarchical or synchronised, is implicit.

A related gap appears at data boundaries. State transitions rarely happen in isolation: entering a state often triggers data computation, and data becoming available often gates a transition. An AI agent loop illustrates this. The transition from "waiting for LLM response" to "executing tool call" depends on data the LLM produced (the tool name, the arguments). Entering the execution state triggers further data resolution (calling the tool, producing a result that feeds back into the next invocation). The control flow and the data flow are coupled, but Allium has no way to express which data a given state requires or produces. Derived values and `let` bindings handle data computation within individual rules, but the dependency structure across the lifecycle is as implicit as the transition graph itself.

## Evidence

Lifecycle-driven entities with constrained transitions appear in every domain Allium specs have been written for. The interview scheduling spec's `Interview` entity has a status enum with seven values and transition logic spread across nine rules. Order fulfilment, user onboarding, document approval, insurance claims and subscription billing all exhibit the same pattern: an enum field whose valid transitions are the central structural property of the entity, discoverable only by reading every rule that touches it.

External specification frameworks have converged independently on making transition graphs explicit. UML state diagrams, Harel statecharts, TLA+ state predicates, the W3C SCXML standard and XState all provide syntax for declaring states and transitions in one place. The breadth of this convergence, across formal methods, visual modelling, web standards and JavaScript libraries, suggests the problem is structural rather than domain-specific.

Statechart implementations in production systems (including the Fulcrologic library in Clojure) regularly reach beyond flat state sets to model hierarchy (states containing sub-states) and parallelism (multiple state dimensions active simultaneously). This recurrence suggests that flat enum fields hit a complexity ceiling in practice, though the threshold at which that ceiling matters varies by domain.

The Pathom3 library (Clojure) demonstrates a parallel structural pattern for data. Pathom models relationships between data attributes as a dependency graph: each resolver declares its inputs and outputs, and the framework chains resolvers automatically when a downstream attribute is requested. The structural insight is that when dependencies between attributes form a directed graph, leaving that graph implicit in scattered function bodies prevents automatic composition, cycle detection and gap analysis. Allium's derived values and `let` bindings exhibit the same implicitness for data dependencies that `requires`/`ensures` pairs exhibit for transition dependencies.

## Design tensions

**Single source of authority.** Allium's rules are currently the sole authority on what transitions are valid: the `requires` clause prevents illegal transitions, and the `ensures` clause effects legal ones. The transition graph is a consequence of the rules, not a separate declaration. Any change to this model must resolve whether the rules derive their validity from something else, or whether the language offers a way to make the implicit graph inspectable without introducing a second source of truth that can contradict the rules.

**Scattered structure vs localised rules.** The transition graph is a global property of an entity, but the logic governing each transition (its trigger, guard conditions, side effects) is local to a rule. Centralising the graph improves readability of the overall lifecycle at the cost of separating it from the rule logic it constrains. Keeping the graph distributed in rules preserves locality but sacrifices the ability to inspect the lifecycle as a whole.

**Flat state vs hierarchical state.** Many lifecycles are flat: a status field with five to eight values and linear or branching transitions. Others exhibit hierarchy: an `active` state with meaningfully distinct sub-states (`active.trial`, `active.paid`) where some transitions apply to all sub-states and others apply only within the group. Allium currently models these with separate enum values (`active_trial`, `active_paid`) and duplicated guards, which obscures the grouping. The tension is that flat lifecycles are common and simple, while hierarchical lifecycles are less common but painful when they arise.

**Independent vs coupled state dimensions.** When an entity has two status fields, the question is whether their transitions are independent or constrained by each other. The `review_status`/`payment_status` example above has cross-field constraints. Invariants can assert valid combinations after the fact, but they cannot express the directionality: which field's transition depends on the other's current value. The language has no way to distinguish "these dimensions are independent" from "these dimensions interact" except by reading every rule that touches either field.

**Control flow and data flow.** Transitions depend on data (a guard checks a field value) and produce data (an `ensures` clause sets field values). But the data dependencies across a lifecycle are as implicit as the transition dependencies. Which fields are read or written by rules associated with each state is discoverable only by reading those rules. This matters most in specs where data flows through a sequence of states, each consuming what the previous one produced, such as processing pipelines or agent loops. The tension is between treating control flow and data flow as separate concerns (simpler, matches the current rule model) and treating them as aspects of a single lifecycle structure (richer, but a larger departure from the current model).

**Checker capabilities vs author burden.** The transition graph's implicitness limits what the checker can verify. It cannot detect unreachable states, unintentional dead ends, or rules whose postconditions create transitions the spec author did not intend. Making the graph explicit would enable these checks, but it would also mean specs that currently pass validation might fail under new structural checks, and authors would need to maintain the graph alongside their rules.

## Scope

This ALP concerns the implicitness of transition graphs for entity status fields and the consequences of that implicitness for readability, verifiability and structural analysis. It also identifies the parallel implicitness of data dependencies across lifecycles as a related concern.

This ALP does not concern the `transitions_to` or `becomes` trigger syntax, which would continue to function as they do today. It does not concern temporal triggers or any rule machinery beyond the interaction between transition constraints and `requires`/`ensures` clauses. It does not propose changes to enum syntax. The data dependency question (the Pathom pattern of declaring attribute inputs and outputs with automatic resolution) is identified as evidence and as a design tension, but designing a general attribute resolution system is a separate concern that the committee may choose to address in a follow-on ALP.

## Panel review

### Summary

The nine-member design review panel debated ALP-18 with one item on the agenda: whether implicit transition graphs represent a problem the language should address. Eight panelists supported the problem framing. One (simplicity) initially argued this is a tooling problem, not a language problem, but conceded the core verification point during rebuttals. The panel reached consensus to adopt the problem statement with refinements to scope. The data-flow dimension identified in the proposal was unanimously (eight to one) judged to belong in a separate ALP.

### Responses

**Simplicity advocate.** Initially argued the transition graph is a consequence of the rules and should remain so. A checker that infers the graph from existing `requires`/`ensures` pairs would deliver every diagnostic benefit without adding syntax. Conceded during rebuttals that inference cannot distinguish an intentionally terminal state from an accidentally orphaned one: that distinction requires declared intent, which belongs in the language.

**Machine reasoning advocate.** The implicit graph is a structural regularity problem. LLMs reconstruct global properties from scattered local assertions poorly, and an explicit declaration converts inference to lookup. Rebutted simplicity's tooling argument by noting that inference solves verification but not generation: when an LLM writes a new spec, there is no graph to infer from yet; a declared graph gives the model something to write first and validate rules against.

**Composability advocate.** Supported the problem framing. Warned that any transition graph construct must compose cleanly with existing rule machinery without creating a second source of truth. Urged that the solution must generalise beyond enum status fields to avoid consuming syntactic space that a more general construct could occupy. Opposed fusing transition graphs with data-flow declarations: orthogonal concerns that compose independently are more valuable than a single fused construct.

**Readability advocate.** Strongly supported. A product owner reading an Order spec must currently scan four rules to answer "what can happen after confirmation?" A centralised lifecycle view would orient non-technical readers before the rule-by-rule detail. Opposed including data-flow declarations in this proposal's scope: a transition graph is stakeholder-legible; a data-dependency graph is a developer artefact.

**Rigour advocate.** Strongly supported. Reachability, completeness and dead-state detection are undecidable with implicit graphs. An explicit graph would make these properties statically decidable and would turn silent specification errors into validation failures. Rebutted simplicity directly: an inferred graph shows what the transition structure is, not what it should be. Completeness checking requires a specification of intent.

**Domain modelling advocate.** Strongly supported. Domain experts think in state machine diagrams; the current language forces decomposition of a first-class domain concept into fragments scattered across rules. The spec is the shared artefact between domain experts and developers, and the lifecycle should be visible there, not reconstructed by tooling.

**Developer experience advocate.** Strongly supported. Newcomers reliably make two mistakes: transition typos the checker cannot catch, and forgotten terminal-state guards. The current implicit model shifts overhead from writing to reading, which is where newcomers spend most of their time. A construct visible in the file beats a diagnostic you have to trigger. Opposed bundling data-flow declarations: it doubles the conceptual load for newcomers who are already struggling with scattered transitions.

**Creative advocate.** Supported the problem framing and pushed further: the scattered transition graph is a symptom of treating entities as bags of fields with rules bolted on, when lifecycle-driven entities are fundamentally state machines with data attached. Argued the data-dependency dimension should not be deferred, since a solution that captures transitions but not the data gates they depend on is incomplete. Partially conceded on scoping after rebuttals from composability and backward compatibility, accepting that the transition graph can be addressed first provided the design does not structurally prevent extension to data flow later.

**Backward compatibility advocate.** Supported exploration provided the construct is additive and opt-in. Existing specs that express transitions through `requires`/`ensures` alone must remain valid. Opposed the creative advocate's entities-as-state-machines proposal as too disruptive for the installed base. Agreed with rigour that the verification gap cannot be closed by inference alone.

### Key tensions

**Tooling vs language (resolved).** Simplicity argued the graph should be inferred by tooling. Rigour and machine reasoning rebutted that inference cannot verify intent (is a dead-end state deliberate or accidental?) and cannot assist generation (an LLM writing a new spec has no rules to infer from). Simplicity conceded the verification point.

**Data flow scope (resolved).** Creative argued that transition graphs and data-dependency declarations should be unified. Readability, composability, developer experience and backward compatibility all argued for separation: the two concerns are orthogonal, fusing them doubles the conceptual load and consumes syntactic space. Creative accepted incremental scoping provided the transition graph design does not foreclose later extension to data flow. The panel agrees that data-flow declarations, if warranted, belong in a follow-on ALP.

**Single source of authority (open).** The proposal identifies a tension between the transition graph as a declaration and the rules as the current sole authority on valid transitions. The panel did not resolve the relationship between a declared graph and rule-level `requires`/`ensures` pairs. Options include the graph as the authority (rules must conform), the graph as a checked summary (derived from rules, validated for completeness), or the graph as a constraint that narrows what rules may express. This is the central design question for the solution phase.

**Generality (open).** Composability warned that a construct scoped only to enum status fields is an incomplete abstraction. Creative accepted this as a design constraint: the syntax should not structurally prevent extension to variant discriminators or other lifecycle-bearing fields. The panel did not resolve the exact scope but agreed it should be addressed in the design phase.

### Verdict

**Consensus: adopt** the problem statement. The panel agrees that:

1. The implicit transition graph is a real, recurring problem that the language should address with a declaration, not just tooling.
2. The data-flow dimension (the Pathom pattern) should be deferred to a separate ALP. The transition graph design should not foreclose later extension to data-flow declarations, but it should not attempt to include them.
3. The construct should be additive and opt-in: existing specs that omit a transition graph declaration must remain valid.
4. The solution phase must resolve the authority relationship between the declared graph and rule-level `requires`/`ensures` pairs.
5. The solution should be designed with generality in mind (not structurally limited to enum status fields) but may initially target the common case.

**Simplicity advocate reservation.** The simplicity advocate conceded the verification point but recorded a reservation: the centralised graph risks becoming a summary that feels sufficient but is not, giving non-technical readers false confidence about their understanding of the lifecycle. The solution phase should consider how the graph relates to the conditions and side-effects that the rules still govern.
