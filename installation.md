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

In Claude Code, type `/allium` and Allium takes it from there. You can also go directly to a specific mode: `/allium:elicit` for building specs through conversation, `/allium:distill` for extracting specs from existing code.

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
