---
layout: default
title: Language
---

<div class="notice">
You don't write or edit Allium specs directly. You describe what your system should do in conversation, and the LLM manages the specification on your behalf. The syntax below is human-readable so you can review what the model produces, but it's designed for LLM consumption first.
</div>

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

The same syntax works whether you're capturing infrastructure contracts or operational policy. A circuit breaker specification describes behaviour that typically lives in library defaults, Grafana alerts and architecture docs, never in any formal specification:

```allium
entity CircuitBreaker {
    service: ExternalService
    status: closed | open | half_open
    opened_at: Timestamp?
    failures: Failure for this circuit_breaker
    recent_failures: failures with occurred_at > now - failure_window
    failure_rate: recent_failures.count / window_sample_size
    is_tripped: failure_rate >= failure_threshold
}

default failure_threshold = 0.5
default failure_window = 30.seconds
default window_sample_size = 20
default recovery_timeout = 10.seconds

rule CircuitOpens {
    when: circuit_breaker.is_tripped
    requires: circuit_breaker.status = closed

    ensures:
        circuit_breaker.status = open
        circuit_breaker.opened_at = now
}

rule CircuitProbes {
    when: circuit_breaker.opened_at + recovery_timeout <= now
    requires: circuit_breaker.status = open

    ensures: circuit_breaker.status = half_open
}
```

At the other end, an incident escalation rule captures operational policy that otherwise lives in runbooks, PagerDuty config and tribal knowledge, where drift between intent and implementation causes real damage:

```allium
default exec_notify_threshold = 2

deferred EscalationPolicy.at_level

rule IncidentEscalates {
    when: incident.declared_at + incident.sla_target <= now
    requires: incident.status in [open, investigating]

    ensures:
        incident.escalation_level = incident.escalation_level + 1
        OnCallPaged(
            team: EscalationPolicy.at_level(incident.escalation_level),
            priority: immediate
        )
        if incident.escalation_level >= exec_notify_threshold:
            ExecBriefingSent(incident: incident)
}
```

The *language reference* covers entities, rules, triggers, relationships, projections, derived values and surfaces.

## A language without a runtime

Allium has no compiler and no runtime. It is purely descriptive, defined entirely by its documentation.

In an era where LLMs function as pseudocode compilers, executing informal descriptions into working code, a well-structured behavioural language becomes the mechanism for ensuring that what gets compiled is what you actually meant. The behavioural model is the primary artefact; the code that implements it is secondary.

---

## Future directions

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

The *patterns library* illustrates this with a variety of worked examples.
