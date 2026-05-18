#!/usr/bin/env node
// Drive the propagate A/B harness.
//
// For each variant in {baseline, experimental}, invoke `claude --print` with
// the matching plugin loaded via --plugin-dir, asking it to propagate tests
// from a fixture's spec to a clean copy of the fixture's code. Saves the
// results to:
//
//   eval/results/<timestamp>/propagate/<variant>/<backend>/<fixture>/sample-<n>/
//
// Each sample directory contains:
//   - tests/                 the generated test tree
//   - inventory*.json        the obligation-bridge inventory(s)  [experimental only]
//   - merged.json            the consensus merged inventory      [experimental only]
//   - propagation-report.md  Stage C report
//   - stdout.raw.txt         raw claude --print stdout
//   - stderr.txt             raw claude --print stderr
//   - meta.json              run metadata
//
// Usage:
//   node eval/run-propagate.mjs [--samples N]
//                                [--variants baseline,experimental]
//                                [--backends pytest+hypothesis,...]
//                                [--fixtures insurance-claims,...]
//                                [--model MODEL] [--timeout MS]
//                                [--out DIR] [--parallel]

import { execFileSync, spawn } from "child_process";
import { cpSync, existsSync, mkdirSync, writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");

const FIXTURE_DEFAULT_BACKEND = {
  "insurance-claims": "pytest+hypothesis",
  "trading-risk": "pytest+hypothesis",
  "build-pipeline": "jest+fastcheck",
};

const DEFAULTS = {
  samples: 3,
  variants: ["baseline", "experimental"],
  backends: ["pytest+hypothesis"],
  fixtures: ["insurance-claims"],
  model: null,
  timeout: 20 * 60 * 1000,
  out: path.join(REPO_ROOT, "eval", "results"),
  parallel: false,
};

const BACKEND_DESCRIPTIONS = {
  "pytest+hypothesis": "Python with pytest + Hypothesis",
  "jest+fastcheck": "TypeScript with Jest + fast-check",
};

function buildPromptBaseline(_fixture, backend) {
  const desc = BACKEND_DESCRIPTIONS[backend] ?? backend;
  return [
    `Use the propagate skill to generate tests for the spec at`,
    `  ./allium-distilled/spec.allium`,
    `against the implementation in this directory.`,
    "",
    `Target test framework: ${backend} (${desc}).`,
    `Write tests under ./tests/. Do not modify the implementation.`,
    "",
    `Use any deterministic CLI tools available (allium plan, allium model).`,
    `Produce real test bodies where the bridge is clear; leave TODO skips`,
    `where the bridge is genuinely ambiguous.`,
  ].join("\n");
}

function buildPromptExperimental(_fixture, backend) {
  return [
    `Use the propagate skill to generate tests for the spec at`,
    `  ./allium-distilled/spec.allium`,
    `against the implementation in this directory.`,
    "",
    `Target test framework: ${backend}.`,
    "",
    `Drive the full consensus pipeline as documented in the propagate`,
    `SKILL.md: precompute allium plan and allium model, spawn K=3 subagents`,
    `in parallel to produce obligation-bridge inventories, run the`,
    `canonicalize/merge/translate scripts to produce deterministic tests,`,
    `and finish with Stage C run-suite.mjs to produce`,
    `propagation-report.md.`,
    "",
    `Save intermediate artefacts under ./allium-propagated/.`,
    `Write tests under ./tests/.`,
  ].join("\n");
}

function parseArgs(argv) {
  const out = { ...DEFAULTS };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "--samples":  out.samples  = parseInt(argv[++i], 10); break;
      case "--variants": out.variants = argv[++i].split(",").map((s) => s.trim()); break;
      case "--backends": out.backends = argv[++i].split(",").map((s) => s.trim()); break;
      case "--fixtures": out.fixtures = argv[++i].split(",").map((s) => s.trim()); break;
      case "--model":    out.model    = argv[++i]; break;
      case "--timeout":  out.timeout  = parseInt(argv[++i], 10); break;
      case "--out":      out.out      = path.resolve(argv[++i]); break;
      case "--parallel": out.parallel = true; break;
      case "-h":
      case "--help":
        console.log(`Usage: node eval/run-propagate.mjs [options]\n\n` +
          `  --samples N       samples per (variant,backend,fixture) (default ${DEFAULTS.samples})\n` +
          `  --variants A,B    variants to run (default ${DEFAULTS.variants.join(",")})\n` +
          `  --backends A,B    backends to run (default ${DEFAULTS.backends.join(",")})\n` +
          `  --fixtures A,B    fixtures to run (default ${DEFAULTS.fixtures.join(",")})\n` +
          `  --model NAME      pin Claude model (default: user's setting)\n` +
          `  --timeout MS      per-invocation timeout (default ${DEFAULTS.timeout})\n` +
          `  --out DIR         results root (default eval/results)\n` +
          `  --parallel        run samples concurrently within a (variant,backend,fixture)\n`);
        process.exit(0);
      default:
        throw new Error(`unknown arg: ${a}`);
    }
  }
  return out;
}

function whichClaude() {
  try { return execFileSync("which", ["claude"], { encoding: "utf-8" }).trim(); }
  catch { throw new Error("`claude` not on PATH"); }
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function ensureDir(p) { if (!existsSync(p)) mkdirSync(p, { recursive: true }); }

function pluginDirFor(variant) { return path.join(REPO_ROOT, "plugins", variant); }

function cloneFixture(fixtureName, dst) {
  const src = path.join(REPO_ROOT, "fixtures", fixtureName);
  if (!existsSync(src)) throw new Error(`fixture not found: ${src}`);
  cpSync(src, dst, { recursive: true, dereference: false });
}

function runOnce({ variant, backend, fixture, sample, runDir, claudePath, opts }) {
  return new Promise((resolve) => {
    const pluginDir = pluginDirFor(variant);
    if (!existsSync(pluginDir)) {
      resolve({ variant, backend, fixture, sample, ok: false, error: `plugin dir not found: ${pluginDir}` });
      return;
    }
    const sampleDir = path.join(runDir, "propagate", variant, backend, fixture, `sample-${sample}`);
    ensureDir(sampleDir);
    const workDir = path.join(sampleDir, "workdir");
    cloneFixture(fixture, workDir);
    const prompt = variant === "experimental"
      ? buildPromptExperimental(fixture, backend)
      : buildPromptBaseline(fixture, backend);

    const args = [
      "--plugin-dir", pluginDir,
      "--print",
      "--permission-mode", "bypassPermissions",
      ...(opts.model ? ["--model", opts.model] : []),
      prompt,
    ];
    const startedAt = Date.now();
    let stdout = "";
    let stderr = "";
    const child = spawn(claudePath, args, { cwd: workDir, stdio: ["ignore", "pipe", "pipe"] });
    const killer = setTimeout(() => child.kill("SIGKILL"), opts.timeout);
    child.stdout.on("data", (c) => { stdout += c.toString("utf-8"); });
    child.stderr.on("data", (c) => { stderr += c.toString("utf-8"); });
    child.on("close", (code, signal) => {
      clearTimeout(killer);
      const durationMs = Date.now() - startedAt;
      writeFileSync(path.join(sampleDir, "stdout.raw.txt"), stdout);
      writeFileSync(path.join(sampleDir, "stderr.txt"), stderr);

      const testsDir = path.join(workDir, "tests");
      const propagatedDir = path.join(workDir, "allium-propagated");
      const haveTests = existsSync(testsDir);
      writeFileSync(path.join(sampleDir, "meta.json"), JSON.stringify({
        variant, backend, fixture, sample,
        claudePath, args, cwd: workDir,
        model: opts.model,
        exitCode: code, signal,
        durationMs,
        testsPresent: haveTests,
        propagatedPresent: existsSync(propagatedDir),
        promptHash: hashString(prompt),
        startedAt: new Date(startedAt).toISOString(),
      }, null, 2));
      console.error(
        `[${variant}/${backend}/${fixture} sample-${sample}] llm_exit=${code} ${Math.round(durationMs/1000)}s tests=${haveTests ? "yes" : "NO"}`,
      );
      resolve({ variant, backend, fixture, sample, ok: haveTests, durationMs });
    });
  });
}

function hashString(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h + ((h<<1)+(h<<4)+(h<<7)+(h<<8)+(h<<24))) >>> 0; }
  return h.toString(16).padStart(8, "0");
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const claudePath = whichClaude();
  const runDir = path.join(opts.out, timestamp());
  ensureDir(runDir);

  writeFileSync(path.join(runDir, "run-propagate-config.json"), JSON.stringify({
    opts, claudePath, repoRoot: REPO_ROOT,
    fixtureBackendDefaults: FIXTURE_DEFAULT_BACKEND,
    startedAt: new Date().toISOString(),
  }, null, 2));

  console.error(`results dir: ${runDir}`);
  console.error(`variants: ${opts.variants.join(", ")} | backends: ${opts.backends.join(", ")} | fixtures: ${opts.fixtures.join(", ")} | samples: ${opts.samples} | parallel: ${opts.parallel}`);

  const jobs = [];
  for (const variant of opts.variants) {
    for (const backend of opts.backends) {
      for (const fixture of opts.fixtures) {
        // If the fixture has a declared default backend that's different,
        // skip mismatched combos to avoid renderable-but-meaningless runs.
        const def = FIXTURE_DEFAULT_BACKEND[fixture];
        if (def && def !== backend) {
          console.error(`skipping ${fixture}+${backend} (fixture default is ${def})`);
          continue;
        }
        for (let sample = 1; sample <= opts.samples; sample++) {
          jobs.push({ variant, backend, fixture, sample });
        }
      }
    }
  }

  const results = [];
  if (opts.parallel) {
    const all = await Promise.all(jobs.map((j) => runOnce({ ...j, runDir, claudePath, opts })));
    results.push(...all);
  } else {
    for (const j of jobs) results.push(await runOnce({ ...j, runDir, claudePath, opts }));
  }
  const okCount = results.filter((r) => r.ok).length;
  console.error(`\n${okCount}/${results.length} invocations produced a tests/ tree.`);
  console.error(`\nnext: node eval/compare-propagate.mjs ${runDir}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
