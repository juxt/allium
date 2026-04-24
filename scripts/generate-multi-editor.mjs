#!/usr/bin/env node

/**
 * Generates VS Code agent variants from the canonical Claude Code
 * agent definitions in agents/.
 *
 * Skills (skills/tend/SKILL.md, skills/weed/SKILL.md) are hand-maintained
 * independently of agents. Skills are interactive; agents are autonomous.
 * The two diverge intentionally in tone and behaviour.
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
        /`\$\{CLAUDE_PLUGIN_ROOT\}\/skills\/allium\/references\/language-reference\.md`/g,
        "[language reference](../../skills/allium/references/language-reference.md)"
      )
      .replace(
        /`\$\{CLAUDE_PLUGIN_ROOT\}\/skills\/allium\/references\/assessing-specs\.md`/g,
        "[assessing specs](../../skills/allium/references/assessing-specs.md)"
      )
      .replace(
        /`\$\{CLAUDE_PLUGIN_ROOT\}\/skills\/allium\/references\/actioning-findings\.md`/g,
        "[actioning findings](../../skills/allium/references/actioning-findings.md)"
      )
      // Replace Claude Code tool names with generic instructions
      .replace(/\(use `Glob` to find them if not specified\)/g, "(search the project to find them if not specified)")
      // Replace "agent" cross-references with "skill" for portable contexts
      .replace(/the `weed` agent/g, "the `weed` skill")
      .replace(/the `tend` agent/g, "the `tend` skill")
  );
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
