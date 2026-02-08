---
layout: default
title: Installation
---

## Get started

### Claude Code (via the JUXT plugin marketplace)

```
/plugin marketplace add juxt/claude-plugins
/plugin install allium
```

### Cursor, Windsurf, Copilot, Aider, Continue and 40+ other tools

```
npx skills add juxt/allium
```

Once installed, your LLM will load the skill when it encounters `.allium` files or when you mention Allium in conversation.

### Manual installation

Allium is just markdown files. If your tool isn't listed above, or you prefer to manage things yourself, grab the files from the [GitHub repository](https://github.com/juxt/allium) and place them wherever your LLM reads custom instructions from.

## Using Allium

In Claude Code, type `/allium` and Allium takes it from there.

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
      <span class="marker">✻</span> I can see you have an existing codebase with authentication, billing and a team management module, but no Allium spec yet. Would you like to:
    </div>
    <div class="turn llm">
      <span class="marker">✻</span> <strong>Distill from code</strong> — I'll read your implementation and draft a behavioural spec capturing what it currently does. Good for establishing a baseline.
    </div>
    <div class="turn llm">
      <span class="marker">✻</span> <strong>Start from intent</strong> — We'll build a spec through conversation, starting with what your system should do. Good for new features or when you want to rethink existing behaviour.
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

Allium determines whether to distill from existing code or build a new spec through conversation based on your project and what you ask for. The [elicitation guide](https://github.com/juxt/allium/blob/main/elicitation.md) and [distillation guide](https://github.com/juxt/allium/blob/main/distillation.md) cover both approaches in detail.
