# Language reference

## File structure

An Allium specification file (`.allium`) contains these sections in order:

```
-- Comments use double-dash
-- use declarations (optional)

------------------------------------------------------------
-- Given
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
-- Enumerations
------------------------------------------------------------

-- Named enumerations shared across entities (optional section)

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

### Formatting

Indentation is significant. Blocks opened by a colon (`:`) after `for`, `if`, `else`, `ensures`, `exposes`, `provides`, `expects`, `related`, `timeout`, `guarantee` and `guidance` are delimited by consistent indentation relative to the parent clause. Comments use `--`. Commas may be used as field separators for single-line entity and value type declarations; newlines are the standard separator for multi-line declarations.

### Naming conventions

- **PascalCase**: entity names, variant names, rule names, trigger names, actor names, surface names (`InterviewSlot`, `CandidateSelectsSlot`)
- **snake_case**: field names, config parameters, derived values, enum literals, relationship names (`expires_at`, `max_login_attempts`, `pending`)
- **Entity collections**: natural English plurals of the entity name (`Users`, `Documents`, `Candidacies`)

---

## Module given

A `given` block declares the entity instances a module operates on. All rules in the module inherit these bindings.

```
given {
    pipeline: HiringPipeline
    calendar: InterviewCalendar
}
```

Rules then reference `pipeline.status`, `calendar.available_slots`, etc. without ambiguity about what they refer to.

Not every module needs a `given` block. Rules scoped by triggers on domain entities (e.g., `when: invitation: Invitation.expires_at <= now`) get their entities from the trigger binding. `given` is for specs where rules operate on shared instances that exist once per module scope, such as a pipeline, a catalog or a processing engine.

`given` bindings must reference entity types declared in the same module or imported via `use`. Imported module instances are accessed via qualified names (`scheduling/calendar`) and do not need to appear in the local `given` block. Modules that operate only on imported instances may omit the `given` block entirely.

This is distinct from surface `context`, which binds a parametric scope for a boundary contract (e.g., `context assignment: SlotConfirmation`).

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

External entities can also serve as **type placeholders**: an entity with minimal or no fields that the consuming spec substitutes with a concrete type. This enables reusable patterns where the library spec depends on an abstraction and the consumer provides the implementation.

```
-- In a comments library spec
external entity Commentable {}

entity Comment {
    parent: Commentable
    ...
}

-- The consuming spec provides its own entity as the Commentable
```

The consuming spec maps its entity to the placeholder by using it wherever the library expects the placeholder type. This is dependency inversion at the spec level: the library depends on the abstraction, the consumer supplies the concrete type.

### Internal entities

```
entity Candidacy {
    -- Fields (required)
    candidate: Candidate
    role: Role
    status: pending | active | completed | cancelled

    -- Relationships (navigate to related entities)
    invitation: Invitation with candidacy = this
    slots: InterviewSlot with candidacy = this

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

Sum types (discriminated unions) specify that an entity is exactly one of several alternatives.

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

A sum type has three parts: a **discriminator field** whose type is a pipe-separated list of variant names, **variant declarations** using `variant X : BaseEntity`, and **variant-specific fields** that only exist for that variant. Variants inherit all fields from the base entity; the discriminator is set automatically on creation.

**Distinguishing sum types from enums:** lowercase values are enum literals (`status: pending | active`), capitalised values are variant references (`kind: Branch | Leaf`). The validator checks that capitalised names correspond to `variant` declarations.

**Creating variant instances** — always via the variant name, not the base:

```
ensures: MentionNotification.created(user: recipient, comment: comment, mentioned_by: author)
-- Not: Notification.created(...)  -- Error: must specify which variant
```

**Type guards** narrow an entity to a specific variant, enabling access to its fields. They appear in `requires` clauses (guarding the entire rule) and `if` expressions (guarding a branch):

```
-- requires guard: entire rule assumes Leaf
rule ProcessLeaf {
    when: ProcessNode(node)
    requires: node.kind = Leaf
    ensures: Results.created(data: node.data + node.log)
}

-- if guard: branch-level narrowing
rule ProcessNode {
    when: ProcessNode(node)
    ensures:
        if node.kind = Branch:
            for child in node.children: ProcessNode(child)
        else:
            Results.created(data: node.data + node.log)
}
```

Accessing variant-specific fields outside a type guard is an error. Sum types guarantee exhaustiveness (all variants declared upfront), mutual exclusivity (exactly one variant), type safety (variant fields only within guards) and automatic discrimination (set on creation).

A `.created` trigger on the base entity fires when any variant is created. The bound variable holds the specific variant instance, and type guards can narrow it:

```
rule HandleNotification {
    when: notification: Notification.created
    ensures:
        if notification.kind = MentionNotification:
            ...
}
```

Use sum types when variants have fundamentally different data or behaviour. Do not use when simple status enums suffice or variants share most of their structure.

### Field types

**Primitive types:**
- `String` — text
- `Integer` — whole numbers. Underscores are ignored in numeric literals for readability: `100_000_000`
- `Decimal` — numbers with fractional parts (use for money, percentages)
- `Boolean` — `true` or `false`
- `Timestamp` — point in time. The built-in value `now` evaluates to the current timestamp.
- `Duration` — length of time, written as a numeric literal with a unit suffix: `.seconds`, `.minutes`, `.hours`, `.days`, `.weeks`, `.months`, `.years` (e.g., `24.hours`, `7.days`, `30.seconds`). Both singular and plural forms are valid: `1.hour` and `24.hours`.

Primitive types have no properties or methods. For domain-specific string types (email addresses, URLs), use value types or plain `String` fields with descriptive names. For operations on primitives beyond the built-in operators, use black box functions (e.g., `length(password)`, `hash(password)`).

**Compound types:**
- `Set<T>` — unordered collection of unique items
- `List<T>` — ordered collection (use when order matters)
- `T?` — optional (may be absent)

**Checking for absent values:**
```
requires: request.reminded_at = null      -- field is absent/unset
requires: request.reminded_at != null     -- field has a value
```

`null` represents the absence of a value for optional fields.

`field = null` and `field != null` are presence checks, not comparisons. `field = null` is true when the field is absent; `field != null` is true when the field has a value. Comparisons with null produce false: `null <= now` is false, `null > 0` is false. Arithmetic with null produces null: `null + 1.day` is null. This means temporal triggers on optional fields (e.g., `when: user: User.next_digest_at <= now`) do not fire when the field is absent.

**Enumerated types (inline):**
```
status: pending | confirmed | declined | expired
```

**Named enumerations:**
```
enum Recommendation { strong_yes | yes | no | strong_no }
enum DayOfWeek { monday | tuesday | wednesday | thursday | friday | saturday | sunday }
```

Named enumerations define a reusable set of values. Declare them in the Enumerations section of the file. Reference them as field types: `recommendation: Recommendation`. Inline enums (`status: pending | active`) are equivalent but anonymous; use named enums when the same set of values appears in multiple fields or entities.

Inline enum values are compared structurally: the literal `pending` is the same value regardless of which inline enum it appears in. Two fields with inline enums can be compared if they share at least one value; the comparison is valid for shared values and always false for values that exist in one enum but not the other. Named enums are distinct types: a field typed `Recommendation` cannot be compared with a field typed `DayOfWeek`, even if they happen to share a literal.

**Entity references:**
```
candidate: Candidate
role: Role
```

### Relationships

Always use singular entity names; the relationship name indicates plurality:

```
-- One-to-one (singular relationship name)
invitation: Invitation with candidacy = this

-- One-to-many (plural relationship name, but singular entity name)
slots: InterviewSlot with candidacy = this
feedback_requests: FeedbackRequest with interview = this

-- Self-referential
replies: Comment with reply_to = this
```

The `with X = this` syntax declares a relationship by naming the field on the related entity that points back. `this` refers to the enclosing entity instance. The syntax is the same whether the relationship is one-to-one, one-to-many or self-referential.

The relationship name determines the cardinality:

- **Singular name** (e.g., `invitation`) — at most one related entity. The value is the entity instance, or `null` if none exists. Equivalent to `T?`. If multiple entities match a singular relationship, the specification is in error and the checker should report it.
- **Plural name** (e.g., `slots`) — zero or more related entities. The value is a collection, empty if none exist.

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

The `-> field` syntax extracts a field from each matching entity. When the extracted field is optional (`T?`), null values are excluded from the result: the projection produces `Set<T>`, not `Set<T?>`.

### Derived values

Computed from other fields. Always read-only and automatically updated.

```
-- Boolean derivations
is_valid: interviewers.any(i => i.can_solo) or interviewers.count >= 2
is_expired: expires_at <= now
all_responded: pending_requests.count = 0

-- Value derivations
time_remaining: deadline - now

-- Parameterised derived values
can_use_feature(f): f in plan.features
has_permission(p): p in role.effective_permissions
```

Parameters are locally scoped to the expression. Parameterised derived values cannot reference module `given` bindings or global state; they operate only on the entity's own fields and their parameter. No side effects.

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
rule ProcessDigests {
    when: schedule: DigestSchedule.next_run_at <= now
    for user in Users with notification_setting.digest_enabled:
        let settings = user.notification_setting
        ensures: DigestBatch.created(user: user, ...)
}
```

The `with` keyword filters the collection, consistent with projection syntax. The indented body contains the rule's `let`, `requires` and `ensures` clauses scoped to each element.

This is the same `for x in collection:` construct used in ensures blocks and surfaces. The only difference is scope: at rule level it wraps the entire rule body.

### Multiple rules for the same trigger

When multiple rules share a trigger, their `requires` clauses determine which fires. If preconditions overlap such that multiple rules could match simultaneously, this is a spec ambiguity. The specification checker should warn when rules with the same trigger have overlapping preconditions.

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
when: interview: Interview.status transitions_to scheduled
when: confirmation: SlotConfirmation.status transitions_to confirmed
```

The variable before the colon binds the entity that triggered the transition. `transitions_to` fires when a field transitions to the specified value from a different value, not on initial entity creation (use `.created` for that). It is valid for enum fields, boolean fields and entity reference fields.

**State reached** — entity has a value, whether by creation or transition:
```
when: interview: Interview.status reaches scheduled
```

`reaches` fires both when an entity is created with the specified value and when a field transitions to that value from a different value. Like `transitions_to`, it is valid for enum fields, boolean fields and entity reference fields. It is equivalent to writing a `transitions_to` rule and a `.created` rule with a `requires` guard, combined into a single trigger. Use `reaches` when the rule should apply regardless of how the entity arrived at the state. Use `transitions_to` when the rule should only apply to transitions (e.g., sending a "rescheduled" notification that doesn't apply on initial creation).

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

Derived condition triggers fire when the value transitions from false to true, the same semantics as temporal triggers. If the derived value could revert to false and become true again, include a `requires` clause to prevent re-firing, just as with temporal triggers.

**Entity creation** — fires when a new entity is created:
```
when: batch: DigestBatch.created
when: mention: CommentMention.created
```

**Chained from another rule's trigger emission:**
```
when: AllConfirmationsResolved(candidacy)
```

A rule chains from another by subscribing to a trigger emission. The emitting rule includes the event in an ensures clause:

```
ensures: AllConfirmationsResolved(candidacy: candidacy)
```

The receiving rule subscribes via its `when` clause. This uses the same syntax as external stimulus triggers, but the stimulus comes from another rule rather than from outside the system.

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
for _ in items: Counted(batch)
```

### Postconditions (ensures)

Postconditions describe what becomes true. They are declarative assertions about the resulting state, not imperative commands.

In state change assignments (`entity.field = expression`), the expression on the right references pre-rule field values. This avoids circular definitions: `user.count = user.count + 1` means the resulting count equals the original count plus one. Conditions within ensures blocks (`if` guards, creation parameters, trigger emission parameters) reference the resulting state as defined by the state changes. A `let` binding within an ensures block introduces a name visible to all subsequent statements in that block.

Worked example: suppose `account.balance` is 100 before the rule fires.

```
ensures: account.balance = account.balance + 50       -- RHS reads pre-rule value: 100 + 50 = 150
ensures:
    if account.balance > 120:                          -- condition reads resulting state: 150 > 120, true
        Notification.created(account: account, type: high_balance)
```

The assignment reads 100 (the pre-rule value). The `if` guard reads 150 (the resulting state after the assignment).

Ensures clauses have four forms:

**State changes** — modify an existing entity's fields:
```
ensures: slot.status = booked
ensures: invitation.status = accepted
ensures: candidacy.retry_count = candidacy.retry_count + 1
ensures: user.locked_until = null              -- clearing an optional field
```

Setting an optional field to `null` asserts the field becomes absent. Only valid for fields typed as optional (`T?`).

**Entity creation** — create a new entity using `.created()`:
```
ensures: Interview.created(
    candidacy: invitation.candidacy,
    slot: slot,
    interviewers: slot.confirmed_interviewers,
    status: scheduled
)

ensures: Email.created(
    to: candidate.email,
    template: interview_invitation,
    data: { slots: slots }
)

ensures: CalendarInvite.created(
    attendees: interviewers + candidate,
    time: slot.time,
    duration: interview_type.duration
)
```

Entity creation uses `.created()` exclusively. Domain meaning lives in entity names and rule names, not in creation verbs. `Email.created(...)` not `Email.sent(...)`.

When creating entities that need to be referenced later in the same ensures block, use explicit `let` binding:
```
ensures:
    let slot = InterviewSlot.created(time: time, candidacy: candidacy, status: pending)
    for interviewer in interviewers:
        SlotConfirmation.created(slot: slot, interviewer: interviewer)
```

A `let` binding within an ensures block is visible to all subsequent statements in that block, including nested `for` loops. It does not leak outside the ensures block.

**Trigger emission** — emit a named event that other rules can chain from:
```
ensures: CandidateInformed(
    candidate: candidacy.candidate,
    about: slot_unavailable,
    data: { available_alternatives: remaining_slots }
)

ensures: UserMentioned(user: mention.user, comment: comment, mentioned_by: author)
ensures: FeatureUsed(workspace: workspace, feature: feature, by: user)
```

Trigger emissions are observable outcomes, not entity creation. They have no `.created()` call and are referenced by other rules' `when` clauses. Parameter values follow normal expression resolution: bound names are resolved first, then enum literals if the parameter has a declared type on the receiving rule. Bare identifiers that resolve to neither a binding nor an enum literal are a checker warning.

**Entity removal:**
```
ensures: not exists target_membership
ensures: not exists CommentMention{comment, user}
```

See [Existence](#existence) in the expression language for the full syntax including bulk removal and the distinction from soft delete.

**Bulk updates:**
```
ensures:
    for s in invitation.proposed_slots:
        s.status = cancelled
```

**Conditional outcomes:**
```
ensures:
    if candidacy.retry_count < 2:
        candidacy.status = pending_scheduling
    else:
        candidacy.status = scheduling_stalled
        Notification.created(...)
```

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

-- Optional navigation (short-circuits to null if left side is null)
inherits_from?.effective_permissions
reply_to?.author

-- Null coalescing (provides default when left side is null)
identity.timezone ?? "UTC"
inherits_from?.effective_permissions ?? {}

-- Self-reference
this                                        -- the instance being defined or identified
replies: Comment with reply_to = this       -- all Comments whose reply_to is this entity
```

`this` refers to the instance of the enclosing type. It is valid in two contexts:

- **Entity declarations**: `this` is the current entity instance. Available in relationships, projections and derived values.
- **Actor `identified_by` expressions**: `this` is the entity instance being tested for actor membership (see [Actor declarations](#actor-declarations)).

### Join lookups

For entities that connect two other entities (join tables):

```
let confirmation = SlotConfirmation{slot, interviewer}
let feedback_request = FeedbackRequest{interview, interviewer}
```

Curly braces with field names look up the specific instance where those fields match. Any number of fields can be specified. Each name serves as both the field name on the entity and the local variable whose value is matched. The lookup must match at most one entity; if the fields do not uniquely identify a single instance, the specification is ambiguous and the checker should report an error. If no entity matches, the binding is null. Use `exists` to test whether a lookup matched before accessing fields on it; accessing fields on a null binding is an error.

When the local variable name differs from the field name, use the explicit form:

```
let actor_membership = WorkspaceMembership{user: actor, workspace: workspace}
let share = ResourceShare{resource: resource, user: inviter}
requires: not exists User{email: new_email}
```

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

-- Filtering (in projections and expressions)
slots with status = confirmed
requests with status in {submitted, escalated}

-- Iteration (introduces a scope block)
for slot in slots: ...

-- Set mutation (ensures-only, modifies a relationship)
interviewers.add(new_interviewer)
interviewers.remove(leaving_interviewer)

-- Set arithmetic (expression-level, produces a new set)
all_permissions: permissions + inherited_permissions
removed_mentions: old_mentions - new_mentions

-- First/last (for ordered collections)
attempts.first
attempts.last
```

`.add()` and `.remove()` are ensures-only mutations on a relationship. Set `+` and `-` are expression-level operations that produce new sets without mutating anything.

### Comparisons

```
status = pending
status != proposed
count >= 2
expires_at <= now
time_until < 24.hours
status in {confirmed, declined, expired}
provider not in user.linked_providers
```

`{value1, value2, ...}` is a set literal used with `in` and `not in` for membership tests. This is the same set literal syntax used in field declarations and expressions.

### Arithmetic

```
candidacy.retry_count + 1
interview.slot.time.start - now
feedback_request.requested_at + 24.hours
now + 7.days
recent_failures.count / config.window_sample_size
price * quantity
```

Four operators: `+`, `-`, `*`, `/`. Standard precedence: `*` and `/` bind tighter than `+` and `-`. Use parentheses to override. Arithmetic involving null produces null (e.g., `null + 1.day` is null). Derived values computed from optional fields are implicitly optional.

### Boolean logic

```
interviewers.count >= 2 or interviewers.any(i => i.can_solo)
invitation.status = pending and not invitation.is_expired
not (a or b)  -- equivalent to: not a and not b
```

`and` and `or` short-circuit left to right. If the left operand of `or` is true, the right operand is not evaluated; if the left operand of `and` is false, the right operand is not evaluated. This permits patterns like `not exists x or not x.is_valid`, where the right side is only reached when `x` exists.

### Conditional expressions

```
-- Inline (single values)
email_status: if settings.email_on_mention = never: skipped else: pending
thread_depth: if is_reply: reply_to.thread_depth + 1 else: 0

-- Block (multiple outcomes)
ensures:
    if candidacy.retry_count < 2:
        candidacy.status = pending_scheduling
    else:
        candidacy.status = scheduling_stalled
        Notification.created(...)
```

Both forms use the same `if condition: ... else: ...` syntax. The inline form is for single-value assignments only. If either branch needs multiple statements or entity creation, use block form. Omit `else` when only the true branch has an effect.

Multi-branch conditionals use `else if`:

```
let preference =
    if notification.kind = MentionNotification: settings.email_on_mention
    else if notification.kind = ReplyNotification: settings.email_on_comment
    else if notification.kind = ShareNotification: settings.email_on_share
    else: immediately
```

Each `else if` adds a branch. The final `else` provides a fallback.

`exists` can also be used as a condition in `if` expressions, not just in `requires`:

```
ensures:
    if exists existing:
        not exists existing
    else:
        CommentReaction.created(comment: comment, user: user, emoji: emoji)
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

### Literals

```
-- Set literals
permissions: { "documents.read", "documents.write" }
features: { basic_editing, api_access }

-- Object literals (anonymous records, used in creation parameters and trigger emissions)
data: { candidate: candidate, time: time }
data: { slots: remaining_slots }
data: { unlocks_at: user.locked_until }
```

Object literals are anonymous record types. They carry named fields but have no declared type. Use them for ad-hoc data in entity creation parameters and trigger emission payloads where defining a named type would add ceremony without clarity.

### Black box functions

Black box functions represent domain logic too complex or algorithmic for the spec level. They appear in expressions and their behaviour is described by comments or deferred specifications.

```
hash(password)                              -- black box
verify(password, user.password_hash)        -- black box
parse_mentions(body)                        -- black box: extracts @username
next_digest_time(user)                      -- black box: uses digest_day_of_week
```

Black box functions are pure (no side effects) and deterministic for the same inputs within a rule execution.

### The `with` keyword

`with` applies a predicate to select a subset. It appears in relationships, projections, surface context, actor identification, iteration and surface `let` bindings. The underlying operation is always predicated subsetting, but the input differs: in a relationship declaration (`InterviewSlot with candidacy = this`), the input is the universe of all instances of that entity type and the predicate defines the structural link. In all other positions (projections, iteration, surface context, surface `let` bindings), the input is an existing collection and the predicate filters it.

```
-- Relationships
slots: InterviewSlot with candidacy = this

-- Projections
slots with status = confirmed

-- Surface context
context assignment: SlotConfirmation with interviewer = viewer

-- Actor identification
User with role = admin

-- Iteration
for user in Users with notification_setting.digest_enabled:

-- Surface let binding (filtering an entity collection)
let comments = Comments with parent = parent and status = active
```

`with` predicates support the same expression language as `requires` clauses: field navigation (including chained), comparisons, arithmetic, boolean combinators (`and`, `or`, `not`), bare boolean expressions and `in` for set membership. `with notification_setting.digest_enabled` and `with notification_setting.digest_enabled = true` are equivalent.

### Entity collections

The pluralised type name refers to all instances of that entity:

```
for user in Users with notification_setting.digest_enabled:
    ...
```

`Users` means all instances of `User`. Use natural English plurals: `Users`, `Documents`, `Workspaces`, `Candidacies`.

Entity collections are typically used in rule-level `for` clauses and surface `let` bindings to iterate or filter across all instances of a type.

---

## Deferred specifications

Reference detailed specifications defined elsewhere:

```
deferred InterviewerMatching.suggest    -- see: detailed/interviewer-matching.allium
deferred SlotRecovery.initiate          -- see: slot-recovery.allium
```

This allows the main specification to remain succinct while acknowledging that detail exists elsewhere.

Deferred specifications are invoked at call sites using dot notation. They can appear as standalone ensures clauses or as expressions that return a value:

```
-- Standalone invocation (the deferred spec handles the outcome)
ensures: InterviewerMatching.suggest(candidacy)

-- Expression usage (the deferred spec returns a value)
ensures: OnCallPaged(team: EscalationPolicy.at_level(level), priority: immediate)
```

Unlike black box functions, which model opaque external computations, deferred specifications represent Allium logic that is fully specified elsewhere. The deferred declaration signals that the detail exists and is maintained separately.

---

## Open questions

Capture unresolved design decisions:

```
open question "Admin ownership - should admins be assigned to specific roles?"
open question "Multiple interview types - how is type assigned to candidacy?"
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
requires: length(password) >= config.min_password_length
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

Default declarations create named entity instances that exist unconditionally. They are available to all rules and surfaces without requiring creation by any rule.

```
default InterviewType all_in_one = { name: "All in one", duration: 75.minutes }

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
    when: feedback/Request.status transitions_to submitted
    ensures:
        for admin in Users with role = admin:
            Notification.created(to: admin, template: feedback_received)
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

Avoid breaking changes: accrete (add new fields, triggers, states; never remove or rename). If a breaking change is necessary, publish under a new name rather than a new version. Consumers update at their own pace; old coordinates remain valid forever.

### Local specs

For specs within the same project, use relative paths:

```
use "./candidacy.allium" as candidacy
use "./scheduling.allium" as scheduling
```

External entities in one spec may be internal entities in another. The boundary is determined by the `external` keyword, not by file location.

---

## Surfaces

A surface defines a contract at a boundary. A boundary exists wherever two parties interact: a user and an application, a framework and its domain modules, a service and its consumers. Each surface names the boundary and specifies what each party exposes, expects and provides.

Surfaces serve two purposes:
- **Documentation**: Capture expectations about what each party sees, must contribute and can use
- **Test generation**: Generate tests that verify the implementation honours the contract

Surfaces do not specify implementation details (database schemas, wire protocols, thread models, UI layout). They specify the behavioural contract both sides must honour.

### Actor declarations

When a surface has a specific external party, declare actor types:

```
actor Interviewer {
    identified_by: User with role = interviewer
}

actor Admin {
    identified_by: User with role = admin
}

actor AuthenticatedUser {
    identified_by: User with active_sessions.count > 0
}
```

The `identified_by` expression specifies the entity type and condition that identifies the actor. It takes the form `EntityType with condition`, where the condition uses the entity's own fields, derived values and relationships. When an actor type is used in a `facing` clause, the binding variable has the entity type from the actor's `identified_by` expression. For example, `facing viewer: Interviewer` where `Interviewer` has `identified_by: User with role = interviewer` binds `viewer` as type `User`.

When an actor's identity depends on a context that varies per surface, declare the expected context type with a `within` clause and reference it in `identified_by`:

```
actor WorkspaceAdmin {
    within: Workspace
    identified_by: User with WorkspaceMembership{user: this, workspace: within}.can_admin = true
}
```

The `within` clause declares the entity type this actor requires from the surface's `context` binding. This makes the dependency explicit: the checker can verify that any surface using this actor provides a compatible context.

Two keywords are available inside `identified_by`:

- `this` — the entity instance being tested (here, the User). Same semantics as `this` in entity declarations.
- `within` — the entity bound by the `context` clause of the surface that uses this actor, constrained to the type declared in the actor's `within` clause.

```
surface WorkspaceManagement {
    facing admin: WorkspaceAdmin
    context workspace: Workspace    -- matches WorkspaceAdmin's within: Workspace
    ...
}
```

An actor declaration with a `within` clause can only be used in surfaces that declare a `context` clause. The surface's context type must match the actor's declared `within` type.

The `facing` clause accepts either an actor type or an entity type directly. Use actor declarations when the boundary has specific identity requirements (e.g., `WorkspaceAdmin` requires admin membership). Use entity types directly when any instance of that entity can interact (e.g., `facing visitor: User` for a public-facing surface). For integration surfaces where the external party is code rather than a person, declare an actor type with a minimal `identified_by` expression rather than leaving the type undeclared.

### Surface structure

```
surface SurfaceName {
    facing party: ActorType
    context item: EntityType [with predicate]
    let binding = expression

    exposes:
        item.field [when condition]
        ...

    expects:
        contribution [when condition]
        ...

    provides:
        Action(party, item, ...) [when condition]
        ...

    guarantee: ConstraintName
    guidance: -- non-normative advice

    related:
        OtherSurface(item.relationship) [when condition]
        ...

    timeout:
        RuleName when temporal_condition
}
```

Variable names (`party`, `item`) are user-chosen, not reserved keywords. All clauses are optional.

| Clause | Purpose |
|--------|---------|
| `facing` | Who is on the other side of the boundary |
| `context` | What entity or scope this surface applies to (one surface instance per matching entity; absent when no entity matches) |
| `let` | Local bindings, same as in rules |
| `exposes` | Visible data (supports `for` iteration over collections) |
| `expects` | What the external party must contribute (surface-wide data the party must supply) |
| `provides` | Available operations with optional when-guards (parameters are per-action inputs from the party) |
| `guarantee` | Constraints that must hold across the boundary |
| `guidance` | Non-normative implementation advice |
| `related` | Associated surfaces reachable from this one; the parenthesised expression evaluates to the entity instance that the target surface's `context` clause binds to, and its type must match the target surface's context type |
| `timeout` | Surface-scoped temporal triggers |

Each entry in surface `expects` is a bare name representing data the external party must supply, optionally followed by `when condition` to make it conditional (e.g., `email`, `password`, `new_password when token.is_valid`).

### Examples

```
surface InterviewerPendingAssignments {
    facing viewer: Interviewer

    context assignment: InterviewAssignment
        with interviewer = viewer and status = pending

    exposes:
        assignment.interview.scheduled_time
        assignment.interview.candidate.name
        assignment.interview.duration

    provides:
        InterviewerConfirmsAssignment(viewer, assignment)
        InterviewerDeclinesAssignment(viewer, assignment, reason?)
}
```

```
surface InterviewerDashboard {
    facing viewer: Interviewer

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

**Timeout example** — binding a temporal trigger to the surface's context:

```
surface InvitationView {
    facing recipient: Candidate

    context invitation: ResourceInvitation with email = recipient.email

    exposes:
        invitation.resource.name
        invitation.is_valid

    provides:
        AcceptInvitation(invitation, recipient) when invitation.is_valid

    timeout:
        InvitationExpires when invitation.expires_at <= now
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
5. All triggers are valid (external stimulus, state transition, state reached, entity creation, temporal, derived or chained)
6. All rules sharing a trigger name must use the same parameter count and positional types. Parameter binding names may differ between rules. Optional parameters (typed `T?`) may be omitted at call sites; omitted optional parameters bind to `null`

**State machine validity:**
7. All status values are reachable via some rule
8. All non-terminal status values have exits
9. No undefined states: rules cannot set status to values not in the enum

**Expression validity:**
10. No circular dependencies in derived values
11. All variables are bound before use
12. Type consistency in comparisons and arithmetic
13. All lambdas are explicit (use `i => i.field` not `field`)

**Sum type validity:**
14. Sum type discriminators use the pipe syntax with capitalised variant names (`A | B | C`)
15. All names in a discriminator field must be declared as `variant X : BaseEntity`
16. All variants that extend a base entity must be listed in that entity's discriminator field
17. Variant-specific fields are only accessed within type guards (`requires:` or `if` branches)
18. Base entities with sum type discriminators cannot be instantiated directly
19. Discriminator field names are user-defined (e.g., `kind`, `node_type`), no reserved name
20. The `variant` keyword is required for variant declarations

**Given validity:**
21. `given` bindings must reference entity types declared in the module or imported via `use`
22. Each binding name must be unique within the `given` block
23. Unqualified instance references in rules must resolve to a `given` binding, a `let` binding, a trigger parameter or a default entity instance

**Config validity:**
24. Config parameters must have explicit types and default values
25. Config parameter names must be unique within the config block
26. References to `config.field` in rules must correspond to a declared parameter in the local config block or a qualified external config (`alias/config.field`)

**Surface validity:**
27. Types in `facing` clauses must be either a declared `actor` type or a valid entity type (internal, external or imported)
28. All fields referenced in `exposes` must be reachable from bindings declared in the surface (`facing`, `context`, `let`), via relationships, or be declared types from imported specifications
29. All triggers referenced in `provides` must be defined as external stimulus triggers in rules
30. All surfaces referenced in `related` must be defined, and the type of the parenthesised expression must match the target surface's `context` type
31. Bindings in `facing` and `context` clauses must be used consistently throughout the surface
32. `when` conditions must reference valid fields reachable from the party or context bindings
33. `for` iterations must iterate over collection-typed fields or bindings and are valid in block scopes that produce per-item content (`exposes`, `provides`, `related`)
34. Every name in `expects` must appear as a parameter name in at least one `provides` entry in the same surface
35. `expects` names that appear in multiple `provides` entries must have the same parameter type across all entries; conflicting types make the surface contract ill-defined

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
- Rules whose ensures creates an entity for a parent, where sibling rules on the same parent don't guard against that entity's existence
- Surface `provides` when-guards weaker than the corresponding rule's requires
- Rules with the same trigger and overlapping preconditions (spec ambiguity)
- Parameterised derived values that reference fields outside the entity (scoping violation)
- Actor `identified_by` expressions that are trivially always-true or always-false
- Rules where all ensures clauses are conditional and at least one execution path produces no effects
- Temporal triggers on optional fields (trigger will not fire when the field is null)

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
ensures: CandidateInformed(about: options_available, data: { slots: slots })
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

**`transitions_to` doesn't fire on creation:**
```
-- Bad: won't fire when Interview is created with status = scheduled
rule NotifyOnScheduled {
    when: interview: Interview.status transitions_to scheduled
    ensures: Email.created(to: interview.candidate.email, template: interview_scheduled)
}

-- Good: use reaches when the rule should fire regardless of how the state was reached
rule NotifyOnScheduled {
    when: interview: Interview.status reaches scheduled
    ensures: Email.created(to: interview.candidate.email, template: interview_scheduled)
}

-- Also good: handle creation and transition separately when the response differs
rule NotifyOnRescheduled {
    when: interview: Interview.status transitions_to scheduled
    ensures: Email.created(to: interview.candidate.email, template: interview_rescheduled)
}

rule NotifyOnCreatedScheduled {
    when: interview: Interview.created
    requires: interview.status = scheduled
    ensures: Email.created(to: interview.candidate.email, template: interview_scheduled)
}
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
| **Given (module)** | Entity instances a module operates on, declared with `given { ... }`; inherited by all rules in the module |
| **Context (surface)** | Parametric scope binding for a boundary contract, declared with `context` inside a surface |
| **Entity** | A domain concept with identity and lifecycle |
| **Value** | Structured data without identity, compared by structure |
| **Sum Type** | Entity constrained to exactly one of several variants via a discriminator field |
| **Discriminator** | Field whose pipe-separated capitalised values name the variants |
| **Variant** | One alternative in a sum type, declared with `variant X : Base { ... }` |
| **Type Guard** | Condition (`requires:` or `if`) that narrows to a variant, unlocking its fields |
| **Field** | Data stored on an entity or value |
| **Relationship** | Navigation from one entity to related entities |
| **Projection** | A filtered view of a relationship |
| **Derived Value** | A computed value based on other fields |
| **Parameterised Derived Value** | A derived value that takes arguments, e.g. `can_use_feature(f): f in plan.features` |
| **Rule** | A specification of behaviour triggered by some condition |
| **Trigger** | The condition that causes a rule to fire |
| **Trigger Emission** | An ensures clause that emits a named event; other rules chain from it via their `when` clause |
| **Precondition** | A requirement that must be true for a rule to execute |
| **Postcondition** | An assertion about what becomes true after a rule executes |
| **Black Box Function** | Domain logic referenced but not defined in the spec; pure and deterministic |
| **External Entity** | An entity managed by another specification; referenced but not governed here |
| **Config** | Configurable parameters for a specification, referenced via `config.field` |
| **Default** | A named entity instance used as seed data or base configuration |
| **Deferred Specification** | Complex logic defined in a separate file |
| **Open Question** | An unresolved design decision |
| **Entity Collection** | Pluralised type name referring to all instances of that entity (e.g., `Users` for all `User` instances) |
| **Exists** | Keyword for checking entity existence (`exists x`) or asserting removal (`not exists x`) |
| **`within`** | Clause in actor declarations that names the required context type; also a keyword in `identified_by` expressions that resolves to the surface's context entity |
| **`this`** | The instance of the enclosing type; valid in entity declarations and actor `identified_by` expressions |
| **Enum** | A named set of values, reusable across fields and entities |
| **Discard Binding** | `_` used where a binding is syntactically required but the value is not needed |
| **Actor** | An entity type that can interact with surfaces, declared with explicit identity mapping |
| **`facing`** | Surface clause naming the external party on the other side of the boundary |
| **`expects`** | Surface clause declaring data the external party must supply (bare names, not boolean expressions) |
| **Surface** | A boundary contract between two parties specifying what each side exposes, expects and provides |
