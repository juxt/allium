# Language reference

## File structure

An Allium specification file (`.allium`) contains these sections in order:

```
-- Comments use double-dash
-- use declarations (optional)

------------------------------------------------------------
-- Context
------------------------------------------------------------

-- Entity instances this module operates on (optional)

------------------------------------------------------------
-- External Entities
------------------------------------------------------------

-- Entities managed outside this specification

------------------------------------------------------------
-- Value Types
------------------------------------------------------------

-- Structured data without identity (optional section)

------------------------------------------------------------
-- Entities and Variants
------------------------------------------------------------

-- Entities managed by this specification, plus their variants

------------------------------------------------------------
-- Config
------------------------------------------------------------

-- Configurable parameters for this specification

------------------------------------------------------------
-- Defaults
------------------------------------------------------------

-- Default entity instances

------------------------------------------------------------
-- Rules
------------------------------------------------------------

-- Behavioural rules organised by flow

------------------------------------------------------------
-- Actor Declarations
------------------------------------------------------------

-- Entity types that can interact with surfaces

------------------------------------------------------------
-- Surfaces
------------------------------------------------------------

-- Boundary contracts between parties

------------------------------------------------------------
-- Deferred Specifications
------------------------------------------------------------

-- References to detailed specs defined elsewhere

------------------------------------------------------------
-- Open Questions
------------------------------------------------------------

-- Unresolved design decisions
```

---

## Module context

A `context` block declares the entity instances a module operates on. All rules in the module inherit these bindings.

```
context {
    pipeline: HiringPipeline
    calendar: InterviewCalendar
}
```

Rules then reference `pipeline.status`, `calendar.available_slots`, etc. without ambiguity about what they refer to.

Not every module needs a context block. Rules scoped by triggers on domain entities (e.g., `when: invitation: Invitation.expires_at <= now`) get their entities from the trigger binding. Module context is for specs where rules operate on shared instances that exist once per module scope, such as a pipeline, a catalog or a processing engine.

Context bindings must reference entity types declared in the same module or imported via `use`. Imported module instances are accessed via qualified names (`scheduling/calendar`) and do not need to appear in the local context block. Modules that operate only on imported instances may omit the context block entirely.

This is distinct from surface context, which binds a parametric scope for a boundary contract (e.g., `context assignment: SlotConfirmation`).

---

## Entities

### External entities

Entities referenced but managed outside this specification:

```
external entity Role {
    title: String
    required_skills: Set<Skill>
    location: Location
}
```

External entities define their structure but not their lifecycle. The specification checker will warn when external entities are referenced, reminding that another spec or system governs them.

### Internal entities

```
entity Candidacy {
    -- Fields (required)
    candidate: Candidate
    role: Role
    status: pending | active | completed | cancelled

    -- Relationships (navigate to related entities)
    invitation: Invitation for this candidacy
    slots: InterviewSlot for this candidacy

    -- Projections (filtered subsets)
    confirmed_slots: slots with status = confirmed
    pending_slots: slots with status = pending

    -- Derived (computed values)
    is_ready: confirmed_slots.count >= 3
    has_expired: invitation.expires_at <= now
}
```

### Value types

Structured data without identity. No lifecycle, compared by value not reference. Use for concepts such as time ranges and addresses.

```
value TimeRange {
    start: Timestamp
    end: Timestamp

    -- Derived
    duration: end - start
}

value Location {
    name: String
    timezone: String
    country: String?
}
```

Value types have no identity, are immutable and are embedded within entities. Entities have identity, lifecycle and rules that govern them.

### Sum types

Sum types (discriminated unions) specify that an entity is exactly one of several alternatives, never both, never neither. The type system enforces the constraint.

**Basic syntax:**

```
entity Node {
    path: Path
    kind: Branch | Leaf              -- discriminator field
}

variant Branch : Node {
    children: List<Node?>            -- variant-specific field
}

variant Leaf : Node {
    data: List<Integer>              -- variant-specific fields
    log: List<Integer>
}
```

The sum type declaration has three parts:
1. **Discriminator field**: A field whose type is a pipe-separated list of variant names (e.g., `kind: Branch | Leaf`). The field name can be anything descriptive.
2. **Variant declarations**: Declared using the `variant` keyword with `: BaseEntity` syntax.
3. **Variant-specific fields**: Fields that only exist when that variant is active.

**Distinguishing sum types from enums:**

- **Lowercase** values are enum literals: `status: pending | active | completed`
- **Capitalised** values are variant references: `kind: Branch | Leaf`

The validator checks that capitalised names correspond to `variant` declarations extending the base entity.

**Field inheritance:**

Variants inherit all fields from the base entity:
```
entity Notification {
    user: User                       -- inherited by all variants
    created_at: Timestamp            -- inherited by all variants
    kind: MentionNotification | ShareNotification
}

variant MentionNotification : Notification {
    comment: Comment                 -- variant-specific
    mentioned_by: User               -- variant-specific
}
```

A `MentionNotification` instance has `user`, `created_at`, `kind`, `comment` and `mentioned_by` fields. The discriminator is set automatically.

**Creating variant instances:**

Always create via the variant name, not the base:
```
-- Correct: create via variant
ensures: MentionNotification.created(
    user: recipient,
    comment: comment,
    mentioned_by: author,
    created_at: now
)

-- Invalid: cannot create base entity directly when it has a sum type discriminator
ensures: Notification.created(...)   -- Error: must specify which variant
```

**Type guards:**

A type guard narrows an entity to a specific variant, enabling access to that variant's fields. They appear in two places:

1. **In `requires` clauses**, guarding the entire rule:
```
rule ProcessLeaf {
    when: ProcessNode(node)
    requires: node.kind = Leaf       -- type guard: entire rule assumes Leaf
    ensures: Results.created(data: node.data + node.log)
}
```

2. **In `if` expressions**, guarding a branch:
```
rule ProcessNode {
    when: ProcessNode(node)
    ensures:
        if node.kind = Branch:
            -- node.children accessible here
            for child in node.children:
                ProcessNode(child)
        else:
            -- node.kind = Leaf (exhaustive)
            -- node.data and node.log accessible here
            Results.created(data: node.data + node.log)
}
```

Accessing variant-specific fields outside a type guard is an error:
```
rule Invalid {
    when: ProcessNode(node)
    ensures: node.children.count    -- Error: node.children only accessible when kind = Branch
}
```

**Semantic guarantees:**

- **Exhaustiveness**: All possible variants are declared upfront in the discriminator field
- **Mutual exclusivity**: An entity is exactly one variant
- **Type safety**: Variant-specific fields are only accessible within type guards
- **Automatic discrimination**: The discriminator field is set automatically on creation

**When to use sum types:**

Use when an entity has fundamentally different behaviour or data based on its kind, you need to prevent invalid state combinations, the variants are mutually exclusive by definition, or you want exhaustiveness checking in conditional logic.

Do not use when simple status enums suffice, the variants share most of their structure (consider optional fields), or the distinction is purely implementation-level.

### Field types

**Primitive types:**
- `String` — text
- `Integer` — whole numbers
- `Decimal` — numbers with fractional parts (use for money, percentages)
- `Boolean` — true/false
- `Timestamp` — point in time
- `Duration` — length of time (e.g., `24.hours`, `7.days`)
- `Email` — email address (validated string)
- `URL` — web address (validated string)

**Compound types:**
- `Set<T>` — unordered collection of unique items
- `List<T>` — ordered collection (use when order matters)
- `T?` — optional (may be absent)

**Checking for absent values:**
```
requires: request.reminded_at = null      -- field is absent/unset
requires: request.reminded_at != null     -- field has a value
```

`null` represents the absence of a value for optional fields. It is not a value itself.

**Enumerated types (inline):**
```
status: pending | confirmed | declined | expired
```

**Named enumerations:**
```
enum Recommendation { strong_yes | yes | no | strong_no }
```

**Entity references:**
```
candidate: Candidate
role: Role
```

### Relationships

Always use singular entity names; the relationship name indicates plurality:

```
-- One-to-one (singular relationship name)
invitation: Invitation for this candidacy

-- One-to-many (plural relationship name, but singular entity name)
slots: InterviewSlot for this candidacy
feedback_requests: FeedbackRequest for this interview
```

The `for this X` syntax indicates the foreign key direction without specifying implementation.

### Projections

Named filtered views of relationships:

```
-- Simple status filter
confirmed_slots: slots with status = confirmed

-- Multiple conditions
active_requests: feedback_requests with status = pending and requested_at > cutoff

-- Projection with mapping
confirmed_interviewers: confirmations with status = confirmed -> interviewer
```

The `-> field` syntax extracts a field from each matching entity.

### Derived values

Computed from other fields. Always read-only and automatically updated.

```
-- Boolean derivations
is_valid: interviewers.any(i => i.can_solo) or interviewers.count >= 2
is_expired: expires_at <= now
all_responded: pending_requests.count = 0

-- Value derivations
time_remaining: deadline - now
```

---

## Rules

Rules define behaviour: what happens when triggers occur.

### Rule structure

```
rule RuleName {
    when: TriggerCondition

    let binding1 = expression      -- bindings can appear before requires

    requires: Precondition1
    requires: Precondition2

    let binding2 = expression      -- or between requires and ensures

    ensures: Postcondition1
    ensures: Postcondition2
}
```

| Clause | Purpose |
|--------|---------|
| `when` | What triggers this rule |
| `for` | Iterate: apply the rule body for each element in a collection |
| `let` | Local variable bindings (can appear anywhere after `when`) |
| `requires` | Preconditions that must be true (rule fails if not met) |
| `ensures` | What becomes true after the rule executes |

Place `let` bindings where they make the rule most readable, typically just before the clause that first uses them.

### Rule-level iteration

A `for` clause applies the rule body once per element in a collection. The binding variable is available in all subsequent clauses.

```
rule CreateDailyDigest {
    when: time_of_day = config.digest_time
    for user in Users with notification_settings.digest_enabled = true:
        let settings = user.notification_settings
        requires: today in settings.digest_day_of_week
        ensures: DigestBatch.created(user: user, ...)
}
```

The `with` keyword filters the collection, consistent with projection syntax. The indented body contains the rule's `let`, `requires` and `ensures` clauses scoped to each element.

This is the same `for x in collection:` construct used in ensures blocks and surfaces. The only difference is scope: at rule level it wraps the entire rule body.

### Trigger types

**External stimulus** — action from outside the system:
```
when: AdminApprovesInterviewers(admin, suggestion, interviewers, times)
when: CandidateSelectsSlot(invitation, slot)
```

**Optional parameters** use the `?` suffix:
```
when: InterviewerReportsNoInterview(interviewer, interview, reason, details?)
```

**State transition** — entity changed state:
```
when: interview: Interview.status becomes scheduled
when: confirmation: SlotConfirmation.status becomes confirmed
```

The variable before the colon binds the entity that triggered the transition.

**Temporal** — time-based condition:
```
when: invitation: Invitation.expires_at <= now
when: interview: Interview.slot.time.start - 1.hour <= now
when: request: FeedbackRequest.requested_at + 24.hours <= now
```

Temporal triggers use explicit `var: Type` binding, the same as state transitions and entity creation. The binding names the entity instance and its type. Temporal triggers fire once when the condition becomes true. Always include a `requires` clause to prevent re-firing:
```
rule InvitationExpires {
    when: invitation: Invitation.expires_at <= now
    requires: invitation.status = pending  -- prevents re-firing
    ensures: invitation.status = expired
}
```

**Derived condition becomes true:**
```
when: interview: Interview.all_feedback_in
when: slot: InterviewSlot.is_valid
```

**Entity creation** — fires when a new entity is created:
```
when: batch: DigestBatch.created
when: mention: CommentMention.created
```

**Chained from another rule:**
```
when: AllConfirmationsResolved(candidacy)
```

Rule completions are another trigger type. The triggering rule's name becomes a trigger, and parameters specify what data flows to the chained rule.

### Preconditions (requires)

Preconditions must be true for the rule to execute. If not met, the trigger is rejected.

```
requires: invitation.status = pending
requires: not invitation.is_expired
requires: slot in invitation.slots
requires: interviewer in interview.interviewers
requires:
    interviewers.count >= 2
    or interviewers.any(i => i.can_solo)
```

**Precondition failure behaviour:**
- For external stimulus triggers: The action is rejected; caller receives an error
- For temporal/derived triggers: The rule simply does not fire; no error
- For chained triggers: The chain stops; previous rules' effects still apply

### Local bindings (let)

```
let confirmation = SlotConfirmation{slot, interviewer}
let time_until = interview.slot.time.start - now
let is_urgent = time_until < 24.hours
let is_modified =
    interviewers != suggestion.suggested_interviewers
    or proposed_times != suggestion.suggested_times
```

### Discard bindings

Use `_` where a binding is required syntactically but the value is not needed. Multiple `_` bindings in the same scope do not conflict.

```
when: _: LogProcessor.last_flush_check + flush_timeout_hours <= now
when: SomeEvent(_, slot)
for _ in items: total = total + 1
```

### Postconditions (ensures)

Postconditions describe what becomes true. They are declarative assertions about the resulting state, not imperative commands. All ensures clauses are evaluated against the *resulting* state, after all changes have been applied.

**State changes:**
```
ensures: slot.status = booked
ensures: invitation.status = accepted
ensures: candidacy.retry_count = candidacy.retry_count + 1
```

**Entity creation:**
```
ensures: Interview.created(
    candidacy: invitation.candidacy,
    slot: slot,
    interviewers: slot.confirmed_interviewers,
    status: scheduled
)
```

When creating entities that need to be referenced later in the same ensures block, use explicit `let` binding:
```
ensures:
    let slot = InterviewSlot.created(time: time, candidacy: candidacy, status: pending)
    for interviewer in interviewers:
        SlotConfirmation.created(slot: slot, interviewer: interviewer)
```

**Entity removal:**
```
ensures: not exists target_membership
ensures: not exists CommentMention{comment, user}
```

See [Existence](#existence) in the expression language for the full syntax including bulk removal and the distinction from soft delete.

**Bulk updates:**
```
ensures: invitation.proposed_slots.each(s => s.status = cancelled)
```

**Conditional outcomes:**
```
ensures:
    if candidacy.retry_count < 2:
        candidacy.status = pending_scheduling
    else:
        candidacy.status = scheduling_stalled
        Notification.sent(...)
```

**Communications:**
```
ensures: Notification.sent(
    to: interview.interviewers,
    channel: slack,
    template: interview_booked,
    data: { candidate, time }
)

ensures: Email.sent(
    to: candidate.email,
    template: interview_invitation,
    data: { slots }
)

ensures: CalendarInvite.created(
    attendees: interviewers + candidate,
    time: slot.time,
    duration: interview_type.duration
)

ensures: CandidateInformed(
    candidate: candidacy.candidate,
    about: slot_unavailable,
    with: { available_alternatives: remaining_slots }
)
```

Communications are observable outcomes that matter at the behavioural level, without specifying UI/UX details.

---

## Expression language

### Navigation

```
-- Field access
interview.status
candidate.email

-- Relationship traversal
interview.feedback_requests
candidacy.slots

-- Chained navigation
interview.candidacy.candidate.email
feedback_request.interview.slot.time
```

### Join lookups

For entities that connect two other entities (join tables):

```
let confirmation = SlotConfirmation{slot, interviewer}
let feedback_request = FeedbackRequest{interview, interviewer}
```

Curly braces with field names look up the specific instance where those fields match.

### Collection operations

```
-- Count
slots.count
pending_requests.count

-- Membership
slot in invitation.slots
interviewer in interview.interviewers

-- Any/All (always use explicit lambda)
interviewers.any(i => i.can_solo)
confirmations.all(c => c.status = confirmed)

-- Filtering (in projections)
slots with status = confirmed
requests with status in [submitted, escalated]

-- Iteration
for slot in slots: ...
collection.each(item => item.status = cancelled)

-- Set operations
interviewers.add(new_interviewer)
interviewers.remove(leaving_interviewer)

-- First/last (for ordered collections)
attempts.first
attempts.last
```

### Comparisons

```
status = pending
status != proposed
count >= 2
expires_at <= now
time_until < 24.hours
status in [confirmed, declined, expired]
```

### Arithmetic

```
candidacy.retry_count + 1
interview.slot.time.start - now
feedback_request.requested_at + 24.hours
now + 7.days
```

### Boolean logic

```
interviewers.count >= 2 or interviewers.any(i => i.can_solo)
invitation.status = pending and not invitation.is_expired
not (a or b)  -- equivalent to: not a and not b
```

### Existence

The `exists` keyword checks whether an entity instance exists. Use `not exists` for negation.

```
-- Entity looked up via let binding
let user = User{email}
requires: exists user

-- Join entity lookup
requires: exists WorkspaceMembership{user, workspace}

-- Negation
requires: not exists User{email: email}
requires: not exists ResourceInvitation{resource, email}
```

In `ensures` clauses, `not exists` asserts that an entity has been removed from the system:

```
-- Entity removal
ensures: not exists target_membership
ensures: not exists CommentMention{comment, user}

-- Bulk removal
ensures:
    for d in workspace.deleted_documents:
        not exists d
```

This is distinct from soft delete, which changes a field rather than removing the entity:

```
-- Soft delete (entity still exists, status changes)
ensures: document.status = deleted

-- Hard delete (entity no longer exists)
ensures: not exists document
```

---

## Deferred specifications

Reference detailed specifications defined elsewhere:

```
deferred InterviewerMatching.suggest    -- see: detailed/interviewer-matching.allium
deferred SlotRecovery.initiate          -- see: slot-recovery.allium
```

This allows the main specification to remain succinct while acknowledging that detail exists elsewhere.

---

## Open questions

Capture unresolved design decisions:

```
open_question "Admin ownership - should admins be assigned to specific roles?"
open_question "Multiple interview types - how is type assigned to candidacy?"
```

Open questions are surfaced by the specification checker as warnings, indicating the spec is incomplete.

---

## Config

A `config` block declares configurable parameters for the specification. Each parameter has a name, type and default value.

```
config {
    min_password_length: Integer = 12
    max_login_attempts: Integer = 5
    lockout_duration: Duration = 15.minutes
    reset_token_expiry: Duration = 1.hour
}
```

Rules reference config values with dot notation:

```
requires: password.length >= config.min_password_length
ensures: token.expires_at = now + config.reset_token_expiry
```

External specs declare their own config blocks. Consuming specs configure them via the qualified name:

```
oauth/config {
    session_duration: 8.hours
    link_expiry: 15.minutes
}
```

External config values are referenced as `oauth/config.session_duration`.

For default entity instances (seed data, base configurations), use `default` declarations.

---

## Defaults

Default declarations create named entity instances.

```
default InterviewType = { name: "All in one", duration: 75.minutes }

default Role viewer = {
    name: "viewer",
    permissions: { "documents.read" }
}

default Role editor = {
    name: "editor",
    permissions: { "documents.write" },
    inherits_from: viewer
}
```

---

## Modular specifications

### Namespaces

Namespaces are prefixes that organise names. Use qualified names to reference entities and triggers from other specs:

```
entity Candidacy {
    candidate: Candidate
    authenticated_via: google-oauth/Session
}
```

### Using other specs

The `use` keyword brings in another spec with an alias:

```
use "github.com/allium-specs/google-oauth/abc123def" as oauth
use "github.com/allium-specs/feedback-collection/def456" as feedback

entity Candidacy {
    authenticated_via: oauth/Session
    ...
}
```

Coordinates are immutable references (git SHAs or content hashes), not version numbers. No version resolution algorithms, no lock files. A spec is immutable once published.

### Referencing external entities and triggers

External specs' entities are used directly with qualified names:

```
rule RequestFeedback {
    when: interview: Interview.slot.time.start + 5.minutes <= now
    ensures: feedback/Request.created(
        subject: interview,
        respondents: interview.interviewers,
        deadline: 24.hours
    )
}
```

### Responding to external triggers

Any trigger or state transition from another spec can be responded to. No extension points need to be declared:

```
rule AuditLogin {
    when: oauth/SessionCreated(session)
    ensures: AuditLog.created(event: login, user: session.user)
}

rule NotifyOnFeedbackSubmitted {
    when: feedback/Request.status becomes submitted
    ensures: Notification.sent(to: Admin.all, template: feedback_received)
}
```

### Configuration

Imported specs expose their own config parameters. Consuming specs set values via the qualified name:

```
use "github.com/allium-specs/google-oauth/abc123def" as oauth

oauth/config {
    session_duration: 8.hours
    link_expiry: 15.minutes
}
```

Reference external config values as `oauth/config.session_duration`. This uses the same `config` mechanism as local config blocks (see [Config](#config)).

### Breaking changes

Breaking changes should be avoided. Instead:
- **Accrete**: Add new fields, triggers, states. Do not remove or rename.
- **New name for new thing**: If a breaking change is necessary, publish under a new name (`google-oauth-2`) rather than a new version.

Consumers update at their own pace. Old coordinates remain valid forever.

### Local specs

For specs within the same project, use relative paths:

```
use "./candidacy.allium" as candidacy
use "./scheduling.allium" as scheduling
```

External entities in one spec may be internal entities in another. The boundary is determined by the `external` keyword, not by file location.

---

## Surfaces

A surface defines a contract at a boundary. A boundary exists wherever two parties interact: a user and an application, a framework and its domain modules, a service and its consumers. Each surface names the boundary and specifies what each party exposes, requires and provides.

Surfaces serve two purposes:
- **Documentation**: Capture expectations about what each party sees, must contribute and can use
- **Test generation**: Generate tests that verify the implementation honours the contract

Surfaces do not specify implementation details (database schemas, wire protocols, thread models, UI layout). They specify the behavioural contract both sides must honour.

### Actor declarations

When a surface has a specific external party, declare actor types:

```
actor User {
    identified_by: session.user
}

actor Interviewer {
    identified_by: User with role = interviewer
}

actor Admin {
    identified_by: User with role = admin
}

actor Candidate {
    identified_by: Candidacy.candidate
}
```

The `identified_by` expression maps an actor type to the entity or condition that identifies them.

For integration surfaces where the external party is code rather than a person, the `for` clause may name a logical role without a formal actor declaration.

### Surface structure

```
surface SurfaceName {
    for party: ActorType [with predicate]

    context item: EntityType [with predicate]

    let binding = expression

    exposes:
        item.field [when condition]
        for x in collection:
            x.field [when condition]
        ...

    requires:
        contribution [when condition]
        ...

    provides:
        Capability(party, item, ...) [when condition]
        for x in collection:
            Capability(party, x, ...) [when condition]
        ...

    invariant: ConstraintName
        -- description

    guidance:
        -- non-normative advice

    related:
        OtherSurface(item.relationship) [when condition]
        for x in collection:
            OtherSurface(x.relationship) [when condition]
        ...
}
```

The names `party` and `item` are user-chosen variable names, not reserved keywords. All clauses are optional. Use what the boundary needs.

| Clause | Purpose |
|--------|---------|
| `for` | Who is on the other side of the boundary |
| `context` | What entity or scope this surface applies to |
| `let` | Local bindings, same as in rules |
| `exposes` | What is visible across the boundary |
| `requires` | What the external party must contribute |
| `provides` | What the system offers |
| `invariant` | Constraints that must hold across the boundary |
| `guidance` | Non-normative implementation advice |
| `related` | Navigation to other surfaces |

### Example

```
surface InterviewerDashboard {
    for viewer: Interviewer

    context assignment: SlotConfirmation with interviewer = viewer

    exposes:
        assignment.slot.time
        assignment.slot.candidacy.candidate.name
        assignment.status
        assignment.slot.other_confirmations.interviewer.name

    provides:
        InterviewerConfirmsSlot(viewer, assignment.slot)
            when assignment.status = pending
        InterviewerDeclinesSlot(viewer, assignment.slot)
            when assignment.status = pending

    related:
        InterviewDetail(assignment.slot.interview)
            when assignment.slot.interview != null
}
```

---

## Validation rules

A valid Allium specification must satisfy:

**Structural validity:**
1. All referenced entities and values exist (internal, external or imported)
2. All entity fields have defined types
3. All relationships reference valid entities (singular names)
4. All rules have at least one trigger and at least one ensures clause
5. All triggers are valid (external stimulus, state transition, entity creation, temporal, derived or chained)

**State machine validity:**
6. All status values are reachable via some rule
7. All non-terminal status values have exits
8. No undefined states: rules cannot set status to values not in the enum

**Expression validity:**
9. No circular dependencies in derived values
10. All variables are bound before use
11. Type consistency in comparisons and arithmetic
12. All lambdas are explicit (use `i => i.field` not `field`)

**Sum type validity:**
13. Sum type discriminators use the pipe syntax with capitalised variant names (`A | B | C`)
14. All names in a discriminator field must be declared as `variant X : BaseEntity`
15. All variants that extend a base entity must be listed in that entity's discriminator field
16. Variant-specific fields are only accessed within type guards (`requires:` or `if` branches)
17. Base entities with sum type discriminators cannot be instantiated directly
18. Discriminator field names are user-defined (e.g., `kind`, `node_type`), no reserved name
19. The `variant` keyword is required for variant declarations

**Context validity:**
20. Context bindings must reference entity types declared in the module or imported via `use`
21. Each binding name must be unique within the context block
22. Unqualified instance references in rules must resolve to a context binding, a `let` binding, a trigger parameter or a default entity instance

**Config validity:**
23. Config parameters must have explicit types and default values
24. Config parameter names must be unique within the config block
25. References to `config.field` in rules must correspond to a declared parameter in the local config block or a qualified external config (`alias/config.field`)

**Surface validity:**
26. Actor types in `for` clauses should have corresponding `actor` declarations when the external party is an entity type
27. All fields referenced in `exposes` must exist on the context entity, be reachable via relationships, or be declared types from imported specifications
28. All triggers referenced in `provides` must be defined as external stimulus triggers in rules
29. All surfaces referenced in `related` must be defined
30. Bindings in `for` and `context` clauses must be used consistently throughout the surface
31. `when` conditions must reference valid fields reachable from the party or context bindings
32. `for` iterations must iterate over collection-typed fields
33. Named `requires` and `provides` blocks must have unique names within the surface

The checker should warn (but not error) on:
- External entities without known governing specification
- Open questions
- Deferred specifications without location hints
- Unused entities or fields
- Rules that can never fire (preconditions always false)
- Temporal rules without guards against re-firing
- Surfaces that reference fields not used by any rule (may indicate dead code)
- Items in `provides` with `when` conditions that can never be true
- Actor declarations that are never used in any surface
- Named `requires` blocks with no corresponding deferred specification or implementation

---

## Anti-patterns

**Implementation leakage:**
```
-- Bad
let request = FeedbackRequest.find(interview_id, interviewer_id)

-- Good
let request = FeedbackRequest{interview, interviewer}
```

**UI/UX in spec:**
```
-- Bad
ensures: Button.displayed(label: "Confirm", onClick: ...)

-- Good
ensures: CandidateInformed(about: options_available, with: { slots })
```

**Algorithm in rules:**
```
-- Bad
ensures: selected = interviewers.sortBy(load).take(3).filter(available)

-- Good
ensures: Suggestion.created(
    interviewers: InterviewerMatching.suggest(considering: [...])
)
```

**Queries in rules:**
```
-- Bad
let pending = SlotConfirmation.where(slot: slot, status: pending)

-- Good
let pending = slot.pending_confirmations
```

**Implicit shorthand in lambdas:**
```
-- Bad
interviewers.any(can_solo)

-- Good
interviewers.any(i => i.can_solo)
```

**Missing temporal guards:**
```
-- Bad: can fire repeatedly
rule InvitationExpires {
    when: invitation: Invitation.expires_at <= now
    ensures: invitation.status = expired
}

-- Good: guard prevents re-firing
rule InvitationExpires {
    when: invitation: Invitation.expires_at <= now
    requires: invitation.status = pending
    ensures: invitation.status = expired
}
```

**Overly broad status enums:**
```
-- Bad
status: draft | pending | active | paused | resumed | completed |
        cancelled | expired | archived | deleted

-- Good
status: pending | active | completed | cancelled
is_archived: Boolean
```

**Magic numbers in rules:**
```
-- Bad
requires: attempts < 3
ensures: deadline = now + 48.hours

-- Good
requires: attempts < config.max_attempts
ensures: deadline = now + config.confirmation_deadline
```

---

## Glossary

| Term | Definition |
|------|------------|
| **Context (module)** | Entity instances a module operates on; inherited by all rules in the module |
| **Context (surface)** | Parametric scope binding for a boundary contract |
| **Entity** | A domain concept with identity and lifecycle |
| **Value** | Structured data without identity, compared by structure |
| **Sum Type** | A type constraint specifying an entity is exactly one of several variants, declared via a discriminator field (e.g., `kind: A \| B \| C`) |
| **Discriminator** | A field on a base entity whose type is a pipe-separated list of variant names; automatically set when creating variants |
| **Variant** | One of the alternatives in a sum type, declared with the `variant` keyword (e.g., `variant A : Base { ... }`) |
| **Type Guard** | A condition (`requires:` or `if` branch) that narrows an entity to a specific variant, enabling access to variant-specific fields |
| **External Entity** | An entity managed by another specification |
| **Field** | Data stored on an entity or value |
| **Relationship** | Navigation from one entity to related entities |
| **Projection** | A filtered view of a relationship |
| **Derived Value** | A computed value based on other fields |
| **Rule** | A specification of behaviour triggered by some condition |
| **Trigger** | The condition that causes a rule to fire |
| **Precondition** | A requirement that must be true for a rule to execute |
| **Postcondition** | An assertion about what becomes true after a rule executes |
| **Deferred Specification** | Complex logic defined in a separate file |
| **Open Question** | An unresolved design decision |
| **Config** | Configurable parameters for a specification, referenced via `config.field` |
| **Default** | A named entity instance used as seed data or base configuration |
| **Exists** | Keyword for checking entity existence (`exists x`) or asserting removal (`not exists x`) |
| **Discard Binding** | `_` used where a binding is syntactically required but the value is not needed |
| **Actor** | An entity type that can interact with surfaces, declared with explicit identity mapping |
| **Surface** | A named boundary contract between two parties, specifying what each side exposes, requires and provides |
