# Allium

A specification language for capturing what your product does, independent of how it's built.

## Why Specification Matters Now

We're seeing two failure modes in AI-assisted development, and they stem from the same root cause.

The first is specification drift. Teams begin with a conversational approach to development, describing features to a model and iterating on the generated code. This works well initially, but after several features the codebase accumulates implicit decisions that nobody remembers making. The authentication flow assumes things about permissions that were never written down. Error handling varies across modules because each generation had slightly different context. When behaviour needs to change, there's no authoritative description of what the system is supposed to do, only the code itself, which conflates intent with implementation accident.

The second is inconsistent generation. When requirements remain informal, the same feature request can produce substantially different implementations depending on context window contents or model version. This isn't a limitation of the models themselves: informal requirements contain implicit decisions, and without a specification to make those decisions explicit, each generation resolves the ambiguity differently.

Both problems are specification problems. Allium addresses them by providing a formal language for capturing product behaviour at the domain level.

## What Allium Captures

Allium specifications describe what happens when events occur: the preconditions that must hold and the outcomes that result. They deliberately exclude implementation details such as database schemas, API designs, framework choices and internal algorithms.

```allium
rule UserRequestsPasswordReset {
    when: UserRequestsReset(user, email)

    requires: email = user.email
    requires: user.status = active

    ensures: ResetToken.created(
        user: user,
        expires_at: now + config.reset_token_lifetime
    )
    ensures: Email.sent(
        to: user.email,
        template: password_reset,
        data: { token }
    )
}
```

This rule captures the behaviour that product owners care about: when a user requests a password reset, if the email matches and the account is active, a token is created and an email is sent. It says nothing about which database stores the token or which service sends the email. Those decisions belong to implementation.

The separation matters because it allows the specification to remain stable while implementations change. A team can migrate from PostgreSQL to DynamoDB, or from SendGrid to Postmark, without touching the specification. Conversely, when product behaviour changes, the specification changes first, and the implementation follows.

## How We Use It

We use Allium in several ways.

**Elicitation** extracts specifications through structured conversation. Rather than generating code directly from informal requirements, we first work with stakeholders to produce an Allium specification that makes implicit decisions explicit. This surfaces ambiguities before implementation begins, when they're cheapest to resolve. The [elicitation guide](ELICITATION.md) describes this process in detail.

**Reverse engineering** extracts specifications from existing codebases. When inheriting a system or preparing for significant changes, we analyse the implementation to produce a specification that captures current behaviour. This provides a baseline for understanding what the system actually does, distinct from what documentation claims or developers believe. The [reverse engineering guide](REVERSE_ENGINEERING.md) walks through this process with worked examples.

**Test generation** produces integration and end-to-end tests directly from specifications. Each rule implies test cases for success paths and for precondition violations, along with edge cases around state transitions and temporal behaviour. The specification becomes the authoritative description that both humans and automated systems can verify against.

## What's Here

The repository contains four documents:

- [SKILL.md](SKILL.md): The complete Allium language specification, covering entities, rules, triggers, relationships, projections and derived values
- [PATTERNS.md](PATTERNS.md): Worked patterns for common domains including authentication, access control, invitations, soft delete, quotas and notifications
- [ELICITATION.md](ELICITATION.md): A guide to extracting specifications through conversation with stakeholders
- [REVERSE_ENGINEERING.md](REVERSE_ENGINEERING.md): A guide to extracting specifications from existing implementations

## The Name

Allium is the botanical family containing onions, garlic, leeks and shallots. The name continues a tradition in behaviour specification tooling: Cucumber and Gherkin established botanical naming as a convention, followed by Lettuce and Spinach for other language ecosystems. The phonetic echo of "LLM" is intentional, reflecting where we expect these specifications to be most useful. And as with its namesake, working with Allium occasionally produces tears, usually when you discover what was hiding in your requirements all along.
