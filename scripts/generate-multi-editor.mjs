#!/usr/bin/env node

/**
 * Generates VS Code agent variants (.github/agents/*.agent.md).
 *
 * The canonical source for each capability is its skill
 * (skills/<name>/SKILL.md). Claude Code agents (agents/<name>.md) are thin
 * shells that preload the skill at runtime via the `skills:` frontmatter
 * field. VS Code has no preload mechanism, so this script materialises the
 * equivalent at build time: the shell's non-interactive pin followed by the
 * full skill body, with relative links rewritten for the .github/agents/
 * location.
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

const AGENTS = ["distill", "propagate", "tend", "weed", "witness"];

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

// The non-interactive pin lives in the Claude Code shell. Everything that is
// Claude Code plumbing — the preload mention, the plugin-root fallback, the
// heading — is dropped; what remains is the harness-neutral mode instruction.
function extractPin(shellBody) {
  return shellBody
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter(
      (p) =>
        p &&
        !p.startsWith("#") &&
        !p.includes("${CLAUDE_PLUGIN_ROOT}") &&
        !p.includes("preloaded")
    )
    .map((p) => p.replace("You have full Bash access", "You have full shell access"))
    .join("\n\n");
}

// Skill bodies use links relative to skills/<name>/. Rewrite them for the
// .github/agents/ location.
// Skill bodies link relative to skills/<name>/: `./x` is skill-local,
// `../other/x` reaches a sibling skill. Rewrite both for the
// .github/agents/ location in a single pass, so a rewritten prefix is
// never re-matched by a later rule.
function adaptSkillBody(name, body) {
  return body.replace(/\]\((\.\/|\.\.\/)/g, (_, prefix) =>
    prefix === "./" ? `](../../skills/${name}/` : "](../../skills/"
  );
}

// ---------------------------------------------------------------------------
// VS Code agent generation
// ---------------------------------------------------------------------------

function generateVscodeAgent(name) {
  const shell = parseFrontmatter(read(`agents/${name}.md`));
  const skill = parseFrontmatter(read(`skills/${name}/SKILL.md`));

  // Omit tools — VS Code defaults to all available tools.
  // Claude Code's Bash restriction (allium check *) can't be expressed
  // in VS Code's format, so we accept broader tool access.
  return `---
name: ${name}
description: "${shell.frontmatter.description}"
---

${extractPin(shell.body)}

${adaptSkillBody(name, skill.body.trim())}
`;
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
