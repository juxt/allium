# Test generation debate report

## Summary

Two linked questions were debated: whether `references/test-generation.md` is premature, and whether Allium needs a dedicated test generator agent. The first reached consensus (keep, with reframing). The second is a split, deferred to the language author.

## Item 1: Is test-generation.md premature?

### The proposal

The file describes a taxonomy of test categories (contract tests, state transition tests, temporal tests, surface tests, cross-rule interaction tests) derivable from Allium spec constructs. Allium has no compiler, runtime or test runner. The question is whether this document earns its place.

### Key tensions

No panelist argued for removal. The disagreement was about status and framing.

The **rigour advocate** raised the sharpest concern: the concurrency note asserts rule atomicity, but the language reference does not define atomicity or evaluation order. The document presupposes semantics that do not yet exist. The cross-rule interaction tests section gestures at combinatorial complexity without specifying how to bound it. Two agents reading this document could produce incompatible test suites from the same spec.

The **creative advocate** argued the opposite direction: the document is under-ambitious, not premature. SKILL.md promises test generation, so a taxonomy of what those tests look like is foundational. It should be a generative grammar showing how constructs map to test shapes, not a flat enumeration.

Several panelists (simplicity, composability, readability, devex) converged on a framing problem: the file sits in `references/` alongside the language reference, implying equivalent authority, when it is closer to guidance for whoever generates tests. A caveat at the top would resolve most confusion.

### Verdict: Consensus: adopt (keep, with reframing)

The document stays. It does real work: it establishes a shared vocabulary for test obligations that humans and LLMs can act on today, independent of runtime infrastructure.

**Required changes:**

1. Add a framing paragraph at the top clarifying that this describes test categories for a person or agent to generate from a spec, not a tool to invoke. It is guidance, not a normative part of the language.
2. The concurrency note should either be grounded in a formal definition of rule atomicity in the language reference, or marked explicitly as an open question. It currently makes assertions the language does not support.

**Noted for future work:**

- The creative advocate's observation that the document should evolve from taxonomy to generative grammar (mapping constructs to test shapes algorithmically) is worth pursuing but out of scope for this review.
- The rigour advocate's point that taxonomy is not an algorithm and that formalising the interpretation function is a prerequisite for deterministic test generation is recorded as a dependency for any future test generation tooling.

## Item 2: Does Allium need a dedicated test generator agent?

### The proposal

The current routing table has `tend` (writes specs), `weed` (checks spec-to-code alignment), `elicit` (builds specs through conversation) and `distill` (extracts specs from code). Nothing owns spec-to-test generation. Should there be a dedicated agent?

### Key tensions

Three panelists argued for a dedicated agent. Six argued against, but disagreed on the alternative.

**For a dedicated agent:** The machine reasoning advocate argued that test generation is structurally distinct from both `tend` and `weed`, and that a dedicated agent with a fixed traversal prompt would produce more uniform output. The rigour advocate argued that assigning test generation to either existing agent violates their stated boundaries: `tend` explicitly disclaims anything outside `.allium` files, `weed` checks alignment between existing artefacts. The creative advocate saw an obvious gap in the routing table that a `seed` or `sprout` agent would fill.

**Against:** Seven panelists targeted the rigour advocate's "logically required" claim in rebuttals, converging on a shared counter-argument: mandate gaps are fixed by expanding briefs, not adding agents. The simplicity and composability advocates argued test generation is a stateless read-and-transform operation better served by a skill than an agent. The readability advocate argued `tend` already translates specs into well-formed artefacts. The compat advocate argued `weed`'s alignment concern naturally extends to test generation. The devex advocate argued a third agent fragments the workflow for newcomers before the ecosystem can support it.

The rigour advocate's rebuttal sharpened the underlying tension: the machine reasoning advocate's claim that the taxonomy provides a "deterministic mapping" was challenged directly. A taxonomy of categories is not determinism; determinism requires specifying how to decompose multi-clause rules, expand iterations into discrete test cases, and define boundary values. This observation actually strengthened the case for tightening the reference before building any tooling on top of it, whether agent or skill.

### Verdict: Split

The panel cannot converge on the delivery mechanism for test generation. Both positions survive rebuttals:

**Position A (dedicated agent):** Test generation is structurally distinct from spec authoring and alignment checking. It reads specs alone and emits artefacts in a target language. Combining it with an existing agent bloats that agent's responsibility and muddies its boundary. A dedicated agent with a precise brief produces more consistent output. (Machine reasoning, rigour, creative.)

**Position B (skill or extension):** Test generation is a stateless transformation, not an interactive authoring task. It does not need the push-back instincts or domain expertise that justify `tend` as a specialist. Adding an agent creates institutional complexity that outlasts the problem. The simpler path is a skill invocable over a spec file, or an extension to `weed`'s brief, graduating to a dedicated agent only when real usage demonstrates the concerns are separable in practice. (Simplicity, composability, readability, compat, devex, domain modelling.)

The question is deferred to the language author. The six-to-three weight of opinion favours a skill or extension, but the minority position (structural distinctness) is not refuted, only outweighed by pragmatic concerns about ecosystem maturity.

## Deferred items

- **Test generator agent vs skill:** Split, deferred to language author.
- **Formalising the test interpretation function:** The rigour advocate's observation that the taxonomy needs tightening before deterministic generation is possible. Recorded as a dependency for any future test generation tooling.
- **Rule atomicity and evaluation order:** The concurrency note in `test-generation.md` asserts semantics the language reference does not define. This should be resolved in the language reference before the test taxonomy is treated as normative.
