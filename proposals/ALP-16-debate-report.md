# ALP-16 debate report: Annotation sigil for prose constructs

## Summary

One proposal was debated: introducing the `@` sigil to mark prose annotations (`@invariant`, `@guidance`, `@guarantee`) throughout the language. The panel reached consensus to adopt, with one reservation from the readability advocate and two refinements required from the rigour advocate. The creative advocate's expansion proposal (open-ended user-defined annotations) was noted but deferred as out of scope.

## Item debated

### The proposal

Introduce the `@` sigil to prefix prose-only constructs whose structure the checker validates but whose content it does not evaluate. This resolves a grammar ambiguity in contract bodies where `invariant: Determinism` is syntactically indistinguishable from a typed signature like `evaluate: (String) -> Result`, and establishes a visible category marker for the prose/structural distinction across contracts, rules and surfaces.

### Key tensions

The central disagreement was between the **readability advocate** (with partial support from the **domain modelling advocate**) and the remaining seven panelists.

**The readability objection.** The `@` sigil is programming syntax borrowed from Java and Swift. A product owner reading a spec will see `@invariant` as a tag or mention, not a constraint declaration. The colon form `invariant: Determinism` reads as a label introducing content, matching the grammatical pattern of every other clause. The sigil solves a parser problem at the cost of stakeholder comprehension.

**The counter-argument (seven panelists).** The colon form's "consistency" is precisely the ambiguity the proposal exists to fix. `invariant: Determinism` and `evaluate: (String) -> Result` look identical to any reader who does not already know which keywords are reserved. The `@` sigil gives the reader a visual partition: sigilled lines are prose commitments, unsigilled lines are structural definitions. This distinction is teachable in one sentence and makes the spec easier to scan, not harder. The readability advocate sharpened the objection in rebuttal (the "tag vs declaration" feel) but did not address the core point that the colon form presents two structurally different things identically.

**Secondary concerns raised:**

- **Machine reasoning advocate**: The comment-block body syntax (`-- prose` lines after an annotation) reintroduces context-sensitivity via indentation, a positional dependency not present elsewhere in the language. This was not contested in rebuttals but is a refinement concern, not a blocking objection.
- **Composability advocate**: The `@` sigil should come with an explicit statement of what it must not be extended to cover, to prevent future semantic drift. Not contested; noted as a documentation refinement.
- **Creative advocate**: The sigil could support open-ended user-defined annotations (`@AnyPascalName`), turning a grammar fix into an extensibility mechanism. Interesting but out of scope for ALP-16; could be a future ALP.
- **Rigour advocate**: Two validation edge cases need tightening (see below).

### Verdict: Consensus: adopt

The panel converges on adoption. The `@` sigil resolves a real grammar ambiguity, marks a semantic category that already exists but lacks syntactic expression, and provides a clean promotion path from prose to expression-bearing forms. The migration is mechanical and the installed base is pre-publication.

**Reservation (readability advocate).** The `@` sigil shifts the grammatical feel of prose constructs from "named clause" to "tag", which may reduce comprehension for non-technical readers. The panel acknowledges this trade-off but considers it outweighed by the disambiguation benefit and the teachability of the one-sentence rule ("@ means prose the checker cannot verify").

**Required refinements before implementation:**

1. **Indentation enforcement (rigour advocate).** Validation rule 4 must explicitly state that annotation body comment lines are indented relative to the `@` sigil, not merely that they exist. A flat (unindented) comment after an annotation is structurally ambiguous with a peer declaration.

2. **Annotation-to-annotation ordering (rigour advocate).** Validation rule 3 constrains `@guidance` ordering relative to structural clauses but leaves annotation-to-annotation ordering undeclared. The proposal should specify whether `@guidance` may precede `@invariant` within the same construct, or whether annotations follow a fixed order.

**Noted for future consideration:**

- The creative advocate's proposal for open-ended user-defined annotations (`@AnyPascalName`) is deferred. It is compatible with ALP-16 but changes the scope from "grammar fix" to "extensibility mechanism" and deserves its own ALP.
- The composability advocate's request for an explicit "what `@` must not be extended to cover" statement should be addressed in the language reference when the sigil is documented.

## Deferred items

None. The proposal reached consensus. The creative advocate's expansion idea is noted as a potential future ALP, not a deferred objection.
