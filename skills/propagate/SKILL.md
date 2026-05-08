---
name: propagate
description: "Generate tests from Allium specifications. Use when the user wants to propagate tests, generate test files from a spec, write tests for a specification, create property-based tests, produce state machine tests, check test coverage against spec obligations, or understand what tests a specification requires."
---

# Propagation

This skill generates tests from Allium specifications. Propagation is how plants reproduce from cuttings of the parent: the spec is the parent, the tests are the offspring.

Deterministic tools guarantee completeness (every spec construct maps to a test obligation). You handle the implementation bridge: correlating spec constructs with code, generating tests in the project's conventions.

## Prerequisites

Before propagating tests, you need:

1. **An Allium spec** — the `.allium` file describing the system's behaviour
2. **A target codebase** — the implementation to test
3. **Test obligations** — from `allium plan <spec>` (JSON listing every required test)
4. **Domain model** — from `allium model <spec>` (JSON describing entity shapes, constraints, state machines)

If the CLI tools are not available, derive test obligations manually from the spec using the test-generation taxonomy in [`references/test-generation.md`](../allium/references/test-generation.md).

## Modes

### Surface mode

Generates boundary tests from surface declarations. Use when the user wants to test an API, UI contract or integration boundary.

For each surface in the spec:

1. **Exposure tests** — verify each item in `exposes` is accessible to the specified actor, including `for` iteration over collections
2. **Provides tests** — verify operations appear when their `when` conditions are true and are hidden otherwise, including when the corresponding rule's `requires` clauses are not met
3. **Actor restriction tests** — verify the surface is not accessible to other actor types
4. **Actor identification tests** — verify only entities matching the actor's `identified_by` predicate can interact; for actors with `within`, verify interaction is scoped to the declared context
5. **Context scoping tests** — verify the surface instance is absent when no entity matches the `context` predicate
6. **Contract obligation tests** — verify `demands` are satisfied by the counterpart, `fulfils` are supplied by this surface, including all typed signatures
7. **Guarantee tests** — verify `@guarantee` annotations hold across the boundary
8. **Timeout tests** — verify referenced temporal rules fire within the surface's context
9. **Related navigation tests** — verify navigation to related surfaces resolves to the correct context entity

### Spec mode

Walks the full test obligations document. Use when the user wants comprehensive test coverage for the entire specification.

Categories from the test-generation taxonomy:

- **Entity and value type tests** — fields, types, optional (`?`) null handling, `when`-clause state-dependent presence, relationships, join lookups, equality
- **Enum tests** — comparability across named enums, membership tests, inline enum isolation
- **Sum type tests** — variant fields, type guards, exhaustiveness, creation via variant name, base `.created` trigger narrowing
- **Derived value and projection tests** — computation, filtering, `-> field` extraction, parameterised derived values, `now` volatility, collection operations
- **Default instance tests** — unconditional existence, field values, cross-references between defaults
- **Config tests** — defaults, overrides, mandatory parameters, expression-form defaults, qualified references, config chains
- **Invariant tests** — post-rule verification, edge cases, implication logic, entity-level invariants
- **Rule tests** — success/failure/edge cases, conditionals (ensuring `if` guards read resulting state), entity creation, removal, bulk updates, rule-level `for` iteration, `let` bindings, chained triggers
- **State transition tests** — valid/invalid transitions, terminal states, `transitions_to` vs `becomes` semantics
- **Temporal tests** — deadline boundaries, re-firing prevention, optional field null behaviour
- **Surface tests** — exposure, availability, actor identification with `within` scoping, context scoping, related navigation
- **Contract tests** — signature satisfaction, `@invariant` honouring, `demands`/`fulfils` direction
- **Cross-module tests** — qualified entity references, external trigger responses, type placeholder substitution
- **Cross-rule interaction tests** — duplicate creation guards, provides availability
- **Transition graph tests** — every declared edge is reachable via its witnessing rule, undeclared transitions are rejected, terminal states have no outbound rules, non-terminal states have at least one exit, exact correspondence between enum values and graph edges
- **State-dependent field tests** — presence when in qualifying state, absence when outside, presence obligations on entering the `when` set, absence obligations on leaving, no obligation when moving within or outside, convergent transitions all set the field, guard required to access `when`-qualified fields, derived value `when` inference via input intersection
- **Scenario tests** — happy path, edge cases, order independence
- **Data flow chain tests** — exercise full chains from surface capture through rules to downstream rule preconditions. For each chain (surface provides trigger → rule ensures field → downstream rule requires field), generate an integration test that submits data through the surface and verifies it reaches the downstream precondition.
- **Reachability tests** — walk from each initial state (via `.created()`) to each terminal state, following a valid path through the transition graph. Each test exercises a complete lifecycle.
- **Deadlock scenario tests** — for states where `allium analyse` identifies potential deadlocks, generate tests that put the entity in the stuck state and verify whether it can progress.
- **Cross-entity process tests** — for processes spanning multiple entities, generate integration tests that exercise the full process from start to terminal state across all participating entities.

If `allium analyse` is available, use its findings to prioritise test generation. A `missing_producer` or `dead_transition` finding indicates a gap worth exercising with a test. A `deadlock` finding should generate a test documenting that the entity cannot escape the stuck state. Consult [actioning findings](../allium/references/actioning-findings.md) for the finding type taxonomy.

## Test output kinds

### 1. Assertion-based tests

For deterministic obligations: field presence, enum membership, transition validity, surface exposure, state-dependent field presence and absence. These are standard unit/integration tests.

### 2. Property-based tests

For invariants and rule properties. Each expression-bearing invariant becomes a PBT property:
- Generate a valid entity state using the generator spec
- Apply a sequence of rules (following the transition graph when declared, or deriving valid sequences from rules alone)
- Check the invariant holds at every step

Use the project's PBT framework:

| Language | Framework | Discovery |
|----------|-----------|-----------|
| TypeScript | fast-check | `package.json` |
| Python | Hypothesis | `pyproject.toml` |
| Rust | proptest | `Cargo.toml` |
| Go | rapid | `go.mod` |
| Elixir | StreamData | `mix.exs` |

Fall back to assertion-based tests if no PBT framework is present.

### 3. State machine tests

For entities with status enums. When a transition graph is declared, walk every path through the graph. When no graph is declared, derive valid transitions from rules.
- Verify transitions succeed via witnessing rules
- Verify rejected transitions fail
- Verify state-dependent fields are present or absent at each state per their `when` clauses
- Verify invariants hold at each state

State machine tests require an **action map**: a function per transition edge that takes the entity in the source state and produces it in the target state by calling the actual implementation code. Without this map, the test framework can describe valid paths through the graph but cannot execute them.

To build the action map:
1. For each edge in the transition graph, find the witnessing rule in the spec.
2. Find the code implementing that rule by reading the spec's clauses, then locating the matching function in the codebase via grep + read.
3. Write a test action that sets up the preconditions (`requires` clauses), invokes the code, and returns the entity in the target state.
4. Register the action under the `(from_state, to_state)` key.

Once the map is built, the PBT framework can walk random valid paths: start at any non-terminal state, pick a random outbound edge, apply its action, check all entity-level invariants, repeat. The path length and starting state are generated randomly. This is the fullest expression of the spec's transition graph as a test.

## The implementation bridge

You correlate spec constructs with implementation code by reading the spec, then exploring the codebase. For each construct, search for symbols that match its name (entity → class/struct/model, rule → function/method, surface → route/handler/controller), open the matching files and confirm the implementation. If a construct has no plausible code match, generate a pending test skeleton and flag it.

If the user has explicitly directed you to use the impact map ("use the impact map", "in map mode", "via impact"), switch to map mode for this section — see the [Map mode](#map-mode) appendix at the end of this document.

### For surface tests

Find each surface's implementation by searching for its declared operations:
- API surfaces: search routes/controllers for handler functions matching the surface's `provides` operations.
- UI surfaces: search components or pages for the named operation.
- Integration surfaces: search for message handlers or SDK methods.

If no implementation can be found, the surface is either unimplemented (aspirational — generate a pending test skeleton) or wired through a framework pattern your search did not anticipate (note the gap and generate the test against the spec, marking it pending).

### For internal tests

For each rule in the spec, locate its implementation by searching the codebase for functions whose name or behaviour matches the rule.

1. Implementation: open the matching function and understand the signature.
2. Instantiation: read the surrounding code (or grep) to find what constructs the entities the implementation operates on (factories, builders, fixtures).
3. Invocation: trace upwards (read callers, grep for invocations) to find the public-facing entry point (the surface or a higher-level service method).
4. Postcondition assertions: check what the implementation returns or mutates, and map `ensures` clauses onto those outcomes.

### For temporal tests

Temporal triggers (deadline-based rules) need a controllable time source in the test. If the implementation uses wall-clock time (`Instant.now()`, `System.currentTimeMillis()`), the test cannot reliably position itself before, at or after a deadline.

Before attempting temporal tests, check whether the component accepts an injected clock or time parameter. Common patterns: a `Clock` parameter on the constructor, an epoch-millisecond argument on the method, a `TimeProvider` interface. If the seam exists, inject a controllable time source. If it does not, flag this as a test infrastructure gap: the temporal tests cannot be generated until the component supports time injection. Do not attempt to test temporal behaviour by sleeping or racing against wall-clock time.

### For cross-module trigger chains

When a rule emits a trigger that another spec's rule receives (e.g. the Arbiter emits `ClerkReceivesEvent`, the Clerk handles it), testing the chain requires multiple components wired together.

Before generating cross-module tests:
1. Trace the trigger emission graph from the plan output: which rules emit triggers, and which rules in other specs receive them.
2. Trace the wiring by reading the codebase: service constructors, dependency injection wiring, event bus configuration, message-routing tables. Identify the code-level hand-offs that correspond to cross-module trigger chains — the two endpoints become the "emitter" and "receiver" sides of the test.
3. Check whether the codebase has an existing integration test fixture that wires the participating components (a pipeline test, an end-to-end test helper, a test harness class)
4. If a fixture exists, reuse it. Cross-module tests should compose existing wiring, not rebuild it.
5. If no fixture exists but the codebase structure is clear enough to understand the wiring (service constructors, dependency injection, event bus configuration), generate the fixture and the test
6. If the wiring is too complex or opaque to generate confidently, generate a test skeleton with TODOs marking where component wiring is needed

Cross-module tests are integration tests by nature. They verify that the spec's trigger chains are faithfully implemented across component boundaries. Prioritise them after single-component tests are passing.

### Reusing existing tests

When exploring the codebase, note which spec obligations are already covered by existing tests. An existing integration test that exercises the happy path from event submission through to acknowledged output already covers multiple `rule_success` obligations and the end-to-end scenario.

When an existing test covers a spec obligation, reference it rather than generating a duplicate. The propagate skill's value at the integration level is verifying that coverage is complete against the spec's obligation list, identifying gaps, and generating tests to fill them. Replacing working hand-written tests with generated equivalents adds no value.

### For deferred specs

Deferred specifications are fully specified in separate files. When the target codebase doesn't include the deferred spec's module, generate a test stub with a placeholder:

```typescript
// TODO: deferred spec — InterviewerMatching.suggest
// This behaviour is specified as deferred. Provide a mock or skip.
```

## Process

1. **Read the spec** — understand entities, rules, surfaces, invariants, transition graphs, state-dependent fields, contracts, config, defaults. Read [assessing specs](../allium/references/assessing-specs.md) to gauge the spec's maturity. A coarse spec (entities and transition graphs but no rules) will produce limited test obligations — mostly structural tests. If the spec is too coarse for meaningful test generation, suggest using the `elicit` or `distill` skill to develop it further before propagating tests. A spec with rules and surfaces enables the full test taxonomy including data flow chain tests and reachability tests.
2. **Read test obligations** — from `allium plan` output or manual derivation
3. **Read domain model** — from `allium model` output or manual derivation
4. **Explore the codebase** — find the test framework, read existing tests, locate domain models, services and entry points. Search for symbols matching spec construct names and read the matching files.
5. **Map constructs to code** — for each spec construct, identify the corresponding code (function, class, route) by reading the spec and grep'ing the codebase
6. **Generate tests** — produce test files following the project's conventions
7. **Verify tests compile/run** — ensure generated tests are syntactically valid

If the user has explicitly asked you to use the impact map, switch to map mode for steps 4–5 — see the [Map mode](#map-mode) appendix at the end of this document.

### Discovery checklist

Before generating tests, establish:

- [ ] Test framework and runner (Jest, pytest, cargo test, etc.)
- [ ] PBT framework if present (fast-check, Hypothesis, proptest, etc.)
- [ ] Test file location conventions (co-located, `__tests__/`, `tests/`, etc.)
- [ ] Entity/model location and patterns (classes, interfaces, structs)
- [ ] Factory/fixture patterns for test data
- [ ] How state transitions are implemented (methods, events, state machines)
- [ ] How surfaces are implemented (routes, controllers, resolvers)
- [ ] Existing test helpers or utilities
- [ ] Whether components accept injected time sources for temporal tests
- [ ] Whether an integration test fixture exists for cross-module trigger chains
- [ ] Which spec obligations are already covered by existing tests

### Generator awareness

When generator specs are available, use them to produce valid test data:

- Respect field types and constraints
- For entities with transition graphs, generate entities at specific lifecycle states with correct field presence per `when` clauses (e.g. a `shipped` Order has `tracking_number` and `shipped_at` populated; a `pending` Order does not)
- For invariants, generate states that exercise boundary conditions
- For config parameters, use declared defaults unless testing overrides

## Interaction with other tools

- **distill** produces specs from code. Those specs feed propagate.
- **weed** checks alignment. After propagating tests, weed verifies spec-code match.
- **tend** evolves specs. After spec changes, run propagate again to update tests.
- **elicit** builds specs through conversation. Once a spec is ready, propagate generates tests.

## Limitations

- Generated tests are a starting point. They may need adjustment for project-specific patterns.
- The implementation bridge is LLM-mediated. Complex or unusual codebases may need manual guidance on the mapping.
- Cross-module tests require understanding component wiring across service boundaries. When the codebase structure is clear, full tests can be generated. When wiring is opaque, tests are generated as skeletons with TODOs for manual setup.
- Runtime trace validation and model checking are separate workstreams.

## Output format

Open every report or test-file batch with a one-line mode announcement so the caller can never be confused about which path you took: "Running propagate in default (grep) mode" or "Running propagate in map mode" (see [Map mode](#map-mode)).

## Map mode

The default flow above uses grep + read to correlate spec constructs with code. If the user has explicitly directed map use ("use the impact map", "in map mode", "via impact"), switch to map mode: the [`impact` skill](../impact/SKILL.md) maintains a JSON spec↔code map at `.allium/impact/<spec>.json` that turns correlation from a search problem into a lookup. Do not enter map mode silently — the user must ask. The presence of `.allium/impact/<spec>.json` is **not** by itself an opt-in signal.

### Trigger

Enter map mode only when the user's request mentions the impact map (or a synonym like "code map" or "via impact"). Otherwise, run the default flow above. If you enter map mode, announce it in the first sentence of your output.

### Step overrides

The following steps in the default flow are replaced when running in map mode:

- **Process step 4 (Explore the codebase)** is replaced by: "Invoke the [`impact` skill](../impact/SKILL.md) in `refresh` mode (or `build` mode if no map exists) and read `.allium/impact/<spec>.json`. The map's `links` give you the spec → code correspondence directly. The `call_edges` give you the code-side call graph, which feeds the state-machine action map and cross-module integration test planning."
- **Process step 5 (Map constructs to code)** is replaced by: "Use the impact map's `links` directly. Only correlate by hand for entries in `unmapped.spec` — those tests must be flagged as pending."
- **State-machine action map step (2)** is replaced by: "Find the code implementing that rule by reading the impact map's link from `spec:Rule.<Name>`. Fall back to manual discovery only if the rule is in `unmapped.spec`."
- **Implementation bridge — for surface tests:** read links where `from` is a `spec:Surface.*` node. API surfaces link to route-handler functions (`via: "surface-decorator"` is the signal the impact skill used a framework pattern); UI surfaces link to components or pages; integration surfaces link to message handlers or SDK methods. If a surface has no link, the map either could not identify the framework (adapter gap — report it) or the surface is not implemented yet (aspirational — generate a pending test skeleton).
- **Implementation bridge — for internal tests:** for each rule, look up the link from `spec:Rule.<Name>` to a `code:` node — that function or method is the rule's implementation. Walk `call_edges` backward to find instantiation patterns and the public-facing entry point.
- **Cross-module trigger chains step (2)** is replaced by: "Read the impact map's `call_edges` where `cross_module: true` — these are the code-level hand-offs that correspond to cross-module trigger chains. The two endpoints of a cross-module edge are strong candidates for the emitter and receiver sides of the test."

### Findings only available in map mode

- **Unmapped spec.** Entries in `unmapped.spec` are spec constructs the map has no implementation for; the corresponding tests are pending.
- **Cross-module call edges.** `call_edges` with `cross_module: true` highlight integration boundaries the default exploration would otherwise have to discover laboriously.

### Recovering the default flow under degradation

If the impact skill returns `degraded: true` (no language adapter matches, or the target LSP is unavailable), do not abandon the run. Note the reason once and fall back to the default (grep) flow for the remainder of this invocation. Tests still get written; they just cost more context to produce.
