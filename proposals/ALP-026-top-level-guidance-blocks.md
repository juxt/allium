# ALP-26: Standalone top-level guidance blocks

**Status**: split (deferred to language author)
**Constructs affected**: `@guidance`
**Sections affected**: file structure (section ordering), annotation validity rules, glossary

## Problem

`@guidance` exists in three host constructs: contracts, rules and surfaces. In each case it attaches non-normative implementation advice to the construct that contains it. There is no way to attach guidance to the module itself.

Cross-cutting implementation advice, the kind that spans multiple rules or concerns, has no home in the language. When a spec author needs to explain a concept like "stream time" or "federation startup ordering" that affects several rules, they have two options, both unsatisfying.

The first is to attach the guidance to one rule and hope readers find it. This is arbitrary. The rule chosen becomes the canonical location for advice that applies equally elsewhere, and readers of the other rules have no signal that the advice exists. The ALP-7 panel identified this problem explicitly: "Attaching it to one rule is arbitrary. A named standalone block gives the concept a home and a label that stakeholders can reference in conversation."

The second is to use bare comments. Comments are invisible to tooling, carry no structural identity and cannot be extracted, suppressed or referenced. `@guidance` was introduced precisely to distinguish "this is implementation advice" from "this clarifies the spec text", but that distinction is only available inside rules, contracts and surfaces.

The gap is visible in the patterns file. Several patterns use bare comments for cross-cutting advice. The comment `-- Invalidate any existing tokens` in the password reset flow, or `-- Note: replies remain but show "deleted comment"` in the comments pattern, are implementation guidance that would benefit from structural identity. They sit outside any `@guidance` block because no module-level form exists. In a real specification these would accumulate. As a module grows, the proportion of implementation advice that belongs to no single construct grows with it.

## Evidence

**ALP-7 panel discussion.** The panel split on standalone guidance blocks but recorded both sides and an explicit recommendation for the form if adopted. The "case for" argument was that cross-cutting advice affecting multiple rules deserves a named home. The "case against" was that standalone guidance participates in no dependency relationships: nothing references it, nothing depends on it, it cannot be imported. The panel converged on a recommended design (PascalCase name, opaque content, dedicated section) but deferred the decision.

**ALP-16 annotation sigil.** The `@` sigil was introduced to mark prose annotations whose structure the checker validates but whose content it does not evaluate. `@guidance` already uses this sigil in contracts, rules and surfaces. A top-level form would extend the same mechanism to module scope.

**Language reference.** The glossary defines `@guidance` as "Permitted in contracts, rules and surfaces." Every other prose annotation has a natural module-level counterpart: `@invariant` has expression-bearing `invariant Name { }` at top level, `@guarantee` lives at surface level. `@guidance` is the only annotation with no module-level form.

**Patterns.** The patterns file uses section-header comments (`-- Registration`, `-- Login`, `-- Password Reset`) to organise rules by flow. These are structural navigation aids, not implementation advice. But interspersed with them are bare comments that serve a different purpose: advising on how to implement something (`-- Invalidate any existing tokens`, `-- Note: replies remain but show "deleted comment"`). The language has no way to distinguish these two uses of comments at the module level.

## Design tensions

**Signal vs noise.** Every other top-level declaration in Allium participates in at least one dependency relationship. Entities have fields, rules have triggers, surfaces have contexts, invariants have expressions. A standalone guidance block participates in none. Adding a construct that nothing in the language references or depends on risks establishing a precedent for "advisory-only" top-level declarations. The question is whether the structural identity and tooling affordances (extraction, suppression, documentation generation) justify the cost of a construct that sits outside the dependency graph.

**Naming and completeness expectations.** Named constructs create an implicit expectation of coverage. If a spec has `@guidance StreamTime`, does the absence of `@guidance FederationStartup` mean the author considered it and decided no guidance was needed, or that they forgot? Rules, entities and surfaces do not have this problem because their absence is caught by structural validation (unreachable states, missing triggers). Guidance blocks have no such checking, so their absence is silent.

**Section ordering.** The ALP-7 panel recommended placing top-level guidance after Invariants and before Deferred Specifications. This puts guidance near the end of the file, after all normative constructs. The alternative is placing it earlier, perhaps after Config, where it could orient the reader before they encounter the rules. The ordering choice signals whether guidance is "advice to consult after reading the spec" or "context to have before reading the spec".

**Scope creep for `@guidance`.** Currently `@guidance` is unnamed in all host constructs. It does not take a name in contracts, rules or surfaces. A top-level form that requires a PascalCase name would make `@guidance` behave differently at module level than in every other context. This is not necessarily wrong (module-level guidance blocks are standalone declarations rather than annotations within a host construct, so naming serves a different purpose), but it is a divergence from the established pattern.

**Attachment to other constructs.** If the problem is that guidance has no home for cross-cutting concerns, an alternative framing is that `@guidance` should be attachable to more constructs: entities, config blocks, enumerations. The ALP-7 panel explicitly restricted `@guidance` to "constructs that describe behaviour (rules, surfaces) or contracts (obligation blocks)". Expanding attachment points would address some of the same use cases without introducing a new top-level declaration, but at the cost of weakening the panel's rationale about behaviour-describing constructs.

**Interaction with expression-bearing invariants.** The ALP-7 "case against" suggested that expression-bearing invariants (ALP-11) might be the better vehicle for cross-cutting concerns. Invariants assert properties that must hold. Guidance advises on how to achieve something. These are distinct purposes: "stream time advances identically on every instance" is an invariant, while "stream time is derived from Kafka record timestamps rather than wall clocks" is guidance. The question is whether the overlap is large enough that invariants subsume most of the use cases, or whether a meaningful class of cross-cutting advice is neither an assertion nor naturally scoped to a single construct.

## Scope

This ALP concerns only standalone top-level `@guidance` blocks at module scope. It does not revisit `@guidance` within rules, contracts or surfaces, which were settled in ALP-7 and ALP-16. It does not address whether `@guidance` should be attachable to entities, config blocks or other constructs; that is a separate question with different trade-offs.

## Panel review

**Status**: split (deferred to language author)
**Date**: 2026-03-19

### Summary

One proposal debated. The panel could not converge. Substantive arguments remain on both sides about whether a construct that participates in no dependency relationships belongs in the language grammar.

### Key tensions

**Structural identity vs dependency discipline (unresolved).** The central disagreement. The readability, domain modelling and developer experience advocates argue that cross-cutting concepts need an address, not a hiding place, and that comments carry no structural identity for tooling to extract, suppress or reference. The simplicity and composability advocates argue that every other top-level construct in Allium participates in at least one dependency relationship, and that a construct whose only purpose is to be read by humans is a comment with syntax.

**Comments are fine (resolved against).** The simplicity advocate argued comments are the right home. The machine reasoning advocate rebutted that "comments are fine" proves too much: it would apply equally to `@guidance` in rules and surfaces, which the panel has already adopted. The readability advocate reinforced that `@guidance` and `@invariant` (prose form) are already constructs whose structure the checker validates but whose content it does not evaluate, so ALP-26 is not the first inert declaration. The simplicity advocate's position shifted from "comments are sufficient" to the sharper "a construct that nothing references is a comment with syntax", which stands.

**Naming divergence (noted).** `@guidance` is unnamed in every existing host construct. A top-level form with a required PascalCase name makes `@guidance` behave differently at module level. The machine reasoning advocate flagged this as memorisation cost. The developer experience advocate proposed clear error messages as the resolution. The rigour advocate noted that if checking differs fundamentally at top level, the shared `@` sigil creates false uniformity.

**Cross-referencing (noted, set aside).** The creative advocate proposed that guidance blocks be referenceable via `see: StreamTime`, creating a dependency graph that would resolve the simplicity advocate's objection. The simplicity advocate responded that this would change their position entirely but is a different, larger proposal. The machine reasoning advocate noted that a reference that is checked creates a dependency (making guidance no longer inert), while one that is unchecked is prose. The proposal cannot be both addressable and inert. This line was acknowledged as productive but set aside as out of scope.

**Expanded attachment points (noted, not explored).** The composability advocate offered an alternative: expand `@guidance` attachment to entities and config blocks, or introduce `@rationale` as an annotation on constructs. This gives name, address and binding without a free-floating declaration. The domain modelling advocate rebutted that this solves metadata on constructs, not concepts spanning constructs. The alternative was not explored deeply enough to resolve the disagreement.

### Verdict: split

**For adoption.** Cross-cutting concepts need structural identity. Comments carry no identity for tooling. `@guidance` was introduced to distinguish implementation advice from spec commentary, and that distinction is unavailable at module scope. The proposal is cleanly additive with no backward compatibility impact. Uniqueness scope is module-level, consistent with existing named constructs. The `@` sigil already marks prose annotations whose structure the checker validates but whose content it does not evaluate. This extends an established pattern.

**Against adoption.** Every other top-level construct in Allium participates in at least one dependency relationship. A construct that nothing references, nothing depends on and nothing checks is a comment with syntax. The language grammar should be reserved for constructs that give the checker something to validate. The naming divergence (unnamed in host constructs, named at top level) creates false uniformity under the `@` sigil. The composability advocate's alternatives (expanded attachment points, `@rationale` on constructs) may address the same need without the precedent.

### Deferred questions for the language author

1. Does structural identity for non-normative cross-cutting advice justify a top-level construct outside the dependency graph?
2. Should the composability advocate's alternatives (expanded attachment points, `@rationale` on constructs) be explored before deciding?
3. If adopted, should the creative advocate's cross-referencing mechanism (`see:`) be designed alongside it to resolve the inertness objection?
