---
layout: default
title: Allium v3
---

<p class="hero">Allium v3</p>

v3 turns your specs into property-based tests. Describe what your system should do, and your LLM generates tests in whatever language and framework you already use.

## Get started

<code>tend</code> and <code>propagate</code> are Allium's built-in agent and skill. Tend updates your specs, propagate generates tests from them. Both work with whatever LLM tooling you have installed.

If you have existing Allium specs, update them and generate tests in two prompts:

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
      <span class="prompt">&gt;</span> Tend our Allium specs to v3. Add transition graphs and when clauses where our entities have lifecycle state.
    </div>
    <div class="turn llm">
      <span class="marker">✻</span> Found 4 specs. <code>orders.allium</code> has a status enum with 5 states — I've added a transition graph and moved <code>tracking_number</code> and <code>shipped_at</code> to <code>when status = shipped | delivered</code>. <code>subscriptions.allium</code> has trial/active/cancelled lifecycle, same treatment. The other two have no lifecycle fields, just bumped them to v3.
    </div>
  </div>
</div>

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
      <span class="prompt">&gt;</span> Propagate the orders spec into property-based tests.
    </div>
    <div class="turn llm">
      <span class="marker">✻</span> Running <code>allium plan</code> and <code>allium model</code> against <code>orders.allium</code>. 47 test obligations. Your existing tests cover 19. Generating the remaining 28, including property-based tests for the 6 invariants and state machine tests walking the order lifecycle. Writing to <code>src/test/kotlin/orders/</code>.
    </div>
  </div>
</div>

If you don't have specs yet, start with `/allium` to distil from your codebase or build one through conversation.

## The big idea

Most testing frameworks work bottom-up: you write tests one at a time. Allium works top-down. The spec already describes your entities, rules, transitions and invariants, so the tooling can tell your LLM what needs testing.

Other spec-driven test tools constrain you to their DSL and their runner. Allium gives your LLM a structured brief, and the LLM writes tests using your project's existing framework and fixtures. The output is idiomatic code you can maintain.

## What's new in the language

### State-dependent fields

Fields declare when they exist:

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

In v2, `deleted_at` would be `Timestamp?` with a comment explaining it's only present when deleted. Technically correct, but semantically wrong: when the document is deleted, `deleted_at` is guaranteed present. Every downstream derived value inherits false optionality, and every rule accessing the field needs a null check the lifecycle already prevents.

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

The graph declares which transitions are structurally possible and which states are terminal. The checker verifies that every declared edge has a witnessing rule, and that undeclared transitions have no rule that could cause them. State machine tests walk every path through the graph, verifying invariants at each step.

### Black box collection operations

v3 separates built-in operations from implementation-defined ones. Built-in operations use dot syntax, black box functions use free-standing syntax:

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

The test generator can reason about built-in operations because their semantics are known. Black box functions are opaque, so it maps them to your actual implementation instead.

### Backtick-quoted enum literals

Enum values that reference external standards often contain hyphens, dots or mixed case. v3 lets you use the canonical form directly:

```allium
enum InterfaceLanguage { en | de | fr | `de-CH-1996` | es | `zh-Hant-TW` | `sr-Latn` }
enum CacheDirective { `no-cache` | `no-store` | `must-revalidate` | `max-age` }
```

Backtick-quoted literals are values, not identifiers. They participate in comparison and assignment like any other enum value, but the checker skips case convention rules inside backticks. Quoted and unquoted forms are distinct: `de_ch_1996` and `` `de-CH-1996` `` are different values with no implicit normalisation.

### Ordered collection semantics

v3 distinguishes ordered from unordered collections. `Set<T>` is unordered, `Sequence<T>` preserves insertion order. Projections and `where` filters on ordered collections produce ordered results, and `.first` and `.last` are only available on ordered collections. When ordering is part of the domain contract, the spec should say so.

```allium
entity Timeline {
    events: Sequence<Event>

    latest: events.last
    has_errors: events.any(e => e.severity = error)
}
```

## How the CLI fits in

The [Allium CLI](https://github.com/juxt/allium-tools) runs behind the scenes. When you ask your LLM to generate tests, the propagate skill calls two commands.

**`allium plan`** reads your spec and emits every test obligation as structured JSON. Rules get success and failure cases, transition edges get validity checks. Invariants become properties to verify after state changes, state-dependent fields get presence and absence checks. The plan is deterministic: same spec, same obligations.

**`allium model`** extracts the domain model: entity shapes with field types and constraints, transition graphs showing valid state sequences, `when`-sets declaring which fields exist at which lifecycle states and invariant expressions that constrain generated data. This is what the test generator needs to construct valid fixtures at any point in the lifecycle.

Without the CLI, your LLM derives test obligations by reading the spec directly. This works, but an LLM reading prose will miss edge cases that a parser catches mechanically. The CLI extracts obligations from the AST, so the plan is complete by construction.

Install with Homebrew or Cargo:

```
brew tap juxt/allium && brew install allium
```

```
cargo install allium-cli
```

With the CLI installed, your LLM also validates every `.allium` file after writing or editing it, catching structural errors before they accumulate.

## Upgrading from v2

Change `-- allium: 2` to `-- allium: 3`. Adopt the new features as you need them. Nothing was removed.
