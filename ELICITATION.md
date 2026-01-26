# Allium Elicitation Guide

## Overview

This guide is for building Allium specifications through conversation with stakeholders or engineers. The goal is to extract domain knowledge, surface ambiguities, and produce a specification that captures what the software does without prescribing implementation.

**The same principles apply to reverse engineering.** Whether you're hearing a stakeholder describe a feature or reading code that implements it, the challenge is identical: finding the right level of abstraction. See REVERSE_ENGINEERING.md for guidance on extracting specs from existing codebases - it uses the same tests and strategies described here.

---

## Scoping the Specification

Before diving into details, establish what you're specifying. Not everything needs to be in one spec.

### Questions to Ask First

1. **"What's the boundary of this specification?"**
   - A complete system? A single feature area? One service in a larger system?
   - Be explicit about what's in and out of scope

2. **"Are there areas we should deliberately exclude?"**
   - Third-party integrations might be library specs (see below)
   - Legacy features might not be worth specifying
   - Some features might belong in separate specs

3. **"Is this a new system or does code already exist?"**
   - If code exists, you're doing reverse engineering with elicitation
   - Existing code constrains what's realistic to specify
   - See REVERSE_ENGINEERING.md for guidance on partial codebase specs

### Documenting Scope Decisions

Capture scope at the start of every spec:

```
-- interview-scheduling.allium

-- Scope: Interview scheduling for the hiring pipeline
-- Includes: Candidacy, Interview, Slot management, Invitations, Feedback
-- Excludes:
--   - Authentication (use oauth library spec)
--   - Payments (not applicable)
--   - Reporting dashboards (separate spec)
-- Dependencies: User entity defined in core.allium
```

---

## Finding the Right Level of Abstraction

The hardest part of specification is choosing what to include and what to leave out. Too concrete and you're specifying implementation; too abstract and you're not saying anything useful.

### The "Why" Test

For every detail, ask: **"Why does the stakeholder care about this?"**

| Detail | Why? | Include? |
|--------|------|----------|
| "Users log in with Google OAuth" | They need to authenticate | Maybe not - "Users authenticate" might be sufficient |
| "We support Google and Microsoft OAuth" | Users choose their provider | Yes - the choice is domain-level |
| "Sessions expire after 24 hours" | Security/UX decision | Yes - affects user experience |
| "Sessions are stored in Redis" | Performance | No - implementation detail |
| "Passwords must be 12+ characters" | Security policy | Yes - affects users |
| "Passwords are hashed with bcrypt" | Security implementation | No - how, not what |

### The "Could It Be Different?" Test

Ask: **"Could this be implemented differently while still being the same system?"**

- If yes → probably implementation detail, abstract it away
- If no → probably domain-level, include it

Examples:
- "Notifications sent via Slack" - Could be email, SMS, etc. → Abstract to `Notification.sent(channel: ...)`
- "Interviewers must confirm within 3 hours" - This specific deadline matters at the domain level → Include the duration
- "We use PostgreSQL" - Could be any database → Don't include
- "Data is retained for 7 years for compliance" - Regulatory requirement → Include

### The "Template vs Instance" Test

Is this a **category** of thing, or a **specific instance**?

| Instance (implementation) | Template (domain-level) |
|---------------------------|-------------------------|
| Google OAuth | Authentication provider |
| Slack | Notification channel |
| 15 minutes | Link expiry duration (configurable) |
| Greenhouse ATS | External candidate source |

But sometimes the instance IS the domain concern:
- "We specifically integrate with Salesforce" (competitive feature)
- "We support exactly these three OAuth providers" (design scope)

When in doubt, ask the stakeholder: **"If we changed this, would it be a different system or just a different implementation?"**

### Levels of Abstraction

```
Too abstract:          "Users can do things"
                              ↓
Product level:         "Candidates can accept or decline interview invitations"
                              ↓  
Too concrete:          "Candidates click a button that POST to /api/invitations/:id/accept"
```

**Signs you're too abstract:**
- The spec could describe almost any system
- No testable assertions
- Product owner says "but that doesn't capture..."

**Signs you're too concrete:**
- You're mentioning technologies, frameworks, or APIs
- You're describing UI elements (buttons, pages, forms)
- Implementation team says "why are you dictating how we build this?"

### Configuration vs Hardcoding

When you encounter a specific value (3 hours, 7 days, etc.), ask:

1. **Is this value a design decision?** → Include it
2. **Might it vary per deployment/customer?** → Make it configurable
3. **Is it arbitrary?** → Consider whether to include at all

```
-- Hardcoded design decision
rule InvitationExpires {
    when: invitation.created_at + 7.days <= now
    ...
}

-- Configurable
config {
    invitation_expiry: Duration = 7.days
}

rule InvitationExpires {
    when: invitation.created_at + config/invitation_expiry <= now
    ...
}
```

### Black Boxes

Some logic is important but belongs at a different level:

```
-- Black box: we know it exists and what it considers, but not how
ensures: Suggestion.created(
    interviewers: InterviewerMatching.suggest(
        considering: {
            role.required_skills,
            Interviewer.skills,
            Interviewer.availability,
            Interviewer.recent_load
        }
    )
)
```

The spec says:
- There is a matching algorithm
- It considers these inputs
- It produces interviewer suggestions

The spec does NOT say:
- How matching works
- What weights are used
- The specific algorithm

This is the right level when:
- The algorithm is complex and evolving
- Product owners care about inputs and outputs, not internals
- A separate detailed spec could cover it if needed

---

## Elicitation Methodology

### Phase 1: Scope Definition

**Goal:** Understand what we're specifying and where the boundaries are.

**Questions to ask:**

1. "What is this system fundamentally about? In one sentence?"
2. "Where does this system start and end? What's in scope vs out?"
3. "Who are the users? Are there different roles?"
4. "What are the main things being managed - the nouns?"
5. "Are there existing systems this integrates with? What do they handle?"

**Outputs:**
- List of actors/roles
- List of core entities
- Boundary decisions (what's external)
- One-sentence description

**Watch for:**
- Scope creep - "and it also does X, Y, Z" → gently refocus
- Assumed knowledge - "obviously it handles auth" → make explicit

### Phase 2: Happy Path Flow

**Goal:** Trace the main journey from start to finish.

**Questions to ask:**

1. "Walk me through a typical [X] from start to finish"
2. "What happens first? Then what?"
3. "What triggers this? A user action? Time passing? Something else?"
4. "What changes when that happens? What state is different?"
5. "Who needs to know when this happens? How?"

**Technique:** Follow one entity through its lifecycle

```
Candidacy: 
  pending_scheduling → scheduling_in_progress → scheduled → 
  interview_complete → feedback_collected → decided
```

**Outputs:**
- State machines for key entities
- Main triggers and their outcomes
- Communication touchpoints

**Watch for:**
- Jumping to edge cases too early - "but what if..." → note it, stay on happy path
- Implementation details creeping in - "the API endpoint..." → redirect to outcomes

### Phase 3: Edge Cases and Errors

**Goal:** Discover what can go wrong and how the system handles it.

**Questions to ask:**

1. "What if [actor] doesn't respond?"
2. "What if [condition] isn't met when they try?"
3. "What if this happens twice? Or in the wrong order?"
4. "How long should we wait before [action]?"
5. "When should a human be alerted to intervene?"
6. "What if [external system] is unavailable?"

**Technique:** For each rule, ask "what are all the ways requires could fail?"

**Outputs:**
- Timeout/deadline rules
- Retry and escalation logic
- Error states
- Recovery paths

**Watch for:**
- Infinite loops - "then it retries, then retries again..." → need terminal states
- Missing escalation - eventually a human needs to know

### Phase 4: Refinement

**Goal:** Clean up the specification and identify gaps.

**Questions to ask:**

1. "Looking at [entity], are these states complete? Can it be in any other state?"
2. "Is there anything we haven't covered?"
3. "This rule references [X] - do we need to define that, or is it external?"
4. "Is this detail essential here, or should it live in a detailed spec?"

**Technique:** Read back the spec and ask "does this match your mental model?"

**Outputs:**
- Complete entity definitions
- Open questions documented
- Deferred specifications identified
- External boundaries confirmed

---

## Elicitation Principles

### Ask One Question at a Time

Bad: "What entities do you have, and what states can they be in, and who can modify them?"

Good: "What are the main things this system manages?"
Then: "Let's take [Candidacy]. What states can it be in?"
Then: "Who can change a candidacy's state?"

### Work Through Implications

When a choice arises, don't just accept the first answer. Explore consequences:

"You said invitations expire after 48 hours. What happens then?"
"And if the candidate still hasn't responded after we retry?"
"What if they never respond - is this candidacy stuck forever?"

This surfaces decisions they haven't made yet.

### Distinguish Product from Implementation

When you hear implementation language, redirect:

| They say | You redirect |
|----------|-------------|
| "The API returns a 404" | "So the user is informed it's not found?" |
| "We store it in Postgres" | "What information is captured?" |
| "The frontend shows a modal" | "The user is prompted to confirm?" |
| "We use a cron job" | "This happens on a schedule - how often?" |

### Surface Ambiguity Explicitly

Better to record an open question than assume:

"I'm not sure whether declining should return the candidate to the pool or remove them entirely. Let me note that as an open question."

```
open_question "When candidate declines, do they return to pool or exit?"
```

### Use Concrete Examples

Abstract discussions get stuck. Ground them:

"Let's say Alice is a candidate for the Senior Engineer role. She's been sent an invitation with three slots. Walk me through what happens when she clicks on Tuesday 2pm."

### Iterate Willingly

It's normal to revise earlier decisions:

"Earlier we said all admins see all notifications. But now you're describing role-specific dashboards. Should we revisit that?"

### Know When to Stop

Not everything needs to be specified now:

- "This is getting into how the matching algorithm works - should we defer that to a detailed spec?"
- "We've covered the main flow. The reporting dashboard sounds like a separate specification."

---

## Recognising Library Spec Opportunities

During elicitation, stay alert for descriptions that suggest a **library spec** rather than application-specific logic. Library specs are standalone specifications for generic integrations that could be reused across projects.

**This applies equally to reverse engineering.** When examining existing code and finding OAuth flows, payment processing, or other integration patterns, the same questions apply. See REVERSE_ENGINEERING.md for code-level signals that indicate library spec candidates.

### Signals That Something Might Be a Library Spec

**External system integration:**
- "We use Google/Microsoft/GitHub for login"
- "Payments go through Stripe/PayPal"
- "We send emails via SendGrid/Postmark"
- "Calendar invites sync with Google Calendar"
- "We store files in S3/GCS"

**Generic patterns being described:**
- OAuth flows, session management, token refresh
- Payment processing, subscriptions, invoicing
- Email delivery, bounce handling, unsubscribes
- File upload, virus scanning, thumbnail generation
- Webhook receipt, retry logic, signature verification

**Implementation-agnostic descriptions:**
- "Users log in with their work account" (could be any SSO provider)
- "We charge them monthly" (could be any payment processor)
- "They get notified" (could be any notification infrastructure)

### Questions to Ask

When you detect a potential library spec, pause and explore:

1. **"Is this specific to your system, or is it a standard integration?"**
   - If standard → likely a library spec candidate

2. **"Would another system integrating with [X] work the same way?"**
   - If yes → definitely a library spec candidate

3. **"Do you have specific customisations to how [X] works, or is it standard?"**
   - Standard behaviour → use or create a library spec
   - Heavy customisation → might still be library spec with configuration

4. **"Should we look for an existing library spec for [X], or do you need something custom?"**
   - Encourages reuse, saves effort

### How to Handle the Decision

**Option 1: Use an existing library spec**
```
"It sounds like you're describing a standard OAuth flow. There's likely
an existing library spec for this - shall we reference that rather than
specifying the OAuth details here? Your application spec would just
respond to authentication events."
```

**Option 2: Create a new library spec**
```
"The way you're describing this Greenhouse ATS integration sounds generic
enough that it could be its own library spec. Other hiring applications
might integrate with Greenhouse the same way. Should we create a separate
greenhouse-ats.allium spec that this application references?"
```

**Option 3: Keep it inline (rare)**
```
"This integration is so specific to your system that it probably doesn't
make sense as a standalone spec. Let's include it directly."
```

### Common Library Spec Candidates

| Domain | Likely Library Specs |
|--------|---------------------|
| Authentication | OAuth providers (Google, Microsoft, GitHub), SAML, magic links |
| Payments | Stripe, PayPal, subscription billing, usage-based billing |
| Communications | Email delivery, SMS, push notifications, Slack/Teams |
| Storage | S3-compatible storage, file scanning, image processing |
| Calendar | Google Calendar, Outlook, iCal feeds |
| CRM/ATS | Salesforce, HubSpot, Greenhouse, Lever |
| Analytics | Segment, Mixpanel, event tracking |
| Infrastructure | Webhook handling, rate limiting, audit logging |

### The Boundary Question

When you identify a library spec candidate, the key question is: **"Where does the library spec end and the application spec begin?"**

The library spec handles:
- The mechanics of the integration (OAuth flow, payment processing)
- Events that any consumer would care about (login succeeded, payment failed)
- Configuration that varies between deployments

The application spec handles:
- What happens in *your system* when those events occur
- Application-specific entities (your User, your Subscription)
- Business rules unique to your domain

**Example boundary:**
```
-- Library spec (oauth.allium) handles:
--   - Provider configuration
--   - Token exchange
--   - Session lifecycle
--   - Emits: AuthenticationSucceeded, SessionExpired, etc.

-- Application spec handles:
--   - Creating your User entity on first login
--   - What roles/permissions new users get
--   - Blocking suspended users from logging in
--   - Audit logging specific to your compliance needs
```

### Red Flags You Missed a Library Spec

During review, watch for:

- **Detailed protocol descriptions**: "First we redirect to Google, then they redirect back with a code, then we exchange it for a token..." → This is OAuth; use a library spec
- **Vendor-specific details**: "Stripe sends a webhook with event type `invoice.paid`..." → This is Stripe integration; use a library spec
- **Repeated patterns**: If you're specifying similar retry/timeout/error handling for multiple integrations, extract a common pattern

---

## Common Elicitation Traps

### The "Obviously" Trap

When someone says "obviously" or "of course", probe:

"You said obviously the admin approves. Is there ever a case where they don't need to? Could this be automated later?"

### The "Edge Case Spiral" Trap

Some people want to cover every edge case immediately:

"Let's capture that as an open question and stay on the main flow for now. We'll come back to edge cases."

### The "Technical Solution" Trap

Engineers especially jump to solutions:

"I hear you saying we need real-time updates. At the domain level, what does the user need to see and when?"

### The "Vague Agreement" Trap

Don't accept "yes" without specifics:

"You said yes, candidates can reschedule. How many times? Is there a limit? What happens after that?"

### The "Missing Actor" Trap

Watch for actions without clear actors:

"You said 'the slots are released'. Who or what releases them? Is it automatic, or does someone trigger it?"

---

## Elicitation Session Structure

**Opening (5 min):**
- Explain Allium briefly: "We're capturing what the software does, not how it's built"
- Set expectations: "I'll ask lots of questions, some obvious-seeming"
- Agree on scope for this session

**Scope definition (10-15 min):**
- Identify actors, entities, boundaries
- Get the one-sentence description

**Happy path (20-30 min):**
- Trace main flow start to finish
- Capture states, triggers, outcomes
- Note communications

**Edge cases (15-20 min):**
- Timeouts and deadlines
- Failure modes
- Escalation paths

**Wrap-up (5-10 min):**
- Read back key decisions
- List open questions
- Identify next session scope if needed

**After session:**
- Write up specification draft
- Send for review
- Note questions for next session
