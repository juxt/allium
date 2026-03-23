---
layout: default
title: Allium v3
---

<p class="hero">Allium v3</p>

v3 turns your specs into property-based tests. Describe what your system should do, and the CLI extracts a complete test plan and domain model. Your LLM generates the actual tests in whatever language and framework you already use.

Every v2 spec is valid v3. Change `-- allium: 2` to `-- allium: 3` and adopt the new features as you need them.

## Why this matters

Most testing frameworks work bottom-up: you write tests, one at a time, hoping you've covered enough. Allium works top-down. The spec already describes every entity, every rule, every transition, every invariant. The CLI reads that description and tells you exactly what needs testing. No gaps, no guesswork.

Other spec-driven test tools constrain you to their DSL, their runner, their conventions. Allium doesn't generate tests itself. It gives your LLM a precise, structured brief, and the LLM writes real tests using your project's existing framework, your factories, your fixtures. The output is idiomatic code you can read, modify and maintain.

## The workflow

<div class="terminal">
  <div class="terminal-titlebar">
    <div class="terminal-dots">
      <span class="terminal-dot red"></span>
      <span class="terminal-dot yellow"></span>
      <span class="terminal-dot green"></span>
    </div>
    <span class="terminal-title">Terminal</span>
  </div>
  <div class="terminal-body">
    <div class="turn user">
      <span class="prompt">$</span> allium plan orders.allium
    </div>
    <div class="turn llm">
      <span class="marker"> </span> <span style="color: #6c7086;">// 47 test obligations: 12 rule tests, 8 state transitions,</span>
    </div>
    <div class="turn llm">
      <span class="marker"> </span> <span style="color: #6c7086;">// 6 invariant properties, 9 field presence checks, ...</span>
    </div>
    <div class="turn user">
      <span class="prompt">$</span> allium model orders.allium
    </div>
    <div class="turn llm">
      <span class="marker"> </span> <span style="color: #6c7086;">// Entity shapes, transition graphs, when-sets, constraints</span>
    </div>
  </div>
</div>

Two commands, two concerns.

**`allium plan`** reads your spec and emits every test obligation as structured JSON. Each rule gets a success case and failure cases. Each transition edge gets a validity check. Each invariant becomes a property to verify after every state change. Each state-dependent field gets presence and absence checks. The plan is exhaustive and deterministic: same spec, same obligations, every time.

**`allium model`** extracts the domain model: entity shapes with field types and constraints, transition graphs showing valid state sequences, `when`-sets declaring which fields exist at which lifecycle states, and invariant expressions that constrain generated data. This is what your test generator needs to construct valid fixtures at any point in the lifecycle.

<div class="terminal">
  <div class="terminal-titlebar">
    <div class="terminal-dots">
      <span class="terminal-dot red"></span>
      <span class="terminal-dot yellow"></span>
      <span class="terminal-dot green"></span>
    </div>
    <span class="terminal-title">Claude Code</span>
  </div>
  <div class="terminal-body">
    <div class="turn user">
      <span class="prompt">&gt;</span> /allium:propagate
    </div>
    <div class="turn llm">
      <span class="marker">✻</span> Found <code>orders.allium</code> and your Kotlin test suite using Kotest + fast-check. Running <code>allium plan</code> and <code>allium model</code> against the spec.
    </div>
    <div class="turn llm">
      <span class="marker">✻</span> 47 test obligations. Your existing tests cover 19. I'll generate the remaining 28, including property-based tests for the 6 invariants and state machine tests walking the order lifecycle. Writing to <code>src/test/kotlin/orders/</code>.
    </div>
  </div>
</div>

The propagate skill reads both outputs alongside your codebase. It maps spec constructs to your implementation, reuses your existing test infrastructure, and fills coverage gaps. Existing tests that already satisfy an obligation are left alone.

## What the CLI gives you

Without the CLI, your LLM derives test obligations by reading the spec directly. This works for straightforward cases, but an LLM reading prose will miss edge cases that a parser catches mechanically. The CLI extracts obligations from the AST. Every `when`-qualified field, every transition edge, every invariant expression maps to a concrete test obligation. The plan is complete by construction.

Here's what `allium plan` produces for a single rule:

```json
{
  "id": "rule-success.ShipOrder",
  "category": "rule_success",
  "description": "Verify rule ShipOrder succeeds when all preconditions are met",
  "source_construct": "ShipOrder",
  "source_span": { "start": 300, "end": 450 },
  "dependencies": {
    "entities_read": ["Order", "Warehouse"],
    "entities_written": ["Order"],
    "trigger_emissions": ["NotifyCustomer"],
    "trigger_source": "external"
  }
}
```

And for a state-dependent field entering its `when` set:

```json
{
  "id": "when-set.ShipOrder.Order.tracking_number",
  "category": "when_set",
  "description": "Verify ShipOrder sets Order.tracking_number when transitioning status from confirmed to shipped",
  "source_construct": "ShipOrder",
  "source_span": { "start": 300, "end": 450 },
  "detail": {
    "rule": "ShipOrder",
    "entity": "Order",
    "field": "tracking_number",
    "source_state": "confirmed",
    "target_state": "shipped",
    "qualifying_states": ["shipped", "delivered"]
  }
}
```

The dependency information tells your test generator whether a rule can be tested in isolation (reads one entity, writes one field) or needs integration wiring (triggers chains across components, references deferred specs).

Here's what `allium model` produces for the same entity:

```json
{
  "name": "Order",
  "kind": "internal",
  "fields": [
    { "name": "status", "type_expr": "pending | confirmed | shipped | delivered | cancelled",
      "enum_values": ["pending", "confirmed", "shipped", "delivered", "cancelled"] },
    { "name": "tracking_number", "type_expr": "String",
      "when_set": { "status_field": "status", "qualifying_states": ["shipped", "delivered"] } },
    { "name": "shipped_at", "type_expr": "Timestamp",
      "when_set": { "status_field": "status", "qualifying_states": ["shipped", "delivered"] } }
  ],
  "transition_graphs": [
    {
      "field": "status",
      "edges": [
        { "from": "pending", "to": "confirmed" },
        { "from": "confirmed", "to": "shipped" },
        { "from": "shipped", "to": "delivered" },
        { "from": "pending", "to": "cancelled" },
        { "from": "confirmed", "to": "cancelled" }
      ],
      "terminal": ["delivered", "cancelled"],
      "states": ["cancelled", "confirmed", "delivered", "pending", "shipped"]
    }
  ],
  "invariants": [
    { "name": "PositiveTotal", "scope": "entity", "expression": "total > 0" }
  ]
}
```

To construct a valid Order at state `shipped`, a test generator includes `tracking_number` and `shipped_at` (their `when_set` contains `shipped`) and omits fields whose `when_set` doesn't. The transition graph tells it which state sequences are valid for state machine tests. The invariant expression constrains generated values.

## What's new in the language

### State-dependent fields

The headline feature. Fields declare when they exist:

```allium
entity Document {
    status: active | archived | deleted

    archived_at: Timestamp when status = archived
    deleted_at: Timestamp when status = deleted
    deleted_by: User when status = deleted

    transitions status {
        active -> archived
        active -> deleted
        archived -> deleted
        terminal: deleted
    }
}
```

In v2, `deleted_at` would be `Timestamp?` with a comment explaining it's only present when deleted. The `?` is technically correct but semantically dishonest: when the document is deleted, `deleted_at` is guaranteed present, not optional. Every downstream derived value inherits false optionality. Every rule accessing it needs a defensive null check the lifecycle already prevents.

`when` clauses fix this. The checker enforces that any rule transitioning into the `when` set must set the field, and any rule transitioning out must clear it. The field's lifecycle is declared once, on the field, not scattered across rules.

### Transition graphs

`when` clauses need structure to work against. Transition graphs declare the valid lifecycle topology:

```allium
entity Subscription {
    status: trial | active | past_due | cancelled

    trial_ends_at: Timestamp when status = trial
    payment_failed_at: Timestamp when status = past_due

    transitions status {
        trial -> active
        trial -> cancelled
        active -> past_due
        past_due -> active
        past_due -> cancelled
        terminal: cancelled
    }
}
```

The graph declares which transitions are structurally possible and which states are terminal. The checker verifies that every declared edge has a witnessing rule, and that undeclared transitions have no rule that could cause them. State machine tests walk every path through this graph, verifying invariants at each step.

### Black box collection operations

v3 draws a clear line between built-in operations and implementation-defined ones. Built-in operations use dot syntax, black box functions use free-standing syntax:

```allium
-- Built-in: the language guarantees semantics
events.count
slots.any(s => s.available)
slots.all(s => s.confirmed)

-- Black box: implementation-defined, unambiguous syntax
filter(events, e => e.recent)
grouped_by(copies, c => c.output)
min_by(pending, e => e.offset)
```

This matters for test generation. Built-in operations have known semantics the test generator can reason about. Black box functions are opaque and require the implementation bridge.

### Backtick-quoted enum literals

Enum values that reference external standards often contain hyphens, dots or mixed case. v3 lets you use the canonical form directly:

```allium
enum InterfaceLanguage { en | de | fr | `de-CH-1996` | es | `zh-Hant-TW` | `sr-Latn` }
enum CacheDirective { `no-cache` | `no-store` | `must-revalidate` | `max-age` }
```

Backtick-quoted literals are values, not identifiers. They participate in comparison and assignment like any other enum value. The checker skips case convention rules inside backticks. Quoted and unquoted forms are distinct: `de_ch_1996` and `` `de-CH-1996` `` are different values with no implicit normalisation.

### Ordered collection semantics

v3 distinguishes ordered from unordered collections. `Set<T>` is unordered, `Sequence<T>` preserves insertion order. Projections and `where` filters on ordered collections produce ordered results. `.first` and `.last` are only available on ordered collections.

```allium
entity Timeline {
    events: Sequence<Event>

    latest: events.last
    has_errors: events.any(e => e.severity = error)
}
```

This distinction matters for specs where ordering is part of the domain contract, not an implementation detail.

## Installing the CLI

```
brew tap juxt/allium && brew install allium
```

Or via Cargo: `cargo install allium-cli`

With the CLI installed, Claude Code validates every `.allium` file after writing or editing it, and the propagate skill uses `allium plan` and `allium model` for deterministic test obligation extraction. Without it, everything still works, but test completeness depends on LLM interpretation rather than AST analysis.

## Upgrading from v2

Change `-- allium: 2` to `-- allium: 3`. One breaking change: `produces` and `consumes` clauses on rules are removed. Replace them with `when` clauses on the fields themselves. The checker emits a migration diagnostic if it encounters the old syntax.

Everything else is additive. Adopt `when` clauses, transition graphs and the other new features as you need them.
