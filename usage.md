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

A booking platform wants to add self-service rescheduling.

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
      <span class="prompt">&gt;</span> Customers want to reschedule appointments through the app. Add a reschedule option to the booking detail page.
    </div>
    <div class="turn llm">
      <span class="marker">✻</span> Your Allium has a <code>CancellationFee</code> rule: cancellations within 24 hours of the appointment incur a charge. A reschedule is functionally a cancellation followed by a new booking, so rescheduling a same-day appointment would trigger the fee.
    </div>
    <div class="turn llm">
      <span class="marker">✻</span> Should rescheduling be exempt from the cancellation fee, follow the same 24-hour policy as cancellations or have its own separate policy?
    </div>
    <div class="turn user">
      <span class="prompt">&gt;</span> Rescheduling should be free if it's to another slot in the same week. Otherwise the cancellation policy applies.
    </div>
  </div>
</div>

Without Allium, the LLM would have implemented a straightforward reschedule endpoint. The behavioural model caught that a same-day reschedule triggers the cancellation fee, a consequence the developer hadn't considered.

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
      <span class="prompt">&gt;</span> Add a bulk discount. Orders over 50 units get 15% off.
    </div>
    <div class="turn llm">
      <span class="marker">✻</span> Your Allium already has a <code>LoyaltyDiscount</code> rule that gives returning customers 10% off orders over &pound;100. A 55-unit order from a loyal customer could qualify for both. Your <code>OrderTotal</code> derivation doesn't specify how multiple discounts interact.
    </div>
    <div class="turn llm">
      <span class="marker">✻</span> Should discounts stack (10% + 15% = 25%), apply the better of the two (15%) or compound (15% then 10% on the remainder)? And should the bulk discount apply before or after the loyalty calculation?
    </div>
    <div class="turn user">
      <span class="prompt">&gt;</span> Apply the better of the two. They shouldn't stack. Update the Allium first, then adjust the pricing logic.
    </div>
  </div>
</div>

Without Allium, the LLM would have added the bulk discount with no awareness of the loyalty programme. The specification surfaced a pricing interaction the developer never mentioned, and the conversation arrived at an explicit discount precedence rule.

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
      <span class="prompt">&gt;</span> Can you check whether our publishing workflow matches the Allium?
    </div>
    <div class="turn llm">
      <span class="marker">✻</span> I found a divergence. Your Allium says <code>ArticlePublished</code> requires <code>article.status = approved</code>, meaning every article goes through editor review before publication. But <code>publishing/views.py</code> line 82 skips the approval check for users with <code>role = senior_author</code>. The Allium has no such exception.
    </div>
    <div class="turn llm">
      <span class="marker">✻</span> Either the code introduced a shortcut or the Allium is incomplete. Which should we trust?
    </div>
    <div class="turn user">
      <span class="prompt">&gt;</span> That was a quick fix during a deadline. The approval step matters. Fix the code to match.
    </div>
  </div>
</div>

Code and intent diverge silently over time. Allium gives the LLM something to check against, turning "does this look right?" into a concrete comparison with a definitive answer. See the [distillation guide](https://github.com/juxt/allium/blob/main/distillation.md) for a structured approach to catching drift, and the [elicitation guide](https://github.com/juxt/allium/blob/main/elicitation.md) for building specs from conversations like the ones above.
