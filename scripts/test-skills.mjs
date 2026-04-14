#!/usr/bin/env node

/**
 * Validates that all skill and agent artifacts are structurally correct,
 * correctly generated, properly isolated, and load in Claude Code.
 *
 * Usage:
 *   node scripts/test-skills.mjs                  # all offline tests
 *   node scripts/test-skills.mjs --live            # include Claude Code smoke tests
 *   node scripts/test-skills.mjs structure         # run one group
 *   node scripts/test-skills.mjs portability links # run multiple groups
 *
 * Groups: structure, portability, links, routing, generation, discovery, crosstalk
 *
 * The first five groups are offline (free, fast). The last two require --live
 * and make Claude API calls.
 */

import { readFileSync, existsSync } from "fs";
import { execFileSync, execSync } from "child_process";
import path from "path";

let _claudePath;
function getClaudePath() {
  if (!_claudePath) _claudePath = execSync("which claude", { encoding: "utf-8" }).trim();
  return _claudePath;
}

const ROOT = path.resolve(import.meta.dirname, "..");
const LIVE = process.argv.includes("--live");

// Parse group filters from positional args (ignore flags)
const requestedGroups = process.argv
  .slice(2)
  .filter((a) => !a.startsWith("--"));

let passed = 0;
let failed = 0;
let skipped = 0;

function pass(name) {
  console.log(`  pass: ${name}`);
  passed++;
}

function fail(name, detail) {
  console.log(`  FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
  failed++;
}

function skip(name, reason) {
  console.log(`  skip: ${name} — ${reason}`);
  skipped++;
}

function rel(absPath) {
  return path.relative(ROOT, absPath);
}

function shouldRun(group) {
  return requestedGroups.length === 0 || requestedGroups.includes(group);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseFrontmatter(src) {
  const match = src.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return null;
  const fm = {};
  const lines = match[1].split("\n");
  let currentKey = null;
  for (const line of lines) {
    if (/^\s+-\s/.test(line) && currentKey) {
      if (!Array.isArray(fm[currentKey])) fm[currentKey] = [];
      fm[currentKey].push(line.replace(/^\s+-\s*/, "").trim());
      continue;
    }
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let val = line.slice(idx + 1).trim();
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    currentKey = key;
    fm[key] = val || true;
  }
  return { frontmatter: fm, body: match[2] };
}

function resolveRelativeLinks(body, fileDir) {
  const linkPattern = /\[.*?\]\((\.\.?\/[^)]+)\)/g;
  const links = [];
  let m;
  while ((m = linkPattern.exec(body)) !== null) {
    links.push(m[1]);
  }
  return links.map((link) => ({
    link,
    target: path.resolve(fileDir, link.replace(/#.*$/, "")),
    exists: existsSync(path.resolve(fileDir, link.replace(/#.*$/, ""))),
  }));
}

function claudeQuery(prompt, { cwd } = {}) {
  const output = execFileSync(
    getClaudePath(),
    [
      "--plugin-dir", ROOT,
      "--print",
      "--model", "haiku",
      "--max-budget-usd", "0.05",
      prompt,
    ],
    {
      encoding: "utf-8",
      timeout: 60000,
      stdio: ["pipe", "pipe", "pipe"],
      ...(cwd ? { cwd } : {}),
    }
  );
  // Strip markdown code fences and try to extract JSON
  const cleaned = output.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  // Try object first (greedy), then array
  for (const re of [/\{[\s\S]*\}/, /\[[\s\S]*\]/]) {
    const match = cleaned.match(re);
    if (match) {
      try { return JSON.parse(match[0]); } catch { /* try next */ }
    }
  }
  throw new Error(`No valid JSON in response: ${output.slice(0, 200)}`);
}

// Known paths
const rootSkill = path.join(ROOT, "SKILL.md");
const skillNames = ["distill", "elicit", "propagate", "tend", "weed"];
const skillPaths = [rootSkill, ...skillNames.map((n) => path.join(ROOT, "skills", n, "SKILL.md"))];
const agentPaths = ["tend", "weed"].map((n) => path.join(ROOT, "agents", `${n}.md`));
const vscodeAgentPaths = ["tend", "weed"].map((n) => path.join(ROOT, ".github", "agents", `${n}.agent.md`));
const portableSkillNames = ["tend", "weed"];

// Patterns that should not appear in portable artifacts
const CLAUDE_CODE_LEAKS = [
  [/\buse `Glob`\b/, "Glob"],
  [/\buse `Grep`\b/, "Grep"],
  [/\bBash\(allium check\b/, "Bash(allium check)"],
  [/\$\{CLAUDE_PLUGIN_ROOT\}/, "${CLAUDE_PLUGIN_ROOT}"],
  [/the `\w+` agent\b/, "agent cross-reference (should be 'skill')"],
];

function checkLeaks(body) {
  return CLAUDE_CODE_LEAKS.filter(([re]) => re.test(body)).map(([, name]) => name);
}

// ---------------------------------------------------------------------------
// Structure — frontmatter validity for all artifact types
// ---------------------------------------------------------------------------

if (shouldRun("structure")) {
  console.log("\n── structure: frontmatter validation ──\n");

  for (const skillPath of skillPaths) {
    const label = rel(skillPath);
    if (!existsSync(skillPath)) { fail(label, "file not found"); continue; }
    const parsed = parseFrontmatter(readFileSync(skillPath, "utf-8"));
    if (!parsed) { fail(label, "no valid frontmatter"); continue; }
    const { frontmatter } = parsed;
    if (!frontmatter.name) fail(`${label}`, "missing 'name'");
    else if (!frontmatter.description) fail(`${label}`, "missing 'description'");
    else pass(`${label}`);
  }

  console.log("");

  for (const agentPath of agentPaths) {
    const label = rel(agentPath);
    if (!existsSync(agentPath)) { fail(label, "file not found"); continue; }
    const parsed = parseFrontmatter(readFileSync(agentPath, "utf-8"));
    if (!parsed) { fail(label, "no valid frontmatter"); continue; }
    const missing = ["name", "description", "model", "tools"].filter((k) => !parsed.frontmatter[k]);
    if (missing.length > 0) fail(`${label}`, `missing: ${missing.join(", ")}`);
    else pass(`${label}`);
  }

  console.log("");

  for (const agentPath of vscodeAgentPaths) {
    const label = rel(agentPath);
    if (!existsSync(agentPath)) { fail(label, "file not found"); continue; }
    const parsed = parseFrontmatter(readFileSync(agentPath, "utf-8"));
    if (!parsed) { fail(label, "no valid frontmatter"); continue; }
    const { frontmatter } = parsed;
    if (!frontmatter.name || !frontmatter.description) {
      fail(`${label}`, "missing name or description");
    } else {
      pass(`${label}`);
    }
    // VS Code doesn't support model or tools
    const unsupported = ["model", "tools"].filter((k) => frontmatter[k]);
    if (unsupported.length > 0) {
      fail(`${label} vs-code compat`, `unsupported fields: ${unsupported.join(", ")}`);
    } else {
      pass(`${label} vs-code compat`);
    }
    // Naming convention
    if (!path.basename(agentPath).endsWith(".agent.md")) {
      fail(`${label} naming`, "must end with .agent.md");
    } else {
      pass(`${label} naming`);
    }
  }
}

// ---------------------------------------------------------------------------
// Portability — no Claude Code references in portable artifacts
// ---------------------------------------------------------------------------

if (shouldRun("portability")) {
  console.log("\n── portability: no Claude Code leakage ──\n");

  // All skills must not contain unexpanded placeholders
  for (const skillPath of skillPaths) {
    if (!existsSync(skillPath)) continue;
    const parsed = parseFrontmatter(readFileSync(skillPath, "utf-8"));
    if (!parsed) continue;
    const label = rel(skillPath);
    if (parsed.body.includes("${CLAUDE_PLUGIN_ROOT}")) {
      fail(`${label}`, "contains unexpanded ${CLAUDE_PLUGIN_ROOT}");
    } else {
      pass(`${label} no placeholders`);
    }
  }

  console.log("");

  // Portable skills and VS Code agents must not reference Claude Code tools
  const portableArtifacts = [
    ...portableSkillNames.map((n) => path.join(ROOT, "skills", n, "SKILL.md")),
    ...vscodeAgentPaths,
  ];
  for (const filePath of portableArtifacts) {
    if (!existsSync(filePath)) continue;
    const parsed = parseFrontmatter(readFileSync(filePath, "utf-8"));
    if (!parsed) continue;
    const leaks = checkLeaks(parsed.body);
    const label = rel(filePath);
    if (leaks.length > 0) {
      fail(`${label}`, `Claude Code references: ${leaks.join(", ")}`);
    } else {
      pass(`${label}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Links — all relative markdown links resolve to real files
// ---------------------------------------------------------------------------

if (shouldRun("links")) {
  console.log("\n── links: relative link resolution ──\n");

  const allPaths = [...skillPaths, ...agentPaths, ...vscodeAgentPaths];
  for (const filePath of allPaths) {
    if (!existsSync(filePath)) continue;
    const parsed = parseFrontmatter(readFileSync(filePath, "utf-8"));
    if (!parsed) continue;
    const links = resolveRelativeLinks(parsed.body, path.dirname(filePath));
    const broken = links.filter((l) => !l.exists);
    for (const { link } of broken) {
      fail(`${rel(filePath)}`, `broken link: ${link}`);
    }
    if (broken.length === 0) {
      pass(`${rel(filePath)} (${links.length} link${links.length !== 1 ? "s" : ""})`);
    }
  }
}

// ---------------------------------------------------------------------------
// Routing — root SKILL.md routing table matches actual skill directories
// ---------------------------------------------------------------------------

if (shouldRun("routing")) {
  console.log("\n── routing: skill routing table ──\n");

  const rootSrc = readFileSync(rootSkill, "utf-8");
  const routingRefs = [...rootSrc.matchAll(/`(\w+)` skill/g)].map((m) => m[1]);
  for (const name of routingRefs) {
    if (name === "this") continue;
    const target = path.join(ROOT, "skills", name, "SKILL.md");
    if (existsSync(target)) {
      pass(`${name}`);
    } else {
      fail(`${name}`, "skill directory not found");
    }
  }

  // Reverse check: every skill directory should be referenced in the routing table
  for (const name of skillNames) {
    if (routingRefs.includes(name)) {
      pass(`${name} in routing table`);
    } else {
      fail(`${name}`, "skill exists but not in routing table");
    }
  }
}

// ---------------------------------------------------------------------------
// Generation — generated files match what the script would produce
// ---------------------------------------------------------------------------

if (shouldRun("generation")) {
  console.log("\n── generation: roundtrip check ──\n");

  try {
    execFileSync(
      "node",
      [path.join(ROOT, "scripts", "generate-multi-editor.mjs"), "--check"],
      { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
    );
    pass("generated files up to date");
  } catch {
    fail("generated files out of date", "run: node scripts/generate-multi-editor.mjs");
  }
}

// ---------------------------------------------------------------------------
// Discovery — live Claude Code skill and agent loading
// ---------------------------------------------------------------------------

if (shouldRun("discovery")) {
  console.log("\n── discovery: Claude Code skill/agent loading ──\n");

  if (!LIVE) {
    skip("skill discovery", "pass --live to enable (uses API tokens)");
    skip("agent discovery", "pass --live to enable");
  } else {
    try {
      const skills = claudeQuery(
        "List every allium skill available to you. Output ONLY a JSON array of " +
        'skill names without the allium: prefix, e.g. ["foo","bar"]. No other text.'
      );
      const missing = skillNames.filter((s) => !skills.includes(s));
      const extra = skills.filter((s) => !skillNames.includes(s));
      if (missing.length > 0) fail("skill discovery", `missing: ${missing.join(", ")}`);
      else if (extra.length > 0) fail("skill discovery", `unexpected: ${extra.join(", ")}`);
      else pass(`skill discovery (${skills.length} skills)`);
    } catch (e) {
      fail("skill discovery", e.message?.slice(0, 200));
    }

    try {
      const agents = claudeQuery(
        "List every allium agent (subagent_type) available to you via the Agent tool. " +
        'Output ONLY a JSON array of agent names, e.g. ["foo","bar"]. No other text.'
      );
      const expectedAgents = ["tend", "weed"];
      const missing = expectedAgents.filter((a) => !agents.includes(a));
      if (missing.length > 0) fail("agent discovery", `missing: ${missing.join(", ")}`);
      else pass(`agent discovery (${agents.length} agents)`);
    } catch (e) {
      fail("agent discovery", e.message?.slice(0, 200));
    }
  }
}

// ---------------------------------------------------------------------------
// Crosstalk — skills from the plugin don't bleed into unrelated projects,
//             and local agents/ don't leak outside the repo
// ---------------------------------------------------------------------------

if (shouldRun("crosstalk")) {
  console.log("\n── crosstalk: isolation between contexts ──\n");

  if (!LIVE) {
    skip("crosstalk", "pass --live to enable (uses API tokens)");
  } else {
    // From a neutral directory (/tmp), only plugin-provided skills should
    // appear. Local agents/ from the allium repo must not leak.
    // Note: plugin agents only load in the project where the plugin is
    // installed, so from /tmp we expect skills but not agents.
    try {
      const result = claudeQuery(
        "List EVERY skill available to you that contains 'tend' or 'weed' in the name. " +
        'Output ONLY a JSON array of their exact names, e.g. ["allium:tend"]. No other text.',
        { cwd: "/tmp" }
      );

      // Unprefixed names would mean local agents/ leaked
      const unprefixed = result.filter((s) => s === "tend" || s === "weed");
      if (unprefixed.length > 0) {
        fail("neutral dir", `local artifacts leaked: ${unprefixed.join(", ")}`);
      } else {
        pass("neutral dir: no local artifact bleed");
      }

      // Prefixed plugin skills should be present
      const prefixed = result.filter(
        (s) => s === "allium:tend" || s === "allium:weed"
      );
      if (prefixed.length >= 2) {
        pass("neutral dir: plugin skills present");
      } else {
        fail("neutral dir: plugin skills", `expected allium:tend and allium:weed, got: ${result.join(", ")}`);
      }
    } catch (e) {
      fail("neutral dir", e.message?.slice(0, 200));
    }

    // From inside the allium repo, both plugin skills (allium:tend) and
    // local agents (tend) should be present. This is expected and correct:
    // contributors working on the repo need the local agents.
    try {
      const result = claudeQuery(
        "List EVERY skill AND agent (subagent_type) available to you that contains " +
        "'tend' or 'weed'. Output ONLY a JSON object: " +
        '{"skills": [...], "agents": [...]}. Exact names. No other text.',
        { cwd: ROOT }
      );

      const { skills = [], agents = [] } = result;

      // Plugin skills should be present
      const pluginSkills = skills.filter(
        (s) => s === "allium:tend" || s === "allium:weed"
      );
      if (pluginSkills.length >= 2) {
        pass("allium repo: plugin skills present");
      } else {
        fail("allium repo: plugin skills", `expected allium:tend and allium:weed, got: ${skills.join(", ")}`);
      }

      // Local agents should also be present (from agents/)
      const localAgents = agents.filter((a) => a === "tend" || a === "weed");
      if (localAgents.length >= 2) {
        pass("allium repo: local agents present");
      } else {
        // Not a failure, just informational — depends on plugin install state
        skip("allium repo: local agents", `got: ${agents.join(", ") || "(none)"}`);
      }

      // There should NOT be unprefixed tend/weed as skills (that would
      // mean skills and agents are colliding)
      const unprefixedSkills = skills.filter(
        (s) => s === "tend" || s === "weed"
      );
      if (unprefixedSkills.length > 0) {
        fail("allium repo: skill/agent collision", `unprefixed skills: ${unprefixedSkills.join(", ")}`);
      } else {
        pass("allium repo: no skill/agent collision");
      }
    } catch (e) {
      fail("allium repo", e.message?.slice(0, 200));
    }

    // Advisory: warn about global plugin installation
    try {
      const listOutput = execSync("claude plugin list", { encoding: "utf-8" });
      if (/allium.*enabled/i.test(listOutput)) {
        console.log(
          "\n  note: allium plugin is installed. Crosstalk tests account for this.\n" +
          "  For full isolation, disable it temporarily:\n" +
          "    claude plugin disable allium\n" +
          "    node scripts/test-skills.mjs --live crosstalk\n" +
          "    claude plugin enable allium"
        );
      }
    } catch {
      // Not critical
    }
  }
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${"─".repeat(40)}`);
console.log(`${passed} passed, ${failed} failed, ${skipped} skipped`);
process.exit(failed > 0 ? 1 : 0);
