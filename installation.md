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

### Cursor, Windsurf, Aider, Continue and other skills-compatible tools

```
npx skills add juxt/allium
```

### GitHub Copilot

Copilot reads skills and agents from the repository automatically. No installation needed.

### Manual installation

Allium is just markdown files. If your tool isn't listed above, or you prefer to manage things yourself, grab the files from the [GitHub repository](https://github.com/juxt/allium) and place them wherever your LLM reads custom instructions from.

## Using Allium

Type `/allium` to get started. This is an entry point that examines your project and guides you toward the right skill, whether that's distilling a spec from existing code or building one through conversation. Once you're familiar with the individual skills, you'll likely invoke them directly.

| Skill | Purpose |
|---|---|
| `/allium` | Entry point. Examines your project and routes you to the right skill. |
| `/allium:elicit` | Build a spec through structured conversation. |
| `/allium:distill` | Extract a spec from existing code. |
| `/allium:propagate` | Generate tests from a spec. |
| `/allium:tend` | Targeted changes to existing specs. |
| `/allium:weed` | Find and fix divergences between spec and code. |

Skills use the fully qualified form `/allium:skill` across all editors. Some editors also allow the short form (`/tend`, `/elicit`) when there's no ambiguity. The `/allium` entry point may not be available in all editors; if it isn't, reach for `/allium:elicit` or `/allium:distill` directly.

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
      <span class="marker">✻</span> I can see you have an existing codebase with order processing, inventory management and a shipping module, but no Allium spec yet. I can <strong>distill from code</strong> to capture what your implementation currently does, or <strong>start from intent</strong> to build a spec through conversation. Which would you prefer?
    </div>
  </div>
</div>

Allium determines whether to distill from existing code or build a new spec based on your project and what you ask for. See the [usage examples](usage) for what happens next.
