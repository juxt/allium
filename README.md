# Allium

A specification language for describing what your code does independent of how it's built.

## Why specification?

Software engineers often understand problems as they model them. Deciding whether a concept is one entity or two, naming a function and realising it does too many things, or discovering that two "different" workflows are actually the same. These clarifications emerge through the act of formalisation. Reasoning through implications in code is how we discover what we actually mean.

LLMs let engineers skip this process. Describe behaviour informally, receive working code. But when models guess at ambiguities rather than surfacing them, those guesses become silent assumptions embedded in the codebase. The discovery that used to happen during implementation now doesn't happen at all.

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

## A language without a runtime

Allium has no compiler and no runtime. It is purely specification, defined entirely by its documentation. This is not a limitation but an illustration of its core premise: what matters is the specification, not the implementation.

In an era where LLMs function as pseudocode compilers, executing informal descriptions into real code, a well-structured specification language becomes the mechanism for ensuring that what gets compiled is what you actually meant. The specification is the primary artefact; the code that implements it is secondary.

## How specs are created

Allium specifications are not written by hand. They emerge through two processes:

**Elicitation** extracts specifications through structured conversation. Rather than generating code directly from informal requirements, you first work with stakeholders to produce a specification that makes implicit decisions explicit. This surfaces ambiguities before implementation, when they're cheapest to resolve. See the [elicitation guide](ELICITATION.md).

**Reverse engineering** extracts specifications from existing codebases. When inheriting a system or preparing for significant changes, you analyse the implementation to produce a specification that captures what the system actually does, distinct from what documentation claims. See the [reverse engineering guide](REVERSE_ENGINEERING.md).

## The problems Allium solves

**Silent assumptions.** After several features, authentication assumes things about permissions that were never written down and error handling varies across modules. Informal requirements contain implicit decisions, and each generation of code resolves them differently. Allium's structure forces you to identify preconditions and outcomes for each trigger, surfacing questions that informal descriptions gloss over.

**Implementation churn.** The specification remains stable while implementations change. A team can migrate from PostgreSQL to DynamoDB, or from SendGrid to Postmark, without touching the specification. Conversely, when the required behaviour changes, the specification changes first and the implementation follows.

**Translation errors.** While engineers are the primary audience, Allium specifications are readable by anyone involved in defining system behaviour. Product owners can validate that the spec captures their intent. QA engineers can derive test cases directly from the rules. The shared language reduces errors that occur when requirements pass through multiple interpretations.

**Test generation.** Each rule implies test cases for success paths and for precondition violations, along with edge cases around state transitions and temporal behaviour. The specification becomes the authoritative description that both humans and automated systems can verify against.

## Pattern libraries

The [patterns library](PATTERNS.md) provides worked examples for common domains including authentication, access control, invitations, soft delete, quotas and notifications. These can be adapted to your specific requirements or used as starting points for elicitation.

## About the name

Allium is the botanical family containing onions and shallots. The name continues a tradition in behaviour specification tooling: Cucumber and Gherkin established botanical naming as a convention, followed by Lettuce and Spinach for other language ecosystems.

The phonetic echo of "LLM" is intentional, reflecting where we expect these specifications to be most useful.

And as with its namesake, working with Allium occasionally produces tears. Usually when you discover what was hiding in your requirements all along.

---

Copyright JUXT Ltd 2026
