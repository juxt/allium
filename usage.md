---
layout: default
title: Usage
---

## What this looks like in practice

Type `/allium` in Claude Code and Allium examines your project, then offers to distill from existing code or build a new spec through conversation.

<div class="terminal">
  <div class="terminal-titlebar">
    <div class="terminal-dots">
      <span class="terminal-dot red"></span>
      <span class="terminal-dot yellow"></span>
      <span class="terminal-dot green"></span>
    </div>
    <span class="terminal-title">Claude Code</span>
  </div>
  <div class="terminal-body">
    <div class="turn user">
      <span class="prompt">&gt;</span> /allium
    </div>
    <div class="turn llm">
      <span class="marker">✻</span> I can see you have an existing codebase with authentication, billing and a team management module, but no Allium spec yet. I can <strong>distill from code</strong> to capture what your implementation currently does, or <strong>start from intent</strong> to build a spec through conversation. Which would you prefer?
    </div>
    <div class="turn user">
      <span class="prompt">&gt;</span> Distill from code. Start with the authentication module.
    </div>
    <div class="turn llm">
      <span class="marker">✻</span> I've read through <code>auth/</code>. I can see login, password reset, session management and role-based access. I've drafted an initial spec at <code>auth.allium</code> with 4 entities and 9 rules. A few things I want to flag:
    </div>
    <div class="turn llm">
      <span class="marker">✻</span> Your login handler in <code>auth/login.py:34</code> allows unlimited retries for users with an <code>internal</code> role. Is that intentional, or should the lockout policy apply to everyone?
    </div>
    <div class="turn user">
      <span class="prompt">&gt;</span> That's a bug. Lockout should apply to everyone. Update the spec and fix the code.
    </div>
  </div>
</div>

The [elicitation guide](https://github.com/juxt/allium/blob/main/elicitation.md) and [distillation guide](https://github.com/juxt/allium/blob/main/distillation.md) cover both approaches in detail.

### Allium surfaces implications you missed

A customer's account was suspended for a terms of service violation. They've appealed and the team wants to let them back in.

<div class="terminal">
  <div class="terminal-titlebar">
    <div class="terminal-dots">
      <span class="terminal-dot red"></span>
      <span class="terminal-dot yellow"></span>
      <span class="terminal-dot green"></span>
    </div>
    <span class="terminal-title">Claude Code</span>
  </div>
  <div class="terminal-body">
    <div class="turn user">
      <span class="prompt">&gt;</span> A customer says they can't reset their password. Their account was suspended last month but they've appealed and we want to let them back in. Can you enable password reset for suspended users?
    </div>
    <div class="turn llm">
      <span class="marker">✻</span> Your Allium requires <code>user.status = active</code> for password resets. This user's status is <code>suspended</code>, so the reset is blocked by design. Reactivating through password reset would bypass your <code>AccountReinstated</code> rule, which requires admin approval and logs an audit trail.
    </div>
    <div class="turn llm">
      <span class="marker">✻</span> Should we reinstate the account through the existing admin flow first, then let them reset their password? Or create a new <code>AccountReinstatedViaAppeal</code> rule that combines both steps with the audit trail intact?
    </div>
    <div class="turn user">
      <span class="prompt">&gt;</span> Reinstate through the admin flow first. The audit trail matters.
    </div>
  </div>
</div>

Without Allium, the LLM would have relaxed the status check, accidentally creating a backdoor around an admin control. The behavioural model caught that password reset and account reinstatement are separate concerns with different approval requirements.

### Knowledge persists across sessions

A developer starts a new session days later, working on a different feature.

<div class="terminal">
  <div class="terminal-titlebar">
    <div class="terminal-dots">
      <span class="terminal-dot red"></span>
      <span class="terminal-dot yellow"></span>
      <span class="terminal-dot green"></span>
    </div>
    <span class="terminal-title">Claude Code</span>
  </div>
  <div class="terminal-body">
    <div class="turn user">
      <span class="prompt">&gt;</span> Add a free trial. New subscribers get their first month at no charge.
    </div>
    <div class="turn llm">
      <span class="marker">✻</span> Your Allium has a constraint here. <code>SubscriptionCreated</code> ensures a payment is processed and <code>InvoiceGenerated</code> requires <code>invoice.amount > 0</code>. A free first month would need to bypass both.
    </div>
    <div class="turn llm">
      <span class="marker">✻</span> Should the trial skip invoice generation entirely, or create a zero-value invoice for the audit trail? And should the <code>PaymentMethod</code> still be captured upfront, or only when the trial converts?
    </div>
    <div class="turn user">
      <span class="prompt">&gt;</span> Create a zero-value invoice and capture the payment method upfront.
    </div>
  </div>
</div>

The developer never mentioned invoicing or payment method capture. The Allium did, from a session that ended days ago. Without it, the LLM would have implemented the trial with no awareness of these constraints, and the gaps would have surfaced in production.

### Allium grounds a design conversation

A developer asks for a straightforward feature.

<div class="terminal">
  <div class="terminal-titlebar">
    <div class="terminal-dots">
      <span class="terminal-dot red"></span>
      <span class="terminal-dot yellow"></span>
      <span class="terminal-dot green"></span>
    </div>
    <span class="terminal-title">Claude Code</span>
  </div>
  <div class="terminal-body">
    <div class="turn user">
      <span class="prompt">&gt;</span> Add an endpoint so admins can view any user's payment history.
    </div>
    <div class="turn llm">
      <span class="marker">✻</span> Your Allium doesn't give admins blanket access. <code>AdminAction</code> requires the admin's scope to include the target resource. The current scopes are <code>billing</code>, <code>users</code> and <code>support</code>. Should this endpoint require <code>billing</code> scope?
    </div>
    <div class="turn user">
      <span class="prompt">&gt;</span> Yes, billing scope. But our support team needs to see payment history too, for resolving disputes. What are our options?
    </div>
    <div class="turn llm">
      <span class="marker">✻</span> You could add <code>billing</code> to the support role, but that also grants access to refunds and plan changes, which your Allium controls through the same scope.
    </div>
    <div class="turn llm">
      <span class="marker">✻</span> Alternatively, split <code>billing</code> into <code>billing.read</code> and <code>billing.write</code>. Support gets read-only access, finance gets both. Your code in <code>admin/permissions.py</code> already distinguishes read and write operations but maps them both to the same scope check, so the implementation is halfway there.
    </div>
    <div class="turn user">
      <span class="prompt">&gt;</span> Go with the read/write split. Update the Allium first, then refactor the scope checks to match.
    </div>
  </div>
</div>

Without Allium, the LLM would likely have implemented a simple `is_admin` check. Instead, the conversation surfaced a scoping model, explored its implications for a second team, and arrived at a design that aligns the behavioural model with a distinction the code already made but never formalised.

### Distillation catches drift

A developer asks the LLM to check whether the code still matches the Allium.

<div class="terminal">
  <div class="terminal-titlebar">
    <div class="terminal-dots">
      <span class="terminal-dot red"></span>
      <span class="terminal-dot yellow"></span>
      <span class="terminal-dot green"></span>
    </div>
    <span class="terminal-title">Claude Code</span>
  </div>
  <div class="terminal-body">
    <div class="turn user">
      <span class="prompt">&gt;</span> Can you check whether our authentication code matches the Allium?
    </div>
    <div class="turn llm">
      <span class="marker">✻</span> I found a divergence. Your Allium says <code>LoginAttempt</code> requires <code>user.failed_attempts < max_login_attempts</code>, with a default of 5. But <code>auth/login.py</code> line 47 hardcodes the limit at 3 and doesn't reset the counter after a successful login. The Allium says <code>UserAuthenticates</code> ensures <code>user.failed_attempts = 0</code>.
    </div>
    <div class="turn llm">
      <span class="marker">✻</span> Either the code drifted or the Allium is aspirational. Which should we trust?
    </div>
    <div class="turn user">
      <span class="prompt">&gt;</span> The Allium is right. Fix the code to match.
    </div>
  </div>
</div>

Code and intent diverge silently over time. Allium gives the LLM something to check against, turning "does this look right?" into a concrete comparison with a definitive answer. See the [distillation guide](https://github.com/juxt/allium/blob/main/distillation.md) for a structured approach to catching drift, and the [elicitation guide](https://github.com/juxt/allium/blob/main/elicitation.md) for building specs from conversations like the ones above.
