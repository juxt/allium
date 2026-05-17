---
name: distill
description: "Extract a deterministic Allium specification from an existing codebase. Use when the user has existing code and wants to distil behaviour into a spec, reverse engineer a specification from implementation, generate a spec from code, turn implementation into a behavioural specification, or document what a codebase does in Allium terms. Produces a byte-deterministic spec by running K independent inventory-extraction passes in parallel and consensus-merging their outputs."
---

# Distillation (consensus pipeline)

This skill produces a **byte-deterministic Allium spec** from a target codebase. It does so by orchestrating K independent inventory-extraction passes in parallel, canonicalising each, merging into a single consensus inventory, and translating that to the final `.allium` spec.

When invoked, you are the **orchestrator**. You do not write the spec yourself — that's the translator's job. You drive the procedure below.

## Pipeline

```
K subagents (Agent tool)
   ↓  each produces inventory-i.json
scripts/canonicalize-inventory.mjs       (per inventory)
   ↓
scripts/merge-inventories.mjs            (one-shot consensus)
   ↓
scripts/inventory-to-spec.mjs            (pure-function translator)
   ↓
allium check                             (validation)
```

The scripts live at `${CLAUDE_PLUGIN_ROOT}/scripts/`. The inventory schema subagents must follow lives at `${CLAUDE_PLUGIN_ROOT}/skills/distill/references/inventory-schema.md`.

## Procedure (mandatory, in order)

### Step 1 — Decide K and output paths

- **K**: default 3. Use 5 if the user explicitly wants higher determinism confidence at higher cost; use 2 only if cost is the primary constraint.
- **Output directory**: default `./allium-distilled/` (relative to the current working directory). If the directory already exists, do not delete its contents — write into it.
- Create `./allium-distilled/inventories/` so each subagent has a place to write.
- The final spec will be at `./allium-distilled/spec.allium`.

### Step 2 — Spawn K subagents in parallel

Use the **Agent tool** with `subagent_type: "general-purpose"`. Send all K Agent tool calls **in a single message** so they execute concurrently — sequential subagents waste wall-clock time. Each subagent receives the prompt template from Step 3, with `<SOURCE_DIR>` and `<OUTPUT_PATH>` substituted. The i-th subagent's output path is `./allium-distilled/inventories/inventory-<i>.json` (1-indexed).

`<SOURCE_DIR>` is the directory the user pointed you at (e.g. `./app`). If they didn't name one, use the current working directory and exclude obvious non-source paths (`node_modules/`, `.git/`, `dist/`, `__pycache__/`, etc.).

### Step 3 — Subagent prompt template

Use this prompt verbatim for each subagent, with the placeholders replaced:

```
You are producing one structured inventory of a codebase as part of a
consensus pipeline. Other subagents are doing the same job in parallel;
your output will be merged with theirs.

Step 1: Read every source file under <SOURCE_DIR>. Skip generated /
vendored / dependency directories.

Step 2: Read the inventory schema and conventions at:
    ${CLAUDE_PLUGIN_ROOT}/skills/distill/references/inventory-schema.md

That document defines the exact JSON shape, naming conventions,
nullability encoding, when-clause grammar for scheduled jobs, invariant
derivation rules, and the self-check list to run before emitting.

Step 3: Produce a JSON inventory matching the schema and write it to:
    <OUTPUT_PATH>

Step 4: Stop. Do NOT:
  - write a .allium spec (the orchestrator's translator handles that)
  - write any other file
  - invoke any other skill (in particular, do not invoke the distill skill — that would recurse)
  - read or follow the orchestrator's SKILL.md
  - print anything other than a one-line confirmation that the file was written

The inventory is your only deliverable.
```

### Step 4 — Canonicalize each inventory

For each inventory the subagents produced, run via the Bash tool:

```
node ${CLAUDE_PLUGIN_ROOT}/scripts/canonicalize-inventory.mjs \
    ./allium-distilled/inventories/inventory-<i>.json \
    ./allium-distilled/inventories/inventory-<i>.canonical.json
```

If a subagent failed to write its inventory, skip it and continue with the survivors. Note any failures in the final report.

### Step 5 — Merge into a consensus inventory

Run via Bash, passing every canonical inventory produced in Step 4:

```
node ${CLAUDE_PLUGIN_ROOT}/scripts/merge-inventories.mjs \
    ./allium-distilled/inventory.merged.json \
    ./allium-distilled/inventories/inventory-1.canonical.json \
    ./allium-distilled/inventories/inventory-2.canonical.json \
    ...
```

The merger does majority voting per top-level item (entities, transitions, etc.) and modal-value voting per field. Same K canonical inventories always produce byte-identical output.

### Step 6 — Translate to the spec

```
node ${CLAUDE_PLUGIN_ROOT}/scripts/inventory-to-spec.mjs \
    ./allium-distilled/inventory.merged.json \
    ./allium-distilled/spec.allium
```

The translator is a pure function — same merged inventory always produces byte-identical spec.

### Step 7 — Verify with `allium check`

Run `allium check ./allium-distilled/spec.allium`. Parse the JSON output and report:
- Number of errors, warnings, and info-level diagnostics
- If errors exist, name the construct(s) involved and which subagent's inventory contributed

A clean run is 0 errors. Warnings about external-entity governing-specification imports and info-level surface/listener gaps are expected and not failures.

### Step 8 — Report

State to the user:
- Path to the produced spec
- K (number of subagents used)
- Spec size (lines, bytes)
- `allium check` result
- Any subagent failures
- One-line summary of the consensus content (e.g. "5 entities, 11 transitions, 4 invariants, 2 contracts, 2 surfaces")

Do not embed the spec contents in your reply — point the user at the file.

## Defaults

- K = 3
- Output directory = `./allium-distilled/`
- Subagents run in parallel (always)
- The skill produces exactly one spec per invocation (no per-sample artefacts beyond the inventories)

## What this skill does NOT do

- It does not invoke `allium analyse` or `allium plan` beyond the basic `allium check`. If the user wants process-completeness checks, they run those tools manually against the produced spec.
- It does not modify the source code being distilled.
- It does not write its own narrative `@guidance` prose — guidance carried through from the inventory's `guidance` fields propagates to the spec via the translator.
- It does not invoke other skills (no recursion through the subagent path).

## What to extract — guidance for subagents

The `references/inventory-schema.md` doc has the concrete schema and conventions. Subagents read that. The orchestrator (you) does not need to know what to extract — only how to drive the pipeline.

If subagents produce visibly poor inventories (missing entities that should obviously be in the code, etc.), the right intervention is to extend `references/inventory-schema.md`, not to add inline guidance to the orchestrator prompt. Keep this SKILL.md focused on orchestration.
