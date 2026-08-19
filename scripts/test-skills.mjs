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
 * Groups: structure, codex, consistency, portability, links, routing, generation, loopdocs, hooks, modes, discovery, parking, witnessing, crosstalk
 *
 * All groups except discovery, parking, witnessing and crosstalk are offline (free, fast);
 * those four require --live and make Claude API calls.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdtempSync, rmSync } from "fs";
import { execFileSync, execSync } from "child_process";
import { tmpdir } from "os";
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
const skillNames = ["allium", "distill", "elicit", "propagate", "tend", "weed", "witness"];
const skillPaths = skillNames.map((n) => path.join(ROOT, "skills", n, "SKILL.md"));
const agentNames = ["distill", "propagate", "tend", "weed", "witness"];
const agentPaths = agentNames.map((n) => path.join(ROOT, "agents", `${n}.md`));
const vscodeAgentPaths = agentNames.map((n) => path.join(ROOT, ".github", "agents", `${n}.agent.md`));
const codexPluginPath = path.join(ROOT, ".codex-plugin", "plugin.json");
const portableSkillNames = agentNames;

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

  console.log("");
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
    "skills/allium/references/driving-the-loop.md",
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
    "skills/allium/references/driving-the-loop.md",
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
// Modes — the interaction-mode contract is stated everywhere it must be.
// The skill is the single source of truth for each agent-backed capability;
// these canonical phrases (cf. loopdocs) pin the contract in all three
// artefacts so a rewording that silently drops it fails here.
// ---------------------------------------------------------------------------

if (shouldRun("modes")) {
  console.log("\n── modes: interaction-mode contract ──\n");

  const MODE_HEADING = "## Interaction modes";
  const MODE_PHRASE = "no user is reachable";
  const PIN_PHRASE = "never wait for an answer";

  for (const name of agentNames) {
    const skillSrc = readFileSync(path.join(ROOT, "skills", name, "SKILL.md"), "utf-8");
    if (skillSrc.includes(MODE_HEADING) && skillSrc.includes(MODE_PHRASE)) {
      pass(`skills/${name} states both modes`);
    } else {
      fail(`skills/${name} interaction modes`, `missing "${MODE_HEADING}" or "${MODE_PHRASE}"`);
    }

    const shellSrc = readFileSync(path.join(ROOT, "agents", `${name}.md`), "utf-8");
    if (shellSrc.includes(MODE_PHRASE) && shellSrc.includes(PIN_PHRASE)) {
      pass(`agents/${name} pins non-interactive mode`);
    } else {
      fail(`agents/${name} pin`, `missing "${MODE_PHRASE}" or "${PIN_PHRASE}"`);
    }
    if (shellSrc.includes(`- allium:${name}`)) {
      pass(`agents/${name} preloads allium:${name}`);
    } else {
      fail(`agents/${name} preload`, `frontmatter must list "- allium:${name}" under skills:`);
    }

    const vsSrc = readFileSync(path.join(ROOT, ".github", "agents", `${name}.agent.md`), "utf-8");
    if (vsSrc.includes(PIN_PHRASE) && vsSrc.includes(MODE_HEADING)) {
      pass(`.github/agents/${name} carries pin + skill body`);
    } else {
      fail(`.github/agents/${name}`, `missing "${PIN_PHRASE}" or "${MODE_HEADING}"`);
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
      const expectedAgents = agentNames;
      const missing = expectedAgents.filter((a) => !agents.includes(a));
      if (missing.length > 0) fail("agent discovery", `missing: ${missing.join(", ")}`);
      else pass(`agent discovery (${agents.length} agents)`);
    } catch (e) {
      fail("agent discovery", e.message?.slice(0, 200));
    }
  }
}

// ---------------------------------------------------------------------------
// Parking — live behavioural probe: a non-interactive agent surfaces an
// undecided point instead of asking the user or silently guessing. Each case
// states the undecided point in the task, so a faithful agent must park it.
// The probe spends model tokens, but the assertions are deterministic — a
// file grep or a summary-line regex, never one model judging another.
//
// The three spec-writing agents (tend, distill, weed) share one parking
// mechanism: an `open question` declaration in the spec they write, so they
// share one assertion. propagate's contract differs — it surfaces decisions
// in its returned report (the reconciliation summary), not as a spec
// construct — so it has its own case and assertion.
// ---------------------------------------------------------------------------

const GIFTCARD_SPEC = `-- allium: 3

entity GiftCard {
    code: String
    balance: Integer
    status: active | redeemed
}
`;

const GIFTCARD_PY = `# giftcard.py — reference implementation
def redeem(card, amount):
    # An over-redemption forces the balance to zero rather than rejecting.
    card["balance"] = max(0, card["balance"] - amount)
    if card["balance"] == 0:
        card["status"] = "redeemed"
    return card
`;

// Runs one agent headlessly in a throwaway dir and returns the printed
// orchestrator output. bypassPermissions because propagate must run the
// project's test command; the dir is temporary and discarded.
function runAgentProbe(dir, prompt) {
  return execFileSync(
    getClaudePath(),
    [
      "--plugin-dir", ROOT,
      "--print",
      "--permission-mode", "bypassPermissions",
      "--max-budget-usd", "2.00",
      prompt,
    ],
    { encoding: "utf-8", timeout: 600000, cwd: dir, stdio: ["pipe", "pipe", "pipe"] }
  );
}

function readAllAllium(dir) {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".allium"))
    .map((f) => readFileSync(path.join(dir, f), "utf-8"))
    .join("\n");
}

if (shouldRun("parking")) {
  console.log("\n── parking: non-interactive agents surface decisions, not ask ──\n");

  if (!LIVE) {
    skip("parking probes", "pass --live to enable (uses API tokens)");
  } else {
    // The three `open question`-parking agents, filename-agnostic: assert some
    // .allium in the dir carries the parked question after the run.
    const specCases = [
      {
        agent: "tend",
        files: { "shop.allium": GIFTCARD_SPEC },
        task:
          "Add gift card expiry behaviour to shop.allium. The business has not yet " +
          "decided the expiry period or what happens to any remaining balance when a " +
          "card expires.",
      },
      {
        agent: "distill",
        files: { "giftcard.py": GIFTCARD_PY },
        task:
          "Distil an Allium spec for giftcard.py into giftcard.allium. The team has " +
          "not decided whether forcing an over-redeemed balance to zero is intended " +
          "behaviour or an accident to preserve — do not guess.",
      },
      {
        agent: "weed",
        files: { "shop.allium": GIFTCARD_SPEC, "giftcard.py": GIFTCARD_PY },
        task:
          "In update-spec mode, reconcile shop.allium with giftcard.py. The code sets " +
          "status to redeemed only when the balance reaches zero, which the spec does " +
          "not describe. The team has not decided whether that is the intended rule — " +
          "where undecided, record it rather than guessing.",
      },
    ];

    for (const c of specCases) {
      const dir = mkdtempSync(path.join(tmpdir(), `allium-parking-${c.agent}-`));
      try {
        for (const [name, body] of Object.entries(c.files)) {
          writeFileSync(path.join(dir, name), body);
        }
        runAgentProbe(
          dir,
          `Use the Agent tool to spawn the 'allium:${c.agent}' subagent with exactly ` +
            `this task: "${c.task}" When it finishes, output only DONE.`
        );
        const specs = readAllAllium(dir);
        if (specs.trim()) pass(`${c.agent}: produced a spec`);
        else fail(`${c.agent}: produced a spec`, "no .allium content in the dir");
        if (/open question/.test(specs)) pass(`${c.agent}: parked the undecided point as an open question`);
        else fail(`${c.agent}: open question`, "no `open question` declaration in any .allium");
      } catch (e) {
        fail(`${c.agent} parking probe`, e.message?.slice(0, 200));
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }

    // propagate: self-contained runnable project (Node's built-in test runner,
    // no npm install) so reconciliation can actually run. Assert the relayed
    // report carries the reconciliation summary line — propagate surfacing its
    // status in output rather than going silent or asking.
    {
      const dir = mkdtempSync(path.join(tmpdir(), "allium-parking-propagate-"));
      try {
        writeFileSync(path.join(dir, "shop.allium"), GIFTCARD_SPEC);
        writeFileSync(
          path.join(dir, "package.json"),
          JSON.stringify({ name: "shop", version: "1.0.0", type: "module", scripts: { test: "node --test" } }, null, 2) + "\n"
        );
        writeFileSync(
          path.join(dir, "giftcard.js"),
          "export class GiftCard {\n" +
            "  constructor(code, balance) { this.code = code; this.balance = balance; this.status = 'active'; }\n" +
            "  redeem(amount) { this.balance = Math.max(0, this.balance - amount); if (this.balance === 0) this.status = 'redeemed'; }\n" +
            "}\n"
        );
        const out = runAgentProbe(
          dir,
          "Use the Agent tool to spawn the 'allium:propagate' subagent with exactly this task: " +
            '"Propagate tests from shop.allium against this project (giftcard.js, Node built-in test runner via npm test)." ' +
            "Then output the subagent's final message verbatim between <<<REPORT and REPORT>>> markers."
        );
        if (/\d+\s+obligations?,\s+\d+\s+covered,\s+\d+\s+uncovered/i.test(out)) {
          pass("propagate: surfaced the reconciliation summary in its report");
        } else {
          fail("propagate: reconciliation summary", "no `N obligations, M covered, K uncovered` line in relayed output");
        }
      } catch (e) {
        fail("propagate parking probe", e.message?.slice(0, 200));
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Witnessing — live behavioural probe: the witness catches a weakened test.
// A generated test whose recorded hash no longer matches its content is the
// cardinal anti-cheat violation; the witness must return FAIL. The fixture
// records the ORIGINAL sha256 in the ledger, then edits the test — so the
// mismatch is real and the assertion is deterministic (a verdict regex over
// the relayed report), never one model judging another.
// ---------------------------------------------------------------------------

if (shouldRun("witnessing")) {
  console.log("\n── witnessing: the witness catches a weakened test ──\n");

  if (!LIVE) {
    skip("witness tamper probe", "pass --live to enable (uses API tokens)");
  } else {
    const dir = mkdtempSync(path.join(tmpdir(), "allium-witness-"));
    try {
      // A minimal converged project: spec, a generated test that passes, and a
      // ledger recording the test's original hash + a clean prior verdict.
      const testFile = "giftcard.test.js";
      const originalTest =
        "import { test } from 'node:test';\n" +
        "import assert from 'node:assert';\n" +
        "import { GiftCard } from './giftcard.js';\n" +
        "test('redeem to zero marks redeemed', () => {\n" +
        "  const c = new GiftCard('A', 10); c.redeem(10);\n" +
        "  assert.strictEqual(c.status, 'redeemed');\n" +
        "});\n";
      writeFileSync(path.join(dir, "shop.allium"), GIFTCARD_SPEC);
      writeFileSync(
        path.join(dir, "package.json"),
        JSON.stringify({ name: "shop", version: "1.0.0", type: "module", scripts: { test: "node --test" } }, null, 2) + "\n"
      );
      writeFileSync(
        path.join(dir, "giftcard.js"),
        "export class GiftCard {\n" +
          "  constructor(code, balance) { this.code = code; this.balance = balance; this.status = 'active'; }\n" +
          "  redeem(amount) { this.balance = Math.max(0, this.balance - amount); if (this.balance === 0) this.status = 'redeemed'; }\n" +
          "}\n"
      );
      writeFileSync(path.join(dir, testFile), originalTest);

      // Record the ORIGINAL hash in the ledger, then weaken the test. The
      // witness recomputes the hash and must see the divergence.
      const originalHash = execFileSync("shasum", ["-a", "256", path.join(dir, testFile)], { encoding: "utf-8" }).split(/\s+/)[0];
      const ledgerDir = path.join(dir, ".allium-loop");
      execFileSync("mkdir", ["-p", ledgerDir]);
      writeFileSync(
        path.join(ledgerDir, "giftcard.json"),
        JSON.stringify(
          {
            goal: "giftcard",
            mode: "spec-first",
            generated_test_hashes: { [testFile]: `sha256:${originalHash}` },
            reconciliation: "1 obligations, 1 covered, 0 uncovered",
            weed: "clean",
          },
          null,
          2
        ) + "\n"
      );
      // Weaken the generated test so it can never fail — the tamper.
      writeFileSync(
        path.join(dir, testFile),
        "import { test } from 'node:test';\n" +
          "test('redeem to zero marks redeemed', () => { /* weakened: asserts nothing */ });\n"
      );

      const out = runAgentProbe(
        dir,
        "Use the Agent tool to spawn the 'allium:witness' subagent with exactly this task: " +
          '"Witness the convergence of the giftcard loop in this directory. The ledger is ' +
          ".allium-loop/giftcard.json and records the generated test hashes. Re-derive the checks " +
          'and write the witness record." ' +
          "Then output the subagent's final message verbatim between <<<REPORT and REPORT>>> markers."
      );

      if (/\bFAIL\b/i.test(out) && /(hash|tamper|weakened|edited|modif)/i.test(out)) {
        pass("witness: returned FAIL naming the weakened test");
      } else {
        fail("witness: tamper detection", "relayed report did not FAIL on the hash mismatch");
      }
      if (existsSync(path.join(ledgerDir, "giftcard.witness.json"))) {
        pass("witness: wrote the witness record");
      } else {
        fail("witness: record", "no .allium-loop/giftcard.witness.json written");
      }
    } catch (e) {
      fail("witness tamper probe", e.message?.slice(0, 200));
    } finally {
      rmSync(dir, { recursive: true, force: true });
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
      const localAgents = agents.filter((a) => agentNames.includes(a));
      if (localAgents.length >= agentNames.length) {
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
