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
 * Groups: structure, codex, consistency, portability, links, routing, generation, loopdocs, hooks, discovery, crosstalk
 *
 * All groups except discovery and crosstalk are offline (free, fast); those two require --live
 * and make Claude API calls.
 */

import { readFileSync, existsSync, readdirSync } from "fs";
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

// Broader link check for prose docs (README, references, design notes):
// any markdown link to a local path, skipping external URLs and pure anchors.
function resolveDocLinks(body, fileDir) {
  const linkPattern = /\[[^\]]*\]\(([^)]+)\)/g;
  const out = [];
  let m;
  while ((m = linkPattern.exec(body)) !== null) {
    const raw = m[1].trim().split(/\s+/)[0]; // drop any "title" suffix
    if (/^(https?:|mailto:|#)/.test(raw)) continue; // external or pure anchor
    const noAnchor = raw.replace(/#.*$/, "");
    if (!noAnchor) continue;
    out.push({ link: raw, exists: existsSync(path.resolve(fileDir, noAnchor)) });
  }
  return out;
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
const skillNames = ["allium", "distill", "elicit", "loop", "propagate", "tend", "weed"];
const skillPaths = skillNames.map((n) => path.join(ROOT, "skills", n, "SKILL.md"));
const agentPaths = ["tend", "weed"].map((n) => path.join(ROOT, "agents", `${n}.md`));
const vscodeAgentPaths = ["tend", "weed"].map((n) => path.join(ROOT, ".github", "agents", `${n}.agent.md`));
const codexPluginPath = path.join(ROOT, ".codex-plugin", "plugin.json");
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

function readJson(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, "utf-8"));
  } catch (e) {
    fail(rel(filePath), `invalid JSON: ${e.message}`);
    return null;
  }
}

function isObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
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
// Codex — plugin manifest stays installable by Codex
// ---------------------------------------------------------------------------

if (shouldRun("codex")) {
  console.log("\n── codex: plugin manifest validation ──\n");

  if (!existsSync(codexPluginPath)) {
    fail(".codex-plugin/plugin.json", "file not found");
  } else {
    const manifest = readJson(codexPluginPath);

    if (manifest) {
      const requiredTopLevel = ["name", "version", "description", "author", "skills", "interface"];
      const missing = requiredTopLevel.filter((key) => !manifest[key]);
      if (missing.length > 0) {
        fail(".codex-plugin/plugin.json", `missing: ${missing.join(", ")}`);
      } else {
        pass(".codex-plugin/plugin.json required fields");
      }

      if (manifest.name === "allium") pass("codex plugin name");
      else fail("codex plugin name", `expected allium, got ${manifest.name}`);

      if (/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(manifest.version || "")) {
        pass("codex plugin version");
      } else {
        fail("codex plugin version", "must be strict semver");
      }

      if (manifest.skills === "./skills/") {
        pass("codex skills path");
      } else {
        fail("codex skills path", "must be ./skills/");
      }

      const skillsDir = path.join(ROOT, "skills");
      if (existsSync(skillsDir)) {
        pass("codex skills directory exists");
      } else {
        fail("codex skills directory", "skills/ not found");
      }

      const unsupported = ["agents", "hooks", "lspServers"].filter((key) => key in manifest);
      if (unsupported.length > 0) {
        fail(".codex-plugin/plugin.json", `unsupported fields: ${unsupported.join(", ")}`);
      } else {
        pass("codex manifest has no Claude-only fields");
      }

      if (isObject(manifest.interface)) {
        const requiredInterface = [
          "displayName",
          "shortDescription",
          "longDescription",
          "developerName",
          "category",
          "capabilities",
        ];
        const missingInterface = requiredInterface.filter((key) => !manifest.interface[key]);
        if (missingInterface.length > 0) {
          fail("codex interface", `missing: ${missingInterface.join(", ")}`);
        } else {
          pass("codex interface required fields");
        }

        if (
          !manifest.interface.websiteURL ||
          /^https:\/\//.test(manifest.interface.websiteURL)
        ) {
          pass("codex interface websiteURL");
        } else {
          fail("codex interface websiteURL", "must be an https URL");
        }

        const prompts = manifest.interface.defaultPrompt || [];
        if (
          Array.isArray(prompts) &&
          prompts.length <= 3 &&
          prompts.every((p) => typeof p === "string" && p.length <= 128)
        ) {
          pass("codex default prompts");
        } else {
          fail("codex default prompts", "must be at most 3 strings of 128 chars");
        }
      } else {
        fail("codex interface", "must be an object");
      }
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

if (shouldRun("consistency")) {
  console.log("\n── consistency: manifests & registration ──\n");

  const claudePluginPath = path.join(ROOT, ".claude-plugin", "plugin.json");
  const claude = readJson(claudePluginPath);
  const codex = readJson(codexPluginPath);

  // Version parity across the two plugin manifests.
  if (claude && codex && claude.version && claude.version === codex.version) {
    pass(`version parity (${claude.version})`);
  } else {
    fail("version parity", `claude=${claude?.version} codex=${codex?.version}`);
  }

  // Registration: skills/ dirs == test skillNames == .claude-plugin skills[].
  const skillsRoot = path.join(ROOT, "skills");
  const actualDirs = existsSync(skillsRoot)
    ? readdirSync(skillsRoot).filter((d) => existsSync(path.join(skillsRoot, d, "SKILL.md")))
    : [];
  const claudeArray = Array.isArray(claude?.skills) ? claude.skills.map((s) => path.basename(s)) : [];
  const sortUniq = (a) => [...new Set(a)].sort();
  const dirs = sortUniq(actualDirs);
  const named = sortUniq(skillNames);
  const registered = sortUniq(claudeArray);
  const eq = (x, y) => x.length === y.length && x.every((v, i) => v === y[i]);
  if (eq(dirs, named) && eq(dirs, registered)) {
    pass(`skill registration consistent (${dirs.length} skills)`);
  } else {
    fail("skill registration", `dirs=[${dirs}] skillNames=[${named}] claude-plugin=[${registered}]`);
  }
}

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

  // Prose docs (README + reference docs + design notes) — broader link check
  // that also covers bare relative paths, not just ./ and ../ links.
  const proseDocs = [path.join(ROOT, "README.md")];
  for (const n of skillNames) {
    const refDir = path.join(ROOT, "skills", n, "references");
    if (existsSync(refDir)) {
      for (const f of readdirSync(refDir)) {
        if (f.endsWith(".md")) proseDocs.push(path.join(refDir, f));
      }
    }
  }
  const designDir = path.join(ROOT, "design");
  if (existsSync(designDir)) {
    for (const f of readdirSync(designDir)) {
      if (f.endsWith(".md")) proseDocs.push(path.join(designDir, f));
    }
  }
  for (const filePath of proseDocs) {
    if (!existsSync(filePath)) continue;
    const links = resolveDocLinks(readFileSync(filePath, "utf-8"), path.dirname(filePath));
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
// Routing — allium SKILL.md routing table matches actual skill directories
// ---------------------------------------------------------------------------

if (shouldRun("routing")) {
  console.log("\n── routing: skill routing table ──\n");

  const rootSkillPath = path.join(ROOT, "skills", "allium", "SKILL.md");
  const rootSrc = readFileSync(rootSkillPath, "utf-8");
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
  for (const name of skillNames.filter((n) => n !== "allium")) {
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
// Loopdocs — the loop constants (caps + phase phrase) stay consistent across
// the docs that restate them. Canonical values live here in the test.
// ---------------------------------------------------------------------------

if (shouldRun("loopdocs")) {
  console.log("\n── loopdocs: loop constant drift ──\n");

  const HARD_CAP = 6;
  const NO_PROGRESS = 2;
  const PHASE_PHRASE = "gather context → take action → verify → repeat";

  // Files that state the numeric caps.
  const capFiles = [
    "skills/loop/SKILL.md",
    "skills/allium/references/recommended-loops.md",
    "design/loop-mode.md",
  ];
  for (const rp of capFiles) {
    const fp = path.join(ROOT, rp);
    if (!existsSync(fp)) continue; // design note may be absent post-release
    const src = readFileSync(fp, "utf-8");
    const hard = src.match(/hard cap[^\n.]*?\b(\d+)\b/i);
    const noProg = src.match(/no-progress[^\n.]*?\b(\d+)\b/i);
    if (hard && Number(hard[1]) === HARD_CAP) pass(`${rp} hard cap = ${HARD_CAP}`);
    else fail(`${rp} hard cap`, `expected ${HARD_CAP}, found ${hard ? hard[1] : "none"}`);
    if (noProg && Number(noProg[1]) === NO_PROGRESS) pass(`${rp} no-progress cap = ${NO_PROGRESS}`);
    else fail(`${rp} no-progress cap`, `expected ${NO_PROGRESS}, found ${noProg ? noProg[1] : "none"}`);
  }

  // Files that state the phase phrase in arrow form.
  const phaseFiles = [
    "skills/loop/SKILL.md",
    "skills/allium/references/recommended-loops.md",
    "skills/allium/SKILL.md",
    "design/loop-mode.md",
  ];
  for (const rp of phaseFiles) {
    const fp = path.join(ROOT, rp);
    if (!existsSync(fp)) continue;
    if (readFileSync(fp, "utf-8").includes(PHASE_PHRASE)) pass(`${rp} phase phrase`);
    else fail(`${rp} phase phrase`, `missing "${PHASE_PHRASE}"`);
  }

  // README states the phases in verb form — check the four appear in order.
  const readmePath = path.join(ROOT, "README.md");
  if (existsSync(readmePath)) {
    const src = readFileSync(readmePath, "utf-8");
    const stems = [/gather/i, /take[s]? action/i, /verif/i, /repeat/i];
    const idx = stems.map((s) => src.search(s));
    if (idx.every((i) => i >= 0) && idx.every((v, i) => i === 0 || v > idx[i - 1])) {
      pass("README.md phases in order");
    } else {
      fail("README.md phases", `not all present and in order: ${idx}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Hooks — the PostToolUse hook config is valid and points at a real script.
// ---------------------------------------------------------------------------

if (shouldRun("hooks")) {
  console.log("\n── hooks: hook config integrity ──\n");

  const hooksPath = path.join(ROOT, "hooks", "hooks.json");
  if (!existsSync(hooksPath)) {
    fail("hooks/hooks.json", "not found");
  } else {
    const cfg = readJson(hooksPath);
    if (!cfg) {
      fail("hooks/hooks.json", "invalid JSON");
    } else {
      pass("hooks/hooks.json valid JSON");
      const post = cfg.hooks?.PostToolUse;
      if (!Array.isArray(post) || post.length === 0) {
        fail("hooks PostToolUse", "missing or empty");
      } else {
        pass("hooks PostToolUse present");
        let matchersOk = true;
        let scriptsOk = true;
        for (const entry of post) {
          if (!entry || !entry.matcher) matchersOk = false;
          const cmds = Array.isArray(entry?.hooks) ? entry.hooks : [];
          for (const h of cmds) {
            const m =
              typeof h.command === "string" &&
              h.command.match(/\$\{CLAUDE_PLUGIN_ROOT\}\/([^"\s]+)/);
            if (m && !existsSync(path.join(ROOT, m[1]))) scriptsOk = false;
          }
        }
        matchersOk ? pass("hooks have matchers") : fail("hooks matcher", "an entry is missing a matcher");
        scriptsOk ? pass("hook command scripts exist") : fail("hook command", "referenced script not found");
      }
    }
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
