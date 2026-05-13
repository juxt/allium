// Tier 4 manifest writer.
//
// A manifest is a small JSON file at the root of a kept workspace
// (tests/.tier4-runs/<scenario>-<ts>/.tier4-manifest.json) that
// records what produced the workspace, when, with what tool versions,
// and per-step cost/duration/session metadata. It serves three jobs:
//
//   1. Triage. `cat .tier4-manifest.json | jq` answers "what was this
//      run?" without inspecting file mtimes or path-encoded metadata.
//   2. Replay. `tier4 --workspace <path>` reads the manifest to
//      identify the scenario the workspace belongs to.
//   3. Cost accounting. Sum the per-step `cost_usd` across recent
//      runs to see what the suite actually costs.
//
// Manifest is written incrementally — after each step completes, the
// file is rewritten with the appended step entry. A run interrupted
// mid-step still leaves a useful partial manifest with
// `result: "in-progress"`.

import { writeFileSync, readFileSync, existsSync } from "fs";
import { execFileSync } from "child_process";
import path from "path";

const MANIFEST_FILENAME = ".tier4-manifest.json";
const VARIANCE_MANIFEST_FILENAME = ".tier4-variance-manifest.json";

export function manifestPath(runRoot) {
  return path.join(runRoot, MANIFEST_FILENAME);
}

export function varianceManifestPath(runRoot) {
  return path.join(runRoot, VARIANCE_MANIFEST_FILENAME);
}

export function createManifest(runRoot, { scenarioId, fixture, authMode, model }) {
  const manifest = {
    scenario_id: scenarioId,
    fixture,
    started_at: new Date().toISOString(),
    completed_at: null,
    auth_mode: authMode,
    model: model ?? null,
    git_sha: safeShellOneLine(["git", "rev-parse", "--short", "HEAD"]),
    tool_versions: {
      allium: parseVersionLine(safeShellOneLine(["allium", "--version"])),
      claude: parseVersionLine(safeShellOneLine(["claude", "--version"])),
    },
    result: "in-progress",
    steps: [],
  };
  write(runRoot, manifest);
  return manifest;
}

// Append a step entry derived from a successful invoke result.
//   stepIndex     1-based step number
//   skill         "distill" | "tend" | "propagate" | ...
//   startedAt     ISO timestamp captured before the invoke call
//   result        the object returned by invoke() — uses .envelope
//                 when available for cost/session/turns/stop_reason
//   checkpointDir name of the per-step checkpoint dir (relative to runRoot)
export function appendStep(
  runRoot,
  manifest,
  { stepIndex, skill, startedAt, result, checkpointDir }
) {
  const completedAt = new Date().toISOString();
  const env = result.envelope ?? {};
  manifest.steps.push({
    index: stepIndex,
    skill,
    started_at: startedAt,
    completed_at: completedAt,
    duration_seconds: Math.round(
      (Date.parse(completedAt) - Date.parse(startedAt)) / 1000
    ),
    cost_usd: typeof env.total_cost_usd === "number" ? env.total_cost_usd : null,
    claude_session_id: env.session_id ?? null,
    stop_reason: env.stop_reason ?? null,
    num_turns: typeof env.num_turns === "number" ? env.num_turns : null,
    checkpoint: checkpointDir,
  });
  write(runRoot, manifest);
}

export function finalise(runRoot, manifest, { result }) {
  manifest.completed_at = new Date().toISOString();
  manifest.result = result; // "success" | "failed" | "interrupted"
  write(runRoot, manifest);
}

export function readManifest(runRoot) {
  const p = manifestPath(runRoot);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf-8"));
  } catch {
    return null;
  }
}

function write(runRoot, manifest) {
  writeFileSync(manifestPath(runRoot), JSON.stringify(manifest, null, 2) + "\n");
}

// ---------------------------------------------------------------------------
// Variance manifest (parent of an N-run variance scenario)
//
// A variance scenario produces N independent per-run subdirs under
// runs/01..N/, each with its own .tier4-manifest.json. The parent dir
// gets a .tier4-variance-manifest.json that records the scenario id,
// repeat count, concurrency, and per-run completion status.
// ---------------------------------------------------------------------------

export function createVarianceManifest(
  runRoot,
  { scenarioId, fixture, repeat, concurrency, authMode, model }
) {
  const manifest = {
    scenario_id: scenarioId,
    fixture,
    repeat,
    concurrency,
    started_at: new Date().toISOString(),
    completed_at: null,
    auth_mode: authMode,
    model: model ?? null,
    git_sha: safeShellOneLine(["git", "rev-parse", "--short", "HEAD"]),
    tool_versions: {
      allium: parseVersionLine(safeShellOneLine(["allium", "--version"])),
      claude: parseVersionLine(safeShellOneLine(["claude", "--version"])),
    },
    result: "in-progress",
    runs: [],
  };
  writeVariance(runRoot, manifest);
  return manifest;
}

// Atomically append/update a run entry. Parallel workers may complete
// in any order, so we identify the slot by runIndex (1-based) and
// either insert or overwrite. The manifest object is mutated in place
// AND flushed to disk; callers should serialise calls (or pass a lock)
// if multiple workers may write concurrently — see runVarianceScenario.
export function updateVarianceManifest(
  runRoot,
  manifest,
  { runIndex, runDir, result, durationSeconds, costUsd }
) {
  const entry = {
    index: runIndex,
    dir: runDir,
    result,
    duration_seconds: durationSeconds ?? null,
    cost_usd: costUsd ?? null,
    completed_at: new Date().toISOString(),
  };
  const existing = manifest.runs.findIndex((r) => r.index === runIndex);
  if (existing >= 0) manifest.runs[existing] = entry;
  else manifest.runs.push(entry);
  manifest.runs.sort((a, b) => a.index - b.index);
  writeVariance(runRoot, manifest);
}

export function finaliseVariance(runRoot, manifest, { result }) {
  manifest.completed_at = new Date().toISOString();
  manifest.result = result; // "success" | "failed" | "partial"
  writeVariance(runRoot, manifest);
}

export function readVarianceManifest(runRoot) {
  const p = varianceManifestPath(runRoot);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf-8"));
  } catch {
    return null;
  }
}

function writeVariance(runRoot, manifest) {
  writeFileSync(
    varianceManifestPath(runRoot),
    JSON.stringify(manifest, null, 2) + "\n"
  );
}

// Run a small command and return its first line of output, or null
// on error. Used for capturing tool versions and the git SHA — these
// are nice-to-haves, not load-bearing, so missing tools shouldn't
// break manifest writing.
function safeShellOneLine(cmd) {
  try {
    const out = execFileSync(cmd[0], cmd.slice(1), {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return out.split("\n")[0].trim();
  } catch {
    return null;
  }
}

// "allium 3.2.3 (language versions: 1, 2, 3)" → "3.2.3"
// "2.1.126 (Claude Code)"                     → "2.1.126"
function parseVersionLine(line) {
  if (!line) return null;
  const m = line.match(/(\d+\.\d+\.\d+(?:[-.\w]*)?)/);
  return m ? m[1] : line;
}
