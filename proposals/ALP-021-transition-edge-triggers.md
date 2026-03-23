# ALP-21: Transition edge triggers

**Status**: reject
**Depends on**: ALP-20 (transition graph syntax)
**Constructs affected**: `transitions`, `rule`, `when`, `ensures`
**Sections affected**: entities and variants, rules, validation rules

## Problem

ALP-20 settled the syntax for transition graph declarations. The graph declares which transitions are structurally valid, using `->` edges inside a `transitions` block within the entity body. Rules declare when and why those transitions fire. But the graph and the rules are connected only implicitly: a reader who sees `pending -> confirmed` in the graph must scan every rule in the file to find which one drives that transition.

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

The graph tells you the topology. The rules tell you the conditions. Nothing connects the two. To answer "what causes an order to move from pending to confirmed?", a reader must reconstruct the mapping by reading every rule's `requires` and `ensures` clauses and matching them against the graph's edges. This reconstruction is the same scattered-global-property problem that ALP-18 identified for the graph itself, now shifted one level up.

The gap is sharpest when multiple rules can drive the same edge. If both `ConfirmOrder` and `AutoConfirmOrder` can move an order from `pending` to `confirmed`, nothing in the graph indicates this. A reader who finds `ConfirmOrder` may not realise there is a second path. The checker enforces that every edge is witnessable by at least one rule (ALP-19's completeness obligation), but it does not surface which rules witness which edges.

## Evidence

UML state machine diagrams label transitions with their triggering events. The label is not the condition (guard) but the event name: the arrow from `pending` to `confirmed` is labelled `ConfirmOrder`, not `payment_verified and order.total > 0`. This separation between trigger identity and trigger conditions is well established in state machine notation and matches the separation Allium already draws between the graph (structural topology) and rules (conditional logic).

XState defines transitions with an `on` property that maps event names to target states. The event name is the primary key; the target state and guards are subordinate. This makes the event-to-transition mapping explicit at the point of declaration rather than requiring cross-reference.

Allium's own trigger syntax already names the events. A rule's `when` clause binds a trigger: `when: ConfirmOrder(order)` names the external stimulus. The information needed to label graph edges already exists in the rule definitions. The question is whether it should also appear on the graph, and what the checker should do with the correspondence.

ALP-22 (cross-rule data dependencies) will need to associate data production with specific transitions. If edges carry trigger labels, ALP-22 can reference them: "the `ConfirmOrder` transition produces `payment_reference`". Without labels, ALP-22 must either invent its own edge-identification mechanism or reference edges by their source-target pair, which becomes ambiguous when multiple rules drive the same edge.

## Design tensions

**Labelling vs pure topology.** ALP-19 established that the graph declares structural topology, not conditional logic. Edge labels sit between these: a trigger name is not a condition, but it is more than bare topology. Adding labels enriches the graph's communicative value but moves it closer to encoding behavioural detail. The question is whether trigger names are structural information (which event opens this edge) or behavioural information (what happens on this edge).

**Single vs multiple triggers per edge.** A transition may be driven by one rule or by several. `pending -> confirmed` might be caused by `ConfirmOrder` (manual) and `AutoConfirmOrder` (automatic). If edges carry labels, the syntax must accommodate multiple triggers per edge. This affects whether labels are a simple annotation or a list, and whether the checker enforces that every listed trigger has a corresponding rule.

**Maintenance surface.** Labels create a new correspondence: the trigger name on the edge must match a rule's `when` clause. Renaming a rule or its trigger requires updating the graph. This is a cost. The question is whether the navigational and verification value justifies it, or whether the correspondence is better left to tooling (e.g. a language server that can jump from edge to rule).

**Checker obligations.** If edges carry labels, the checker could enforce several new properties: every label on an edge corresponds to a rule that produces that transition; every rule that produces a transition is listed on the corresponding edge; no label appears on an edge whose source-target pair the rule cannot produce. Each of these is independently useful but each adds a validation obligation that spec authors must satisfy.

**Interaction with ALP-22.** ALP-22 will address data dependencies across transitions. If edges are labelled with trigger names, data declarations can reference specific triggers rather than source-target pairs. This makes per-transition data contracts more readable ("ConfirmOrder produces payment_reference") but couples the data mechanism to the labelling mechanism. If labels are optional, ALP-22 must handle both labelled and unlabelled edges.

**Optional vs required.** Labels could be mandatory (every edge must name its trigger), optional (authors label edges when useful) or inferred (the checker derives labels from rules and displays them in diagnostics). Mandatory labels maximise the graph's communicative value but increase the authoring cost. Optional labels create two dialects. Inferred labels add no syntax but provide no declared intent.

## Scope

This ALP concerns whether and how transition graph edges carry trigger labels that identify the rules or events driving each transition. It covers the labelling syntax, the correspondence between labels and rule triggers, checker obligations for that correspondence, and interaction with ALP-22's data dependency declarations.

This ALP does not revisit the transition graph syntax settled by ALP-20 (inline placement, `transitions` keyword, `->` edges, `terminal:` clause). It does not concern the authority model or completeness obligations settled by ALP-19, except to extend them with new label-related checks. It does not concern data-flow declarations, which are deferred to ALP-22.

## Panel review

### Summary

The nine-member design review panel debated ALP-21 across three central questions: whether edge labels belong in the language at all, whether they should be optional or required, and what a label denotes. The panel could not converge. Four panellists favoured adoption (machine reasoning, readability, domain modelling, creative), three favoured rejection in favour of tooling-inferred labels (simplicity, composability, developer experience), and two favoured deferral until ALP-22's requirements are concrete (rigour, backward compatibility). A refinement cycle narrowed the optional/required question but did not resolve the deeper disagreement about whether labels cross ALP-19's topology/behaviour boundary. The result is a split, deferred to the language author.

### Responses

**Simplicity advocate.** Edge trigger labels entangle two things ALP-19 and ALP-20 deliberately separated: structural topology and behavioural logic. The graph says which edges exist; rules say when and why they fire. Trigger labels sit in neither category cleanly, creating a third kind of information maintained in lockstep with both. The problem is real but navigational, not structural, and navigational problems belong to tooling. Favours inferred labels surfaced in diagnostics.

**Machine reasoning advocate.** Edge labels are the single highest-value addition the checker could receive. Without them, an LLM reconstructing the rule-to-edge mapping must perform exactly the scattered cross-reference ALP-18 identified as the core problem. Labels enable a three-phase generation workflow: write graph with trigger names, write rules, checker validates correspondence. Favours required labels with square-bracket postfix syntax: `pending -> confirmed [ConfirmOrder, AutoConfirmOrder]`. Labels must be exhaustive (closed-world).

**Composability advocate.** Labels are not structural topology. ALP-19 drew a clean line: the graph declares which edges exist, rules declare when and why. A trigger name answers "what causes this transition", which is closer to "why" than to "which". Attaching labels to edges consumes syntactic space that future features (priority, cost, guard summaries) might need. ALP-22 should declare data dependencies on rules (per-rule `produces`/`consumes` clauses, matching Pathom's model), not on edges. Favours inferred labels via tooling.

**Readability advocate.** The graph currently answers "what states exist?" but goes silent when you ask "what makes that happen?" Labelling edges with trigger names turns the graph into a narrative a product owner can follow. Multiple triggers per edge read naturally: `pending -> confirmed [ConfirmOrder, AutoConfirmOrder]` says there are two ways this happens. Favours optional labels, with authors adding them where they improve clarity.

**Rigour advocate.** The critical question is whether labels create new validation power or merely restate what the checker already computes. If labels are exhaustive (closed-world), they enable exclusivity verification: not just "does at least one rule witness this edge?" but "are exactly these rules the ones that witness it?" That is genuinely stronger. But the proposal conflates three distinct things: trigger name (the event in the `when` clause), rule name, and causal event. These need not coincide. Until the semantics of what a label denotes are pinned down, the correspondence check is ambiguous. Also raises cross-entity labelling (a rule that transitions fields on two entities must be labelled in both graphs) and conditional ensures (a rule whose ensures clause conditionally targets different edges). Prefers to defer until ALP-22 clarifies its requirements.

**Domain modelling advocate.** Domain experts already label transitions with triggering events when they draw lifecycle diagrams. The gap is real and maps onto how stakeholders think. But domain experts use domain event names ("payment verified"), not rule names (`ConfirmOrder`) or trigger bindings. If labels reference rule names, they serve developers; if domain event names, they serve stakeholders. The proposal does not resolve which vocabulary labels use. Favours optional labels using trigger names, matching UML convention.

**Developer experience advocate.** The navigational problem is real but the cure creates a new failure mode. A newcomer who renames a rule gets a checker error on the graph, not the rule, and must understand the label-to-rule correspondence before they can fix it. Stale labels during active development are worse than no labels because they create false confidence. Favours inferred labels surfaced in diagnostics, with source-target pairs as stable edge identifiers.

**Creative advocate.** The fact that topology was settled in ALP-20 and a separate proposal is now needed just to say who drives which edge suggests the original separation cut too deep. The most expressive version of this proposal turns the graph from a topology diagram into a transition table: colon-delimited trigger lists after each edge (`pending -> confirmed: ConfirmOrder, AutoConfirmOrder`). This dissolves ALP-22's edge-identification problem and leaves room for future data annotations per trigger. Favours optional per-edge labels.

**Backward compatibility advocate.** Mandatory labels invalidate every ALP-20 graph that exists. The precedent is damaging: syntax shipped in one ALP and broken in the next erodes trust. Optional labels are the only backward-compatible choice. Prefers to defer until ALP-22's requirements are concrete, since every month of adoption makes mandatory labels more expensive.

### Rebuttals

**Machine reasoning rebutted simplicity and composability:** inferred labels are tooling, not language. If the navigational problem is real enough to identify in a proposal, it deserves a language-level solution. A reader without a language server gets nothing from inference. The checker already computes the mapping; externalising it as declared intent enables closed-world verification, which is genuinely new validation power.

**Simplicity rebutted machine reasoning:** required labels double the misgeneration surface. An LLM writing a spec now has two places to state the same correspondence. Every mismatch is a checker error that has nothing to do with behavioural correctness. The checker's completeness obligation already ensures every edge is witnessable. Labels add a second way to get it wrong without adding a second thing to get right.

**Rigour rebutted the optional camp** (readability, domain modelling, creative): optional per-edge labels create open-world semantics that actively mislead. A reader seeing `pending -> confirmed [ConfirmOrder]` naturally assumes exhaustiveness. If `AutoConfirmOrder` also drives that edge but is unlisted, the label is worse than no label. Open-world labels invite the false-confidence problem that ALP-19's simplicity reservation warned about.

**Readability and creative conceded** the per-edge misleading-absence problem. Both shifted to all-or-nothing at the graph level: if any edge is labelled, all must be. This preserves closed-world semantics within a labelled graph while keeping labelling opt-in across graphs.

**Domain modelling responded to rigour:** partially conceded, but raised the deeper question: if labels must be exhaustive, what exactly are they enumerating? Rule names? Trigger names? Domain event names? Different answers serve different audiences. Until this is resolved, labels cannot be specified precisely enough to check.

**Composability rebutted machine reasoning on ALP-22:** ALP-22 cites Pathom, where resolvers declare their own inputs and outputs. The natural home for data production declarations is the rule, not the edge. If ALP-22 uses per-rule `produces`/`consumes` clauses, edge labels are unnecessary for data dependency tracking. Source-target pairs work for the common case; per-rule declarations work for the multi-trigger case.

**Backward compatibility rebutted machine reasoning:** required labels invalidate every ALP-20 graph that exists. A syntax shipped in one ALP and broken in the next erodes trust in the language's stability.

**Developer experience rebutted readability:** labels help when correct, hurt when stale. During active spec development, labels will lag behind rule changes. A newcomer trusting a stale label is worse off than a newcomer who knows to search for rules.

**Machine reasoning rebutted rigour's deferral:** ALP-22 explicitly depends on ALP-21 and needs a stable edge-identification mechanism. Designing ALP-22 first and then retrofitting labels creates more rework than designing labels now with ALP-22's needs in mind.

**Rigour responded to machine reasoning:** ALP-22's dependency on ALP-21 is stated, not demonstrated. The data dependency mechanism may ultimately attach to rules rather than edges, making labels unnecessary. Designing labels to serve an unreviewed proposal risks premature commitment to a coupling the downstream proposal may not want.

### Refinement

After rebuttals, the optional camp (readability, creative) conceded per-edge optionality and converged on all-or-nothing graph-level labelling: a graph is either fully labelled (closed-world, every edge annotated) or fully unlabelled (current ALP-20 form). This refinement addressed rigour's misleading-absence concern and backward compatibility's migration concern.

The refined proposal: labels are opt-in at the graph level. When present, every edge must carry a trigger list. The checker enforces that listed triggers correspond to rules and that every rule producing a transition on that graph appears on the corresponding edge. Unlabelled graphs retain current ALP-20 behaviour.

The reject camp (simplicity, composability, developer experience) maintained their position: the refinement reduces the two-dialect problem but does not resolve the fundamental objection. Labels still cross ALP-19's topology/behaviour line, still create a maintenance surface, and still consume syntactic space on edges. Inferred labels via tooling achieve the navigational benefit without these costs.

Rigour noted that the refinement sidesteps the semantics question. What does a label denote: the trigger name from the `when` clause, the rule name, or a domain event name? All-or-nothing labelling is a structural decision; the denotation question is a semantic one that remains unresolved.

The refinement did not achieve convergence.

### Key tensions

**Labels as topology or behaviour (unresolved).** The central question. ALP-19 drew a line: the graph declares structural topology, not conditional logic. The adopt camp argues trigger names are structural information (which event opens the edge, not what conditions apply). The reject camp argues trigger names are references to rules, which are behavioural machinery, and that labelling crosses the line. Neither side conceded. This is a genuine disagreement about where the boundary between structure and behaviour falls, not a misunderstanding that rebuttals can resolve.

**Optional vs required vs inferred (partially resolved).** Three initial positions collapsed to two after rebuttals. Rigour's closed-world argument eliminated per-edge optionality: the optional camp conceded that partially labelled graphs invite misreading. The field narrowed to all-or-nothing graph-level labelling (the adopt camp's refined position) vs inferred labels via tooling (the reject camp). Required labels on all graphs were rejected by backward compatibility as a migration violation.

**Label denotation (unresolved).** What a label refers to: trigger name (from the `when` clause), rule name, or domain event name. Domain modelling raised the distinction. Rigour sharpened it: a rule named `AutoConfirmOrder` might fire on a `TimerExpired` trigger, and which name goes on the edge produces different semantics. Machine reasoning proposed trigger names; rigour proposed rule names; domain modelling wanted domain event names. No convergence.

**ALP-22 coupling (unresolved).** The adopt camp's strongest argument: labels give ALP-22 stable edge identifiers for data dependency declarations. The reject camp's strongest counter: ALP-22 may attach data dependencies to rules rather than edges (following Pathom's model), making labels unnecessary. Composability argued that coupling edge labels to an unreviewed proposal is premature. Machine reasoning argued that deferral leaves ALP-22 without a foundation. Neither argument was refuted.

### Verdict

**Split.** Substantive arguments remain on both sides after rebuttals and one refinement cycle. The panel records both positions at their strongest. No change is made. The finding is deferred to the language author.

**For adoption.** Edge labels convert the transition graph from a topology diagram into a transition table that answers both "what states connect?" and "what causes each connection?" This is the information readers most need when scanning a lifecycle, and it cannot be provided by tooling alone because Allium specs are read by humans without language servers. Labels enable closed-world verification (exactly these triggers drive this edge, and no others), which is genuinely new validation power beyond ALP-19's completeness checks. Labels give ALP-22 stable, unambiguous edge identifiers for data dependency declarations. The maintenance cost (keeping labels in sync with rules) is the same pattern as the graph itself: stated intent that the checker verifies. The refined design (all-or-nothing graph-level labelling) preserves backward compatibility and avoids the misleading-absence problem. If adopted, the syntax should use a postfix annotation on each edge line, with the graph identified as either labelled or unlabelled as a whole.

**Against adoption.** Labels cross the line ALP-19 drew between structural topology and behavioural logic. Trigger names are references to rules, which are behavioural machinery. The graph's virtue is its purity: it says which edges exist, full stop. Labels entangle the graph with rule-level churn, creating a maintenance surface that scales with the number of rules per edge. The navigational problem is real but belongs to tooling: the checker already computes the edge-to-rule mapping via ALP-19's completeness obligations, and inferred labels in diagnostics or language server hover provide the same navigational value without baking a synchronisation obligation into the source text. The ALP-22 argument is premature: the data dependency mechanism may attach to rules rather than edges, making labels unnecessary. The semantics of what a label denotes (trigger name, rule name, domain event) are unresolved, and shipping labels before resolving this risks premature commitment.

**Deferred questions for the language author:**

1. Is a trigger name structural information (which event opens an edge) or behavioural information (a reference to a rule)? Where the boundary between topology and behaviour falls determines whether labels belong on the graph.
2. Should ALP-22 be reviewed before ALP-21 is decided? The data dependency mechanism's design may resolve the edge-identification question in a way that makes labels unnecessary, or in a way that makes them essential.
3. If labels are adopted, what do they denote: trigger names, rule names, or a separate vocabulary? The answer determines the checker obligations and the audience the labels serve.

---

## Panel revisit — post ALP-22 adoption

### Summary

The panel reconvened after ALP-22 (cross-rule data dependencies) was adopted with per-rule `produces`/`consumes` clauses that attach data dependencies to rules, not graph edges. This resolved deferred question #2 and removed the adopt camp's strongest argument: edge labels are no longer needed as stable identifiers for data dependency declarations. The prior split (4 adopt, 3 reject, 2 defer) collapsed to 0 adopt, 7 reject, 2 defer. The panel reached **consensus: reject**.

### What changed

ALP-22's adoption settled the coupling question decisively. Data dependencies attach to rules via per-rule `produces`/`consumes` clauses following the Pathom model. Source-target pairs handle edge identification where needed. The composability advocate's prediction during the original ALP-21 debate was confirmed: edge labels are unnecessary for data dependency tracking.

With the coupling rationale removed, edge labels must stand on two remaining arguments alone: navigational value (answering "what drives this edge?" at the point of declaration) and closed-world verification (exactly these triggers drive this edge, no others). The panel found neither sufficient to justify a permanent syntax addition.

### Updated positions

**Reject (7).** Simplicity, composability, readability, developer experience, creative and backward compatibility all moved to or hardened at reject. Rigour moved from defer to reject. The shared reasoning: navigational convenience does not clear the bar for a syntax addition that crosses ALP-19's topology/behaviour line, creates a maintenance surface scaling with rule count, and is adequately served by tooling-inferred labels in diagnostics and language server hover.

**Defer (2).** Machine reasoning shifted from adopt to defer, acknowledging the ALP-22 coupling argument was its strongest card and that the remaining navigational value does not force the issue. Domain modelling shifted from adopt to defer, maintaining that domain experts label transitions with triggering events but conceding the unresolved denotation question (trigger name vs rule name vs domain event name) undermines the case for adopting labels before that vocabulary is settled.

**Adopt (0).** No panellist maintained an adopt position.

### Verdict: reject

The panel agrees the navigational problem is real but concludes it is better solved by tooling than by language syntax. The problem labels address has narrowed (ALP-22 no longer needs them), the costs have not (maintenance surface, topology/behaviour boundary violation, unresolved denotation semantics), and inferred labels via diagnostics and language server hover provide the same navigational value without a synchronisation obligation in the source text.

### Recommendations

1. **Tooling-inferred labels.** The checker already computes the edge-to-rule mapping via ALP-19's completeness obligations. Tooling should surface this mapping as inferred labels in diagnostics, language server hover and documentation generators.
2. **No syntax change.** Transition graphs retain ALP-20's pure topology form. No label syntax is added.
3. **Denotation question deferred.** If a future proposal revisits edge labels, it must first resolve what labels denote (trigger name, rule name, domain event name) before the panel can evaluate checker obligations.
