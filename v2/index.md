---
layout: default
title: Allium v2
---

<p class="hero">Allium v2 — additive language features for sharper specifications</p>

Allium is a behavioural specification language for describing what systems should do, not how. LLMs and humans interpret it directly; there is no compiler or runtime. v2 extends what specs can express without removing or altering any v1 syntax.

## Getting started

Three things to set up.

**Install the Allium skill** so your LLM can read and write specs:

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
      <span class="prompt">&gt;</span> /plugin marketplace add juxt/claude-plugins
    </div>
    <div class="turn user">
      <span class="prompt">&gt;</span> /plugin install allium
    </div>
  </div>
</div>

For Cursor, Windsurf, Copilot, Aider, Continue and 40+ other tools:

```
npx skills add juxt/allium
```

**Install the CLI** so specs are validated automatically after every edit:

```
brew tap juxt/allium && brew install allium
```

Or via Cargo: `cargo install allium-cli`

With the CLI installed, Claude Code checks every `.allium` file after writing or editing it, catching structural errors before they accumulate. Without it, validation falls back to the language reference — functional, but a parser catches more.

**Build your first spec.** Type `/allium` in Claude Code. It examines your project, then offers to distil from existing code or build a new spec through conversation. `/allium:elicit` goes straight to building from intent; `/allium:distill` extracts from existing code.

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
      <span class="prompt">&gt;</span> /allium
    </div>
    <div class="turn llm">
      <span class="marker">✻</span> I can see you have an existing codebase with order processing, inventory management and a shipping module, but no Allium spec yet. I can <strong>distil from code</strong> to capture what your implementation currently does, or <strong>start from intent</strong> to build a spec through conversation. Which would you prefer?
    </div>
  </div>
</div>

## What's new in v2

Every v1 spec is valid v2 — change `-- allium: 1` to `-- allium: 2` and everything works. Nothing was removed. Six additions:

### Expression-bearing invariants

Machine-readable assertions over entity state that tooling can verify:

```allium
invariant UniqueEmail {
    for a in Users:
        for b in Users:
            a != b implies a.email != b.email
}

entity Account {
    balance: Decimal
    credit_limit: Decimal

    invariant SufficientFunds {
        balance >= -credit_limit
    }
}
```

Previously these lived in comments. Now LLMs can check them when generating code, and the checker can flag violations. Top-level invariants express system-wide properties; entity-level invariants scope to a single entity.

### The `implies` operator

`a implies b` instead of `not a or b`. Available everywhere expressions are used.

```allium
requires: user.role = admin implies user.mfa_enabled
```

### Module-level contracts

Reusable typed interfaces for code-to-code boundaries. Contracts declare typed signatures and prose invariants. Surfaces reference them with directionality: `demands` means the counterpart must implement it, `fulfils` means this surface supplies it.

```allium
contract Codec {
    serialize: (value: Any) -> ByteArray
    deserialize: (bytes: ByteArray) -> Any

    @invariant Roundtrip
        -- deserialize(serialize(value)) produces a value
        -- equivalent to the original for all supported types.
}

surface DomainIntegration {
    facing framework: FrameworkRuntime

    contracts:
        demands Codec
        fulfils EventSubmitter

    @guarantee AllOperationsIdempotent
        -- All operations exposed by this surface
        -- are safe to retry.
}
```

Specs can describe integration boundaries precisely enough that an LLM implementing one side knows what the other side expects.

### The `@` annotation sigil

Three keywords mark prose whose structure the checker validates but whose content it does not evaluate:

`@invariant` — named prose assertion scoped to a contract. `@guarantee` — named prose assertion scoped to a surface. `@guidance` — non-normative implementation advice (latency hints, batching strategies) that belongs in the spec rather than scattered across comments.

Start with prose annotations, promote to expression-bearing forms when you can formalise them. When `@invariant` becomes expressible, the `@` drops and a `{ expr }` body replaces the prose.

### Config parameter references

Importing modules can reference or derive config defaults from dependencies:

```allium
use "./core.allium" as core

config {
    base_timeout: Duration = core/config.base_timeout
    extended_timeout: Duration = core/config.base_timeout * 2
    buffer_size: Integer = core/config.batch_size + 10
}
```

Config composition without magic numbers crossing module boundaries. Expressions resolve once at config resolution time and the reference graph must be acyclic.

### Updated section order

Two new sections — contracts and invariants — slot into the file structure in their natural positions. Empty sections are still omitted, so most v1 specs need no structural changes.

## Upgrading from v1

Change `-- allium: 1` to `-- allium: 2`. Adopt the new features as you need them.
