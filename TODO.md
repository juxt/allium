# Tooling roadmap

Allium has consistent syntax, naming conventions and validation rules, but nothing reads it except humans and LLMs. A parser changes that. Once a parser exists, deterministic tooling becomes possible: test generation, model checking, runtime validation, static analysis. The parser is the prerequisite for all of it.

These five items are ordered by dependency and priority. The parser comes first because everything else builds on it.

## 1. Parser and structural validator

The parser reads `.allium` files and produces a typed abstract syntax tree: entities with their fields, types, relationships, projections and derived values. Rules with their triggers, preconditions, postconditions and local bindings. Surfaces with their contracts. Actors, config blocks, defaults, module references, deferred specifications and open questions. Variants, value types and named enumerations. The full language.

Other tools could import the parser as a library and work with the AST directly, or consume its output via a CLI. The right distribution model depends on the implementation language: a Rust parser is most useful as a CLI with structured output; a TypeScript parser is most useful as a library that other Node tools import.

The language reference defines structural validation rules that the parser should enforce. Referenced entities and fields must exist. Relationships must include a backreference. Rules need at least one trigger and one ensures clause. Status values must be reachable, and non-terminal states must have exits. Derived values cannot be circular. Sum type discriminators must match their variant declarations. Inline enum fields cannot be compared across entities. Surface `provides` entries must correspond to defined triggers. Config references must resolve. The parser reports errors for violations and warnings for softer checks: unused entities, temporal rules without guards, overlapping preconditions.

Implementation language: Rust. Hand-written recursive descent parser producing a typed AST covering the full language reference. Distributed as a native binary (homebrew, apt, GitHub releases) and as an MCP server for LLM tooling. The tree-sitter grammar in allium-tools continues to serve editor syntax highlighting separately. See `allium-tools/docs/project/parser-roadmap.md` for the detailed plan and tree-sitter grammar audit.

## 2. Property-based test generation

Allium rules are natural property specifications. A `requires`/`ensures` pair says: for any state satisfying these preconditions, these postconditions hold after the rule fires. Property-based testing frameworks are built to test exactly this shape of assertion.

From the parsed AST, generate two things. Entity generators derived from field declarations, producing random valid instances: a `status: pending | active | completed` field yields values from that set, an `Integer` field bounded by a config default stays within range, relationships define the graph shape connecting instances. Rule properties derived from requires/ensures pairs, where each rule becomes a testable property that a PBT framework can exercise with randomised inputs.

The output must work across languages, whether through an intermediate representation that language-specific adapters consume or by generating test code directly for each target. Entity generators are useful beyond testing: staging environments, demos, seed data.

This also motivates a language addition. Some properties span multiple rules: "account balance never goes negative", "no two interviews overlap for the same candidate." These are things domain experts state in conversation. They have no home in the current language. An `invariant` block would express them:

```
invariant "account balance is non-negative" {
    for account in Accounts:
        account.balance >= 0
}
```

Invariants use Allium's existing expression language. They enrich the specification for human readers regardless of tooling, and they give the property test generator system-wide properties to check after sequences of rule applications.

Open questions: whether invariants should support temporal assertions or only state assertions, and how black box functions should be handled in generators.

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

The reference could live in the language (an optional `verified_by` clause on `guarantee`) or outside it (a sidecar file mapping guarantee names to artefact paths). Either way, the artefact could be another Allium spec that models the property in detail, a Cedar policy that proves authorisation correctness, or a Kani proof that verifies a Rust implementation. The weed agent checks that the referenced artefact covers the same entities, operations and actors as the Allium surface. Whether the proof actually proves the property is the proof tool's concern, not Allium's.

The Allium-to-Allium case is likely more useful than the external proof case. Most teams will never use Cedar or Lean. They might use a second Allium spec to model a property in enough detail to be convincing: `guarantee: AllSessionsExpire verified_by "./session-lifecycle.allium"`.

This is the lowest priority of the five. The syntax extension is small and the audience is narrow. Worth doing when a specific user needs it.
