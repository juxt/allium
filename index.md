---
layout: default
title: Home
---

<p class="hero">Allium is an LLM-native language for sharpening intent alongside implementation.</p>

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
      <span class="prompt">&gt;</span> Users are asking to delete their accounts. Add a self-service option to the account settings page.
    </div>
    <div class="turn llm">
      <span class="marker">✻</span> Your Allium says <code>Team</code> requires at least one admin. If the user is the sole admin of any team, deleting their account would leave that team without an admin. Should we block self-deletion for sole admins, or prompt them to transfer the role first?
    </div>
  </div>
</div>

## The problem with conversational context

- Within a session, meaning drifts: by prompt ten or twenty, the model is pattern-matching on its own outputs rather than the original intent.
- Across sessions, knowledge evaporates: assumptions and constraints disappear when the chat ends.

Allium gives behavioural intent a durable form that doesn't drift with the conversation and persists across sessions.

## Why not just point the LLM at the code?

Modern LLMs navigate codebases effectively, and many engineers find this sufficient. The limitation appears when you need to distinguish what the code *does* from what it *should do*. Code captures implementation, including bugs and expedient decisions. The model treats all of it as intended behaviour.

Precise prompting helps, but precise prompting means specifying intent: which behaviours are deliberate, which constraints must be preserved. You end up writing descriptions of intent distributed across your prompts. Allium captures this in a form that persists. The next engineer, or the next model, or you next week, can understand not just what the system does but what it was meant to do.

## Why not capture requirements in markdown?

Markdown provides no framework for surfacing ambiguities and contradictions. You can write "users must be authenticated" in one section and "guest checkout is supported" in another without the format highlighting the tension. Capable models may resolve such ambiguities silently in ways you didn't intend; weaker models may not recognise that alternatives existed.

Allium's structure makes contradictions visible. When two rules have incompatible preconditions, the formal syntax exposes the conflict. The model doesn't need to be clever enough to spot the issue in prose; the structure does that work. Markdown can capture robust behaviour with sufficient diligence, but that diligence falls entirely on the author. Allium's constraints guide you toward completeness and consistency.

## Iterating on specifications

The specification and the code evolve together. Writing and refining a behavioural model alongside implementation sharpens your understanding of both the problem and your solution. Questions surface that you wouldn't have thought to ask; constraints emerge that only become visible when you try to formalise them.

Manual coding embedded this discovery in the act of implementation. LLMs generate code from descriptions, shifting where design thinking occurs. Allium captures it explicitly: the specification becomes the site of that thinking, the code its expression.

Two processes feed this growth: **elicitation** works forward from intent through structured conversations with stakeholders, while **distillation** works backward from implementation to capture what the system actually does, including behaviours that were never explicitly decided. Distillation reveals what you built; elicitation clarifies what you meant. When these diverge, you've found something worth investigating.

See the [elicitation guide](https://github.com/juxt/allium/blob/main/elicitation.md) and the [distillation guide](https://github.com/juxt/allium/blob/main/distillation.md) for detailed approaches.

## On single sources of truth

A common objection is that maintaining behavioural models alongside code violates the single source of truth principle. But code captures both intentional and accidental behaviour, with no mechanism to distinguish them. Is that authentication quirk a feature or a bug? The code can't tell you. You need something outside the code to even articulate "this behaviour is wrong". Engineers already accept this in other contexts: type systems express intent that code must satisfy, tests assert expected behaviour against actual behaviour. These aren't duplication.

Allium applies the same pattern. Code excels at expressing *how*; behavioural models excel at expressing *what* and *under which conditions*. When these disagree, that disagreement is information. Perhaps the implementation drifted from intent, or perhaps the model was naive. Either might need to change. The gap between them surfaces questions you need to answer. Redundancy, in this context, isn't overhead. It's resilience.
