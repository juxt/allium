# Allium Distillation Guide

## Overview

This guide is for extracting Allium specifications from existing codebases. While it might seem different from forward elicitation, **the core challenge is the same**: finding the right level of abstraction. In elicitation, you're filtering out implementation ideas as they arise. In distillation, you're filtering out implementation details that already exist. Both require the same judgment about what matters at the domain level.

**The core challenge:** Code tells you *how* something works. A specification needs to capture *what* it does and *why* it matters. The skill is the same as elicitation - asking "why does the stakeholder care about this?" and "could this be different while still being the same system?"

---

## Scoping the Distillation Effort

Before diving into code, establish what you're actually trying to specify. Not every line of code deserves a place in the spec.

### Questions to Ask First

1. **"What subset of this codebase are we specifying?"**
   - Mono repos often contain multiple distinct systems
   - You may only need a spec for one service or domain
   - Clarify boundaries explicitly before starting

2. **"Is there code we should deliberately exclude?"**
   - **Legacy code**: Features kept for backwards compatibility but not part of the core system
   - **Incidental code**: Supporting infrastructure that isn't domain-level (logging, metrics, deployment)
   - **Deprecated paths**: Code scheduled for removal
   - **Experimental features**: Behind feature flags, not yet design decisions

3. **"Who owns this spec?"**
   - Different teams may own different parts of a mono repo
   - Each team's spec should focus on their domain

### The "Would We Rebuild This?" Test

For any code path you encounter, ask: **"If we rebuilt this system from scratch, would this be in the requirements?"**

- Yes → Include in spec
- No, it's legacy → Exclude
- No, it's infrastructure → Exclude
- No, it's a workaround → Exclude (but note the underlying need it addresses)

### Documenting Scope Decisions

At the top of a distilled spec, document what's included and excluded:

```
-- interview-scheduling.allium

-- Scope: Interview scheduling flow only
-- Includes: Candidacy, Interview, InterviewSlot, Invitation, Feedback
-- Excludes:
--   - User authentication (use auth library spec)
--   - Analytics/reporting (separate spec)
--   - Legacy V1 API (deprecated, not specified)
--   - Greenhouse sync (use greenhouse library spec)
```

---

## Finding the Right Level of Abstraction

Distillation and elicitation share the same fundamental challenge: choosing what to include. The tests below work in both directions - whether you're hearing a stakeholder describe a feature or reading code that implements it.

### The "Why" Test

For every detail in the code, ask: **"Why does the stakeholder care about this?"**

| Code detail | Why? | Include? |
|-------------|------|----------|
| Invitation expires in 7 days | Affects candidate experience | Yes |
| Token is 32 bytes URL-safe | Security implementation | No |
| Sessions stored in Redis | Performance choice | No |
| Uses PostgreSQL JSONB | Database implementation | No |
| Slot status changes to 'proposed' | Affects what candidate sees | Yes |
| Email sent when invitation accepted | Communication requirement | Yes |

If you can't articulate why a stakeholder would care, it's probably implementation.

### The "Could It Be Different?" Test

Ask: **"Could this be implemented differently while still being the same system?"**

- If yes → probably implementation detail, abstract it away
- If no → probably domain-level, include it

| Detail | Could be different? | Include? |
|--------|---------------------|----------|
| `secrets.token_urlsafe(32)` | Yes - any secure token generation | No |
| 7-day invitation expiry | No - this is the design decision | Yes |
| PostgreSQL database | Yes - any database | No |
| "Pending → Confirmed → Completed" states | No - this is the workflow | Yes |

### The "Template vs Instance" Test

Is this a **category** of thing, or a **specific instance**?

| Instance (often implementation) | Template (often domain-level) |
|--------------------------------|-------------------------------|
| Google OAuth | Authentication provider |
| Slack webhook | Notification channel |
| SendGrid API | Email delivery |
| `timedelta(hours=3)` | Confirmation deadline |

But sometimes the instance IS the domain concern - see "The Concrete Detail Problem" below.

---

## The Distillation Mindset

### Code is Over-Specified

Every line of code makes decisions that might not matter at the domain level:

```python
# Code tells you:
def send_invitation(candidate_id: int, slot_ids: List[int]) -> Invitation:
    candidate = db.session.query(Candidate).get(candidate_id)
    slots = db.session.query(InterviewSlot).filter(
        InterviewSlot.id.in_(slot_ids),
        InterviewSlot.status == 'confirmed'
    ).all()
    
    invitation = Invitation(
        candidate_id=candidate_id,
        token=secrets.token_urlsafe(32),
        expires_at=datetime.utcnow() + timedelta(days=7),
        status='pending'
    )
    db.session.add(invitation)
    
    for slot in slots:
        slot.status = 'proposed'
        invitation.slots.append(slot)
    
    db.session.commit()
    
    send_email(
        to=candidate.email,
        template='interview_invitation',
        context={'invitation': invitation, 'slots': slots}
    )
    
    return invitation
```

```
-- Specification should say:
rule SendInvitation {
    when: SendInvitation(candidacy, slots)
    
    requires: slots.all(s => s.status = confirmed)
    
    ensures: slots.each(s => s.status = proposed)
    ensures: Invitation.created(
        candidacy: candidacy,
        slots: slots,
        expires_at: now + 7.days,
        status: pending
    )
    ensures: Email.sent(
        to: candidacy.candidate.email,
        template: interview_invitation
    )
}
```

What we dropped:
- `candidate_id: int` → just `candidacy`
- `db.session.query(...)` → relationship traversal
- `secrets.token_urlsafe(32)` → token is implementation
- `datetime.utcnow() + timedelta(...)` → `now + 7.days`
- `db.session.add/commit` → implied by `created`
- `invitation.slots.append(slot)` → implied by relationship

### Ask "Would a Product Owner Care?"

For every detail in the code, ask:

| Code detail | Product owner cares? | Include? |
|-------------|---------------------|----------|
| Invitation expires in 7 days | Yes - affects candidate experience | Yes |
| Token is 32 bytes URL-safe | No - security implementation | No |
| Uses SQLAlchemy ORM | No - persistence mechanism | No |
| Email template name | Maybe - if templates are design decisions | Maybe |
| Slot status changes to 'proposed' | Yes - affects what candidate sees | Yes |
| Database transaction commits | No - implementation detail | No |

### Distinguish Means from Ends

**Means:** How the code achieves something
**Ends:** What outcome the system needs

| Means (code) | Ends (spec) |
|--------------|-------------|
| `requests.post('https://slack.com/api/...')` | `Notification.sent(channel: slack)` |
| `candidate.oauth_token = google.exchange(code)` | `Candidate authenticated` |
| `redis.setex(f'session:{id}', 86400, data)` | `Session.created(expires: 24.hours)` |
| `for slot in slots: slot.status = 'cancelled'` | `slots.each(s => s.status = cancelled)` |

---

## The Concrete Detail Problem

The hardest judgment call: **when is a concrete detail part of the domain vs just implementation?**

### Google OAuth Example

You find this code:
```python
OAUTH_PROVIDERS = {
    'google': GoogleOAuthProvider(client_id=..., client_secret=...),
}

def authenticate(provider: str, code: str) -> User:
    return OAUTH_PROVIDERS[provider].authenticate(code)
```

**Question:** Is "Google OAuth" domain-level or implementation?

**It's implementation if:**
- Google is just the auth mechanism chosen
- It could be replaced with any OAuth provider
- Users don't see or care which provider
- The code is written generically (provider is a parameter)

**It's domain-level if:**
- Users explicitly choose Google (vs Microsoft, etc.)
- "Sign in with Google" is a feature
- Google-specific scopes/permissions are used
- Multiple providers are supported as a feature

**How to tell:** Look at the UI and user flows. If users see "Sign in with Google" as a choice, it's domain-level. If they just see "Sign in" and Google happens to be behind it, it's implementation.

### Database Choice Example

You find PostgreSQL-specific code:
```python
from sqlalchemy.dialects.postgresql import JSONB, ARRAY

class Candidate(Base):
    skills = Column(ARRAY(String))
    metadata = Column(JSONB)
```

**Almost always implementation.** The spec should say:
```
entity Candidate {
    skills: Set<String>
    metadata: String?              -- or model specific fields
}
```

The specific database is rarely domain-level. Exception: if the system explicitly promises PostgreSQL compatibility or specific PostgreSQL features to users.

### Third-Party Integration Example

You find Greenhouse ATS integration:
```python
class GreenhouseSync:
    def import_candidate(self, greenhouse_id: str) -> Candidate:
        data = self.client.get_candidate(greenhouse_id)
        return Candidate(
            name=data['name'],
            email=data['email'],
            greenhouse_id=greenhouse_id,
            source='greenhouse'
        )
```

**Could be either:**

**Implementation if:**
- Greenhouse is just where candidates happen to come from
- Could be swapped for Lever, Workable, etc.
- The integration is an implementation detail of "candidates are imported"

Spec:
```
external entity Candidate {
    name: String
    email: Email
    source: CandidateSource
}
```

**Product-level if:**
- "Greenhouse integration" is a selling point
- Users configure their Greenhouse connection
- Greenhouse-specific features are exposed (like syncing feedback back)

Spec:
```
external entity Candidate {
    name: String
    email: Email
    greenhouse_id: String?  -- explicitly modeled
}

rule SyncFromGreenhouse {
    when: GreenhouseWebhookReceived(candidate_data)
    ensures: Candidate.created(
        ...
        greenhouse_id: candidate_data.id
    )
}
```

### The "Multiple Implementations" Heuristic

Look for variation in the codebase:

- If there's only one OAuth provider → probably implementation
- If there are multiple OAuth providers → probably domain-level
- If there's only one notification channel → probably implementation  
- If there are Slack AND email AND SMS → probably domain-level

The presence of multiple implementations suggests the variation itself is a domain concern.

---

## Distillation Process

### Step 1: Map the Territory

Before extracting any specification, understand the codebase structure:

1. **Identify entry points** - API routes, CLI commands, message handlers, scheduled jobs
2. **Find the domain models** - Usually in `models/`, `entities/`, `domain/`
3. **Locate business logic** - Services, use cases, handlers
4. **Note external integrations** - What third parties does it talk to?

Create a rough map:
```
Entry points:
  - API: /api/candidates/*, /api/interviews/*, /api/invitations/*
  - Webhooks: /webhooks/greenhouse, /webhooks/calendar
  - Jobs: send_reminders, expire_invitations, sync_calendars

Models:
  - Candidate, Interview, InterviewSlot, Invitation, Feedback

Services:
  - SchedulingService, NotificationService, CalendarService

Integrations:
  - Google Calendar, Slack, Greenhouse, SendGrid
```

### Step 2: Extract Entity States

Look at enum fields and status columns:

```python
class Invitation(Base):
    status = Column(Enum('pending', 'accepted', 'declined', 'expired'))
```

Becomes:
```
entity Invitation {
    status: pending | accepted | declined | expired
}
```

Look for:
- Enum definitions
- Status/state columns
- Constants like `STATUS_PENDING = 'pending'`
- State machine libraries (e.g., `transitions`, `django-fsm`)

### Step 3: Extract Transitions

Find where status changes happen:

```python
def accept_invitation(invitation_id: int, slot_id: int):
    invitation = get_invitation(invitation_id)
    
    if invitation.status != 'pending':
        raise InvalidStateError()
    if invitation.expires_at < datetime.utcnow():
        raise ExpiredError()
    
    slot = get_slot(slot_id)
    if slot not in invitation.slots:
        raise InvalidSlotError()
    
    invitation.status = 'accepted'
    slot.status = 'booked'
    
    # Release other slots
    for other_slot in invitation.slots:
        if other_slot.id != slot_id:
            other_slot.status = 'available'
    
    # Create the interview
    interview = Interview(
        candidate_id=invitation.candidate_id,
        slot_id=slot_id,
        status='scheduled'
    )
    
    notify_interviewers(interview)
    send_confirmation_email(invitation.candidate, interview)
```

Extract:
```
rule CandidateAcceptsInvitation {
    when: CandidateAccepts(invitation, slot)
    
    requires: invitation.status = pending
    requires: invitation.expires_at > now
    requires: slot in invitation.slots
    
    ensures: invitation.status = accepted
    ensures: slot.status = booked
    ensures: invitation.other_slots.each(s => s.status = available)
    ensures: Interview.created(
        candidacy: invitation.candidacy,
        slot: slot,
        status: scheduled
    )
    ensures: Notification.sent(to: slot.interviewers, ...)
    ensures: Email.sent(to: invitation.candidate.email, ...)
}
```

**Key extraction patterns:**

| Code pattern | Spec pattern |
|--------------|--------------|
| `if x.status != 'pending': raise` | `requires: x.status = pending` |
| `if x.expires_at < now: raise` | `requires: x.expires_at > now` |
| `if item not in collection: raise` | `requires: item in collection` |
| `x.status = 'accepted'` | `ensures: x.status = accepted` |
| `Model.create(...)` | `ensures: Model.created(...)` |
| `send_email(...)` | `ensures: Email.sent(...)` |
| `notify(...)` | `ensures: Notification.sent(...)` |

### Step 4: Find Temporal Triggers

Look for scheduled jobs and time-based logic:

```python
# In celery tasks or cron jobs
@app.task
def expire_invitations():
    expired = Invitation.query.filter(
        Invitation.status == 'pending',
        Invitation.expires_at < datetime.utcnow()
    ).all()
    
    for invitation in expired:
        invitation.status = 'expired'
        for slot in invitation.slots:
            slot.status = 'available'
        notify_candidate_expired(invitation)

@app.task  
def send_reminders():
    upcoming = Interview.query.filter(
        Interview.status == 'scheduled',
        Interview.slot.time.between(
            datetime.utcnow() + timedelta(hours=1),
            datetime.utcnow() + timedelta(hours=2)
        )
    ).all()
    
    for interview in upcoming:
        send_reminder_notification(interview)
```

Extract:
```
rule InvitationExpires {
    when: invitation.expires_at <= now
    requires: invitation.status = pending
    
    ensures: invitation.status = expired
    ensures: invitation.slots.each(s => s.status = available)
    ensures: CandidateInformed(candidate: invitation.candidate, about: invitation_expired)
}

rule InterviewReminder {
    when: interview.slot.time - 1.hour <= now
    requires: interview.status = scheduled
    
    ensures: Notification.sent(to: interview.interviewers, template: reminder)
}
```

### Step 5: Identify External Boundaries

Look for:
- Third-party API calls
- Webhook handlers
- Import/export functions
- Data that's read but never written (or vice versa)

These often indicate external entities:

```python
# Candidate data comes from Greenhouse, we don't create it
def import_from_greenhouse(webhook_data):
    candidate = Candidate.query.filter_by(
        greenhouse_id=webhook_data['id']
    ).first()
    
    if not candidate:
        candidate = Candidate(greenhouse_id=webhook_data['id'])
    
    candidate.name = webhook_data['name']
    candidate.email = webhook_data['email']
```

Suggests:
```
external entity Candidate {
    name: String
    email: Email
}
```

### Step 6: Abstract Away Implementation

Now make a pass through your extracted spec and remove implementation details:

**Before (too concrete):**
```
entity Invitation {
    candidate_id: Integer
    token: String(32)
    created_at: DateTime
    expires_at: DateTime
    status: pending | accepted | declined | expired
}
```

**After (domain-level):**
```
entity Invitation {
    candidacy: Candidacy
    created_at: Timestamp
    expires_at: Timestamp
    status: pending | accepted | declined | expired
    
    is_expired: expires_at <= now
}
```

Changes:
- `candidate_id: Integer` → `candidacy: Candidacy` (relationship, not FK)
- `token: String(32)` → removed (implementation)
- `DateTime` → `Timestamp` (domain type)
- Added derived `is_expired` for clarity

### Step 7: Validate with Stakeholders

The extracted spec is a hypothesis. Validate it:

1. **Show the spec to the original developers** - "Is this what the system does?"
2. **Show to stakeholders** - "Is this what the system should do?"
3. **Look for gaps** - Code often has bugs or missing features; spec might reveal them

Common findings:
- "Oh, that retry logic was a hack, we should remove it"
- "Actually we wanted X but never built it"
- "These two code paths should be the same but aren't"

---

## Worked Examples: From Code to Spec

These examples show real implementations in Python and TypeScript, then walk through extracting the Allium specification.

### Example 1: Password Reset (Python/Flask)

**The implementation:**

```python
# models.py
from datetime import datetime, timedelta
from werkzeug.security import generate_password_hash, check_password_hash
import secrets

class User(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    email = db.Column(db.String(120), unique=True, nullable=False)
    password_hash = db.Column(db.String(256), nullable=False)
    status = db.Column(db.String(20), default='active')
    failed_attempts = db.Column(db.Integer, default=0)
    locked_until = db.Column(db.DateTime, nullable=True)
    
    def set_password(self, password):
        self.password_hash = generate_password_hash(password)
    
    def check_password(self, password):
        return check_password_hash(self.password_hash, password)
    
    def is_locked(self):
        return (self.status == 'locked' and 
                self.locked_until and 
                self.locked_until > datetime.utcnow())


class PasswordResetToken(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    token = db.Column(db.String(64), unique=True, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    expires_at = db.Column(db.DateTime, nullable=False)
    used = db.Column(db.Boolean, default=False)
    
    user = db.relationship('User', backref='reset_tokens')
    
    @staticmethod
    def generate_token():
        return secrets.token_urlsafe(32)
    
    def is_valid(self):
        return (not self.used and 
                self.expires_at > datetime.utcnow())


# routes.py
from flask import request, jsonify
from flask_mail import Message

RESET_TOKEN_EXPIRY_HOURS = 1
MAX_FAILED_ATTEMPTS = 5
LOCKOUT_MINUTES = 15

@app.route('/api/auth/request-reset', methods=['POST'])
def request_password_reset():
    data = request.get_json()
    email = data.get('email')
    
    user = User.query.filter_by(email=email).first()
    if not user:
        # Return success anyway to prevent email enumeration
        return jsonify({'message': 'If account exists, reset email sent'}), 200
    
    if user.status == 'deactivated':
        return jsonify({'message': 'If account exists, reset email sent'}), 200
    
    # Invalidate existing tokens
    PasswordResetToken.query.filter_by(
        user_id=user.id, 
        used=False
    ).update({'used': True})
    
    # Create new token
    token = PasswordResetToken(
        user_id=user.id,
        token=PasswordResetToken.generate_token(),
        expires_at=datetime.utcnow() + timedelta(hours=RESET_TOKEN_EXPIRY_HOURS)
    )
    db.session.add(token)
    db.session.commit()
    
    # Send email
    reset_url = f"{app.config['FRONTEND_URL']}/reset-password?token={token.token}"
    msg = Message(
        'Password Reset Request',
        recipients=[user.email],
        html=render_template('emails/password_reset.html', 
                           user=user, 
                           reset_url=reset_url)
    )
    mail.send(msg)
    
    return jsonify({'message': 'If account exists, reset email sent'}), 200


@app.route('/api/auth/reset-password', methods=['POST'])
def reset_password():
    data = request.get_json()
    token_string = data.get('token')
    new_password = data.get('password')
    
    if len(new_password) < 12:
        return jsonify({'error': 'Password must be at least 12 characters'}), 400
    
    token = PasswordResetToken.query.filter_by(token=token_string).first()
    
    if not token or not token.is_valid():
        return jsonify({'error': 'Invalid or expired token'}), 400
    
    user = token.user
    
    # Mark token as used
    token.used = True
    
    # Update password
    user.set_password(new_password)
    user.status = 'active'
    user.failed_attempts = 0
    user.locked_until = None
    
    # Invalidate all sessions (assuming Session model exists)
    Session.query.filter_by(
        user_id=user.id,
        status='active'
    ).update({'status': 'revoked'})
    
    db.session.commit()
    
    # Send confirmation email
    msg = Message(
        'Password Changed',
        recipients=[user.email],
        html=render_template('emails/password_changed.html', user=user)
    )
    mail.send(msg)
    
    return jsonify({'message': 'Password reset successful'}), 200


# Scheduled job (e.g., celery task)
@celery.task
def cleanup_expired_tokens():
    """Run hourly to mark expired tokens"""
    PasswordResetToken.query.filter(
        PasswordResetToken.used == False,
        PasswordResetToken.expires_at < datetime.utcnow()
    ).update({'used': True})
    db.session.commit()
```

**Extraction process:**

1. **Identify entities from models:**
   - `User` - has email, password_hash, status, failed_attempts, locked_until
   - `PasswordResetToken` - has user, token, created_at, expires_at, used

2. **Identify states from status fields and booleans:**
   - User status: `active | locked | deactivated` (found in code)
   - Token: `used` boolean → convert to status: `pending | used | expired`

3. **Identify triggers from routes/handlers:**
   - `request_password_reset` → external trigger
   - `reset_password` → external trigger
   - `cleanup_expired_tokens` → temporal trigger

4. **Extract preconditions from validation:**
   - `if not user` → `requires: user.exists`
   - `len(new_password) < 12` → `requires: password.length >= 12`
   - `token.is_valid()` → `requires: token.is_valid`

5. **Extract postconditions from mutations:**
   - `token.used = True` → `ensures: token.status = used`
   - `user.set_password(...)` → `ensures: user.password_hash = hash(password)`
   - `mail.send(msg)` → `ensures: Email.sent(...)`

6. **Strip implementation details:**
   - Remove: `secrets.token_urlsafe(32)`, `generate_password_hash`, `db.session`
   - Remove: HTTP status codes, JSON responses
   - Remove: `render_template`, URL construction
   - Keep: durations (1 hour, 12 characters)

**Extracted Allium spec:**

```
-- password-reset.allium

config {
    reset_token_expiry: Duration = 1.hour
    min_password_length: Integer = 12
}

entity User {
    email: Email
    password_hash: String
    status: active | locked | deactivated
    failed_attempts: Integer
    locked_until: Timestamp?
    
    reset_tokens: PasswordResetToken for this user
    sessions: Session for this user
    
    active_sessions: sessions with status = active
    pending_reset_tokens: reset_tokens with status = pending
}

entity PasswordResetToken {
    user: User
    created_at: Timestamp
    expires_at: Timestamp
    status: pending | used | expired
    
    is_valid: status = pending and expires_at > now
}

rule RequestPasswordReset {
    when: UserRequestsPasswordReset(email)
    
    let user = User{email}
    
    requires: user.exists
    requires: user.status in [active, locked]
    
    ensures: user.pending_reset_tokens.each(t => t.status = used)
    ensures:
        let token = PasswordResetToken.created(
            user: user,
            created_at: now,
            expires_at: now + config/reset_token_expiry,
            status: pending
        )
        Email.sent(
            to: user.email,
            template: password_reset,
            data: { token: token }
        )
}

rule CompletePasswordReset {
    when: UserResetsPassword(token, new_password)
    
    requires: token.is_valid
    requires: new_password.length >= config/min_password_length
    
    let user = token.user
    
    ensures: token.status = used
    ensures: user.password_hash = hash(new_password)
    ensures: user.status = active
    ensures: user.failed_attempts = 0
    ensures: user.locked_until = null
    ensures: user.active_sessions.each(s => s.status = revoked)
    ensures: Email.sent(to: user.email, template: password_changed)
}

rule ResetTokenExpires {
    when: token.expires_at <= now
    requires: token.status = pending
    ensures: token.status = expired
}
```

**What we removed:**
- Database details (SQLAlchemy, column types, foreign keys)
- HTTP layer (routes, JSON, status codes)
- Security implementation (token generation algorithm, password hashing)
- Email enumeration protection (design decision - could add back if desired)
- Template rendering details

---

### Example 2: Usage Limits (TypeScript/Node)

**The implementation:**

```typescript
// models/plan.ts
export interface Plan {
  id: string;
  name: string;
  maxProjects: number;      // -1 for unlimited
  maxStorageMB: number;     // -1 for unlimited
  maxTeamMembers: number;
  monthlyPriceUsd: number;
  features: string[];
}

export const PLANS: Record<string, Plan> = {
  free: {
    id: 'free',
    name: 'Free',
    maxProjects: 3,
    maxStorageMB: 100,
    maxTeamMembers: 1,
    monthlyPriceUsd: 0,
    features: ['basic_editor'],
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    maxProjects: 50,
    maxStorageMB: 10000,
    maxTeamMembers: 10,
    monthlyPriceUsd: 15,
    features: ['basic_editor', 'advanced_editor', 'api_access'],
  },
  enterprise: {
    id: 'enterprise',
    name: 'Enterprise',
    maxProjects: -1,
    maxStorageMB: -1,
    maxTeamMembers: -1,
    monthlyPriceUsd: 99,
    features: ['basic_editor', 'advanced_editor', 'api_access', 'sso', 'audit_log'],
  },
};

// models/workspace.ts
export interface Workspace {
  id: string;
  name: string;
  ownerId: string;
  planId: string;
  createdAt: Date;
}

// services/usage.service.ts
import { prisma } from '../db';
import { PLANS } from '../models/plan';

export class UsageService {
  async getWorkspaceUsage(workspaceId: string) {
    const [projectCount, storageBytes, memberCount] = await Promise.all([
      prisma.project.count({ where: { workspaceId, deletedAt: null } }),
      prisma.file.aggregate({
        where: { project: { workspaceId } },
        _sum: { sizeBytes: true },
      }),
      prisma.workspaceMember.count({ where: { workspaceId } }),
    ]);

    return {
      projects: projectCount,
      storageMB: Math.ceil((storageBytes._sum.sizeBytes || 0) / 1024 / 1024),
      members: memberCount,
    };
  }

  async canCreateProject(workspaceId: string): Promise<boolean> {
    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
    });
    if (!workspace) return false;

    const plan = PLANS[workspace.planId];
    if (plan.maxProjects === -1) return true;

    const usage = await this.getWorkspaceUsage(workspaceId);
    return usage.projects < plan.maxProjects;
  }

  async canAddMember(workspaceId: string): Promise<boolean> {
    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
    });
    if (!workspace) return false;

    const plan = PLANS[workspace.planId];
    if (plan.maxTeamMembers === -1) return true;

    const usage = await this.getWorkspaceUsage(workspaceId);
    return usage.members < plan.maxTeamMembers;
  }

  async canUploadFile(workspaceId: string, fileSizeBytes: number): Promise<boolean> {
    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
    });
    if (!workspace) return false;

    const plan = PLANS[workspace.planId];
    if (plan.maxStorageMB === -1) return true;

    const usage = await this.getWorkspaceUsage(workspaceId);
    const newStorageMB = usage.storageMB + Math.ceil(fileSizeBytes / 1024 / 1024);
    return newStorageMB <= plan.maxStorageMB;
  }

  hasFeature(planId: string, feature: string): boolean {
    const plan = PLANS[planId];
    return plan?.features.includes(feature) ?? false;
  }
}

// controllers/project.controller.ts
import { UsageService } from '../services/usage.service';

const usageService = new UsageService();

export async function createProject(req: Request, res: Response) {
  const { workspaceId, name } = req.body;
  const userId = req.user.id;

  // Check membership
  const membership = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
  });
  
  if (!membership) {
    return res.status(403).json({ error: 'Not a member of this workspace' });
  }

  // Check limits
  const canCreate = await usageService.canCreateProject(workspaceId);
  if (!canCreate) {
    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      include: { plan: true },
    });
    
    return res.status(403).json({
      error: 'Project limit reached',
      code: 'LIMIT_REACHED',
      limit: PLANS[workspace!.planId].maxProjects,
      upgradeUrl: '/settings/billing',
    });
  }

  const project = await prisma.project.create({
    data: {
      workspaceId,
      name,
      createdById: userId,
    },
  });

  // Track usage event
  await prisma.usageEvent.create({
    data: {
      workspaceId,
      type: 'PROJECT_CREATED',
      metadata: { projectId: project.id },
    },
  });

  return res.status(201).json(project);
}

// controllers/billing.controller.ts
export async function changePlan(req: Request, res: Response) {
  const { workspaceId, newPlanId } = req.body;
  const userId = req.user.id;

  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
  });

  if (!workspace || workspace.ownerId !== userId) {
    return res.status(403).json({ error: 'Only owner can change plan' });
  }

  const currentPlan = PLANS[workspace.planId];
  const newPlan = PLANS[newPlanId];

  if (!newPlan) {
    return res.status(400).json({ error: 'Invalid plan' });
  }

  // Check if downgrading
  const isDowngrade = newPlan.monthlyPriceUsd < currentPlan.monthlyPriceUsd;

  if (isDowngrade) {
    const usage = await usageService.getWorkspaceUsage(workspaceId);

    // Validate limits
    if (newPlan.maxProjects !== -1 && usage.projects > newPlan.maxProjects) {
      return res.status(400).json({
        error: 'Cannot downgrade: too many projects',
        code: 'DOWNGRADE_BLOCKED',
        current: usage.projects,
        limit: newPlan.maxProjects,
        mustDelete: usage.projects - newPlan.maxProjects,
      });
    }

    if (newPlan.maxStorageMB !== -1 && usage.storageMB > newPlan.maxStorageMB) {
      return res.status(400).json({
        error: 'Cannot downgrade: storage exceeds limit',
        code: 'DOWNGRADE_BLOCKED',
        currentMB: usage.storageMB,
        limitMB: newPlan.maxStorageMB,
      });
    }

    if (newPlan.maxTeamMembers !== -1 && usage.members > newPlan.maxTeamMembers) {
      return res.status(400).json({
        error: 'Cannot downgrade: too many team members',
        code: 'DOWNGRADE_BLOCKED',
        current: usage.members,
        limit: newPlan.maxTeamMembers,
      });
    }
  }

  await prisma.workspace.update({
    where: { id: workspaceId },
    data: { planId: newPlanId },
  });

  // Send email notification
  const owner = await prisma.user.findUnique({ where: { id: workspace.ownerId } });
  await sendEmail({
    to: owner!.email,
    template: isDowngrade ? 'plan_downgraded' : 'plan_upgraded',
    data: { oldPlan: currentPlan.name, newPlan: newPlan.name },
  });

  return res.json({ success: true, plan: newPlan });
}
```

**Extraction process:**

1. **Identify entities from types/models:**
   - `Plan` - configuration entity with limits
   - `Workspace` - has owner, plan
   - `WorkspaceMember` - join entity (user + workspace)
   - `Project`, `File` - resources that count against limits
   - `UsageEvent` - audit/tracking

2. **Identify derived values from service methods:**
   - `canCreateProject()` → derived boolean on Workspace
   - `canAddMember()` → derived boolean
   - `hasFeature()` → derived function

3. **Recognize the "unlimited" pattern:**
   - `-1` means unlimited → convert to explicit handling

4. **Identify triggers from controllers:**
   - `createProject` → external trigger with limit check
   - `changePlan` → external trigger with downgrade validation

5. **Extract the permission/limit pattern:**
   - Check membership → `requires: membership.exists`
   - Check limit → `requires: workspace.can_add_project`
   - Return error with upgrade path → separate rule for limit reached

**Extracted Allium spec:**

```
-- usage-limits.allium

entity Plan {
    name: String
    max_projects: Integer           -- -1 = unlimited
    max_storage_mb: Integer
    max_team_members: Integer
    monthly_price: Decimal
    features: Set<Feature>

    has_unlimited_projects: max_projects = -1
    has_unlimited_storage: max_storage_mb = -1
    has_unlimited_members: max_team_members = -1
}

entity Workspace {
    name: String
    owner: User
    plan: Plan
    
    members: WorkspaceMember for this workspace
    all_projects: Project for this workspace

    -- Projections
    projects: all_projects with deleted_at = null
    
    -- Usage calculations
    project_count: projects.count
    storage_mb: calculate_storage(this)         -- black box
    member_count: members.count
    
    -- Limit checks
    can_add_project: 
        plan.has_unlimited_projects 
        or project_count < plan.max_projects
    
    can_add_member:
        plan.has_unlimited_members
        or member_count < plan.max_team_members
    
    can_add_storage(size_mb):
        plan.has_unlimited_storage
        or storage_mb + size_mb <= plan.max_storage_mb
    
    can_use_feature(f): f in plan.features
}

entity WorkspaceMember {
    workspace: Workspace
    user: User
}

rule CreateProject {
    when: CreateProject(user, workspace, name)
    
    let membership = WorkspaceMember{workspace, user}
    
    requires: membership.exists
    requires: workspace.can_add_project
    
    ensures: Project.created(
        workspace: workspace,
        name: name,
        created_by: user
    )
    ensures: UsageEvent.created(
        workspace: workspace,
        type: project_created
    )
}

rule CreateProjectLimitReached {
    when: CreateProject(user, workspace, name)
    
    let membership = WorkspaceMember{workspace, user}
    
    requires: membership.exists
    requires: not workspace.can_add_project
    
    ensures: UserInformed(
        user: user,
        about: limit_reached,
        with: {
            limit_type: projects,
            current: workspace.project_count,
            max: workspace.plan.max_projects
        }
    )
}

rule ChangePlan {
    when: ChangePlan(user, workspace, new_plan)
    
    requires: user = workspace.owner
    
    let is_downgrade = new_plan.monthly_price < workspace.plan.monthly_price
    
    requires: not is_downgrade
              or (workspace.project_count <= new_plan.max_projects
                  or new_plan.has_unlimited_projects)
    requires: not is_downgrade
              or (workspace.storage_mb <= new_plan.max_storage_mb
                  or new_plan.has_unlimited_storage)
    requires: not is_downgrade
              or (workspace.member_count <= new_plan.max_team_members
                  or new_plan.has_unlimited_members)
    
    ensures: workspace.plan = new_plan
    ensures: Email.sent(
        to: workspace.owner.email,
        template: if is_downgrade then plan_downgraded else plan_upgraded,
        data: { old_plan: workspace.plan, new_plan: new_plan }
    )
}

rule DowngradeBlocked {
    when: ChangePlan(user, workspace, new_plan)
    
    requires: user = workspace.owner
    requires: new_plan.monthly_price < workspace.plan.monthly_price
    requires: workspace.project_count > new_plan.max_projects
              and not new_plan.has_unlimited_projects
    
    ensures: UserInformed(
        user: user,
        about: downgrade_blocked,
        with: {
            reason: projects,
            current: workspace.project_count,
            limit: new_plan.max_projects
        }
    )
}
```

**What we removed:**
- Prisma queries and database access patterns
- HTTP layer (Express req/res, status codes)
- Promise.all parallelization
- Math.ceil for storage calculation
- JSON error response structure
- Compound unique key syntax

**What we kept:**
- The -1 unlimited convention (could also use explicit `unlimited` type)
- Plan structure with features
- The paired success/failure rule pattern
- Usage event tracking

---

### Example 3: Soft Delete (Java/Spring)

**The implementation:**

```java
// entities/Document.java
@Entity
@Table(name = "documents")
@Where(clause = "deleted_at IS NULL")  // Default filter
public class Document {
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private String id;
    
    @Column(nullable = false)
    private String title;
    
    @Column(columnDefinition = "TEXT")
    private String content;
    
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "workspace_id", nullable = false)
    private Workspace workspace;
    
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "created_by_id", nullable = false)
    private User createdBy;
    
    @Column(nullable = false)
    private Instant createdAt;
    
    @Column
    private Instant deletedAt;
    
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "deleted_by_id")
    private User deletedBy;
    
    public boolean isDeleted() {
        return deletedAt != null;
    }
    
    public boolean canRestore() {
        if (deletedAt == null) return false;
        Instant retentionDeadline = deletedAt.plus(Duration.ofDays(30));
        return Instant.now().isBefore(retentionDeadline);
    }
}

// repositories/DocumentRepository.java
public interface DocumentRepository extends JpaRepository<Document, String> {
    
    // This ignores the @Where clause to include deleted documents
    @Query("SELECT d FROM Document d WHERE d.workspace.id = :workspaceId")
    List<Document> findAllIncludingDeleted(@Param("workspaceId") String workspaceId);
    
    @Query("SELECT d FROM Document d WHERE d.workspace.id = :workspaceId AND d.deletedAt IS NOT NULL")
    List<Document> findDeleted(@Param("workspaceId") String workspaceId);
    
    @Query("SELECT d FROM Document d WHERE d.workspace.id = :workspaceId AND d.deletedAt IS NOT NULL AND d.deletedAt > :cutoff")
    List<Document> findRestorable(@Param("workspaceId") String workspaceId, @Param("cutoff") Instant cutoff);
    
    @Modifying
    @Query("DELETE FROM Document d WHERE d.deletedAt IS NOT NULL AND d.deletedAt < :cutoff")
    int permanentlyDeleteExpired(@Param("cutoff") Instant cutoff);
}

// services/DocumentService.java
@Service
@Transactional
public class DocumentService {
    
    private static final Duration RETENTION_PERIOD = Duration.ofDays(30);
    
    @Autowired
    private DocumentRepository documentRepository;
    
    @Autowired
    private WorkspaceMemberRepository memberRepository;
    
    public void softDelete(String documentId, String userId) {
        Document document = documentRepository.findById(documentId)
            .orElseThrow(() -> new NotFoundException("Document not found"));
        
        if (document.isDeleted()) {
            throw new IllegalStateException("Document already deleted");
        }
        
        // Check permission: creator or admin
        boolean isCreator = document.getCreatedBy().getId().equals(userId);
        boolean isAdmin = memberRepository.isAdmin(document.getWorkspace().getId(), userId);
        
        if (!isCreator && !isAdmin) {
            throw new ForbiddenException("Not authorized to delete this document");
        }
        
        document.setDeletedAt(Instant.now());
        document.setDeletedBy(userRepository.findById(userId).orElseThrow());
        
        documentRepository.save(document);
    }
    
    public void restore(String documentId, String userId) {
        // Bypass @Where to find deleted document
        Document document = documentRepository.findAllIncludingDeleted(documentId)
            .stream()
            .filter(d -> d.getId().equals(documentId))
            .findFirst()
            .orElseThrow(() -> new NotFoundException("Document not found"));
        
        if (!document.canRestore()) {
            throw new IllegalStateException("Document cannot be restored");
        }
        
        // Check permission: original deleter or admin
        boolean isDeleter = document.getDeletedBy().getId().equals(userId);
        boolean isAdmin = memberRepository.isAdmin(document.getWorkspace().getId(), userId);
        
        if (!isDeleter && !isAdmin) {
            throw new ForbiddenException("Not authorized to restore this document");
        }
        
        document.setDeletedAt(null);
        document.setDeletedBy(null);
        
        documentRepository.save(document);
    }
    
    public void permanentlyDelete(String documentId, String userId) {
        Document document = documentRepository.findAllIncludingDeleted(documentId)
            .stream()
            .filter(d -> d.getId().equals(documentId))
            .findFirst()
            .orElseThrow(() -> new NotFoundException("Document not found"));
        
        if (!document.isDeleted()) {
            throw new IllegalStateException("Document must be soft-deleted first");
        }
        
        boolean isAdmin = memberRepository.isAdmin(document.getWorkspace().getId(), userId);
        if (!isAdmin) {
            throw new ForbiddenException("Only admins can permanently delete");
        }
        
        documentRepository.delete(document);
    }
    
    public void emptyTrash(String workspaceId, String userId) {
        boolean isAdmin = memberRepository.isAdmin(workspaceId, userId);
        if (!isAdmin) {
            throw new ForbiddenException("Only admins can empty trash");
        }
        
        List<Document> deleted = documentRepository.findDeleted(workspaceId);
        documentRepository.deleteAll(deleted);
    }
}

// scheduled/RetentionCleanupJob.java
@Component
public class RetentionCleanupJob {
    
    @Autowired
    private DocumentRepository documentRepository;
    
    @Scheduled(cron = "0 0 2 * * *")  // Run at 2 AM daily
    @Transactional
    public void cleanupExpiredDocuments() {
        Instant cutoff = Instant.now().minus(Duration.ofDays(30));
        int deleted = documentRepository.permanentlyDeleteExpired(cutoff);
        log.info("Permanently deleted {} expired documents", deleted);
    }
}
```

**Extraction process:**

1. **Spot the soft delete pattern:**
   - `deletedAt` timestamp (nullable) instead of status enum
   - `@Where` clause for default filtering
   - Separate queries to include/exclude deleted

2. **Extract the implicit state machine:**
   - `deletedAt = null` → active
   - `deletedAt != null` → deleted
   - `deleted` removes from database → permanently deleted

3. **Identify the retention policy:**
   - `Duration.ofDays(30)` → config value
   - `canRestore()` method → derived value

4. **Extract permission rules:**
   - Delete: creator OR admin
   - Restore: original deleter OR admin
   - Permanent delete: admin only

**Extracted Allium spec:**

```
-- soft-delete.allium

config {
    retention_period: Duration = 30.days
}

entity Document {
    workspace: Workspace
    title: String
    content: String
    created_by: User
    created_at: Timestamp
    status: active | deleted
    deleted_at: Timestamp?
    deleted_by: User?
    
    retention_expires_at: deleted_at + config/retention_period
    can_restore: status = deleted and retention_expires_at > now
}

entity Workspace {
    all_documents: Document for this workspace

    documents: all_documents with status = active
    deleted_documents: all_documents with status = deleted
    restorable_documents: all_documents with can_restore = true
}

rule DeleteDocument {
    when: DeleteDocument(actor, document)
    
    let membership = WorkspaceMember{document.workspace, actor}
    
    requires: document.status = active
    requires: actor = document.created_by or membership.can_admin
    
    ensures: document.status = deleted
    ensures: document.deleted_at = now
    ensures: document.deleted_by = actor
}

rule RestoreDocument {
    when: RestoreDocument(actor, document)
    
    let membership = WorkspaceMember{document.workspace, actor}
    
    requires: document.can_restore
    requires: actor = document.deleted_by or membership.can_admin
    
    ensures: document.status = active
    ensures: document.deleted_at = null
    ensures: document.deleted_by = null
}

rule PermanentlyDelete {
    when: PermanentlyDelete(actor, document)
    
    let membership = WorkspaceMember{document.workspace, actor}
    
    requires: document.status = deleted
    requires: membership.can_admin
    
    ensures: document.permanently_deleted
}

rule EmptyTrash {
    when: EmptyTrash(actor, workspace)
    
    let membership = WorkspaceMember{workspace, actor}
    
    requires: membership.can_admin
    
    ensures: workspace.deleted_documents.each(d => d.permanently_deleted)
}

rule RetentionExpires {
    when: document.retention_expires_at <= now
    requires: document.status = deleted
    ensures: document.permanently_deleted
}
```

**Key observations:**

The Java code uses `deletedAt != null` as the delete indicator, but the spec uses an explicit `status` field. Both are valid approaches - the spec is more explicit about state, while the code uses a convention. The spec captures the *meaning* (document is either active or deleted) without prescribing the implementation (status enum vs nullable timestamp).

---

## Recognising Library Spec Candidates

During distillation, stay alert for code that implements **generic integration patterns** rather than application-specific logic. These belong in library specs, not your main specification.

**The same principle applies in elicitation.** When a stakeholder describes "we use Google for login" or "payments go through Stripe," pause and consider whether this is a library spec. See elicitation.md's "Recognising Library Spec Opportunities" section for conversation-level signals.

### Signals in the Code

**Third-party integration modules:**
```python
# Finding code like this suggests a library spec
class StripeWebhookHandler:
    def handle_invoice_paid(self, event):
        ...
    def handle_subscription_cancelled(self, event):
        ...

class GoogleOAuthProvider:
    def exchange_code(self, code):
        ...
    def refresh_token(self, refresh_token):
        ...
```

**Generic patterns with specific providers:**
- OAuth flows (Google, Microsoft, GitHub)
- Payment processing (Stripe, PayPal)
- Email delivery (SendGrid, Postmark, SES)
- Calendar sync (Google Calendar, Outlook)
- ATS integrations (Greenhouse, Lever)
- File storage (S3, GCS)

**Configuration-driven integrations:**
```python
# Heavy configuration suggests the integration itself is separable
OAUTH_CONFIG = {
    'google': {'client_id': ..., 'scopes': ...},
    'microsoft': {'client_id': ..., 'scopes': ...},
}
```

### Questions to Ask

1. **"Is this integration logic, or application logic?"**
   - Integration: How to talk to Stripe
   - Application: What to do when payment succeeds

2. **"Would another application integrate the same way?"**
   - If yes → library spec candidate
   - If no → probably application-specific

3. **"Does the code separate integration from application concerns?"**
   - If cleanly separated → easy to extract to library spec
   - If tangled → might need refactoring first (but spec should still separate them)

### How to Handle

**Option 1: Reference an existing library spec**

If a standard library spec exists for this integration:
```
use "github.com/allium-specs/stripe-billing/abc123" as stripe

-- Application responds to Stripe events
rule ActivateSubscription {
    when: stripe/PaymentSucceeded(invoice)
    ...
}
```

**Option 2: Create a separate library spec**

If no standard spec exists but the integration is generic:
```
-- greenhouse-ats.allium (library spec)
-- Specifies: Greenhouse webhook events, candidate sync, etc.

-- interview-scheduling.allium (application spec)
use "./greenhouse-ats.allium" as greenhouse

rule ImportCandidate {
    when: greenhouse/CandidateCreated(data)
    ensures: Candidacy.created(...)
}
```

**Option 3: Abstract and move on**

If the integration is minor, just abstract it:
```
-- Don't specify Slack details, just:
ensures: Notification.sent(
    to: interviewers,
    channel: slack
)
```

### Red Flags: Integration Logic in Your Spec

If you find yourself writing spec like this, stop and reconsider:

```
-- TOO DETAILED - this is Stripe's domain, not yours
rule ProcessStripeWebhook {
    when: WebhookReceived(payload, signature)

    requires: verify_stripe_signature(payload, signature)

    let event = parse_stripe_event(payload)

    if event.type = "invoice.paid":
        ...
}
```

Instead:
```
-- Application responds to payment events (integration handled elsewhere)
rule PaymentReceived {
    when: stripe/InvoicePaid(invoice)
    ...
}
```

### Common Library Spec Extractions

| Code Pattern Found | Library Spec Candidate |
|-------------------|----------------------|
| OAuth token exchange, refresh, session management | `oauth2.allium` |
| Stripe webhook handling, subscription lifecycle | `stripe-billing.allium` |
| Email sending with templates, bounce handling | `email-delivery.allium` |
| Calendar event sync, availability checking | `calendar-integration.allium` |
| ATS candidate import, status sync | `greenhouse-ats.allium`, `lever-ats.allium` |
| File upload, virus scanning, thumbnail generation | `file-storage.allium` |

See patterns.md Pattern 8 for detailed examples of integrating library specs.

---

## Common Distillation Challenges

### Challenge: Duplicate Terminology

When you find two terms for the same concept—across specs, within a spec, or between spec and code—treat it as a blocking problem.

```
-- BAD: Acknowledges duplication without resolving it
-- Order vs Purchase
-- checkout.alm uses "Purchase" - these are equivalent concepts.
```

This is not a resolution. When different parts of a codebase are built against different specs, both terms end up in the implementation: duplicate models, redundant join tables, foreign keys pointing both ways.

**What to do:**
- Choose one term. Cross-reference related specs before deciding.
- Update all references. Don't leave the old term in comments or "see also" notes.
- Note the rename in a changelog, not in the spec itself.

**Warning signs in code:**
- Two models representing the same concept (`Order` and `Purchase`)
- Join tables for both (`order_items`, `purchase_items`)
- Comments like "equivalent to X" or "same as Y"

The spec you extract must pick one term. Flag the other as technical debt to remove.

### Challenge: Implicit State Machines

Code often has implicit states that aren't modeled:

```python
# No explicit status field, but there's a state machine hiding here
class FeedbackRequest:
    interview_id = Column(Integer)
    interviewer_id = Column(Integer)
    requested_at = Column(DateTime)
    reminded_at = Column(DateTime, nullable=True)
    feedback_id = Column(Integer, nullable=True)  # FK to Feedback if submitted
```

The implicit states are:
- `pending`: requested_at set, feedback_id null, reminded_at null
- `reminded`: reminded_at set, feedback_id null
- `submitted`: feedback_id set

Extract to explicit:
```
entity FeedbackRequest {
    interview: Interview
    interviewer: Interviewer
    requested_at: Timestamp
    reminded_at: Timestamp?
    status: pending | reminded | submitted
}
```

### Challenge: Scattered Logic

The same conceptual rule might be spread across multiple places:

```python
# In API handler
def accept_invitation(request):
    if invitation.status != 'pending':
        return error(400, "Already responded")
    ...

# In model
class Invitation:
    def can_accept(self):
        return self.expires_at > datetime.utcnow()

# In service
def process_acceptance(invitation, slot):
    if slot not in invitation.slots:
        raise InvalidSlot()
    ...
```

Consolidate into one rule:
```
rule CandidateAccepts {
    when: CandidateAccepts(invitation, slot)
    
    requires: invitation.status = pending
    requires: invitation.expires_at > now
    requires: slot in invitation.slots
    ...
}
```

### Challenge: Dead Code and Historical Accidents

Codebases accumulate:
- Features that were built but never used
- Workarounds for bugs that are now fixed
- Code paths that are never executed

Don't include these in the spec. If you're unsure:
1. Check if the code is actually reachable
2. Ask developers if it's intentional
3. Check git history for context

### Challenge: Missing Error Handling

Code might silently fail or have incomplete error handling:

```python
def send_notification(user, message):
    try:
        slack.send(user.slack_id, message)
    except SlackError:
        pass  # Silently ignore failures
```

The spec should capture the intended behaviour, not the bug:
```
ensures: Notification.sent(to: user, channel: slack)
```

Whether the current implementation properly handles failures is separate from what the system should do.

### Challenge: Over-Engineered Abstractions

Enterprise codebases often have abstraction layers that obscure intent:

```java
public interface NotificationStrategy {
    void notify(NotificationContext context);
}

public class SlackNotificationStrategy implements NotificationStrategy {
    @Override
    public void notify(NotificationContext context) {
        // Actual Slack call buried 5 levels deep
    }
}
```

Cut through to the actual behaviour. The spec doesn't need:
- Strategy patterns
- Dependency injection
- Abstract factories

Just: `ensures: Notification.sent(channel: slack, ...)`

---

## Checklist: Have You Abstracted Enough?

Before finalising a distilled spec:

- [ ] No database column types (Integer, VARCHAR, etc.)
- [ ] No ORM or query syntax
- [ ] No HTTP status codes or API paths
- [ ] No framework-specific concepts (middleware, decorators, etc.)
- [ ] No programming language types (int, str, List, etc.)
- [ ] No variable names from the code (use domain terms)
- [ ] No infrastructure (Redis, Kafka, S3, etc.)
- [ ] Foreign keys replaced with relationships
- [ ] Tokens/secrets removed (implementation of identity)
- [ ] Timestamps use domain Duration, not timedelta/seconds

If any remain, ask: "Would a stakeholder include this in a requirements doc?"

## Checklist: Terminology Consistency

- [ ] Each concept has exactly one name throughout the spec
- [ ] No "also known as" or "equivalent to" comments
- [ ] Cross-referenced related specs for conflicting terms
- [ ] Duplicate models in code flagged as technical debt to remove
