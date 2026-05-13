#!/usr/bin/env node
//
// Top-level test orchestrator. Forwards to per-tier runners and existing
// scripts; sums their counters; exits non-zero on any failure.
//
// Usage:
//   node scripts/test.mjs                  # all offline tiers
//   node scripts/test.mjs --live           # include API-using tiers when wired up
//   node scripts/test.mjs tier1            # one group
//   node scripts/test.mjs tier1 artifact   # selected groups
//   node scripts/test.mjs tier1 entities   # group plus per-tier filter
//
// Groups currently wired:
//   tier1     — language fixtures (offline, requires `allium` on PATH)
//   artifact  — forwards to scripts/test-skills.mjs (offline)
//   hook      — forwards to hooks/allium-check.test.mjs (offline)
//
// Tiers 2, 3 and 4 are planned but not yet implemented; they will be
// added as their runners land.

import { execFileSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import { run as tier1Run } from "../tests/tier1-language.mjs";
import { run as tier2Run } from "../tests/tier2-docs.mjs";
import { run as tier3Run } from "../tests/tier3-evals.mjs";
import { run as tier4Run } from "../tests/tier4-e2e.mjs";
import { summarise } from "../tests/lib/reporter.mjs";
import { printBanner } from "../tests/lib/banner.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);

const argv = process.argv.slice(2);
const live = argv.includes("--live");
const flags = new Set(argv.filter((a) => a.startsWith("--")));

// Some flags take a value (e.g. `--workspace /path`). Skip the value
// when bucketing positional args so it doesn't get misread as a
// scenario filter or group name.
const VALUE_FLAGS = ["--workspace", "--repeats", "--concurrency"];
const valueIndices = new Set();
for (const f of VALUE_FLAGS) {
  const i = argv.indexOf(f);
  if (i >= 0 && i < argv.length - 1) valueIndices.add(i + 1);
}
const positional = argv.filter(
  (a, i) => !a.startsWith("--") && !valueIndices.has(i)
);
function takeFlagValue(flag) {
  const i = argv.indexOf(flag);
  if (i < 0 || i === argv.length - 1) return null;
  const v = argv[i + 1];
  if (v.startsWith("--")) return null;
  return v;
}

const KNOWN_GROUPS = ["tier1", "tier2", "tier3", "tier4", "artifact", "hook"];
const requestedGroups = positional.filter((a) => KNOWN_GROUPS.includes(a));
const filters = positional.filter((a) => !KNOWN_GROUPS.includes(a));

function shouldRun(group) {
  return requestedGroups.length === 0 || requestedGroups.includes(group);
}

const totals = {
  passed: 0,
  failed: 0,
  skipped: 0,
  drifted: 0,
  failures: [],
  elapsedMs: 0, // wall-clock for the orchestrator, set just before summarise
};

function add(counters) {
  totals.passed += counters.passed;
  totals.failed += counters.failed;
  totals.skipped += counters.skipped;
  totals.drifted += counters.drifted ?? 0;
  totals.failures.push(...(counters.failures ?? []));
}

const orchestratorStartedAt = Date.now();

printBanner();

// ---------------------------------------------------------------------------
// tier1 — language fixtures
// ---------------------------------------------------------------------------
if (shouldRun("tier1")) {
  add(await tier1Run({ filters, quiet: flags.has("--quiet") }));
}

// ---------------------------------------------------------------------------
// tier2 — doc-example validation
// ---------------------------------------------------------------------------
if (shouldRun("tier2")) {
  add(await tier2Run({ filters, quiet: flags.has("--quiet") }));
}

// ---------------------------------------------------------------------------
// tier3 — skill behavioural evals (gated behind --live; costs API spend)
// ---------------------------------------------------------------------------
if (shouldRun("tier3")) {
  add(
    await tier3Run({
      filters,
      live,
      quiet: flags.has("--quiet"),
      verbose: flags.has("--verbose"),
    })
  );
}

// ---------------------------------------------------------------------------
// tier4 — end-to-end pipeline (gated behind --live; multi-step, expensive)
// ---------------------------------------------------------------------------
if (shouldRun("tier4")) {
  const repeatsArg = takeFlagValue("--repeats");
  const concurrencyArg = takeFlagValue("--concurrency");
  add(
    await tier4Run({
      filters,
      live,
      quiet: flags.has("--quiet"),
      updateSnapshots: flags.has("--update-snapshots"),
      verbose: flags.has("--verbose"),
      keepWorkspace: flags.has("--keep-workspace"),
      workspaceOverride: takeFlagValue("--workspace"),
      judge: !flags.has("--no-judge"),
      showDiff: flags.has("--diff"),
      repeats: repeatsArg ? Math.max(1, parseInt(repeatsArg, 10)) : null,
      concurrency: concurrencyArg ? Math.max(1, parseInt(concurrencyArg, 10)) : 3,
    })
  );
}

// ---------------------------------------------------------------------------
// artifact — existing skill-structure tests
// ---------------------------------------------------------------------------
if (shouldRun("artifact")) {
  console.log("\nArtifact — scripts/test-skills.mjs");
  const args = [path.join(ROOT, "scripts", "test-skills.mjs")];
  if (live) args.push("--live");
  add(forwardCounters("artifact", args));
}

// ---------------------------------------------------------------------------
// hook — existing hook tests
// ---------------------------------------------------------------------------
if (shouldRun("hook")) {
  console.log("\nHook — hooks/allium-check.test.mjs");
  add(forwardCounters("hook", [path.join(ROOT, "hooks", "allium-check.test.mjs")]));
}

totals.elapsedMs = Date.now() - orchestratorStartedAt;
summarise("Total", totals);
process.exit(totals.failed === 0 ? 0 : 1);

// ---------------------------------------------------------------------------
// Forwarding helper. Existing scripts use their own pass/fail counters and
// don't expose a programmatic API; we run them as subprocesses and infer
// counters from their final exit code. A non-zero exit becomes one failure.
//
// Reports elapsed wall-clock for the subprocess (the inner test counts
// aren't visible here, but the time spent running them is).
// ---------------------------------------------------------------------------
function forwardCounters(label, args) {
  const startedAt = Date.now();
  try {
    execFileSync("node", args, { stdio: "inherit" });
    const elapsedMs = Date.now() - startedAt;
    console.log(`  ${label} forwarded subprocess: ${formatDurationLocal(elapsedMs)}`);
    return { passed: 1, failed: 0, skipped: 0, failures: [] };
  } catch (e) {
    const elapsedMs = Date.now() - startedAt;
    console.log(`  ${label} forwarded subprocess: ${formatDurationLocal(elapsedMs)}`);
    return {
      passed: 0,
      failed: 1,
      skipped: 0,
      failures: [`${label} subprocess exited ${e.status ?? "non-zero"}`],
    };
  }
}

// Compact local copy of formatDuration so the orchestrator stays
// independent of the reporter's import surface for this small thing.
function formatDurationLocal(ms) {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return ms < 10000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms / 1000)}s`;
  const totalSec = Math.round(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return s === 0 ? `${m}m` : `${m}m ${s}s`;
}
