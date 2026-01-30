---
name: allium
description: Allium behavioural specification language for capturing domain requirements
auto_trigger:
  - file_patterns: ["**/*.allium"]
  - keywords: ["allium", "allium spec", "allium specification", ".allium file"]
---

# Allium - Product Specification Language

## Overview

Allium is a formal language for capturing software behaviour at the domain level. It sits between informal feature descriptions and implementation, providing a precise way to specify what software does without prescribing how it's built.

The name comes from the botanical family containing onions and shallots, continuing a tradition in behaviour specification tooling established by Cucumber and Gherkin.

**Key principles:**
- Describes observable behaviour, not implementation
- Captures domain logic that matters at the behavioural level
- Generates integration and end-to-end tests (not unit tests)
- Forces ambiguities into the open before implementation
- Implementation-agnostic: the same spec could be implemented in any language

**Allium does NOT specify:**
- Programming language or framework choices
- Database schemas or storage mechanisms
- API designs or UI layouts
- Internal algorithms (unless they're domain-level concerns)

---

## How to Use These Guides

This skill includes four documents. Which one you need depends on what you're trying to do.

**If the user is describing a feature or behaviour they want to build**, start with [ELICITATION.md](./ELICITATION.md). This guide covers how to extract a specification through conversation: finding the right abstraction level, identifying entities and rules, surfacing implicit decisions and recognising when behaviour should be captured in a library spec rather than written from scratch. The elicitation process typically moves through phases, from scoping the domain to the happy path, then edge cases, then refinement.

**If the user has existing code and wants to extract a specification from it**, start with [REVERSE_ENGINEERING.md](./REVERSE_ENGINEERING.md). This guide covers how to read implementation code and produce an Allium specification that captures the behaviour without the implementation details. It includes worked examples in Python, TypeScript and Java, along with techniques for identifying implicit state machines and scattered business logic, and for distinguishing essential behaviour from implementation accident.

**If you're writing a specification and need examples of common patterns**, consult [PATTERNS.md](./PATTERNS.md). This document provides complete worked examples for authentication, role-based access control, invitations, soft delete, notification preferences, usage limits and comments with mentions, along with integration patterns for library specs such as OAuth and payment processing.

**If you need the language syntax reference**, continue reading this document. The Language Reference section below covers file structure, entities, rules, triggers, expressions and validation rules.

---

## Language Reference

### File Structure

An Allium specification file (`.allium`) contains these sections in order:

```
-- Comments use double-dash

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
-- Defaults
------------------------------------------------------------

-- Default values for entities

------------------------------------------------------------
-- Rules
------------------------------------------------------------

-- Behavioural rules organised by flow

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

### Entities

Entities represent the domain concepts that matter to the system's behaviour.

#### External Entities

Entities referenced but managed outside this specification:

```
external entity Role {
    title: String
    required_skills: Set<Skill>
    location: Location
}
```

External entities define their structure but not their lifecycle. The specification checker will warn when external entities are referenced, reminding that another spec or system governs them.

#### Internal Entities

Entities fully managed by this specification:

```
entity Candidacy {
    -- Fields (required)
    candidate: Candidate
    role: Role
    status: pending | active | completed | cancelled
    retry_count: Integer
    
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

**Entity components:**

| Component | Syntax | Purpose |
|-----------|--------|---------|
| Field | `name: Type` | Data the entity holds |
| Relationship | `name: Entity for this entity` | Navigate to related entities |
| Projection | `name: relationship with condition` | Filtered subset of relationship |
| Derived | `name: expression` | Computed boolean or value |

#### Value Types

Value types are structured data without identity. Unlike entities, they have no lifecycle and are compared by value, not reference. Use value types for concepts such as time ranges and addresses.

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

**When to use value types vs entities:**
- **Entity**: Has identity, lifecycle, can be referenced, has rules that govern it
- **Value**: No identity, immutable, embedded within entities, compared by structure

#### Sum Types

Sum types (also known as discriminated unions or tagged unions) specify that an entity is exactly one of several alternatives - never both, never neither. This is more precise than nullable fields or string tags because the type system itself enforces the constraint.

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
1. **Discriminator field**: A field on the base entity whose type is a pipe-separated list of variant names (e.g., `kind: Branch | Leaf`). The field name can be anything descriptive (`kind`, `node_type`, etc.).
2. **Variant declarations**: Variants are declared using the `variant` keyword (not `entity`) and specify which base entity they belong to using the `: BaseEntity` syntax.
3. **Variant-specific fields**: Fields declared on variants that only exist when that variant is active.

**Distinguishing sum types from enums:**

The pipe syntax is used for both enums and sum types. The distinction is:
- **Lowercase** values are enum literals: `status: pending | active | completed`
- **Capitalised** values are variant references: `kind: Branch | Leaf`

The validator checks that capitalised names in a discriminator field correspond to `variant` declarations that extend the base entity. If they don't exist or aren't declared as variants, it's an error.

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

A `MentionNotification` instance has `user`, `created_at`, `kind`, `comment`, and `mentioned_by` fields. The discriminator field `kind` is also inherited and is automatically set to `MentionNotification` when creating that variant.

**Creating variant instances:**

Always create instances using the variant entity name, not the base:
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

The discriminator field is set automatically based on which variant you create.

**Type guards:**

A type guard is a condition that narrows an entity to a specific variant, enabling access to that variant's fields. Type guards can appear in two places:

1. **In `requires` clauses** - guards the entire rule:
```
rule ProcessLeaf {
    when: ProcessNode(node)
    requires: node.kind = Leaf       -- type guard: entire rule assumes Leaf
    ensures: Results.created(data: node.data + node.log)
}
```

2. **In `if` expressions** - guards a branch:
```
rule ProcessNode {
    when: ProcessNode(node)
    ensures:
        if node.kind = Branch:
            -- node.children accessible here
            for each child in node.children:
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

Sum types provide several guarantees that improve correctness:

- **Exhaustiveness**: All possible variants are declared upfront in the discriminator field
- **Mutual exclusivity**: An entity is exactly one variant - never both, never neither
- **Type safety**: Variant-specific fields are only accessible within appropriate type guards
- **Automatic discrimination**: The discriminator field is set automatically on creation

**When to use sum types:**

Use sum types when:
- An entity has fundamentally different behaviour or data based on its kind
- You need to prevent invalid state combinations
- The variants are mutually exclusive by definition
- You want exhaustiveness checking in conditional logic

Don't use sum types when:
- Simple status enums are sufficient (`status: pending | active | completed`)
- The variants share most of their structure (consider optional fields instead)
- The distinction is purely implementation-level, not domain-level

**Common patterns:**

**Result types** - operations that succeed or fail:
```
entity ProcessingResult {
    kind: Success | Failure
}

variant Success : ProcessingResult {
    data: List<Record>
    processed_count: Integer
}

variant Failure : ProcessingResult {
    error_message: String
    retry_after: Duration?
}
```

**Notification types** - different kinds of notifications:
```
entity Notification {
    recipient: User
    created_at: Timestamp
    kind: MentionNotification | ShareNotification | SystemNotification
}

variant MentionNotification : Notification {
    comment: Comment
    mentioned_by: User
}

variant ShareNotification : Notification {
    resource: Resource
    shared_by: User
    permission: view | edit | admin
}

variant SystemNotification : Notification {
    title: String
    body: String
}
```

**Tree structures** - nodes that are either branches or leaves:
```
entity TreeNode {
    depth: Integer
    kind: Branch | Leaf
}

variant Branch : TreeNode {
    children: List<TreeNode>
}

variant Leaf : TreeNode {
    value: String
}
```

#### Field Types

**Primitive types:**
- `String` - text
- `Integer` - whole numbers
- `Decimal` - numbers with fractional parts (use for money, percentages)
- `Boolean` - true/false
- `Timestamp` - point in time
- `Duration` - length of time (e.g., `24.hours`, `7.days`)
- `Email` - email address (validated string)
- `URL` - web address (validated string)

**Compound types:**
- `Set<T>` - unordered collection of unique items
- `List<T>` - ordered collection (use when order matters)
- `T?` - optional (may be absent)

**Checking for absent values:**
```
requires: request.reminded_at = null      -- field is absent/unset
requires: request.reminded_at != null     -- field has a value
```

Note: `null` represents the absence of a value for optional fields. It is not a value itself.

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

#### Relationships

Relationships define how entities connect. Always use singular entity names; the relationship name indicates plurality:

```
-- One-to-one (singular relationship name)
invitation: Invitation for this candidacy

-- One-to-many (plural relationship name, but singular entity name)
slots: InterviewSlot for this candidacy
feedback_requests: FeedbackRequest for this interview
```

The "for this X" syntax indicates the foreign key direction without specifying implementation.

#### Projections

Projections are named filtered views of relationships:

```
-- Simple status filter
confirmed_slots: slots with status = confirmed

-- Multiple conditions
active_requests: feedback_requests with status = pending and requested_at > cutoff

-- Projection with mapping
confirmed_interviewers: confirmations with status = confirmed -> interviewer
```

The `-> field` syntax extracts a field from each matching entity.

#### Derived Values

Derived values are computed from other fields. They are always read-only and automatically updated.

```
-- Boolean derivations
is_valid: interviewers.any(i => i.can_solo) or interviewers.count >= 2
is_expired: expires_at <= now
all_responded: pending_requests.count = 0

-- Value derivations
time_remaining: deadline - now
```

---

### Rules

Rules define behaviour: what happens when triggers occur.

#### Rule Structure

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
| `let` | Local variable bindings (can appear anywhere after `when`) |
| `requires` | Preconditions that must be true (rule fails if not met) |
| `ensures` | What becomes true after the rule executes |

**Note on `let` placement:** Bindings can appear anywhere after the `when` clause. Place them where they make the rule most readable - typically just before the clause that first uses them. Common patterns:
- Before `requires` when computing values needed for precondition checks
- After `requires` when computing values only needed in `ensures`

#### Trigger Types

**External stimulus** - action from outside the system:
```
when: AdminApprovesInterviewers(admin, suggestion, interviewers, times)
when: CandidateSelectsSlot(invitation, slot)
when: InterviewerSubmitsFeedback(interviewer, interview, recommendation, notes)
```

**Optional parameters** in triggers use the `?` suffix:
```
when: InterviewerReportsNoInterview(interviewer, interview, reason, details?)
```
Optional parameters may be absent when the trigger fires. Use `parameter = null` in rules to check for absence.

**State transition** - entity changed state:
```
when: interview: Interview.status becomes scheduled
when: confirmation: SlotConfirmation.status becomes confirmed
```

The variable before the colon (e.g., `interview:`) binds the entity that triggered the transition, making it available throughout the rule.

**Temporal** - time-based condition:
```
when: invitation.expires_at <= now
when: interview.slot.time.start - 1.hour <= now
when: feedback_request.requested_at + 24.hours <= now
```

Temporal triggers fire once when the condition becomes true. **Important:** Always include a `requires` clause to prevent re-firing:
```
rule InvitationExpires {
    when: invitation.expires_at <= now
    requires: invitation.status = pending  -- prevents re-firing
    ensures: invitation.status = expired
}
```

**Derived condition becomes true:**
```
when: interview.all_feedback_in
when: slot.is_valid
```

**Entity creation** - fires when a new entity is created:
```
when: batch: DigestBatch.created
when: mention: CommentMention.created
```

The variable before the colon binds the newly created entity for use in the rule.

**Chained from another rule:**
```
when: AllConfirmationsResolved(candidacy)
```

Rule completions are just another trigger type. The triggering rule's name becomes a trigger, and parameters specify what data flows to the chained rule. This unifies chaining with external stimulus syntax.

#### Preconditions (requires)

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
- For temporal/derived triggers: The rule simply doesn't fire; no error
- For chained triggers: The chain stops; previous rules' effects still apply

#### Local Bindings (let)

Bind values for use in ensures clauses:

```
let confirmation = SlotConfirmation{slot, interviewer}
let time_until = interview.slot.time.start - now
let is_urgent = time_until < 24.hours
let is_modified = 
    interviewers != suggestion.suggested_interviewers 
    or proposed_times != suggestion.suggested_times
```

#### Postconditions (ensures)

Postconditions describe what becomes true. They are declarative assertions about the resulting state, not imperative commands.

**Evaluation semantics:** All ensures clauses are evaluated against the *resulting* state, after all changes have been applied. If you modify a field and check it, you check the new value.

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
    for each interviewer in interviewers:
        SlotConfirmation.created(slot: slot, interviewer: interviewer)
```

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

### Expression Language

#### Navigation

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

#### Join Lookups

For entities that connect two other entities (join tables):

```
let confirmation = SlotConfirmation{slot, interviewer}
let feedback_request = FeedbackRequest{interview, interviewer}
```

Curly braces with field names look up the specific instance where those fields match.

#### Collection Operations

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
for each slot in slots: ...
collection.each(item => item.status = cancelled)

-- Set operations
interviewers.add(new_interviewer)
interviewers.remove(leaving_interviewer)

-- First/last (for ordered collections)
attempts.first
attempts.last
```

#### Comparisons

```
status = pending
status != proposed
count >= 2
expires_at <= now
time_until < 24.hours
status in [confirmed, declined, expired]
```

#### Arithmetic

```
candidacy.retry_count + 1
interview.slot.time.start - now
feedback_request.requested_at + 24.hours
now + 7.days
```

#### Boolean Logic

```
interviewers.count >= 2 or interviewers.any(i => i.can_solo)
invitation.status = pending and not invitation.is_expired
not (a or b)  -- equivalent to: not a and not b
```

---

### Deferred Specifications

Reference detailed specifications defined elsewhere:

```
deferred InterviewerMatching.suggest    -- see: detailed/interviewer-matching.allium
deferred SlotRecovery.initiate          -- see: slot-recovery.allium
```

This allows the main specification to remain succinct while acknowledging that detail exists elsewhere.

---

### Open Questions

Capture unresolved design decisions:

```
open_question "Admin ownership - should admins be assigned to specific roles?"
open_question "Multiple interview types - how is type assigned to candidacy?"
```

Open questions are surfaced by the specification checker as warnings, indicating the spec is incomplete.

---

### Defaults

Define default values:

```
default InterviewType = { name: "All in one", duration: 75.minutes }
default retry_limit = 2
default invitation_expiry = 7.days
```

---

### Modular Specifications

#### Namespaces

Namespaces are just prefixes that organise names. Use qualified names to reference entities and triggers from other specs:

```
entity Candidacy {
    candidate: Candidate
    authenticated_via: google-oauth/Session
}
```

#### Using Other Specs

The `use` keyword brings in another spec with an alias:

```
use "github.com/allium-specs/google-oauth/abc123def" as oauth
use "github.com/allium-specs/feedback-collection/def456" as feedback

entity Candidacy {
    authenticated_via: oauth/Session
    ...
}
```

Coordinates are immutable references (git SHAs or content hashes), not version numbers. This means:
- No version resolution algorithms
- No lock files needed
- A spec is immutable once published

#### Referencing External Entities and Triggers

External specs' entities are just entities - use them directly with qualified names:

```
rule RequestFeedback {
    when: interview.slot.time.start + 5.minutes <= now
    ensures: feedback/Request.created(
        subject: interview,
        respondents: interview.interviewers,
        deadline: 24.hours
    )
}
```

#### Responding to External Triggers

Any trigger or state transition from another spec can be responded to. No "extension points" need to be declared - if it's observable, you can react to it:

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

#### Configuration

Some specs need configuration. Config is just data:

```
use "github.com/allium-specs/google-oauth/abc123def" as oauth

oauth/config {
    session_duration: 8.hours
    link_expiry: 15.minutes
}
```

The external spec reads these values. No special binding mechanism - just a map of values.

#### Breaking Changes

Breaking changes should be avoided. Instead:
- **Accrete**: Add new fields, triggers, states - don't remove or rename
- **New name for new thing**: If a breaking change is necessary, publish under a new name (`google-oauth-2`) rather than a new version

This means consumers can update at their own pace, and old coordinates remain valid forever.

#### Local Specs

For specs within the same project, use relative paths:

```
use "./candidacy.allium" as candidacy
use "./scheduling.allium" as scheduling
```

External entities in one spec may be internal entities in another - the boundary is determined by the `external` keyword, not by file location.

---

## Validation Rules

A valid Allium specification must satisfy:

**Structural validity:**
1. All referenced entities and values exist (internal, external or imported)
2. All entity fields have defined types
3. All relationships reference valid entities (singular names)
4. All rules have at least one trigger and at least one ensures clause
5. All triggers are valid (external stimulus, state transition, entity creation, temporal, derived or chained)

**State machine validity:**
6. All status values are reachable - every status can be reached via some rule
7. All non-terminal status values have exits - every non-terminal status has a rule that transitions out
8. No undefined states - rules cannot set status to values not in the enum

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
17. Base entities with sum type discriminators cannot be instantiated directly - must use a variant
18. Discriminator field names are user-defined (e.g., `kind`, `node_type`) - there is no reserved name
19. The `variant` keyword is required for variant declarations - using `entity` for a type that extends another entity with a discriminator is an error

The checker should warn (but not error) on:
- External entities without known governing specification
- Open questions
- Deferred specifications without location hints
- Unused entities or fields
- Rules that can never fire (preconditions always false)
- Temporal rules without guards against re-firing

---

## Test Generation

From an Allium specification, generate:

**Contract tests** (per rule):
- Success case: all preconditions met, verify all postconditions hold
- Failure cases: one test per precondition, verify rule is rejected when that precondition fails
- Edge cases: boundary values for numeric conditions

**State transition tests** (per entity with status):
- Valid transitions succeed via their rules
- Invalid transitions are rejected (no rule allows them)
- Terminal states have no outbound transitions

**Temporal tests** (per time-based trigger):
- Before deadline: rule doesn't fire, state unchanged
- At deadline: rule fires, postconditions hold
- After deadline: rule has already fired, doesn't re-fire

**Communication tests** (per Notification/Email/etc):
- Verify communication is triggered
- Verify recipient is correct
- Verify template and data are passed

**Scenario tests** (per flow):
- Happy path through main flow
- Edge cases and error paths
- Concurrent scenarios: what happens if two triggers fire simultaneously?

**Sum type tests** (per sum type):
- Type discrimination: verify each variant has distinct accessible fields
- Exhaustiveness: verify all variants are handled in conditional logic
- Invalid state prevention: verify that an entity cannot be multiple variants
- Type guard correctness: verify variant-specific fields are only accessible within appropriate type guards

**Concurrency note:** Rules are assumed to be atomic - a rule either completes entirely or not at all. If two rules could fire simultaneously on the same entity, test that the resulting state is consistent regardless of order.

---

## Anti-Patterns to Avoid

**Implementation leakage:**
```
-- Bad: describes how to find data
let request = FeedbackRequest.find(interview_id, interviewer_id)

-- Good: describes what data we need
let request = FeedbackRequest{interview, interviewer}
```

**UI/UX in spec:**
```
-- Bad: describes interface
ensures: Button.displayed(label: "Confirm", onClick: ...)

-- Good: describes communication
ensures: CandidateInformed(about: options_available, with: { slots })
```

**Algorithm in rules:**
```
-- Bad: specifies algorithm
ensures: selected = interviewers.sortBy(load).take(3).filter(available)

-- Good: defers to detailed spec
ensures: Suggestion.created(
    interviewers: InterviewerMatching.suggest(considering: [...])
)
```

**Queries in rules:**
```
-- Bad: inline query
let pending = SlotConfirmation.where(slot: slot, status: pending)

-- Good: projection on entity
let pending = slot.pending_confirmations
```

**Implicit shorthand in lambdas:**
```
-- Bad: implicit field access
interviewers.any(can_solo)

-- Good: explicit lambda
interviewers.any(i => i.can_solo)
```

**Missing temporal guards:**
```
-- Bad: can fire repeatedly
rule InvitationExpires {
    when: invitation.expires_at <= now
    ensures: invitation.status = expired
}

-- Good: guard prevents re-firing
rule InvitationExpires {
    when: invitation.expires_at <= now
    requires: invitation.status = pending
    ensures: invitation.status = expired
}
```

**Overly broad status enums:**
```
-- Bad: too many states, hard to track
status: draft | pending | active | paused | resumed | completed |
        cancelled | expired | archived | deleted

-- Good: minimal states, separate boolean fields for flags
status: pending | active | completed | cancelled
is_archived: Boolean
```

**Magic numbers in rules:**
```
-- Bad: hardcoded values
requires: attempts < 3
ensures: deadline = now + 48.hours

-- Good: use defaults
requires: attempts < max_attempts
ensures: deadline = now + confirmation_deadline
```

---

## Glossary

| Term | Definition |
|------|------------|
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
| **Default** | A configurable value used in rules |
