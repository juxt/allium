# Allium

A specification language for capturing what your software does, independent of how it's built.

## Installation

Allium is a skill for [Claude Code](https://claude.ai/claude-code), Anthropic's CLI tool for AI-assisted development.

**Global installation** makes the skill available across all your projects:

```bash
git clone https://github.com/juxt/allium.git ~/.claude/skills/allium
```

**Project-local installation** scopes the skill to a specific codebase:

```bash
git clone https://github.com/juxt/allium.git .claude/skills/allium
```

For teams managing multiple skills across projects, [Craftdesk](https://craftdesk.io) provides tooling for configuration and synchronisation.

Once installed, Claude Code will load the skill when it encounters `.allium` files or when you mention Allium in conversation.

## Why specification matters now

### Code as a thinking tool

Writing code has always been a mechanism for understanding requirements. The act of formalising behaviour into a programming language forces decisions: what happens when this field is null, what order should these operations occur in, how should this error propagate. Code is ultimately the reification of cause-and-effect behaviours we want our software to perform, but these essential behaviours often become secondary to incidental complexity: memory management, type systems, framework conventions and dependency injection.

### What changes with LLMs

LLMs allow engineers to describe behaviour informally and receive working code, working at a higher level of abstraction than traditional development. This is powerful, but it risks losing the disambiguation that traditionally happened during implementation. When the model guesses at ambiguities rather than surfacing them, those guesses become silent assumptions embedded in the codebase.

The consequences emerge over time. After several features, authentication assumes things about permissions that were never written down, error handling varies across modules and nobody remembers why that edge case was handled that way. Informal requirements contain implicit decisions, and each generation resolves them differently.

### Disambiguation without implementation

Allium reintroduces the disambiguation process at a higher level of abstraction. It provides a structured framework for working through requirements formally, identifying conflicts and edge cases, without descending into implementation detail.

The value is not in the syntax itself but in the discipline it imposes. Allium's structure forces you to identify preconditions and outcomes for each trigger, surfacing questions that informal descriptions gloss over. This counteracts the natural tendency of LLMs to produce plausible-looking solutions to fuzzy problems, and requires the engineer to do the harder work of deciding what the system should actually do.

While engineers are the primary audience, Allium specifications are readable by anyone involved in defining system behaviour. Product owners can validate that the spec captures their intent. QA engineers can derive test cases directly from the rules. The shared language reduces the translation errors that occur when requirements pass through multiple interpretations.

## A language without a runtime

Allium has no compiler and no runtime. It is purely specification, defined entirely by its documentation. This is not a limitation but an illustration of its core premise: what matters is the specification, not the implementation.

In an era where LLMs function as pseudocode compilers, executing informal descriptions into real code, a well-structured specification language becomes the mechanism for ensuring that what gets compiled is what you actually meant. The LLM reads the Allium skill documentation and uses it to interpret `.allium` files or create new specifications, whether through elicitation from conversation or reverse-engineering from existing code. The specification is the primary artefact; the code that implements it is secondary.

## What Allium captures

Allium specifications describe what happens when events occur: the preconditions that must hold and the outcomes that result. They deliberately exclude implementation details such as database schemas, API designs, framework choices and internal algorithms.

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

The separation matters because it allows the specification to remain stable while implementations change. A team can migrate from PostgreSQL to DynamoDB, or from SendGrid to Postmark, without touching the specification. Conversely, when the required behaviour changes, the specification changes first and the implementation follows.

## How we use it

**Elicitation** extracts specifications through structured conversation. Rather than generating code directly from informal requirements, we first work with stakeholders to produce an Allium specification that makes implicit decisions explicit. This surfaces ambiguities before implementation begins, when they're cheapest to resolve. The [elicitation guide](ELICITATION.md) describes this process in detail.

**Reverse engineering** extracts specifications from existing codebases. When inheriting a system or preparing for significant changes, we analyse the implementation to produce a specification that captures current behaviour. This provides a baseline for understanding what the system actually does, distinct from what documentation claims or developers believe. The [reverse engineering guide](REVERSE_ENGINEERING.md) walks through this process with worked examples.

**Test generation** produces integration and end-to-end tests directly from specifications. Each rule implies test cases for success paths and for precondition violations, along with edge cases around state transitions and temporal behaviour. The specification becomes the authoritative description that both humans and automated systems can verify against.

## What's here

The repository contains four documents:

- [SKILL.md](SKILL.md): The complete Allium language specification, covering entities, rules, triggers, relationships, projections and derived values
- [ELICITATION.md](ELICITATION.md): A guide to extracting specifications through conversation with stakeholders
- [REVERSE_ENGINEERING.md](REVERSE_ENGINEERING.md): A guide to extracting specifications from existing implementations
- [PATTERNS.md](PATTERNS.md): Worked examples for common domains including authentication, access control, invitations, soft delete, quotas and notifications

## The name

Allium is the botanical family containing onions and shallots. The name continues a tradition in behaviour specification tooling: Cucumber and Gherkin established botanical naming as a convention, followed by Lettuce and Spinach for other language ecosystems. The phonetic echo of "LLM" is intentional, reflecting where we expect these specifications to be most useful. And as with its namesake, working with Allium occasionally produces tears, usually when you discover what was hiding in your requirements all along.

---

Copyright JUXT Ltd 2026
