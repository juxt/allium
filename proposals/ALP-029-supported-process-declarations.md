# ALP-29: Allium cannot express the processes a specification is meant to support

**Status**: proposed
**Related**: ALP-022 (cross-rule data dependencies, adopted)
**Constructs affected**: `entity`, `rule`, `surface`, `actor`, validation rules
**Sections affected**: Entities and Variants, Rules, Surfaces, Actor Declarations, Validation rules

## Problem

Allium provides constructs for the parts of a system. Entities hold
state; rules effect state changes; surfaces describe boundaries;
invariants assert properties; contracts encode obligations; actors
identify parties that interact with surfaces. Each construct is
validated in isolation — the checker verifies that a rule's references
resolve, that a surface's facing and context are declared, that an
entity's fields are well-typed.

The language has no construct for the *processes* the spec is meant to
support. There is no way to state that *a candidate becomes a hire
through application, interview and decision*, that *an order progresses
from placement through payment, fulfilment and delivery*, or that *an
incident is resolved through detection, escalation, remediation and
retrospective*. As a consequence, the validator cannot detect whether
the declared entities, surfaces and rules compose into the processes
the spec is meant to serve.

This absence has several consequences.

**Missing entities are undetectable.** An author specifying a purchase
flow may declare `Customer`, `Product` and `Order` but omit a
`DeliveryAddress` entity the flow requires. The spec passes validation
because every declared construct is internally consistent; the gap is
visible only to a reader who reasons about the flow as a whole.

**Missing surfaces are undetectable.** A spec may carry a collection
surface (checkout) and an action surface (dispatch) without the
intermediate surfaces that bridge them (address confirmation, payment
authorisation, order review). Each declared surface is well-formed;
the absence of the intermediates produces no error, because the
language does not know what sequence of surfaces the flow requires.

**Missing data connections are undetectable.** A `DispatchOrder` rule
may require `order.shipping_address` while no surface captures a
shipping address anywhere in the spec. ALP-022 addressed this form of
gap within intra-entity rule lifecycles via produces/consumes
declarations on rules; it did not extend the mechanism to surfaces or
to cross-entity flows.

**Stakeholders cannot read the spec as a narrative.** Rules and
surfaces read well in isolation. The processes they compose into are
implicit and must be reconstructed by hand. A product owner asking
"walk me through what a candidate experiences" receives a flat list
of rules and surfaces; the narrative is the reader's to assemble.

**Skills lack a natural anchor.** Elicitation proceeds
construct-by-construct rather than process-by-process. Distillation
produces a flat inventory of rules and surfaces rather than a set of
flows the system supports. Propagation lacks a natural unit for
describing change scope.

The symptom in each case is the same: the spec describes the parts of
a system without stating what the parts are collectively meant to do.

## Evidence

A specification under development by the author for a hiring process
passed the validator with a `DecisionIssued` rule that required
`background_check_status` on a `Candidacy`, while no surface in the
spec captured or derived this field. The gap was discovered only by
manually tracing the intended end-to-end flow. In the same spec,
earlier iterations lacked a distinct review surface between
application and interview scheduling; the flow appeared in the
author's mental model but was never instantiated in the spec. The
validator had no basis to flag either omission.

The wireframe analogy is the recurring external example. Design
teams routinely produce wireframes where every screen is individually
complete but the set of screens fails to support the flow a user is
meant to accomplish. This happens despite the wireframes being
reviewed and approved, because reviewing each screen in isolation
does not test whether the screens compose to support the stated
purpose. Allium currently shares this weakness at the specification
level.

Domain-driven design practitioners distinguish between *consistent*
and *sound* models. Consistency can be checked locally; soundness
requires a view of the whole. Event storming and user-story-mapping
workshops exist in part because no formal artefact captures processes
across events, surfaces and rules. Allium is the kind of formal
artefact these workshops might feed into, but it currently offers no
receptacle for their output.

ALP-022's adoption acknowledges that the language needed a way to
reason about data flow between rules. That fix is narrower than the
problem here: it assumes the flow is an intra-entity lifecycle,
expressible through transition graphs plus produces/consumes
declarations on rules. The broader pattern — a process crossing
entities, surfaces and actor handoffs, with a named purpose at its
end — is outside ALP-022's scope and recurs across specs the author
has maintained.

## Design tensions

**Locality of validation vs. process-scoped checks.** Allium's other
checks are local: a rule's validity is determined from the rule's own
body plus the entity it references. A check for whether a process is
supported by a spec crosses construct boundaries. Any mechanism must
resolve how far the check reaches without forcing local validation to
carry global state.

**Actor-driven vs. infrastructural specifications.** Some specs
describe flows an actor experiences; others describe infrastructural
behaviour (circuit breakers, batch processors, scheduled jobs) where
the concept of a process may not apply or applies in a different
register. A mechanism scoped to actor-driven specs avoids imposing a
discipline where no benefit accrues; a uniform mechanism imposes
cognitive cost on infrastructural-spec authors without a
corresponding gain.

**Overlap with ALP-022.** ALP-022 allows rules to declare
produces/consumes within entity lifecycles. Any mechanism here must
subsume that declaration, coexist with it without duplication, or
carve a clean boundary. The worst outcome is two adjacent
vocabularies for related relationships.

**Vocabulary register.** The language is deliberately domain-facing:
`exposes`, `provides`, `requires`, `ensures`. Any vocabulary
introduced for processes must land in the same register; programmer's
vocabulary (`depends_on`, `inputs`, `outputs`) would drift from the
stated audience of product owners and domain experts.

**Shape-malleability.** Entities and rules admit one canonical shape
per domain fact (a field belongs to one entity, a behaviour is a
rule). A process can legitimately be represented as a linear
sequence, as a graph with alternatives or parallel paths, as a
decomposition into sub-processes, or as a set of handoffs between
actors. A mechanism must either pick a canonical shape (losing
expressiveness) or accept shape-malleability (creating cognitive
load and tooling complexity).

**Prescriptiveness.** Not every spec needs to declare the processes
it supports. Library specs and infrastructural contracts are useful
without them. A mechanism must be opt-in at the spec level, and the
language must continue to accept specs that do not use it.

**Absence of a first-class purpose.** Allium currently has no
construct for "the purpose this spec supports". Rules terminate in
state changes and entity creations; surfaces expose data and provide
actions; invariants assert properties. None names the stated outcome
the rules and surfaces are meant collectively to realise. A check for
whether a spec supports its purpose needs a target: what is the
purpose? The language has no place to say.

## Scope

This ALP concerns the absence of any construct by which a
specification can state the processes it is meant to support, and
the validator gaps that absence produces. It covers:

- the gap where entities required by an intended process are omitted
  from the spec without detection,
- the gap where surfaces required by an intended process are omitted
  from the spec without detection,
- the gap where data captured at surfaces fails to reach the rules
  that require it, extending ALP-022's intra-entity scope,
- the gap where stakeholders cannot read a spec as a narrative of
  what the system supports, and
- the gap where skills operating on specs lack a natural unit larger
  than a single construct.

It does not cover:

- the specific shape of any mechanism that addresses these gaps,
- runtime semantics or execution ordering of rules,
- validation of the correctness of captured values (e.g., whether an
  email is well-formed),
- user-interface concerns (screens, routes, clicks, navigation),
- whether every spec must declare its processes — the question of
  opt-in scope is for a mechanism, not a constraint on the problem.
