---
layout: default
title: Usage
---

## Spec-driven agentic engineering

Allium is an AI skill for expressing behavioural intent. In this video, we use it to build a new app from scratch with only spec-driven agentic engineering practices: starting with an `AGENTS.md`, eliciting a specification through dialogue with the AI, propagating that spec into implementation and tests, and using `weed` to keep the spec and code aligned as they evolve. The result is a working system you understand precisely, without having written a single line of code by hand.

<div class="video">
  <iframe src="https://www.youtube-nocookie.com/embed/SZOee7RUNr0" title="Allium" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>
</div>

## Getting started

Type `/allium` to get started and Allium examines your project, then offers to distill from existing code or build a new spec through conversation. If you already know which mode you want, go directly: `/allium:elicit` builds a spec through structured conversation, `/allium:distill` extracts one from existing code. If `/allium` isn't available in your editor, reach for `/allium:elicit` or `/allium:distill` directly.

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

The [elicitation guide](https://github.com/juxt/allium/blob/main/skills/elicit/SKILL.md) and [distillation guide](https://github.com/juxt/allium/blob/main/skills/distill/SKILL.md) cover both approaches in detail.
