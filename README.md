# Allium

A language for capturing what your code does, independent of how it's built.

## The problem with conversational context

We've observed two patterns among engineers who work extensively with LLMs.

Within a session, meaning drifts. The first prompt produces strong results, but iteration quality degrades over subsequent exchanges. By prompt forty or fifty, the model is making mistakes it wouldn't have made initially, pattern-matching on its own outputs and the conversation's drift rather than the original intent.

Across sessions, knowledge evaporates. The assumptions stated and constraints clarified disappear when the chat ends, and the next session starts from zero. Each conversation is an informal specification that exists only for its duration.

Allium addresses both problems by giving behavioural intent a durable form. Within a session, the spec provides a stable reference point that doesn't drift with the conversation. Across sessions, it persists alongside your code and provides context to every future interaction.

## Our hypothesis

We believe Allium addresses this, but we haven't proven it yet. This document explains the theory; your experiments will test whether it holds in practice. We're looking for evidence that structured behavioural specs reduce misunderstandings and produce better code on the first try. We're also open to discovering that the overhead isn't worth the clarity.

## Why not just point the LLM at the code?

A reasonable response to the iteration problem is to clear the context and start fresh, giving the model access to the codebase itself. Modern LLMs navigate codebases effectively, and many engineers find this sufficient for their needs.

The limitation emerges when you need the model to distinguish between what the code *does* and what it *should do*. Code captures implementation, including bugs and expedient decisions made under pressure. When the model reads your codebase, it treats all of this as intended behaviour. If authentication silently fails open under certain conditions, the model will preserve that behaviour unless you explicitly tell it otherwise.

The natural response is to prompt more precisely, but precise prompting means specifying intent: which behaviours are deliberate and which are accidental, which constraints must be preserved and which can be relaxed. You end up writing a specification in natural language, distributed across your prompts.

Allium captures this specification work in a form that persists. The next engineer, or the next model, or you in six months, can understand not just what the system does but what it was meant to do.

## What Allium captures

Allium provides a minimal syntax for describing events with their preconditions and the outcomes that result. The language deliberately excludes implementation details such as database schemas and API designs, focusing purely on observable behaviour.

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

This rule captures observable behaviour: when a user requests a password reset, if the email matches and the account is active, a token is created and an email is sent. It says nothing about which database stores the token or which service sends the email, because those decisions belong to implementation.

The [language reference](SKILL.md) covers entities, rules, triggers, relationships, projections and derived values.

### A language without a runtime

Allium has no compiler and no runtime. It is purely specification, defined entirely by its documentation.

In an era where LLMs function as pseudocode compilers, executing informal descriptions into working code, a well-structured behavioural language becomes the mechanism for ensuring that what gets compiled is what you actually meant. The specification is the primary artefact; the code that implements it is secondary.

## How knowledge accumulates

Behavioural models tend to accumulate incrementally through two processes:

**Elicitation** extracts models through structured conversation, working with stakeholders to surface implicit decisions and resolve ambiguities. See the [elicitation guide](ELICITATION.md).

**Reverse engineering** extracts models from existing codebases, analysing implementation to capture what the system actually does. See the [reverse engineering guide](REVERSE_ENGINEERING.md).

Both processes are iterative. Neither requires you to pause development and "write specs" before coding.

## How to evaluate this

We're asking you to test whether Allium improves your LLM-assisted workflow. Here's what we're looking for:

**Good candidates for testing:**
- A feature with non-obvious constraints or edge cases
- Work on a system where you've previously had to re-explain context across sessions
- A module where "what it should do" isn't fully captured by "what it currently does"
- A greenfield feature where you can establish specs from the start

**What to notice:**
- Does having the spec reduce back-and-forth with the model?
- Does the model make fewer mistakes that violate stated constraints?
- Is the overhead of maintaining the spec worth the clarity it provides?
- Do you find yourself naturally updating the spec, or does it rot?

**What to report back:**
- Where it helped and where it didn't
- What's missing from the language
- Whether the spec stayed accurate as the code evolved
- Whether you'd use it again on similar work

Give it a few sessions before forming an opinion. The value, if any, compounds over time.

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

## About the name

Allium is the botanical family containing onions and shallots. The name continues a tradition in behaviour specification tooling: Cucumber and Gherkin established botanical naming as a convention, followed by Lettuce and Spinach for other language ecosystems.

The phonetic echo of "LLM" is intentional, reflecting where we expect these models to be most useful.

Like its namesake, working with Allium may produce tears during the peeling, but never at the table.

---

## Appendix: The problems we think this addresses

These are the issues we believe Allium addresses. We're stating them as hypotheses to test, not proven benefits.

### Constraints that don't persist

After several features built through LLM-assisted development, authentication sometimes assumes things about permissions that were never written down, and error handling can vary across modules in ways that reflect different conversations rather than deliberate design. Each generation of code resolves ambiguities independently, because the constraints from previous sessions weren't captured anywhere the model could reference.

Allium's structure requires you to identify preconditions and outcomes for each trigger, surfacing questions that informal descriptions gloss over. Once captured, these constraints remain available to every future interaction.

### Intent that drifts from implementation

Requirements tend to become tangled with infrastructure choices over time. Knowing what the system should do gets mixed up with how it currently does it, making it difficult to reason about behaviour changes without also reasoning about implementation changes.

With a separate behavioural model, intent remains stable while implementations evolve. A team can migrate from PostgreSQL to DynamoDB without re-deriving requirements from code, and when behaviour needs to change, the model changes first. Conflicts between intended and implemented behaviour surface immediately rather than hiding in production.

### Knowledge scattered across conversations

Requirements pass through multiple interpretations on their way to code: stakeholder to product owner, product owner to engineer, engineer to LLM. Each handoff introduces drift, and the authoritative version often exists only in someone's memory of a conversation that happened weeks ago.

Allium captures knowledge in a form that's readable by anyone involved in defining system behaviour. Product owners can validate that the model captures their intent and QA engineers can derive test cases directly from the rules, keeping everyone aligned on a single authoritative description.

### Tests that drift from intent

Tests accumulate organically and tend to drift from intended behaviour as systems evolve. Edge cases get covered inconsistently, and the relationship between test assertions and business requirements becomes unclear.

With Allium, each rule implies test cases for success paths and precondition violations. The behavioural model becomes the authoritative source that both humans and automated systems verify against, making it clear when tests and intent have diverged.

### Smaller models with limited context

Smaller and faster models can struggle to produce rich implementations from informal descriptions alone, particularly when the system has complex constraints or non-obvious edge cases. A well-structured behavioural model provides scaffolding that guides generation, allowing less capable models to produce higher quality code by following explicit rules rather than inferring intent from limited context.

## Appendix: Future directions

We're exploring these capabilities but haven't built them yet.

### Composable models

We're designing Allium models to be composable. Common patterns will be publishable as standalone `.allium` files and referenced by other models using the `use` keyword:

```allium
use "github.com/allium-specs/google-oauth/abc123def" as oauth

entity User {
    authenticated_via: oauth/Session
}
```

Coordinates will be immutable references such as git SHAs or content hashes, not version numbers. A model becomes immutable once published, so no version resolution or lock files are needed.

Teams will be able to publish general-purpose models for authentication flows and payment processing. Others can compose these into their own models, responding to triggers and referencing entities across boundaries.

The [patterns library](PATTERNS.md) illustrates this with a variety of worked examples.

---

Copyright JUXT Ltd 2026
