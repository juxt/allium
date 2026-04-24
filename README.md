# Allium

*Velocity through clarity*

---

Feed your AI something healthier than Markdown. [juxt.github.io/allium](https://juxt.github.io/allium/)

## What this is

Allium is a skill for clarifying intent during agentic engineering. The LLM builds and maintains a behavioural specification alongside your code, capturing what the system should do in a form that persists across sessions. Paired with a CLI that validates syntax and draws semantic inferences, it catches design gaps, surfaces implications you missed and generates tests from the formal behaviours of your system.

## Get started

Allium works with Claude Code, Copilot, Cursor, Windsurf, Aider, Continue and 40+ other tools. How you install depends on your editor, but the skills are the same everywhere.

**Claude Code** via the [JUXT plugin marketplace](https://github.com/juxt/claude-plugins):

```
/plugin marketplace add juxt/claude-plugins
/plugin install allium
```

**Cursor, Windsurf, Aider, Continue and other skills-compatible tools:**

```
npx skills add juxt/allium
```

**GitHub Copilot** reads skills and agents from the repository automatically. No installation needed.

**Other editors:** If your editor doesn't read from `.agents/skills/`, symlink the installed skills into wherever it does look (e.g. `ln -s .agents/skills/allium .continue/rules/allium`, or `mklink /J` on Windows). Use a symlink rather than copying; the skill files contain relative links to reference material that a copy would break.

Once installed, type `/allium` to get started. Allium examines your project and guides you toward the right skill, whether that's distilling a spec from existing code or building one through conversation. Once you're familiar with the individual skills, you'll likely invoke them directly.

Jump to what [Allium looks like in practice](#what-this-looks-like-in-practice).

## Command-line tooling

The [Allium CLI](https://github.com/juxt/allium-tools) checks specs for structural problems and generates tests. It catches things language models can't do reliably on their own: tracing data flow across rules, verifying that every entity lifecycle can reach a terminal state, spotting dead ends. The LLM uses these findings to ask better questions and produce more complete specs.

The skills work without the CLI, falling back to the language reference, but installing it means every edit is formally checked and the results feed straight into the conversation.

Install via [Homebrew](https://brew.sh/) or [crates.io](https://crates.io/crates/allium-cli):

```
brew tap juxt/allium && brew install allium
```

```
cargo install allium-cli
```

See the [allium-tools repo](https://github.com/juxt/allium-tools) for details.

## Skills and agents

Allium provides five skills, an entry point and two autonomous agents.

| Skill | Purpose |
|---|---|
| `/allium <prompt>` | Entry point. Examines your project or the prompt and routes you to the right skill. |
| `/elicit <feature idea>` (or `/allium:elicit`) | Build a spec through structured conversation. |
| `/distill <codebase area>` (or `/allium:distill`) | Extract a spec from existing code. |
| `/propagate <optional constraints>` (or `/allium:propagate`) | Generate tests from a spec. |
| `/tend <optional constraints>` (or `/allium:tend`) | Targeted changes to existing specs. |
| `/weed <optional constraints>` (or `/allium:weed`) | Find and fix divergences between spec and code. |

How skills appear depends on your editor. Some show the fully qualified form (`/allium:weed`), others show the short form (`/weed`), and some support both. If one form isn't recognised, try the other. Skills also auto-trigger when you open or edit `.allium` files.

Tend and weed are also available as autonomous **agents** that run in their own context, keeping Allium syntax out of your main session. Claude Code picks up agents from `agents/`, Copilot from `.github/agents/`. How editors discover skills and agents is still settling; we make these available in the most portable formats we can and expect to consolidate as conventions stabilise. If your editor doesn't pick something up, [raise an issue](https://github.com/juxt/allium/issues).

For larger codebases, distillation and other ambitious tasks may need several passes to capture everything. Consider an iterative approach like the [Ralph Wiggum loop](https://ghuntley.com/ralph/), repeating until there's nothing further to do.

## Why not just point the LLM at the code?

Within a session, meaning drifts: by prompt ten or twenty, the model is pattern-matching on its own outputs rather than the original intent. Across sessions, knowledge evaporates entirely. Modern LLMs navigate codebases effectively, but the limitation appears when you need to distinguish what the code *does* from what it *should do*. Code captures implementation, including bugs and expedient decisions. The model treats all of it as intended behaviour.

Precise prompting helps, but precise prompting means specifying intent: which behaviours are deliberate, which constraints must be preserved. You end up writing descriptions of intent distributed across your prompts. Allium captures this in a form that persists. The next engineer, or the next model, or you next week, can understand what the system does and what it was meant to do.

## Why not capture requirements in markdown?

Markdown provides no framework for surfacing ambiguities and contradictions. You can write "users must be authenticated" in one section and "guest checkout is supported" in another without the format highlighting the tension. Capable models may resolve such ambiguities silently in ways you didn't intend; weaker models may not recognise that alternatives existed.

Allium's structure makes contradictions visible. When two rules have incompatible preconditions, the formal syntax exposes the conflict. The model doesn't need to be clever enough to spot the issue in prose; the structure does that work.
## Iterating on specifications

The specification and the code evolve together. Writing and refining a behavioural model alongside implementation deepens your understanding of both the problem and your solution. Questions surface that you wouldn't have thought to ask; constraints emerge that only become visible when you try to formalise them.

Two processes feed this growth: **elicitation** works forward from intent through structured conversations with stakeholders, while **distillation** works backward from implementation to capture what the system actually does, including behaviours that were never explicitly decided. When distillation and elicitation diverge, you've found something worth investigating.

See the [elicitation guide](skills/elicit/SKILL.md) and the [distillation guide](skills/distill/SKILL.md) for detailed approaches.

## On single sources of truth

A common objection is that maintaining behavioural models alongside code violates the single source of truth principle. But code captures both intentional and accidental behaviour, with no mechanism to distinguish them. Is that authentication quirk a feature or a bug? The code can't tell you. You need something outside the code to even articulate "this behaviour is wrong". Engineers already accept this in other contexts: type systems express intent that code must satisfy, tests assert expected behaviour against actual behaviour. These aren't duplication. The gap between spec and code surfaces questions you need to answer, and that redundancy is what makes the system resilient.

## What Allium captures

Allium provides a minimal syntax for describing events with their preconditions and the outcomes that result. The language deliberately excludes implementation details such as database schemas and API designs, focusing purely on observable behaviour.

```allium
rule RequestPasswordReset {
    when: UserRequestsPasswordReset(email)

    let user = User{email}

    requires: exists user
    requires: user.status in {active, locked}

    ensures:
        for t in user.pending_reset_tokens:
            t.status = expired
    ensures:
        let token = PasswordResetToken.created(
            user: user,
            created_at: now,
            expires_at: now + config.reset_token_expiry,
            status: pending
        )
        Email.created(
            to: user.email,
            template: password_reset,
            data: { token: token }
        )
}
```

This rule captures observable behaviour: when a password reset is requested, if the email matches an active or locked account, existing tokens are invalidated, a new token is created and an email is sent. It says nothing about which database stores the token or which service sends the email, because those decisions belong to implementation.

The same syntax works whether you're capturing infrastructure contracts or operational policy. A circuit breaker specification describes behaviour that typically lives in library defaults, Grafana alerts and architecture docs, never in any formal specification:

```allium
entity CircuitBreaker {
    service: ExternalService
    status: closed | open | half_open
    opened_at: Timestamp?
    failures: Failure with circuit_breaker = this
    recent_failures: failures where occurred_at > now - config.failure_window
    failure_rate: recent_failures.count / config.window_sample_size
    is_tripped: failure_rate >= config.failure_threshold
}

config {
    failure_threshold: Decimal = 0.5
    failure_window: Duration = 30.seconds
    window_sample_size: Integer = 20
    recovery_timeout: Duration = 10.seconds
}

rule CircuitOpens {
    when: circuit_breaker: CircuitBreaker.is_tripped
    requires: circuit_breaker.status = closed

    ensures:
        circuit_breaker.status = open
        circuit_breaker.opened_at = now
}

rule CircuitProbes {
    when: circuit_breaker: CircuitBreaker.opened_at + config.recovery_timeout <= now
    requires: circuit_breaker.status = open

    ensures: circuit_breaker.status = half_open
}
```

The [language reference](skills/allium/references/language-reference.md) covers entities, rules, triggers, relationships, projections, derived values, surfaces and actor declarations. The [v1 to v2 migration guide](skills/allium/references/migration-v1-to-v2.md) and [v2 to v3 migration guide](skills/allium/references/migration-v2-to-v3.md) cover what changed between versions and how to upgrade existing specs.

Allium has no compiler and no runtime. It is purely descriptive, defined entirely by its documentation. LLMs already function as pseudocode compilers, executing informal descriptions into working code. A well-structured behavioural language ensures that what gets compiled is what you actually meant. The behavioural model is the primary artefact; the code that implements it is secondary.

## What this looks like in practice

### Allium surfaces implications you missed

A customer's account was suspended for a terms of service violation. They've appealed and the team wants to let them back in.

---

> ***> A customer says they can't reset their password. Their account was suspended last month but they've appealed and we want to let them back in. Can you enable password reset for suspended users?***
>
> ✻ Your Allium requires `user.status in {active, locked}` for password resets. This user's status is `suspended`, so the reset is blocked by design. Reactivating through password reset would bypass your `AccountReinstated` rule, which requires admin approval and logs an audit trail.
>
> ✻ Should we reinstate the account through the existing admin flow first, then let them reset their password? Or create a new `AccountReinstatedViaAppeal` rule that combines both steps with the audit trail intact?
>
> ***> Reinstate through the admin flow first. The audit trail matters.***

---

Without Allium, the LLM would have relaxed the status check, accidentally creating a backdoor around an admin control. The behavioural model caught that password reset and account reinstatement are separate concerns with different approval requirements.

### Knowledge persists across sessions

A developer starts a new session days later, working on a different feature.

---

> ***> Add a free trial. New subscribers get their first month at no charge.***
>
> ✻ Your Allium has a constraint here. `SubscriptionCreated` ensures a payment is processed and `InvoiceGenerated` requires `invoice.amount > 0`. A free first month would need to bypass both.
>
> ✻ Should the trial skip invoice generation entirely, or create a zero-value invoice for the audit trail? And should the `PaymentMethod` still be captured upfront, or only when the trial converts?
>
> ***> Create a zero-value invoice and capture the payment method upfront.***

---

The developer never mentioned invoicing or payment method capture. The Allium did, from a session that ended days ago. Without it, the LLM would have implemented the trial with no awareness of these constraints, and the gaps would have surfaced in production.

## Verification

When the CLI is installed, `.allium` files are validated automatically after every write or edit. Diagnostics appear inline and the model fixes issues in the same turn.

## Language governance

Every change to Allium is debated by a [nine-member review panel](https://github.com/juxt/allium/blob/proposals/TEAM.md) before adoption. Each panellist represents a distinct design priority: simplicity, machine reasoning, composability, readability, formal rigour, domain modelling, developer experience, creative ambition and backward compatibility. The panel exists to surface tensions that any single perspective would miss.

The panel operates in two modes. [Reviews](https://github.com/juxt/allium/blob/proposals/REVIEW.md) evaluate fixes to rough edges in the existing language, where the default is to fix the problem if a good fix exists. [Proposals](https://github.com/juxt/allium/blob/proposals/PROPOSE.md) evaluate new features and ambitious changes, where the default is to leave the language alone unless the case for change is strong. Both follow the same debate protocol: present, respond, rebut, synthesise, verdict.

## Feedback

We'd love to hear how you get on with Allium. Success stories, rough edges, missing features, things that surprised you. Drop us a line at [info@juxt.pro](mailto:info@juxt.pro) or [raise an issue](https://github.com/juxt/allium/issues) if you have a specific request.

## About the name

Allium is the botanical family containing onions and shallots. The name continues a tradition in behaviour specification tooling: Cucumber and Gherkin established botanical naming as a convention in behaviour-driven development, followed by tools like Lettuce and Spinach.

The phonetic echo of "LLM" is intentional, reflecting where we expect these models to be most useful. "Know your onions" means to understand a subject thoroughly, and Allium consolidates scattered intent into an explicit form that models can reference reliably.

Like its namesake, working with Allium may produce tears during the peeling, but never at the table.

## Star History

<a href="https://www.star-history.com/?repos=juxt%2Fallium&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/image?repos=juxt/allium&type=date&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/image?repos=juxt/allium&type=date&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/image?repos=juxt/allium&type=date&legend=top-left" />
 </picture>
</a>

---

## Copyright & License

The MIT License (MIT)

Copyright © 2026 JUXT Ltd.

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
