# Allium Pattern Library

## Overview

This library contains reusable patterns for common SaaS scenarios. Each pattern demonstrates specific Allium language features and can be adapted to your domain.

| Pattern | Key Features Demonstrated |
|---------|---------------------------|
| Password Auth with Reset | Temporal triggers, token lifecycle, configuration |
| Role-Based Access Control | Derived permissions, relationships, `requires` checks |
| Invitation to Resource | Join entities, permission levels, tokenised actions |
| Soft Delete & Restore | State machines, projections filtering deleted items |
| Notification Preferences | User preferences affecting rule behaviour, digest batching |
| Usage Limits & Quotas | Limit checks in `requires`, metered resources, plan tiers |
| Comments with Mentions | Nested entities, parsing triggers, cross-entity notifications |
| Integrating Library Specs | External spec references, configuration, responding to external triggers |

---

## Pattern 1: Password Authentication with Reset

**Demonstrates:** Temporal triggers, token lifecycle, configuration, multiple related rules

This pattern handles user registration, login and password reset: the foundation of most SaaS applications.

```
-- password-auth.allium

config {
    min_password_length: Integer = 12
    max_login_attempts: Integer = 5
    lockout_duration: Duration = PT15M
    reset_token_expiry: Duration = PT1H
    session_duration: Duration = PT24H
}

------------------------------------------------------------
-- Entities
------------------------------------------------------------

entity User {
    email: Email
    password_hash: String          -- stored, never exposed
    status: pending | active | locked | deactivated
    failed_login_attempts: Integer
    locked_until: Timestamp?
    
    -- Relationships
    sessions: Session for this user
    reset_tokens: PasswordResetToken for this user
    
    -- Projections
    active_sessions: sessions with status = active
    pending_reset_tokens: reset_tokens with status = pending

    -- Derived
    is_locked: status = locked and locked_until > now
}

entity Session {
    user: User
    created_at: Timestamp
    expires_at: Timestamp
    status: active | expired | revoked
    
    -- Derived
    is_valid: status = active and expires_at > now
}

entity PasswordResetToken {
    user: User
    created_at: Timestamp
    expires_at: Timestamp
    status: pending | used | expired
    
    -- Derived
    is_valid: status = pending and expires_at > now
}

------------------------------------------------------------
-- Registration
------------------------------------------------------------

rule Register {
    when: UserRegisters(email, password)
    
    requires: not User.exists(email: email)
    requires: password.length >= config/min_password_length
    
    ensures: User.created(
        email: email,
        password_hash: hash(password),    -- black box
        status: active,
        failed_login_attempts: 0
    )
    ensures: Email.sent(
        to: email,
        template: welcome
    )
}

------------------------------------------------------------
-- Login
------------------------------------------------------------

rule LoginSuccess {
    when: UserLogsIn(email, password)
    
    let user = User{email}
    
    requires: user.exists
    requires: not user.is_locked
    requires: verify(password, user.password_hash)    -- black box
    
    ensures: user.failed_login_attempts = 0
    ensures: Session.created(
        user: user,
        created_at: now,
        expires_at: now + config/session_duration,
        status: active
    )
}

rule LoginFailure {
    when: UserLogsIn(email, password)
    
    let user = User{email}
    
    requires: user.exists
    requires: not user.is_locked
    requires: not verify(password, user.password_hash)
    
    ensures: user.failed_login_attempts = user.failed_login_attempts + 1
    ensures:
        if user.failed_login_attempts >= config/max_login_attempts:
            user.status = locked
            user.locked_until = now + config/lockout_duration
            Email.sent(to: user.email, template: account_locked)
}

rule LoginAttemptWhileLocked {
    when: UserLogsIn(email, password)
    
    let user = User{email}
    
    requires: user.is_locked
    
    ensures: UserInformed(
        user: user,
        about: account_locked,
        with: { unlocks_at: user.locked_until }
    )
}

rule LockoutExpires {
    when: user.locked_until <= now
    
    requires: user.status = locked
    
    ensures: user.status = active
    ensures: user.failed_login_attempts = 0
    ensures: user.locked_until = null
}

------------------------------------------------------------
-- Logout
------------------------------------------------------------

rule Logout {
    when: UserLogsOut(session)
    
    requires: session.status = active
    
    ensures: session.status = revoked
}

rule SessionExpires {
    when: session.expires_at <= now
    
    requires: session.status = active
    
    ensures: session.status = expired
}

------------------------------------------------------------
-- Password Reset
------------------------------------------------------------

rule RequestPasswordReset {
    when: UserRequestsPasswordReset(email)
    
    let user = User{email}
    
    requires: user.exists
    requires: user.status in [active, locked]
    
    -- Invalidate any existing tokens
    ensures: user.pending_reset_tokens.each(t => t.status = expired)

    ensures:
        let token = PasswordResetToken.created(
            user: user,
            created_at: now,
            expires_at: now + config/reset_token_expiry,
            status: pending
        )
        Email.sent(
            to: email,
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
    ensures: user.failed_login_attempts = 0
    ensures: user.locked_until = null
    
    -- Invalidate all existing sessions
    ensures: user.active_sessions.each(s => s.status = revoked)
    
    ensures: Email.sent(
        to: user.email,
        template: password_changed
    )
}

rule ResetTokenExpires {
    when: token.expires_at <= now
    
    requires: token.status = pending
    
    ensures: token.status = expired
}
```

**Key language features shown:**
- `config` block with typed defaults
- Derived values (`is_locked`, `is_valid`)
- Multiple rules for same trigger with different `requires` (login success vs failure)
- Temporal triggers with guards (`when: token.expires_at <= now` with `requires: status = pending`)
- Projections for filtered collections (`pending_reset_tokens`)
- Bulk updates (`user.active_sessions.each(...)`)
- Explicit `let` binding for created entities
- Black box functions (`hash()`, `verify()`)

---

## Pattern 2: Role-Based Access Control (RBAC)

**Demonstrates:** Derived permissions, relationships, using permissions in `requires` clauses

This pattern implements hierarchical roles where higher roles inherit permissions from lower ones.

```
-- rbac.allium

------------------------------------------------------------
-- Entities
------------------------------------------------------------

entity Permission {
    name: String                    -- e.g., "documents.read", "documents.write"
    description: String
}

entity Role {
    name: String                    -- e.g., "viewer", "editor", "admin"
    permissions: Set<Permission>
    inherits_from: Role?            -- optional parent role
    
    -- Derived: all permissions including inherited
    effective_permissions: 
        permissions + (inherits_from?.effective_permissions ?? {})
}

entity User {
    email: Email
    name: String
}

entity Workspace {
    name: String
    owner: User
    
    -- Relationships
    memberships: WorkspaceMembership for this workspace
    
    -- Projections
    members: memberships -> user
    admins: memberships with role.name = "admin" -> user
}

-- Join entity connecting User, Workspace, and Role
entity WorkspaceMembership {
    user: User
    workspace: Workspace
    role: Role
    joined_at: Timestamp
    
    -- Derived: check specific permissions
    can_read: "documents.read" in role.effective_permissions
    can_write: "documents.write" in role.effective_permissions
    can_admin: "workspace.admin" in role.effective_permissions
}

------------------------------------------------------------
-- Defaults
------------------------------------------------------------

default Role viewer = {
    name: "viewer",
    permissions: { "documents.read" }
}

default Role editor = {
    name: "editor",
    permissions: { "documents.write" },
    inherits_from: viewer
}

default Role admin = {
    name: "admin",
    permissions: { "workspace.admin", "members.manage" },
    inherits_from: editor
}

------------------------------------------------------------
-- Rules
------------------------------------------------------------

rule CreateWorkspace {
    when: UserCreatesWorkspace(user, name)

    ensures:
        let workspace = Workspace.created(
            name: name,
            owner: user
        )
        -- Owner automatically becomes admin
        WorkspaceMembership.created(
            user: user,
            workspace: workspace,
            role: admin,
            joined_at: now
        )
}

rule AddMember {
    when: AddMemberToWorkspace(actor, workspace, new_user, role)
    
    let actor_membership = WorkspaceMembership{actor, workspace}
    
    requires: actor_membership.can_admin
    requires: not WorkspaceMembership{new_user, workspace}.exists
    
    ensures: WorkspaceMembership.created(
        user: new_user,
        workspace: workspace,
        role: role,
        joined_at: now
    )
    ensures: Email.sent(
        to: new_user.email,
        template: added_to_workspace,
        data: { workspace, role }
    )
}

rule ChangeMemberRole {
    when: ChangeMemberRole(actor, workspace, target_user, new_role)
    
    let actor_membership = WorkspaceMembership{actor, workspace}
    let target_membership = WorkspaceMembership{target_user, workspace}
    
    requires: actor_membership.can_admin
    requires: target_membership.exists
    requires: target_user != workspace.owner    -- can't change owner's role
    
    ensures: target_membership.role = new_role
}

rule RemoveMember {
    when: RemoveMemberFromWorkspace(actor, workspace, target_user)
    
    let actor_membership = WorkspaceMembership{actor, workspace}
    let target_membership = WorkspaceMembership{target_user, workspace}
    
    requires: actor_membership.can_admin
    requires: target_membership.exists
    requires: target_user != workspace.owner    -- can't remove owner
    
    ensures: target_membership.deleted
}

rule LeaveWorkspace {
    when: UserLeavesWorkspace(user, workspace)
    
    let membership = WorkspaceMembership{user, workspace}
    
    requires: membership.exists
    requires: user != workspace.owner    -- owner can't leave
    
    ensures: membership.deleted
}

------------------------------------------------------------
-- Using permissions in other rules
------------------------------------------------------------

rule CreateDocument {
    when: CreateDocument(user, workspace, title, content)
    
    let membership = WorkspaceMembership{user, workspace}
    
    requires: membership.can_write
    
    ensures: Document.created(
        workspace: workspace,
        created_by: user,
        title: title,
        content: content
    )
}

rule ViewDocument {
    when: ViewDocument(user, document)
    
    let membership = WorkspaceMembership{user, document.workspace}
    
    requires: membership.can_read
    
    ensures: DocumentView.recorded(user: user, document: document, at: now)
}
```

**Key language features shown:**
- Recursive derived values (`effective_permissions` includes inherited)
- Null-safe navigation (`inherits_from?.effective_permissions ?? {}`)
- Join entity lookup (`WorkspaceMembership{user, workspace}`)
- Permission checks in `requires` clauses
- Membership with `in` operator for set membership
- `deleted` as an outcome (soft or hard delete unspecified)

---

## Pattern 3: Invitation to Resource

**Demonstrates:** Tokenised actions, permission levels, invitation lifecycle, guest vs member flows

This pattern handles inviting users to collaborate on resources, whether they're existing users or not.

```
-- resource-invitation.allium

config {
    invitation_expiry: Duration = P7D
}

------------------------------------------------------------
-- Entities
------------------------------------------------------------

entity Resource {
    name: String
    owner: User
    
    -- Relationships
    shares: ResourceShare for this resource
    invitations: ResourceInvitation for this resource
    
    -- Projections
    active_shares: shares with status = active
    pending_invitations: invitations with status = pending
}

entity ResourceShare {
    resource: Resource
    user: User
    permission: view | edit | admin
    status: active | revoked
    created_at: Timestamp
    
    -- Derived
    can_view: permission in [view, edit, admin]
    can_edit: permission in [edit, admin]
    can_admin: permission = admin
    can_invite: permission in [edit, admin]    -- editors and admins can invite
}

entity ResourceInvitation {
    resource: Resource
    email: Email
    permission: view | edit | admin
    invited_by: User
    created_at: Timestamp
    expires_at: Timestamp
    status: pending | accepted | declined | expired | revoked
    
    -- Derived
    is_valid: status = pending and expires_at > now
}

------------------------------------------------------------
-- Inviting
------------------------------------------------------------

rule InviteToResource {
    when: InviteToResource(inviter, resource, email, permission)
    
    let inviter_share = ResourceShare{resource, inviter}
    
    requires: inviter = resource.owner or inviter_share.can_invite
    requires: permission in [view, edit]    -- can't invite as admin unless owner
              or (permission = admin and inviter = resource.owner)
    requires: not ResourceShare{resource, User{email}}.exists    -- not already shared
    requires: not ResourceInvitation{resource, email}.is_valid   -- no pending invite
    
    ensures: ResourceInvitation.created(
        resource: resource,
        email: email,
        permission: permission,
        invited_by: inviter,
        created_at: now,
        expires_at: now + config/invitation_expiry,
        status: pending
    )
    ensures: Email.sent(
        to: email,
        template: resource_invitation,
        data: { 
            resource: resource,
            inviter: inviter,
            permission: permission
        }
    )
}

------------------------------------------------------------
-- Accepting (existing user)
------------------------------------------------------------

rule AcceptInvitationExistingUser {
    when: AcceptInvitation(invitation, user)
    
    requires: invitation.is_valid
    requires: user.email = invitation.email
    
    ensures: invitation.status = accepted
    ensures: ResourceShare.created(
        resource: invitation.resource,
        user: user,
        permission: invitation.permission,
        status: active,
        created_at: now
    )
    ensures: Notification.sent(
        to: invitation.invited_by,
        template: invitation_accepted,
        data: { resource: invitation.resource, user: user }
    )
}

------------------------------------------------------------
-- Accepting (new user - triggers signup flow)
------------------------------------------------------------

rule AcceptInvitationNewUser {
    when: AcceptInvitation(invitation, email, name, password)

    requires: invitation.is_valid
    requires: email = invitation.email
    requires: not User.exists(email: email)

    ensures:
        let user = User.created(
            email: email,
            name: name,
            password_hash: hash(password),
            status: active
        )
        invitation.status = accepted
        ResourceShare.created(
            resource: invitation.resource,
            user: user,
            permission: invitation.permission,
            status: active,
            created_at: now
        )
        Notification.sent(
            to: invitation.invited_by,
            template: invitation_accepted,
            data: { resource: invitation.resource, user: user }
        )
}

------------------------------------------------------------
-- Declining and expiring
------------------------------------------------------------

rule DeclineInvitation {
    when: DeclineInvitation(invitation)
    
    requires: invitation.is_valid
    
    ensures: invitation.status = declined
}

rule InvitationExpires {
    when: invitation.expires_at <= now
    
    requires: invitation.status = pending
    
    ensures: invitation.status = expired
}

rule RevokeInvitation {
    when: RevokeInvitation(actor, invitation)
    
    let actor_share = ResourceShare{invitation.resource, actor}
    
    requires: invitation.status = pending
    requires: actor = invitation.resource.owner or actor_share.can_admin
    
    ensures: invitation.status = revoked
}

------------------------------------------------------------
-- Managing shares
------------------------------------------------------------

rule ChangeSharePermission {
    when: ChangeSharePermission(actor, share, new_permission)
    
    let actor_share = ResourceShare{share.resource, actor}
    
    requires: actor = share.resource.owner or actor_share.can_admin
    requires: share.user != share.resource.owner    -- can't change owner
    requires: share.status = active
    
    ensures: share.permission = new_permission
}

rule RevokeShare {
    when: RevokeShare(actor, share)
    
    let actor_share = ResourceShare{share.resource, actor}
    
    requires: actor = share.resource.owner or actor_share.can_admin
    requires: share.user != share.resource.owner
    requires: share.status = active
    
    ensures: share.status = revoked
    ensures: Notification.sent(
        to: share.user,
        template: access_revoked,
        data: { resource: share.resource }
    )
}
```

**Key language features shown:**
- Complex permission logic in `requires`
- Multiple rules for same trigger with different shapes (existing vs new user)
- Invitation lifecycle (pending → accepted/declined/expired/revoked)
- Checking existence with `.exists`
- Permission escalation prevention (`can't invite as admin unless owner`)

---

## Pattern 4: Soft Delete & Restore

**Demonstrates:** Simple state machines, projections that filter deleted items, retention policies

This pattern implements soft delete where items appear deleted but can be restored within a retention period.

```
-- soft-delete.allium

config {
    retention_period: Duration = P30D
}

------------------------------------------------------------
-- Entities
------------------------------------------------------------

entity Document {
    workspace: Workspace
    title: String
    content: String
    created_by: User
    created_at: Timestamp
    status: active | deleted
    deleted_at: Timestamp?
    deleted_by: User?
    
    -- Derived
    is_active: status = active
    retention_expires_at: deleted_at + config/retention_period
    can_restore: status = deleted and retention_expires_at > now
}

-- Extend Workspace to show how projections filter
entity Workspace {
    name: String
    
    -- Relationships
    all_documents: Document for this workspace
    
    -- Projections (what users typically see)
    documents: all_documents with status = active
    deleted_documents: all_documents with status = deleted
    restorable_documents: all_documents with can_restore = true
}

------------------------------------------------------------
-- Rules
------------------------------------------------------------

rule DeleteDocument {
    when: DeleteDocument(actor, document)
    
    let membership = WorkspaceMembership{actor, document.workspace}
    
    requires: document.status = active
    requires: actor = document.created_by or membership.can_admin
    
    ensures: document.status = deleted
    ensures: document.deleted_at = now
    ensures: document.deleted_by = actor
}

rule RestoreDocument {
    when: RestoreDocument(actor, document)
    
    let membership = WorkspaceMembership{actor, document.workspace}
    
    requires: document.can_restore
    requires: actor = document.deleted_by or membership.can_admin
    
    ensures: document.status = active
    ensures: document.deleted_at = null
    ensures: document.deleted_by = null
}

rule PermanentlyDelete {
    when: PermanentlyDelete(actor, document)
    
    let membership = WorkspaceMembership{actor, document.workspace}
    
    requires: document.status = deleted
    requires: membership.can_admin
    
    ensures: document.permanently_deleted    -- actually removed
}

rule RetentionExpires {
    when: document.retention_expires_at <= now
    
    requires: document.status = deleted
    
    ensures: document.permanently_deleted
}

------------------------------------------------------------
-- Bulk operations
------------------------------------------------------------

rule EmptyTrash {
    when: EmptyTrash(actor, workspace)
    
    let membership = WorkspaceMembership{actor, workspace}
    
    requires: membership.can_admin
    
    ensures: workspace.deleted_documents.each(d => d.permanently_deleted)
}

rule RestoreAll {
    when: RestoreAllDeleted(actor, workspace)
    
    let membership = WorkspaceMembership{actor, workspace}
    
    requires: membership.can_admin
    
    ensures: workspace.restorable_documents.each(d => 
        d.status = active,
        d.deleted_at = null,
        d.deleted_by = null
    )
}
```

**Key language features shown:**
- `status` field with clear lifecycle
- Nullable timestamps (`deleted_at: Timestamp?`)
- Projections filtering by status (`documents: all_documents with status = active`)
- Derived values using config (`retention_expires_at: deleted_at + config/retention_period`)
- Temporal trigger for automatic cleanup (`when: document.retention_expires_at <= now`)
- `permanently_deleted` as distinct from soft delete
- Bulk operations with `.each()`

---

## Pattern 5: Notification Preferences & Digests

**Demonstrates:** User preferences affecting rule behaviour, batching/digest logic, temporal triggers for scheduled sends

This pattern handles in-app notifications with user-controlled email preferences and digest batching.

```
-- notifications.allium

config {
    digest_time: Time = 09:00
    max_batch_size: Integer = 50
}

------------------------------------------------------------
-- Entities
------------------------------------------------------------

entity User {
    email: Email
    name: String
    
    -- Relationships
    notification_settings: NotificationSetting for this user
    notifications: Notification for this user
    
    -- Projections
    unread_notifications: notifications with status = unread
    pending_email_notifications: notifications with email_status = pending
    recent_pending_notifications: notifications with email_status = pending and created_at >= now - PT24H
}

entity NotificationSetting {
    user: User
    
    -- Per-type email preferences
    email_on_mention: immediately | daily_digest | never
    email_on_comment: immediately | daily_digest | never
    email_on_share: immediately | daily_digest | never
    email_on_assignment: immediately | daily_digest | never
    
    -- Global settings
    digest_enabled: Boolean
    digest_day_of_week: Set<DayOfWeek>    -- e.g., { monday, wednesday, friday }
}

entity Notification {
    user: User
    type: mention | comment | share | assignment | system
    title: String
    body: String
    link: URL?
    created_at: Timestamp
    status: unread | read | archived
    email_status: pending | sent | skipped | digested
    
    -- Derived
    is_unread: status = unread
}

entity DigestBatch {
    user: User
    notifications: Set<Notification>
    created_at: Timestamp
    sent_at: Timestamp?
    status: pending | sent | failed
}

------------------------------------------------------------
-- Creating notifications
------------------------------------------------------------

rule CreateNotification {
    when: NotificationTriggered(user, type, title, body, link)
    
    let settings = user.notification_settings
    let email_preference = settings.preference_for(type)    -- black box lookup
    
    ensures:
        let notification = Notification.created(
            user: user,
            type: type,
            title: title,
            body: body,
            link: link,
            created_at: now,
            status: unread,
            email_status: if email_preference = never then skipped else pending
        )
        -- Immediate email if preference is "immediately"
        if email_preference = immediately:
            Email.sent(
                to: user.email,
                template: notification_immediate,
                data: { notification: notification }
            )
            notification.email_status = sent

------------------------------------------------------------
-- Reading notifications
------------------------------------------------------------

rule MarkAsRead {
    when: MarkNotificationRead(user, notification)
    
    requires: notification.user = user
    requires: notification.status = unread
    
    ensures: notification.status = read
}

rule MarkAllAsRead {
    when: MarkAllNotificationsRead(user)
    
    ensures: user.unread_notifications.each(n => n.status = read)
}

rule ArchiveNotification {
    when: ArchiveNotification(user, notification)
    
    requires: notification.user = user
    
    ensures: notification.status = archived
}

------------------------------------------------------------
-- Daily digest
------------------------------------------------------------

rule CreateDailyDigest {
    when: time_of_day = config/digest_time
    for each: user in Users with notification_settings.digest_enabled = true
    
    let today = current_day_of_week
    let settings = user.notification_settings
    let pending = user.recent_pending_notifications.take(config/max_batch_size)
    
    requires: today in settings.digest_day_of_week
    requires: pending.count > 0
    
    ensures: DigestBatch.created(
        user: user,
        notifications: pending,
        created_at: now,
        status: pending
    )
    ensures: pending.each(n => n.email_status = digested)
}

rule SendDigest {
    when: batch: DigestBatch.created

    requires: batch.status = pending
    requires: batch.notifications.count > 0
    
    ensures: Email.sent(
        to: batch.user.email,
        template: daily_digest,
        data: { 
            notifications: batch.notifications,
            unread_count: batch.user.unread_notifications.count
        }
    )
    ensures: batch.status = sent
    ensures: batch.sent_at = now
}

------------------------------------------------------------
-- Preference updates
------------------------------------------------------------

rule UpdateNotificationPreferences {
    when: UpdatePreferences(user, preferences)
    
    let settings = user.notification_settings
    
    ensures: settings.email_on_mention = preferences.mention
    ensures: settings.email_on_comment = preferences.comment
    ensures: settings.email_on_share = preferences.share
    ensures: settings.email_on_assignment = preferences.assignment
    ensures: settings.digest_enabled = preferences.digest_enabled
    ensures: settings.digest_day_of_week = preferences.digest_days
}
```

**Key language features shown:**
- User preferences stored as entity
- Conditional logic based on preferences (`if email_preference = immediately`)
- Scheduled triggers (`when: time_of_day = config/digest_time`)
- `for each` with filter (`for each: user in Users with ... = true`)
- Set membership (`today in settings.digest_day_of_week`)
- Batching and limiting (`.take(config/max_batch_size)`)
- Multi-step flows (create batch → send batch)

---

## Pattern 6: Usage Limits & Quotas

**Demonstrates:** Limit checks in `requires`, metered resources, plan tiers, overage handling

This pattern handles SaaS usage limits: different plans have different quotas, and usage is tracked and enforced.

```
-- usage-limits.allium

------------------------------------------------------------
-- Entities
------------------------------------------------------------

entity Plan {
    name: String                    -- e.g., "free", "pro", "enterprise"
    
    -- Limits (-1 = unlimited)
    max_documents: Integer
    max_storage_bytes: Integer
    max_team_members: Integer
    max_api_requests_per_day: Integer
    
    -- Features
    features: Set<Feature>
    
    -- Derived
    has_unlimited_documents: max_documents = -1
    has_unlimited_storage: max_storage_bytes = -1
}

entity Workspace {
    name: String
    plan: Plan
    
    -- Relationships
    documents: Document for this workspace
    members: WorkspaceMembership for this workspace
    usage: WorkspaceUsage for this workspace
    
    -- Derived limits
    documents_remaining: 
        if plan.has_unlimited_documents 
        then unlimited 
        else plan.max_documents - documents.count
    
    storage_remaining:
        if plan.has_unlimited_storage
        then unlimited
        else plan.max_storage_bytes - usage.storage_bytes_used
    
    members_remaining:
        plan.max_team_members - members.count
    
    -- Derived checks
    can_add_document: documents_remaining > 0 or documents_remaining = unlimited
    can_add_member: members_remaining > 0
    can_use_feature(f): f in plan.features
}

entity WorkspaceUsage {
    workspace: Workspace
    storage_bytes_used: Integer
    api_requests_today: Integer
    last_reset_date: Date
    
    -- Derived
    api_requests_remaining:
        workspace.plan.max_api_requests_per_day - api_requests_today
}

entity UsageEvent {
    workspace: Workspace
    type: document_created | document_deleted | storage_added | 
          storage_removed | api_request | member_added | member_removed
    amount: Integer
    recorded_at: Timestamp
}

------------------------------------------------------------
-- Defaults
------------------------------------------------------------

default Plan free = {
    name: "free",
    max_documents: 10,
    max_storage_bytes: 100_000_000,    -- 100MB
    max_team_members: 3,
    max_api_requests_per_day: 100,
    features: { basic_editing }
}

default Plan pro = {
    name: "pro",
    max_documents: 1000,
    max_storage_bytes: 10_000_000_000,  -- 10GB
    max_team_members: 20,
    max_api_requests_per_day: 10000,
    features: { basic_editing, advanced_editing, api_access, integrations }
}

default Plan enterprise = {
    name: "enterprise",
    max_documents: -1,                  -- unlimited
    max_storage_bytes: -1,              -- unlimited
    max_team_members: -1,               -- unlimited
    max_api_requests_per_day: -1,       -- unlimited
    features: { basic_editing, advanced_editing, api_access, integrations, 
                sso, audit_log, custom_branding }
}

------------------------------------------------------------
-- Enforcing limits
------------------------------------------------------------

rule CreateDocument {
    when: CreateDocument(user, workspace, title)
    
    requires: workspace.can_add_document
    
    ensures: Document.created(workspace: workspace, title: title, created_by: user)
    ensures: UsageEvent.created(
        workspace: workspace,
        type: document_created,
        amount: 1,
        recorded_at: now
    )
}

rule CreateDocumentLimitReached {
    when: CreateDocument(user, workspace, title)
    
    requires: not workspace.can_add_document
    
    ensures: UserInformed(
        user: user,
        about: limit_reached,
        with: { 
            limit_type: documents,
            current: workspace.documents.count,
            max: workspace.plan.max_documents,
            upgrade_path: next_plan(workspace.plan)
        }
    )
}

rule AddTeamMember {
    when: AddMember(actor, workspace, new_member, role)
    
    requires: workspace.can_add_member
    requires: WorkspaceMembership{actor, workspace}.can_admin
    
    ensures: WorkspaceMembership.created(...)
    ensures: UsageEvent.created(
        workspace: workspace,
        type: member_added,
        amount: 1,
        recorded_at: now
    )
}

rule UseFeature {
    when: UseFeature(user, workspace, feature)
    
    requires: workspace.can_use_feature(feature)
    
    ensures: FeatureUsed(workspace: workspace, feature: feature, by: user)
}

rule UseFeatureNotAvailable {
    when: UseFeature(user, workspace, feature)
    
    requires: not workspace.can_use_feature(feature)
    
    ensures: UserInformed(
        user: user,
        about: feature_not_available,
        with: {
            feature: feature,
            available_on: plans_with_feature(feature)
        }
    )
}

------------------------------------------------------------
-- API rate limiting
------------------------------------------------------------

rule RecordApiRequest {
    when: ApiRequestReceived(workspace, endpoint)
    
    let usage = workspace.usage
    
    requires: usage.api_requests_remaining > 0
    
    ensures: usage.api_requests_today = usage.api_requests_today + 1
    ensures: UsageEvent.created(
        workspace: workspace,
        type: api_request,
        amount: 1,
        recorded_at: now
    )
}

rule ApiRateLimitExceeded {
    when: ApiRequestReceived(workspace, endpoint)
    
    let usage = workspace.usage
    
    requires: usage.api_requests_remaining <= 0
    
    ensures: ApiResponse.returned(
        status: 429,
        body: { 
            error: "rate_limit_exceeded",
            resets_at: tomorrow_midnight
        }
    )
}

rule ResetDailyApiUsage {
    when: date_changed
    for each: usage in WorkspaceUsage
    
    requires: usage.last_reset_date < today
    
    ensures: usage.api_requests_today = 0
    ensures: usage.last_reset_date = today
}

------------------------------------------------------------
-- Plan changes
------------------------------------------------------------

rule UpgradePlan {
    when: UpgradePlan(workspace, new_plan)
    
    requires: new_plan.max_documents >= workspace.plan.max_documents
              or new_plan.has_unlimited_documents
    
    ensures: workspace.plan = new_plan
    ensures: Email.sent(
        to: workspace.owner.email,
        template: plan_upgraded,
        data: { old_plan: workspace.plan, new_plan: new_plan }
    )
}

rule DowngradePlan {
    when: DowngradePlan(workspace, new_plan)
    
    -- Can only downgrade if under new plan's limits
    requires: workspace.documents.count <= new_plan.max_documents
              or new_plan.has_unlimited_documents
    requires: workspace.members.count <= new_plan.max_team_members
    requires: workspace.usage.storage_bytes_used <= new_plan.max_storage_bytes
              or new_plan.has_unlimited_storage
    
    ensures: workspace.plan = new_plan
    ensures: Email.sent(
        to: workspace.owner.email,
        template: plan_downgraded,
        data: { old_plan: workspace.plan, new_plan: new_plan }
    )
}

rule DowngradeBlocked {
    when: DowngradePlan(workspace, new_plan)
    
    requires: workspace.documents.count > new_plan.max_documents
              and not new_plan.has_unlimited_documents
    
    ensures: UserInformed(
        user: workspace.owner,
        about: downgrade_blocked,
        with: {
            reason: documents,
            current: workspace.documents.count,
            new_limit: new_plan.max_documents,
            must_delete: workspace.documents.count - new_plan.max_documents
        }
    )
}
```

**Key language features shown:**
- Plan definitions with limits
- Derived values with `unlimited` handling
- `requires` checking limits before actions
- Paired rules for success/failure cases
- Usage tracking with events
- Daily reset with temporal trigger
- Plan upgrade/downgrade logic with limit validation
- Feature flags (`can_use_feature(f)`)

---

## Pattern 7: Comments with Mentions

**Demonstrates:** Nested entities, parsing for mentions, cross-entity notifications, threading

This pattern implements comments with @mentions, including mention parsing and notification generation.

```
-- comments.allium

------------------------------------------------------------
-- Entities
------------------------------------------------------------

entity Commentable {
    -- Abstract: could be Document, Task, Project, etc.
    -- Defined by consuming spec
}

entity Comment {
    parent: Commentable
    reply_to: Comment?              -- null for top-level, set for replies
    author: User
    body: String
    created_at: Timestamp
    edited_at: Timestamp?
    status: active | deleted
    
    -- Relationships
    mentions: CommentMention for this comment
    replies: Comment with reply_to = this
    reactions: CommentReaction for this comment
    
    -- Projections
    active_replies: replies with status = active
    
    -- Derived
    is_reply: reply_to != null
    is_edited: edited_at != null
    mentioned_users: mentions -> user
    thread_depth: if is_reply then reply_to.thread_depth + 1 else 0
}

-- Join entity for mentions
entity CommentMention {
    comment: Comment
    user: User
    notified: Boolean
}

entity CommentReaction {
    comment: Comment
    user: User
    emoji: String                   -- e.g., "👍", "❤️", "🎉"
    created_at: Timestamp
}

------------------------------------------------------------
-- Creating comments
------------------------------------------------------------

rule CreateComment {
    when: CreateComment(author, parent, body)

    let mentioned_usernames = parse_mentions(body)    -- black box: extracts @username
    let mentioned_users = users_with_usernames(mentioned_usernames)    -- black box lookup

    ensures:
        let comment = Comment.created(
            parent: parent,
            reply_to: null,
            author: author,
            body: body,
            created_at: now,
            status: active
        )
        for each user in mentioned_users:
            CommentMention.created(
                comment: comment,
                user: user,
                notified: false
            )
}

rule CreateReply {
    when: CreateReply(author, parent_comment, body)

    let mentioned_usernames = parse_mentions(body)
    let mentioned_users = users_with_usernames(mentioned_usernames)    -- black box lookup

    requires: parent_comment.status = active
    requires: parent_comment.thread_depth < 3    -- limit nesting

    ensures:
        let comment = Comment.created(
            parent: parent_comment.parent,
            reply_to: parent_comment,
            author: author,
            body: body,
            created_at: now,
            status: active
        )
        for each user in mentioned_users:
            CommentMention.created(
                comment: comment,
                user: user,
                notified: false
            )
}

------------------------------------------------------------
-- Notifications for mentions
------------------------------------------------------------

rule NotifyMentionedUser {
    when: mention: CommentMention.created

    requires: mention.user != mention.comment.author    -- don't notify self
    requires: not mention.notified
    
    ensures: mention.notified = true
    ensures: Notification.created(
        user: mention.user,
        type: mention,
        title: "{author} mentioned you",
        body: truncate(mention.comment.body, 100),
        link: mention.comment.parent.url
    )
}

rule NotifyCommentAuthorOfReply {
    when: comment: Comment.created

    let original_author = comment.reply_to?.author
    
    requires: comment.is_reply
    requires: original_author != null
    requires: original_author != comment.author    -- don't notify self
    requires: original_author not in comment.mentioned_users    -- avoid double notify
    
    ensures: Notification.created(
        user: original_author,
        type: comment,
        title: "{author} replied to your comment",
        body: truncate(comment.body, 100),
        link: comment.parent.url
    )
}

------------------------------------------------------------
-- Editing
------------------------------------------------------------

rule EditComment {
    when: EditComment(actor, comment, new_body)

    requires: actor = comment.author
    requires: comment.status = active

    let old_mentions = comment.mentioned_users
    let new_mentioned_usernames = parse_mentions(new_body)
    let new_mentioned_users = users_with_usernames(new_mentioned_usernames)    -- black box lookup
    let added_mentions = new_mentioned_users - old_mentions
    let removed_mentions = old_mentions - new_mentioned_users

    ensures: comment.body = new_body
    ensures: comment.edited_at = now

    -- Remove old mentions that are no longer present
    ensures: for each user in removed_mentions:
        CommentMention{comment, user}.deleted

    -- Add new mentions
    ensures: for each user in added_mentions:
        CommentMention.created(
            comment: comment,
            user: user,
            notified: false
        )
}

------------------------------------------------------------
-- Deleting
------------------------------------------------------------

rule DeleteComment {
    when: DeleteComment(actor, comment)
    
    requires: actor = comment.author or actor.is_admin
    requires: comment.status = active
    
    ensures: comment.status = deleted
    -- Note: replies remain but show "deleted comment"
}

------------------------------------------------------------
-- Reactions
------------------------------------------------------------

rule AddReaction {
    when: AddReaction(user, comment, emoji)
    
    requires: comment.status = active
    requires: not CommentReaction{comment, user, emoji}.exists
    
    ensures: CommentReaction.created(
        comment: comment,
        user: user,
        emoji: emoji,
        created_at: now
    )
}

rule RemoveReaction {
    when: RemoveReaction(user, comment, emoji)
    
    let reaction = CommentReaction{comment, user, emoji}
    
    requires: reaction.exists
    
    ensures: reaction.deleted
}

rule ToggleReaction {
    when: ToggleReaction(user, comment, emoji)
    
    let existing = CommentReaction{comment, user, emoji}
    
    ensures:
        if existing.exists:
            existing.deleted
        else:
            CommentReaction.created(
                comment: comment,
                user: user,
                emoji: emoji,
                created_at: now
            )
}
```

**Key language features shown:**
- Nested/recursive entities (comments with replies)
- Entity creation triggers with binding (`when: mention: CommentMention.created`)
- Black box functions (`parse_mentions()`, `users_with_usernames()`)
- Explicit `let` binding for created entities
- Set operations (`new_mentioned_users - old_mentions`)
- Depth limiting (`thread_depth < 3`)
- Multiple notifications from one action (mention + reply)
- Avoiding double notifications (`original_author not in comment.mentioned_users`)
- Toggle pattern with conditional ensures
- Join entity with three keys (`CommentReaction{comment, user, emoji}`)

---

## Pattern 8: Integrating Library Specs

**Demonstrates:** External spec references with coordinates, configuration blocks, responding to external triggers, using external entities

Library specs are standalone specifications for common functionality - authentication providers, payment processors, email services, etc. They define a contract that implementations must satisfy, and your application spec composes them in.

### Example: OAuth Authentication

This example shows integrating a library OAuth spec into your application. The OAuth spec handles the authentication flow; your application responds to authentication events and manages application-level user state.

```
-- app-auth.allium

------------------------------------------------------------
-- External Spec References
------------------------------------------------------------

-- Reference the OAuth spec from the library
-- The coordinate is immutable (git SHA), ensuring reproducible specs
use "github.com/allium-specs/oauth2/a]f8e2c1d" as oauth

-- Configure the OAuth spec for our application
oauth/config {
    providers: { google, microsoft, github }
    session_duration: PT24H
    refresh_window: PT1H
    link_expiry: PT15M
}

------------------------------------------------------------
-- Application Entities
------------------------------------------------------------

-- Our application's User entity, linked to OAuth identities
entity User {
    email: Email
    name: String
    avatar_url: URL?
    status: active | suspended | deactivated
    created_at: Timestamp
    last_login_at: Timestamp?

    -- Relationship to OAuth sessions (from external spec)
    sessions: oauth/Session for this user
    identities: oauth/Identity for this user

    -- Projections
    active_sessions: sessions with status = active

    -- Derived
    is_authenticated: active_sessions.count > 0
    linked_providers: identities -> provider
}

-- Application-specific user preferences
entity UserPreferences {
    user: User
    theme: light | dark | system
    timezone: String
    locale: String
}

------------------------------------------------------------
-- Responding to OAuth Events
------------------------------------------------------------

-- When a user authenticates for the first time, create our User entity
rule CreateUserOnFirstLogin {
    when: oauth/AuthenticationSucceeded(identity, session)

    requires: not User.exists(email: identity.email)

    ensures:
        let user = User.created(
            email: identity.email,
            name: identity.display_name,
            avatar_url: identity.avatar_url,
            status: active,
            created_at: now,
            last_login_at: now
        )
        -- Link the OAuth identity to our user
        identity.user = user
        session.user = user
        -- Create default preferences
        UserPreferences.created(
            user: user,
            theme: system,
            timezone: identity.timezone ?? "UTC",
            locale: identity.locale ?? "en"
        )
        Email.sent(
            to: user.email,
            template: welcome,
            data: { user: user, provider: identity.provider }
        )
}

-- When an existing user logs in, update last login
rule UpdateUserOnLogin {
    when: oauth/AuthenticationSucceeded(identity, session)

    let user = User{email: identity.email}

    requires: user.exists
    requires: user.status = active

    ensures: user.last_login_at = now
    ensures: session.user = user
}

-- Block login for suspended users
rule BlockSuspendedUserLogin {
    when: oauth/AuthenticationSucceeded(identity, session)

    let user = User{email: identity.email}

    requires: user.exists
    requires: user.status = suspended

    ensures: session.status = revoked
    ensures: UserInformed(
        user: user,
        about: account_suspended,
        with: { contact: "support@example.com" }
    )
}

-- When OAuth session expires, we might want to notify
rule NotifySessionExpiring {
    when: session: oauth/Session.status becomes expiring

    let user = session.user

    requires: user != null

    ensures: Notification.created(
        user: user,
        type: system,
        title: "Session expiring soon",
        body: "Your session will expire in {session.time_remaining}. Save your work."
    )
}

-- Audit logging for security events
rule AuditLogout {
    when: oauth/SessionTerminated(session, reason)

    let user = session.user

    requires: user != null

    ensures: AuditLog.created(
        user: user,
        event: logout,
        reason: reason,
        timestamp: now,
        metadata: { provider: session.provider, session_id: session.id }
    )
}

------------------------------------------------------------
-- Application Actions Using OAuth
------------------------------------------------------------

rule LinkAdditionalProvider {
    when: LinkProvider(user, provider)

    requires: user.status = active
    requires: provider not in user.linked_providers

    -- Trigger the OAuth flow from the library spec
    ensures: oauth/InitiateAuthentication(
        provider: provider,
        intent: link_account,
        existing_user: user
    )
}

rule UnlinkProvider {
    when: UnlinkProvider(user, provider)

    let identity = oauth/Identity{user, provider}

    requires: user.status = active
    requires: identity.exists
    requires: user.linked_providers.count > 1    -- must keep at least one

    ensures: identity.deleted
    ensures: AuditLog.created(
        user: user,
        event: provider_unlinked,
        timestamp: now,
        metadata: { provider: provider }
    )
}
```

### Example: Payment Processing

This example shows integrating a payment processor spec for subscription billing.

```
-- billing.allium

------------------------------------------------------------
-- External Spec References
------------------------------------------------------------

use "github.com/allium-specs/stripe-billing/b2c4e6f8" as stripe

stripe/config {
    currency: USD
    tax_calculation: automatic
    proration: create_prorations
    trial_period: P14D
}

------------------------------------------------------------
-- Application Entities
------------------------------------------------------------

entity Organisation {
    name: String
    owner: User

    -- Link to Stripe customer (from external spec)
    stripe_customer: stripe/Customer?

    -- Relationships
    subscription: Subscription for this organisation
    invoices: stripe/Invoice for this stripe_customer

    -- Derived
    is_paying: subscription?.status = active
    has_payment_method: stripe_customer?.default_payment_method != null
}

entity Subscription {
    organisation: Organisation
    plan: Plan
    status: trialing | active | past_due | cancelled | expired
    started_at: Timestamp
    trial_ends_at: Timestamp?
    current_period_ends_at: Timestamp

    -- Link to Stripe subscription
    stripe_subscription: stripe/Subscription?

    -- Derived
    is_trial: status = trialing
    days_until_renewal: current_period_ends_at - now
}

------------------------------------------------------------
-- Responding to Payment Events
------------------------------------------------------------

-- When Stripe confirms payment, activate or renew subscription
rule ActivateOnPaymentSuccess {
    when: stripe/PaymentSucceeded(invoice)

    let customer = invoice.customer
    let org = Organisation{stripe_customer: customer}
    let sub = org.subscription

    requires: org.exists
    requires: sub.status in [trialing, past_due]

    ensures: sub.status = active
    ensures: sub.current_period_ends_at = invoice.period_end
    ensures: Email.sent(
        to: org.owner.email,
        template: payment_confirmed,
        data: { amount: invoice.amount, next_billing: invoice.period_end }
    )
}

-- Handle failed payments
rule HandlePaymentFailure {
    when: stripe/PaymentFailed(invoice, failure_reason)

    let customer = invoice.customer
    let org = Organisation{stripe_customer: customer}
    let sub = org.subscription

    requires: org.exists

    ensures: sub.status = past_due
    ensures: Email.sent(
        to: org.owner.email,
        template: payment_failed,
        data: {
            reason: failure_reason,
            retry_date: invoice.next_payment_attempt,
            update_payment_url: org.billing_portal_url
        }
    )
    ensures: Notification.created(
        user: org.owner,
        type: billing,
        title: "Payment failed",
        body: "We couldn't process your payment. Please update your payment method."
    )
}

-- When trial is ending, remind user
rule TrialEndingReminder {
    when: sub.trial_ends_at - P3D <= now

    requires: sub.status = trialing
    requires: not sub.trial_reminder_sent

    let org = sub.organisation

    ensures: sub.trial_reminder_sent = true
    ensures: Email.sent(
        to: org.owner.email,
        template: trial_ending,
        data: {
            days_remaining: 3,
            plan: sub.plan,
            has_payment_method: org.has_payment_method
        }
    )
}

-- Respond to subscription cancellation from Stripe
rule HandleSubscriptionCancelled {
    when: stripe/SubscriptionCancelled(stripe_sub, reason)

    let sub = Subscription{stripe_subscription: stripe_sub}
    let org = sub.organisation

    requires: sub.exists

    ensures: sub.status = cancelled
    ensures: Email.sent(
        to: org.owner.email,
        template: subscription_cancelled,
        data: { reason: reason, access_until: sub.current_period_ends_at }
    )
    ensures: AuditLog.created(
        user: org.owner,
        event: subscription_cancelled,
        timestamp: now,
        metadata: { reason: reason, plan: sub.plan.name }
    )
}

------------------------------------------------------------
-- Application Actions Using Stripe
------------------------------------------------------------

rule StartSubscription {
    when: StartSubscription(org, plan)

    requires: org.subscription = null or org.subscription.status in [cancelled, expired]
    requires: org.stripe_customer != null
    requires: org.has_payment_method

    ensures: stripe/CreateSubscription(
        customer: org.stripe_customer,
        price: plan.stripe_price_id,
        trial_period: if plan.has_trial then stripe/config.trial_period else null
    )
}

rule ChangePlan {
    when: ChangePlan(org, new_plan)

    let sub = org.subscription

    requires: sub.status = active
    requires: new_plan != sub.plan

    ensures: stripe/UpdateSubscription(
        subscription: sub.stripe_subscription,
        new_price: new_plan.stripe_price_id
    )
    ensures: sub.plan = new_plan
}

rule CancelSubscription {
    when: CancelSubscription(org, reason)

    let sub = org.subscription

    requires: sub.status in [active, trialing]

    ensures: stripe/CancelSubscription(
        subscription: sub.stripe_subscription,
        at_period_end: true    -- access continues until paid period ends
    )
    ensures: AuditLog.created(
        user: org.owner,
        event: cancellation_requested,
        timestamp: now,
        metadata: { reason: reason }
    )
}
```

**Key language features shown:**
- External spec references with immutable coordinates (`use "github.com/.../abc123" as alias`)
- Configuration blocks for external specs (`oauth/config { ... }`)
- Responding to external triggers (`when: oauth/AuthenticationSucceeded(...)`)
- Responding to external state transitions (`when: stripe/Subscription.status becomes cancelled`)
- Using external entities (`oauth/Session`, `stripe/Customer`)
- Linking application entities to external entities (`stripe_customer: stripe/Customer?`)
- Triggering external actions (`ensures: stripe/CreateSubscription(...)`)
- Qualified names throughout (`oauth/Session`, `stripe/config.trial_period`)

### Library Spec Design Principles

When creating or choosing library specs:

1. **Immutable coordinates**: Always use content-addressed references (git SHAs), never floating versions
2. **Configuration over convention**: Library specs should expose configuration for anything that might vary between applications
3. **Observable triggers**: Library specs should emit triggers for all significant events so consuming specs can respond
4. **Minimal coupling**: Library specs shouldn't depend on your application entities - the linkage goes one way
5. **Clear boundaries**: The library spec handles its domain (OAuth flow, payment processing); your spec handles application concerns (user creation, access control)

---

## Using These Patterns

### Composition

Patterns can be composed. For example, a complete document collaboration spec might use:

```
use "./rbac.allium" as rbac
use "./soft-delete.allium" as trash
use "./comments.allium" as comments
use "./notifications.allium" as notify

entity Document {
    workspace: Workspace
    title: String
    content: String
    status: active | deleted
    ...
}

-- Documents are commentable
apply comments/Commentable to Document

-- Documents use soft delete
apply trash/SoftDelete to Document

-- Document actions require RBAC checks
rule EditDocument {
    when: EditDocument(user, document, content)
    
    let share = rbac/ResourceShare{document, user}
    
    requires: share.can_edit
    ...
}
```

### Adaptation

Patterns are starting points. When applying:

1. **Rename** to match your domain (User → Member, Document → Note)
2. **Adjust** timeouts and limits to your context
3. **Remove** unused states or rules
4. **Extend** with domain-specific behaviour
5. **Compose** multiple patterns for richer functionality

### Anti-Patterns

When using patterns, avoid:

- **Over-engineering**: Don't include reaction system if you don't need reactions
- **Premature abstraction**: Start concrete, extract patterns when you see repetition
- **Pattern worship**: If the pattern doesn't fit, adapt it or write something custom
- **Ignoring context**: A free tier pattern that makes sense for B2C may not fit B2B
