#!/usr/bin/env node

/**
 * Generates skill and VS Code agent variants from the canonical
 * Claude Code agent definitions in agents/.
 *
 * Usage: node scripts/generate-multi-editor.mjs [--check]
 *
 * --check  Report whether generated files are up to date without writing.
 *          Exits 1 if any file would change.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import path from "path";

const ROOT = path.resolve(import.meta.dirname, "..");
const CHECK = process.argv.includes("--check");

const AGENTS = ["tend", "weed"];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function read(rel) {
  return readFileSync(path.join(ROOT, rel), "utf-8");
}

function write(rel, content) {
  const abs = path.join(ROOT, rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  if (existsSync(abs) && readFileSync(abs, "utf-8") === content) return false;
  if (!CHECK) writeFileSync(abs, content);
  return true;
}

function parseFrontmatter(src) {
  const match = src.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) throw new Error("No frontmatter found");
  const fm = {};
  for (const line of match[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let val = line.slice(idx + 1).trim();
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    fm[key] = val;
  }
  return { frontmatter: fm, body: match[2] };
}

function adaptBody(body) {
  return (
    body
      // Replace ${CLAUDE_PLUGIN_ROOT} paths with relative markdown links
      .replace(
        /`\$\{CLAUDE_PLUGIN_ROOT\}\/references\/language-reference\.md`/g,
        "[language reference](../../references/language-reference.md)"
      )
      // Replace Claude Code tool names with generic instructions
      .replace(/\(use `Glob` to find them if not specified\)/g, "(search the project to find them if not specified)")
      // Replace "agent" cross-references with "skill" for portable contexts
      .replace(/the `weed` agent/g, "the `weed` skill")
      .replace(/the `tend` agent/g, "the `tend` skill")
  );
}

// ---------------------------------------------------------------------------
// Skill generation
// ---------------------------------------------------------------------------

const SKILL_EXTRA_TEND = `
## Context management

Spec evolution can require many edit-validate cycles. If you anticipate a long iterative session, or if the context is growing large, advise the user to open a fresh chat specifically for tending the spec. Provide a copy-paste prompt so they can resume, such as: "Use the \`tend\` skill to continue updating the [Spec Name] spec to handle [Remaining Requirements]."

## Verification

After every edit to a \`.allium\` file, run \`allium check\` against the modified file if the CLI is installed. Fix any reported issues before presenting the result. If the CLI is not available, verify against the [language reference](../../references/language-reference.md).
`;

const SKILL_EXTRA_WEED = `
## Context management

Spec alignment checks can require many edit-validate cycles. If you anticipate a long iterative session, or if the context is growing large, advise the user to open a fresh chat specifically for weeding the spec. Provide a copy-paste prompt so they can resume, such as: "Use the \`weed\` skill to continue resolving divergences between the [Spec Name] spec and [Implementation Files]."

## Verification

After every edit to a \`.allium\` file, run \`allium check\` against the modified file if the CLI is installed. Fix any reported issues before presenting the result. If the CLI is not available, verify against the [language reference](../../references/language-reference.md).
`;

const SKILL_EXTRAS = { tend: SKILL_EXTRA_TEND, weed: SKILL_EXTRA_WEED };

function generateSkill(name) {
  const src = read(`agents/${name}.md`);
  const { frontmatter, body } = parseFrontmatter(src);
  const adapted = adaptBody(body);

  // Insert extra sections before the final ## Output or ## Output format section
  const extra = SKILL_EXTRAS[name];
  let finalBody = adapted;
  const outputMatch = adapted.match(/\n(## Output\b[^\n]*)/);
  if (outputMatch) {
    const idx = adapted.indexOf(outputMatch[0]);
    finalBody = adapted.slice(0, idx) + extra + adapted.slice(idx);
  } else {
    finalBody = adapted + extra;
  }

  const skill = `---
name: ${name}
description: "${frontmatter.description}"
---
${finalBody}`;

  return skill;
}

// ---------------------------------------------------------------------------
// VS Code agent generation
// ---------------------------------------------------------------------------

function generateVscodeAgent(name) {
  const src = read(`agents/${name}.md`);
  const { frontmatter, body } = parseFrontmatter(src);
  const adapted = adaptBody(body);

  // Omit tools — VS Code defaults to all available tools.
  // Claude Code's Bash restriction (allium check *) can't be expressed
  // in VS Code's format, so we accept broader tool access.
  const agent = `---
name: ${name}
description: "${frontmatter.description}"
---
${adapted}`;

  return agent;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

let dirty = false;

for (const name of AGENTS) {
  if (write(`skills/${name}/SKILL.md`, generateSkill(name))) {
    console.log(`${CHECK ? "out of date" : "wrote"}: skills/${name}/SKILL.md`);
    dirty = true;
  }
  if (write(`.github/agents/${name}.agent.md`, generateVscodeAgent(name))) {
    console.log(
      `${CHECK ? "out of date" : "wrote"}: .github/agents/${name}.agent.md`
    );
    dirty = true;
  }
}

if (CHECK && dirty) {
  console.error(
    "\nGenerated files are out of date. Run: node scripts/generate-multi-editor.mjs"
  );
  process.exit(1);
}

if (!dirty) {
  console.log("All generated files are up to date.");
}
