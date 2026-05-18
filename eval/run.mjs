#!/usr/bin/env node
// Drive the distill A/B harness.
//
// For each variant in {baseline, experimental}, invoke `claude --print` with
// the matching plugin loaded via --plugin-dir, asking it to distill the
// fixture codebase into a single Allium spec. Saves the raw stdout to:
//
//   eval/results/<timestamp>/<variant>/sample-<n>/spec.allium
//
// Plus a meta.json next to each spec capturing duration, exit code, args
// and the invocation prompt.
//
// Usage:
//   node eval/run.mjs [--samples N] [--variants baseline,experimental]
//                     [--model MODEL] [--timeout MS] [--fixture PATH]
//                     [--out DIR] [--parallel]

import { execFileSync, spawn } from "child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");

const DEFAULTS = {
  samples: 3,
  variants: ["baseline", "experimental"],
  model: null,                            // null = inherit user's default
  timeout: 15 * 60 * 1000,                // 15 minutes per invocation
  fixture: path.join(REPO_ROOT, "fixtures", "insurance-claims"),
  out: path.join(REPO_ROOT, "eval", "results"),
  parallel: false,
};

function buildPrompt(inventoryPath) {
  return [
    "Use the distill skill's inventory pass to produce a structured inventory",
    "of the Python code in this directory. Write the inventory as JSON to:",
    "",
    `  ${inventoryPath}`,
    "",
    "The downstream pipeline contains a deterministic translator that converts",
    "the inventory to the canonical .allium spec. You do not need to write the",
    "spec yourself. Concentrate your effort on producing a complete, correct,",
    "well-structured inventory that follows the schema in the distill skill's",
    "SKILL.md, covering: header, entities (with kind, fields, status_enum,",
    "relationships, derived_properties expressed as {name, expression}),",
    "transitions (with structured body: params, lets, requires, ensures with",
    "kind: assign/create/invoke), scheduled_jobs (similarly structured),",
    "invariants, integrations with operations and preconditions, value_types,",
    "auxiliary_enumerations, config, routes, and webhooks.",
    "",
    "Read every file under ./app first. You have access to Read, Write, Bash",
    "and other tools — use them as the skill directs.",
    "",
    "Important: the inventory's type_hint fields must use Allium types",
    "(String, Integer, Timestamp, Set<String>, EntityName, EntityName?, etc.),",
    "not Python types (str, int, datetime). The translator does not convert.",
  ].join("\n");
}

function parseArgs(argv) {
  const out = { ...DEFAULTS };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "--samples":  out.samples  = parseInt(argv[++i], 10); break;
      case "--variants": out.variants = argv[++i].split(",").map((s) => s.trim()); break;
      case "--model":    out.model    = argv[++i]; break;
      case "--timeout":  out.timeout  = parseInt(argv[++i], 10); break;
      case "--fixture":  out.fixture  = path.resolve(argv[++i]); break;
      case "--out":      out.out      = path.resolve(argv[++i]); break;
      case "--parallel": out.parallel = true; break;
      case "-h":
      case "--help":
        console.log(`Usage: node eval/run.mjs [options]\n\n` +
          `  --samples N       samples per variant (default ${DEFAULTS.samples})\n` +
          `  --variants A,B    variants to run (default ${DEFAULTS.variants.join(",")})\n` +
          `  --model NAME      pin Claude model (default: user's setting)\n` +
          `  --timeout MS      per-invocation timeout (default ${DEFAULTS.timeout})\n` +
          `  --fixture PATH    fixture codebase (default fixtures/insurance-claims)\n` +
          `  --out DIR         results root (default eval/results)\n` +
          `  --parallel        run samples concurrently within a variant\n`);
        process.exit(0);
      default:
        throw new Error(`unknown arg: ${a}`);
    }
  }
  return out;
}

function whichClaude() {
  // Mirror test-skills.mjs: rely on `claude` on PATH.
  try {
    return execFileSync("which", ["claude"], { encoding: "utf-8" }).trim();
  } catch {
    throw new Error("`claude` not on PATH");
  }
}

function execFileSync2(cmd, args) {
  // execFileSync that doesn't throw on non-zero exit; returns {status, stdout, stderr}.
  try {
    const stdout = execFileSync(cmd, args, { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] });
    return { status: 0, stdout, stderr: "" };
  } catch (e) {
    return {
      status: e.status ?? 1,
      stdout: e.stdout?.toString("utf-8") ?? "",
      stderr: e.stderr?.toString("utf-8") ?? String(e.message ?? ""),
    };
  }
}

function timestamp() {
  // ISO 8601 with `:` -> `-` so it's filesystem-safe.
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function ensureDir(p) {
  if (!existsSync(p)) mkdirSync(p, { recursive: true });
}

function pluginDirFor(variant) {
  return path.join(REPO_ROOT, "plugins", variant);
}

function runOnce({ variant, sample, runDir, claudePath, opts }) {
  return new Promise((resolve) => {
    const pluginDir = pluginDirFor(variant);
    if (!existsSync(pluginDir)) {
      resolve({
        variant, sample, ok: false,
        error: `plugin dir not found: ${pluginDir}`,
      });
      return;
    }
    const sampleDir = path.join(runDir, variant, `sample-${sample}`);
    ensureDir(sampleDir);
    const specPath = path.join(sampleDir, "spec.allium");
    const inventoryPath = path.join(sampleDir, "inventory.json");
    const prompt = buildPrompt(inventoryPath);

    const args = [
      "--plugin-dir", pluginDir,
      "--print",
      // Skip permission prompts: this is unattended headless, no human will
      // be there to click "allow" on each Read/Write/Bash tool call.
      "--permission-mode", "bypassPermissions",
      ...(opts.model ? ["--model", opts.model] : []),
      prompt,
    ];
    const startedAt = Date.now();
    let stdout = "";
    let stderr = "";

    const child = spawn(claudePath, args, {
      cwd: opts.fixture,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const killer = setTimeout(() => {
      child.kill("SIGKILL");
    }, opts.timeout);

    child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf-8"); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf-8"); });

    child.on("close", (code, signal) => {
      clearTimeout(killer);
      const durationMs = Date.now() - startedAt;
      writeFileSync(path.join(sampleDir, "stdout.raw.txt"), stdout);
      writeFileSync(path.join(sampleDir, "stderr.txt"), stderr);

      // The LLM may have written a .allium file along with the inventory
      // (e.g., as a leftover from the old prompt or as a self-check). Preserve
      // it for forensics but don't use it as the canonical spec.
      if (existsSync(specPath)) {
        const llmSpec = readFileSync(specPath, "utf-8");
        writeFileSync(path.join(sampleDir, "spec.llm.allium"), llmSpec);
      }

      // Canonical step: translator over the inventory.
      let translatorStatus = "ok";
      let translatorStderr = "";
      let spec = "";
      if (!existsSync(inventoryPath)) {
        translatorStatus = "missing-inventory";
      } else {
        const tr = execFileSync2(
          "node",
          [path.join(REPO_ROOT, "eval", "inventory-to-spec.mjs"), inventoryPath, specPath],
        );
        translatorStatus = tr.status === 0 ? "ok" : "translator-error";
        translatorStderr = tr.stderr;
        if (translatorStatus === "ok" && existsSync(specPath)) {
          spec = readFileSync(specPath, "utf-8");
        }
      }

      if (translatorStderr) {
        writeFileSync(path.join(sampleDir, "translator.stderr.txt"), translatorStderr);
      }

      writeFileSync(path.join(sampleDir, "meta.json"), JSON.stringify({
        variant, sample,
        claudePath, args, cwd: opts.fixture,
        model: opts.model,
        exitCode: code, signal,
        durationMs,
        specBytes: spec.length,
        inventoryPresent: existsSync(inventoryPath),
        translatorStatus,
        promptHash: hashString(prompt),
        startedAt: new Date(startedAt).toISOString(),
      }, null, 2));
      console.error(
        `[${variant} sample-${sample}] llm_exit=${code} signal=${signal ?? "-"} ` +
        `${Math.round(durationMs/1000)}s inventory=${existsSync(inventoryPath) ? "yes" : "NO"} ` +
        `translator=${translatorStatus} spec=${spec.length}B`,
      );
      resolve({
        variant, sample, ok: translatorStatus === "ok" && spec.length > 0,
        durationMs, translatorStatus,
      });
    });
  });
}

function extractSpec(stdout) {
  // Defensive: model is told to emit only the spec, but it sometimes wraps
  // in ```allium … ``` or adds a sentence. Strip code fences; trim leading
  // chatter up to the first `-- allium:` line if present.
  let s = stdout.replace(/```(?:allium|allium-spec|text)?\n?/g, "").replace(/```\n?/g, "");
  const idx = s.indexOf("-- allium:");
  if (idx > 0) s = s.slice(idx);
  return s.trim() + "\n";
}

function hashString(s) {
  // FNV-1a 32-bit — good enough as a prompt-version fingerprint.
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const claudePath = whichClaude();
  const runDir = path.join(opts.out, timestamp());
  ensureDir(runDir);

  // Prompt template uses ${specPath}; we record it with a placeholder so the
  // hash represents the template (per-sample paths vary).
  const promptTemplate = buildPrompt("${specPath}");
  writeFileSync(path.join(runDir, "run-config.json"), JSON.stringify({
    opts,
    claudePath,
    repoRoot: REPO_ROOT,
    promptHash: hashString(promptTemplate),
    promptTemplate,
    startedAt: new Date().toISOString(),
  }, null, 2));

  console.error(`results dir: ${runDir}`);
  console.error(`variants: ${opts.variants.join(", ")} | samples: ${opts.samples} | model: ${opts.model ?? "(default)"} | parallel: ${opts.parallel}`);

  const jobs = [];
  for (const variant of opts.variants) {
    for (let sample = 1; sample <= opts.samples; sample++) {
      jobs.push({ variant, sample });
    }
  }

  const results = [];
  if (opts.parallel) {
    const all = await Promise.all(jobs.map((j) => runOnce({ ...j, runDir, claudePath, opts })));
    results.push(...all);
  } else {
    for (const j of jobs) {
      results.push(await runOnce({ ...j, runDir, claudePath, opts }));
    }
  }

  const okCount = results.filter((r) => r.ok).length;
  console.error(`\n${okCount}/${results.length} invocations succeeded.`);

  // Post-batch: per variant, build the consensus spec by canonicalizing each
  // sample's inventory, merging into one consensus inventory, and translating
  // that to spec.consensus.allium. This is the deterministic deliverable —
  // same K canonical inventories always produce byte-identical output.
  for (const variant of opts.variants) {
    const variantDir = path.join(runDir, variant);
    if (!existsSync(variantDir)) continue;
    const sampleDirs = listSampleDirsWithInventory(variantDir);
    if (sampleDirs.length === 0) {
      console.error(`[${variant}] no inventories produced; skipping consensus.`);
      continue;
    }
    // Canonicalize each sample's inventory.
    const canonicalPaths = [];
    for (const sd of sampleDirs) {
      const inv = path.join(sd, "inventory.json");
      const canon = path.join(sd, "inventory.canonical.json");
      const r = execFileSync2("node", [path.join(REPO_ROOT, "eval", "canonicalize-inventory.mjs"), inv, canon]);
      if (r.status === 0 && existsSync(canon)) canonicalPaths.push(canon);
      else console.error(`[${variant}] canonicalize failed for ${sd}: ${r.stderr.slice(0, 200)}`);
    }
    if (canonicalPaths.length === 0) {
      console.error(`[${variant}] all canonicalizations failed; skipping consensus.`);
      continue;
    }
    // Merge into one consensus inventory.
    const mergedPath = path.join(variantDir, "inventory.merged.json");
    const mergeArgs = [path.join(REPO_ROOT, "eval", "merge-inventories.mjs"), mergedPath, ...canonicalPaths];
    const mr = execFileSync2("node", mergeArgs);
    if (mr.status !== 0 || !existsSync(mergedPath)) {
      console.error(`[${variant}] merge failed: ${mr.stderr.slice(0, 200)}`);
      continue;
    }
    // Translate the consensus inventory.
    const consensusSpec = path.join(variantDir, "spec.consensus.allium");
    const tr = execFileSync2("node", [path.join(REPO_ROOT, "eval", "inventory-to-spec.mjs"), mergedPath, consensusSpec]);
    if (tr.status !== 0 || !existsSync(consensusSpec)) {
      console.error(`[${variant}] consensus translation failed: ${tr.stderr.slice(0, 200)}`);
      continue;
    }
    console.error(`[${variant}] consensus over ${canonicalPaths.length} inventories -> ${consensusSpec}`);
  }

  console.error(`\nnext: node eval/compare.mjs ${runDir}`);
}

function listSampleDirsWithInventory(variantDir) {
  return readdirSync(variantDir)
    .filter((n) => n.startsWith("sample-"))
    .map((n) => path.join(variantDir, n))
    .filter((p) => existsSync(path.join(p, "inventory.json")));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
