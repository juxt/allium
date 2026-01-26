# Allium

A specification language for describing what your code does independent of how it's built.

## Why specification?

Software engineers often understand problems as they model them. Deciding whether a concept is one entity or two, naming a function and realising it does too many things, or discovering that two "different" workflows are actually the same: these clarifications emerge through the act of formalisation. Reasoning through implications in code is how we discover what we actually mean.

LLMs let engineers skip this process: describe behaviour informally, receive working code. But when models guess at ambiguities rather than surfacing them, those guesses become silent assumptions embedded in the codebase. The discovery that used to happen during implementation now doesn't happen at all.

Allium reclaims that discovery at a higher level of abstraction, without descending into implementation detail.

## Installation

Allium is a skill for [Claude Code](https://claude.ai/claude-code), Anthropic's CLI tool for AI-assisted development.

**Global installation** makes the skill available across all your projects:

```bash
git clone git@github.com:juxt/allium.git ~/.claude/skills/allium
```

**Project-local installation** scopes the skill to a specific codebase:

```bash
git clone git@github.com:juxt/allium.git .claude/skills/allium
```

For teams managing multiple skills across projects, [Craftdesk](https://github.com/mensfeld/craftdesk) provides tooling for configuration and synchronisation.

Once installed, Claude Code will load the skill when it encounters `.allium` files or when you mention Allium in conversation.

## What a spec looks like

Allium specifications describe what happens when events occur: the preconditions that must hold and the outcomes that result. They deliberately exclude implementation details like database schemas and API designs.

```allium
rule UserRequestsPasswordReset {
    when: UserRequestsReset(user, email)

    requires: email = user.email
    requires: user.status = active

    ensures:
        let token = ResetToken.created(
            user: user,
            expires_at: now + config.reset_token_lifetime
        )
        Email.sent(
            to: user.email,
            template: password_reset,
            data: { token }
        )
}
```

This rule captures observable behaviour: when a user requests a password reset, if the email matches and the account is active, a token is created and an email is sent. It says nothing about which database stores the token or which service sends the email. Those decisions belong to implementation.

The [language specification](SKILL.md) covers entities, rules, triggers, relationships, projections and derived values.

### A language without a runtime

Allium has no compiler and no runtime. It is purely specification, defined entirely by its documentation. This is not a limitation but an illustration of its core premise: what matters is the specification, not the implementation.

In an era where LLMs function as pseudocode compilers, executing informal descriptions into real code, a well-structured specification language becomes the mechanism for ensuring that what gets compiled is what you actually meant. The specification is the primary artefact; the code that implements it is secondary.

## How specs are created

Allium specifications are not written by hand. They emerge through two processes:

**Elicitation** extracts specifications through structured conversation. Rather than generating code directly from informal requirements, you first work with stakeholders to produce a specification that makes implicit decisions explicit. This surfaces ambiguities before implementation, when they're cheapest to resolve. See the [elicitation guide](ELICITATION.md).

**Reverse engineering** extracts specifications from existing codebases. When inheriting a system or preparing for significant changes, you analyse the implementation to produce a specification that captures what the system actually does, distinct from what documentation claims. See the [reverse engineering guide](REVERSE_ENGINEERING.md).

## The problems Allium solves

### Silent assumptions

After several features, authentication assumes things about permissions that were never written down and error handling varies across modules. Informal requirements contain implicit decisions, and each generation of code resolves them differently. Allium's structure forces you to identify preconditions and outcomes for each trigger, surfacing questions that informal descriptions gloss over.

### Specification-implementation coupling

Requirements become tangled with infrastructure choices. Knowing what the system should do gets mixed up with how it currently does it. With a separate specification, the behaviour remains stable while implementations change. A team can migrate from PostgreSQL to DynamoDB without re-deriving the requirements from code. When behaviour needs to change, the specification changes first and the implementation follows.

### Requirements that mutate

Requirements pass through multiple interpretations: stakeholder to product owner, product owner to engineer, engineer to code. Each handoff introduces drift. Allium specifications are readable by anyone involved in defining system behaviour. Product owners can validate that the spec captures their intent. QA engineers can derive test cases directly from the rules. The shared language keeps everyone aligned on a single authoritative description.

### Verification drift

Tests accumulate organically and drift from intended behaviour. Edge cases get covered inconsistently. With Allium, each rule implies test cases for success paths and precondition violations. The specification becomes the authoritative source that both humans and automated systems verify against.

### Model capability constraints

Smaller and faster models can struggle to produce rich implementations from informal descriptions alone. A well-structured specification provides scaffolding that guides generation, allowing less capable models to produce higher quality code by following explicit rules rather than inferring intent.

## Reusable specifications

Allium specifications are composable. Common patterns can be published as standalone `.allium` files and referenced by other specifications using the `use` keyword:

```allium
use "github.com/allium-specs/google-oauth/abc123def" as oauth

entity User {
    authenticated_via: oauth/Session
}
```

Coordinates are immutable references (git SHAs or content hashes), not version numbers. A spec is immutable once published, so no version resolution or lock files are needed.

This means teams can publish general-purpose specifications for authentication flows, payment processing, notification systems or any other common interface. Others can compose these into their own specifications, responding to triggers and referencing entities across spec boundaries.

The [patterns library](PATTERNS.md) illustrates this with a variety of worked examples.

## About the name

Allium is the botanical family containing onions and shallots. The name continues a tradition in behaviour specification tooling: Cucumber and Gherkin established botanical naming as a convention, followed by Lettuce and Spinach for other language ecosystems.

The phonetic echo of "LLM" is intentional, reflecting where we expect these specifications to be most useful.

Like its namesake, working with Allium may produce tears during the peeling, but never at the table.

---

Copyright JUXT Ltd 2026
