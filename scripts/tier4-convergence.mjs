#!/usr/bin/env node
//
// Post-run convergence report for a Tier 4 kept-workspace run.
//
// After `node scripts/test.mjs tier4 <id> --live --oauth --keep-workspace`
// completes, the run dir at tests/.tier4-runs/<scenario>-<ts>/ contains
// one `after-step-N-<skill>/` checkpoint per step. This script diffs
// the SAME named file across consecutive checkpoints and reports the
// line-count delta, so you can see at a glance whether successive
// passes are converging:
//
//   $ node scripts/tier4-convergence.mjs tests/.tier4-runs/weed-convergence-XYZ
//
//   Convergence report for weed-convergence-2026-05-09T... (6 checkpoints):
//
//     Tracking: spec.allium
//
//        1. after-step-1-distill                       (baseline, 142 lines)
//     →  2. after-step-2-weed       Δ  47 lines
//     →  3. after-step-3-weed       Δ  12 lines
//     →  4. after-step-4-weed       Δ   3 lines
//     →  5. after-step-5-weed       Δ   0 lines  ← converged
//     →  6. after-step-6-weed       Δ   0 lines  ← stable
//
//   First zero-delta step: step 5 (after 4 weed passes)
//   Stable from step 5 onward.
//
// With `--judge`, every non-zero transition is also fed to the
// snapshot-diff judge (haiku, ~$0.05 per transition). Each transition
// then gets a `judge:` headline plus a per-change list — so a 28-line
// delta dominated by cosmetic prose looks very different from a
// 28-line delta that removes a rule clause. Useful for understanding
// WHY a run isn't converging (e.g. unbounded @guidance prose growth).
//
// Judge verdicts are cached in `<run-root>/.convergence-judges.json`,
// keyed by `<tracked-file>` then `<from>-><to>` (e.g. `2->3`). Re-runs
// reuse cached entries instantly (no API spend, no wait), so iterating
// on the report's display logic is free after the first --judge run.
// Pass `--refresh-judges` to bypass the cache and re-evaluate every
// transition (e.g. after editing the rubric).
//
// Designed for the weed-convergence scenario but works on any kept
// workspace with multiple checkpoints (e.g. distill-weed-tend).
//
// Flags:
//   --judge                LLM-judge every non-zero transition (haiku, ~$0.05 each)
//   --track <file>         which file to track (default: spec.allium)
//   --refresh-judges       ignore cached verdicts; re-evaluate from scratch

import { existsSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";

import { unifiedDiff } from "../tests/lib/snapshot.mjs";
import { judgeSnapshotDiff, canJudge } from "../tests/lib/snapshot-judge.mjs";
import { formatVerdict } from "../tests/lib/judge-format.mjs";

const execFileAsync = promisify(execFile);

// argv parsing: first positional = runRoot, optional --track <file>,
// optional --judge flag. Order-tolerant so users can mix and match.
const argv = process.argv.slice(2);
const useJudge = takeFlag(argv, "--judge");
const refreshJudges = takeFlag(argv, "--refresh-judges");
const trackedFile = takeFlagValue(argv, "--track") ?? "spec.allium";
const runRoot = argv.find((a) => !a.startsWith("--"));

if (!runRoot || !existsSync(runRoot)) {
  console.error(
    "Usage: node scripts/tier4-convergence.mjs <run-root> [--track <file>] [--judge] [--refresh-judges]"
  );
  console.error("");
  console.error("Where <run-root> is a kept-workspace dir under tests/.tier4-runs/.");
  console.error("");
  console.error("  --track <file>     which file to track (default: spec.allium)");
  console.error("  --judge            run snapshot-diff judge on every non-zero transition");
  console.error("                     (~$0.05/transition with haiku; needs claude + auth)");
  console.error("                     Verdicts cached in <run-root>/.convergence-judges.json");
  console.error("  --refresh-judges   ignore cached verdicts and re-evaluate from scratch");
  process.exit(2);
}

const checkpoints = readdirSync(runRoot)
  .filter((d) => d.startsWith("after-step-"))
  .map((d) => {
    const m = d.match(/^after-step-(\d+)-/);
    return m ? { name: d, n: parseInt(m[1], 10) } : null;
  })
  .filter(Boolean)
  .sort((a, b) => a.n - b.n);

if (checkpoints.length < 2) {
  console.error(
    `Need at least 2 checkpoints to compare; found ${checkpoints.length} in ${runRoot}`
  );
  process.exit(2);
}

const baselinePath = path.join(runRoot, checkpoints[0].name, trackedFile);
if (!existsSync(baselinePath)) {
  console.error(`Tracked file not in baseline checkpoint: ${baselinePath}`);
  process.exit(2);
}
const baselineLines = readFileSync(baselinePath, "utf-8").split("\n").length;

// Resolve scenario id from runRoot dirname; used as judge context. The
// dirname is `<scenario-id>-<UTC-timestamp>`; the timestamp begins with
// a 4-digit year so split on the first dash-followed-by-digit pair.
const scenarioId = path.basename(runRoot).replace(/-\d{4}-\d{2}-\d{2}.*$/, "");

// Cache of judge verdicts keyed by `<trackedFile>` then `<from>-><to>`.
// Shape: { "<file>": { "2->3": { overallSeverity, recommendation, changes, cached_at } } }
const cacheFile = path.join(runRoot, ".convergence-judges.json");
let judgeCache = readJudgeCache(cacheFile);
if (refreshJudges) {
  // Clear out the bucket for this tracked file so we start fresh,
  // but preserve buckets for other tracked files in the same run.
  delete judgeCache[trackedFile];
}
let cacheHits = 0;
let cacheMisses = 0;

if (useJudge) {
  if (!(await canJudge())) {
    console.error(
      "  --judge requested but the judge is unavailable: claude CLI not on PATH, " +
        "or no auth (set ANTHROPIC_API_KEY for bare, or `claude login` for OAuth)."
    );
    process.exit(2);
  }
}

console.log(
  `\nConvergence report for ${path.basename(runRoot)} (${checkpoints.length} checkpoints):\n`
);
console.log(`  Tracking: ${trackedFile}\n`);
console.log(
  `     1. ${pad(checkpoints[0].name, 36)} (baseline, ${baselineLines} lines)`
);

let firstZeroStep = null;
let stableFromStep = null;
let prevDelta = null;

for (let i = 1; i < checkpoints.length; i++) {
  const prev = path.join(runRoot, checkpoints[i - 1].name, trackedFile);
  const curr = path.join(runRoot, checkpoints[i].name, trackedFile);
  if (!existsSync(curr)) {
    console.log(
      `  →  ${(i + 1).toString().padStart(2)}. ${pad(
        checkpoints[i].name,
        36
      )} (${trackedFile} not present)`
    );
    prevDelta = null;
    continue;
  }
  const delta = await countChangedLines(prev, curr);
  let marker = "";
  if (delta === 0) {
    if (firstZeroStep === null) {
      firstZeroStep = i + 1;
      marker = "  ← converged";
    } else if (prevDelta === 0) {
      stableFromStep ??= firstZeroStep;
      marker = "  ← stable";
    }
  } else {
    // a non-zero delta after a zero one breaks stability
    if (firstZeroStep !== null && prevDelta === 0) {
      marker = "  ⚠ regressed (was zero last step)";
    }
  }
  console.log(
    `  →  ${(i + 1).toString().padStart(2)}. ${pad(
      checkpoints[i].name,
      36
    )} Δ ${delta.toString().padStart(3)} lines${marker}`
  );

  // Judge non-zero transitions only — a zero-delta transition has
  // nothing for the judge to assess.
  if (useJudge && delta > 0) {
    const cacheKey = `${i}->${i + 1}`;
    const cached = judgeCache[trackedFile]?.[cacheKey];
    if (cached) {
      cacheHits++;
      console.log(
        formatVerdict(cached, { prefix: "         ", tag: "cached" })
      );
    } else {
      const expected = readFileSync(prev, "utf-8");
      const actual = readFileSync(curr, "utf-8");
      const diff = await unifiedDiff(expected, actual);
      const judgeStartedAt = Date.now();
      const verdict = await judgeSnapshotDiff({
        scenarioId,
        snapshotFile: `${trackedFile} (step ${i} → ${i + 1})`,
        expected,
        actual,
        diff,
      });
      const judgeElapsed = Date.now() - judgeStartedAt;
      if (!verdict.ok) {
        console.log(`         judge failed: ${verdict.error}`);
      } else {
        cacheMisses++;
        // Persist immediately so a Ctrl-C mid-loop keeps the work so far.
        judgeCache[trackedFile] ??= {};
        judgeCache[trackedFile][cacheKey] = {
          overallSeverity: verdict.overallSeverity,
          recommendation: verdict.recommendation,
          changes: verdict.changes,
          cached_at: new Date().toISOString(),
        };
        writeJudgeCache(cacheFile, judgeCache);
        console.log(
          formatVerdict(verdict, { prefix: "         ", elapsedMs: judgeElapsed })
        );
      }
    }
  }

  prevDelta = delta;
}

console.log("");
if (firstZeroStep !== null) {
  const passes = firstZeroStep - 2; // step 1 is distill; step 2 is first weed
  const passesNote = passes >= 1 ? ` (after ${passes} weed pass${passes === 1 ? "" : "es"})` : "";
  console.log(
    `  First zero-delta step: step ${firstZeroStep}${passesNote}`
  );
  if (stableFromStep !== null) {
    console.log(`  Stable from step ${stableFromStep} onward.`);
  } else {
    console.log(`  Note: only one zero-delta observed; rerun with more steps to confirm stability.`);
  }
} else {
  console.log(`  Did NOT converge in ${checkpoints.length - 1} transitions.`);
  console.log(`  Each step still produced ${checkpoints.length - 1 > 0 ? "non-zero" : "?"} changes — try more weed passes, or investigate whether the prompt is unstable.`);
}
if (useJudge && (cacheHits || cacheMisses)) {
  console.log(
    `  Judge cache: ${cacheHits} hit${cacheHits === 1 ? "" : "s"}, ${cacheMisses} fresh evaluation${cacheMisses === 1 ? "" : "s"} (saved to ${path.relative(process.cwd(), cacheFile)})`
  );
}
console.log("");

// ---------------------------------------------------------------------------

async function countChangedLines(a, b) {
  try {
    await execFileAsync("diff", ["-u", a, b]);
    return 0; // exit 0 = no diff
  } catch (e) {
    if (e.code !== 1) throw e;
    const out = String(e.stdout ?? "");
    // Lines that start with + or - but are not the file headers (--- or +++).
    return out
      .split("\n")
      .filter(
        (l) =>
          (l.startsWith("+") || l.startsWith("-")) &&
          !l.startsWith("+++") &&
          !l.startsWith("---")
      ).length;
  }
}

function pad(s, n) {
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}

// Read the per-run judge cache. Returns an empty object if the file
// is absent or malformed (malformed = warn-and-skip rather than abort,
// so a corrupt cache doesn't block iteration).
function readJudgeCache(file) {
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, "utf-8"));
  } catch (e) {
    console.warn(`  (judge cache at ${file} malformed; starting fresh: ${e.message})`);
    return {};
  }
}

function writeJudgeCache(file, cache) {
  writeFileSync(file, JSON.stringify(cache, null, 2) + "\n");
}

// Strip a boolean flag from argv (mutates) and return whether it was present.
function takeFlag(argv, name) {
  const i = argv.indexOf(name);
  if (i < 0) return false;
  argv.splice(i, 1);
  return true;
}

// Strip a `--flag <value>` pair from argv (mutates) and return the value.
function takeFlagValue(argv, name) {
  const i = argv.indexOf(name);
  if (i < 0 || i === argv.length - 1) return null;
  const v = argv[i + 1];
  if (v.startsWith("--")) return null;
  argv.splice(i, 2);
  return v;
}
