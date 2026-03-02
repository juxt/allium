# Tooling roadmap

A Rust parser (`allium-tools/crates/allium-parser`) reads `.allium` files and produces a typed AST covering the full v2 language. The CLI outputs JSON, making it consumable by any downstream tool. The tree-sitter grammar in allium-tools serves editor syntax highlighting separately. The remaining items build on the parser.

## 1. Structural validator

The parser produces the AST; the structural validator enforces the language reference's validation rules against it. Referenced entities and fields must exist. Relationships must include a backreference. Rules need at least one trigger and one ensures clause. Status values must be reachable, and non-terminal states must have exits. Derived values cannot be circular. Sum type discriminators must match their variant declarations. Inline enum fields cannot be compared across entities. Surface `provides` entries must correspond to defined triggers. Config references must resolve. Errors for violations, warnings for softer checks: unused entities, temporal rules without guards, overlapping preconditions.

## 2. Property-based test generation

Allium rules are natural property specifications. A `requires`/`ensures` pair says: for any state satisfying these preconditions, these postconditions hold after the rule fires. Property-based testing frameworks are built to test exactly this shape of assertion.

From the parsed AST, generate two things. Entity generators derived from field declarations, producing random valid instances: a `status: pending | active | completed` field yields values from that set, an `Integer` field bounded by a config default stays within range, relationships define the graph shape connecting instances. Rule properties derived from requires/ensures pairs, where each rule becomes a testable property that a PBT framework can exercise with randomised inputs.

The output must work across languages, whether through an intermediate representation that language-specific adapters consume or by generating test code directly for each target. Entity generators are useful beyond testing: staging environments, demos, seed data.

Expression-bearing invariants (ALP-11) give the property test generator system-wide properties to check after sequences of rule applications. Top-level invariants assert properties over entity collections; entity-level invariants assert properties of individual instances. Both use the existing expression language with purity constraints (no side effects, no `now`). The `implies` operator and `for` quantification make most domain properties expressible directly.

Open question: how black box functions should be handled in generators.

## 3. Runtime trace validation

Surfaces define boundary contracts: who sees what, who can do what, under what conditions. Nothing validates that production behaviour honours these contracts. The weed agent compares specs to code statically, but static analysis cannot catch behaviour that emerges only under load, timing or production conditions.

From the parsed AST, derive a trace event schema from surface definitions. Surfaces already declare who can see what (`exposes`), what operations are available (`provides`) and under what conditions (`when` guards), which is enough to define what a valid trace looks like. A standalone validator reads the spec and a trace file, then reports violations in surface terms: "the InterviewerDashboard exposed interview details to a non-Interviewer" rather than "trace event at offset 47 violated constraint C3."

One approach is a three-layer architecture: schema derivation from the parser, a standalone validator that checks trace files against surface definitions, and per-language emitters that produce trace events from running applications. Another is language-specific validation middleware that checks surface contracts inline as the application runs. The trace-file approach is simpler to specify and language-agnostic by design. The middleware approach gives tighter feedback but is harder to generalise across languages.

Open questions: whether traces should capture surface events only or extend to rule-level execution, and how to handle the emitter bootstrapping problem (the validator is academic until at least one emitter exists).

## 4. Model checking bridge

Allium has no model checker. Exhaustive state space exploration catches bugs that no amount of testing finds: subtle interleavings, race conditions between temporal triggers and external stimuli, invariant violations that only appear after specific sequences of rule firings. Allium specs contain the information needed to generate checkable models.

From the parsed AST, translate a subgraph of interacting rules into a form that a model checker can verify. The translation targets specific interaction patterns where interleaving bugs hide, not the entire spec. The user identifies which rules to check and provides state space bounds (how many entities of each type). Bounds can be inferred from config defaults where possible. Counter-examples must be translated back into Allium terms: rule names, entity states, trigger sequences. A raw model checker trace is useless to someone who writes Allium specs; a description of which rules can interleave to produce an invalid state is actionable.

The right translation target depends on which formalism best fits Allium's constructs. TLA+ has the widest ecosystem and most mature tooling but is action-oriented; flattening Allium's relational entity model into TLA+ state variables is work. P is event-driven state machines, closer to how Allium rules fire on triggers. Alloy is relational at its core (signatures, fields, relations, constraints), which maps naturally to Allium's entity/relationship/projection model. The choice deserves investigation rather than a premature commitment.

Open questions: which translation target to pursue first, how to handle black box functions, and whether the translation should be fully mechanical or LLM-assisted given Allium's structural regularity.

## 5. Formal guarantee integration

The `guarantee` clause in surfaces is prose. It communicates intent but is unfalsifiable. For most specifications this is fine. For security boundaries, authorisation logic and financial calculations, a guarantee that points to external evidence is more convincing.

The reference could live in the language (an optional `verified_by` clause on `@guarantee`) or outside it (a sidecar file mapping guarantee names to artefact paths). Either way, the artefact could be another Allium spec that models the property in detail, a Cedar policy that proves authorisation correctness, or a Kani proof that verifies a Rust implementation. The weed agent checks that the referenced artefact covers the same entities, operations and actors as the Allium surface. Whether the proof actually proves the property is the proof tool's concern, not Allium's.

The Allium-to-Allium case is likely more useful than the external proof case. Most teams will never use Cedar or Lean. They might use a second Allium spec to model a property in enough detail to be convincing: `@guarantee AllSessionsExpire verified_by "./session-lifecycle.allium"`.

This is the lowest priority of the five. The syntax extension is small and the audience is narrow. Worth doing when a specific user needs it.
