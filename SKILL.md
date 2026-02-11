---
name: allium
description: An LLM-native language for sharpening intent alongside implementation. Velocity through clarity.
auto_trigger:
  - file_patterns: ["**/*.allium"]
  - keywords: ["allium", "allium spec", "allium specification", ".allium file"]
---

# Allium

Allium is a formal language for capturing software behaviour at the domain level. It sits between informal feature descriptions and implementation, providing a precise way to specify what software does without prescribing how it's built.

The name comes from the botanical family containing onions and shallots, continuing a tradition in behaviour specification tooling established by Cucumber and Gherkin.

Key principles:

- Describes observable behaviour, not implementation
- Captures domain logic that matters at the behavioural level
- Generates integration and end-to-end tests (not unit tests)
- Forces ambiguities into the open before implementation
- Implementation-agnostic: the same spec could be implemented in any language

Allium does NOT specify programming language or framework choices, database schemas or storage mechanisms, API designs or UI layouts, or internal algorithms (unless they are domain-level concerns).

## Routing table

| Task | Skill | When |
|------|-------|------|
| Writing or reading `.allium` files | this skill | You need language syntax and structure |
| Building a spec through conversation | `elicit` | User describes a feature or behaviour they want to build |
| Extracting a spec from existing code | `distill` | User has implementation code and wants a spec from it |

## Quick syntax summary

### Entity

```
entity Candidacy {
    -- Fields
    candidate: Candidate
    role: Role
    status: pending | active | completed | cancelled   -- inline enum
    retry_count: Integer

    -- Relationships
    invitation: Invitation for this candidacy            -- one-to-one
    slots: InterviewSlot for this candidacy              -- one-to-many

    -- Projections
    confirmed_slots: slots with status = confirmed
    pending_slots: slots with status = pending

    -- Derived
    is_ready: confirmed_slots.count >= 3
    has_expired: invitation.expires_at <= now
}
```

### External entity

```
external entity Role { title: String, required_skills: Set<Skill>, location: Location }
```

### Value type

```
value TimeRange { start: Timestamp, end: Timestamp, duration: end - start }
```

### Sum type

A base entity declares a discriminator field whose capitalised values name the variants. Variants use the `variant` keyword.

```
entity Node {
    path: Path
    kind: Branch | Leaf              -- discriminator field
}

variant Branch : Node {
    children: List<Node?>
}

variant Leaf : Node {
    data: List<Integer>
    log: List<Integer>
}
```

Lowercase pipe values are enum literals (`status: pending | active`). Capitalised values are variant references (`kind: Branch | Leaf`). Type guards (`requires:` or `if` branches) narrow to a variant and unlock its fields.

### Module context

Declares the entity instances a module's rules operate on. All rules inherit these bindings. Not every module needs one: rules scoped by triggers on domain entities get their entities from the trigger. Module context is for specs where rules operate on shared instances that exist once per module scope.

```
context {
    pipeline: HiringPipeline
    calendar: InterviewCalendar
}
```

Imported module instances are accessed via qualified names (`scheduling/calendar`) and do not appear in the local context block. Distinct from surface context, which binds a parametric scope for a boundary contract.

### Rule

```
rule InvitationExpires {
    when: invitation: Invitation.expires_at <= now
    requires: invitation.status = pending
    let remaining = invitation.proposed_slots with status != cancelled
    ensures: invitation.status = expired
    ensures: remaining.each(s => s.status = cancelled)
}
```

### Trigger types

- **External stimulus**: `when: CandidateSelectsSlot(invitation, slot)` — action from outside the system
- **State transition**: `when: interview: Interview.status becomes scheduled` — entity changed state
- **Temporal**: `when: invitation: Invitation.expires_at <= now` — time-based condition (always add a `requires` guard against re-firing)
- **Derived condition**: `when: interview: Interview.all_feedback_in` — derived value becomes true
- **Entity creation**: `when: batch: DigestBatch.created` — fires when a new entity is created
- **Chained**: `when: AllConfirmationsResolved(candidacy)` — triggered by another rule completing

All entity-scoped triggers use explicit `var: Type` binding. Use `_` as a discard binding where the name is not needed: `when: _: Invitation.expires_at <= now`, `when: SomeEvent(_, slot)`.

### Surface

```
surface InterviewerDashboard {
    for viewer: Interviewer

    context assignment: SlotConfirmation with interviewer = viewer

    exposes:
        assignment.slot.time
        assignment.status

    provides:
        InterviewerConfirmsSlot(viewer, assignment.slot)
            when assignment.status = pending

    related:
        InterviewDetail(assignment.slot.interview)
            when assignment.slot.interview != null
}
```

Surfaces define contracts at boundaries. The `for` clause names the external party, `context` scopes the entity, `exposes` declares visible data, `requires` declares what the external party must contribute, `provides` declares available capabilities and `related` links to other surfaces. Actor types used in `for` clauses need `actor` declarations with `identified_by` mappings.

### Expressions

Navigation: `interview.candidacy.candidate.email`. Collections: `slots.count`, `slot in invitation.slots`, `interviewers.any(i => i.can_solo)`, `collection.each(item => item.status = cancelled)`. Comparisons: `status = pending`, `count >= 2`, `status in [confirmed, declined]`. Boolean logic: `a and b`, `a or b`, `not a`.

### Modular specs

```
use "github.com/allium-specs/google-oauth/abc123def" as oauth
```

Qualified names reference entities across specs: `oauth/Session`. Coordinates are immutable (git SHAs or content hashes). Local specs use relative paths: `use "./candidacy.allium" as candidacy`.

### Config

```
config {
    invitation_expiry: Duration = 7.days
    max_login_attempts: Integer = 5
}
```

Rules reference config values as `config.invitation_expiry`. For default entity instances, use `default`:

### Defaults

```
default Role viewer = { name: "viewer", permissions: { "documents.read" } }
```

### Deferred specs

```
deferred InterviewerMatching.suggest    -- see: detailed/interviewer-matching.allium
```

### Open questions

```
open_question "Admin ownership - should admins be assigned to specific roles?"
```

## References

- [Language reference](./references/language-reference.md) — full syntax for entities, rules, expressions, surfaces and validation
- [Test generation](./references/test-generation.md) — generating tests from specifications
- [Patterns](./references/patterns.md) — 8 worked patterns: auth, RBAC, invitations, soft delete, notifications, usage limits, comments, library spec integration
