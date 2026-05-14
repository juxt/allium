#!/usr/bin/env node
//
// Post-run variance report for a Tier 4 variance scenario.
//
// A variance scenario (one with `repeat: N` in its JSON) produces a
// parent kept-workspace dir containing N independent per-run subdirs:
//
//   tests/.tier4-runs/<id>-<ts>/
//     .tier4-variance-manifest.json
//     runs/01/final/spec.allium
//     runs/02/final/spec.allium
//     ...
//
// This script reads each run's final spec, computes pairwise diffs,
// and optionally calls the snapshot-diff judge on every pair. The
// goal is to answer "how much variance is there across N runs of
// the same pipeline?" — i.e. how much the early non-deterministic
// distill output influences the final spec after weed/tend cleanup.
//
// Usage:
//   $ node scripts/tier4-variance.mjs tests/.tier4-runs/distill-stability-XYZ
//   $ node scripts/tier4-variance.mjs <run-root> --judge
//   $ node scripts/tier4-variance.mjs <run-root> --judge --pair 1,3
//   $ node scripts/tier4-variance.mjs <run-root> --refresh-judges
//   $ node scripts/tier4-variance.mjs <run-root> --judge --concurrency 10
//
// With --judge:
//   - Every pair (i, j) with i < j is judged once and cached in
//     <run-root>/.variance-judges.json. Re-runs reuse cache.
//   - Pair evaluation runs concurrently (default 5 in flight); cached
//     pairs cost nothing, fresh pairs each take one judge round-trip.
//   - Clustering: runs whose pairwise verdicts are all `cosmetic`
//     (or zero-delta) are grouped into the same cluster. Singletons
//     and outliers are surfaced.
//
// --pair i,j drilldown: print the cached verdict for one specific
// pair using the same renderer tier4 uses for snapshot fails.
//
// Flags:
//   --judge              LLM-judge every non-zero pair (haiku, ~$0.05 each)
//   --refresh-judges     ignore cached verdicts and re-evaluate
//   --pair i,j           drill into one specific pair (prints verdict + diff line count)
//   --track <file>       which file to compare (default: spec.allium)
//   --concurrency <N>    pairs evaluated in parallel (default: 5)

import { existsSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";

import { unifiedDiff } from "../tests/lib/snapshot.mjs";
import { judgeSnapshotDiff, canJudge } from "../tests/lib/snapshot-judge.mjs";
import { formatVerdict } from "../tests/lib/judge-format.mjs";
import { readVarianceManifest } from "../tests/lib/tier4-manifest.mjs";

const execFileAsync = promisify(execFile);

const argv = process.argv.slice(2);
const useJudge = takeFlag(argv, "--judge");
const refreshJudges = takeFlag(argv, "--refresh-judges");
const pairArg = takeFlagValue(argv, "--pair");
const trackedFile = takeFlagValue(argv, "--track") ?? "spec.allium";
const concurrencyArg = takeFlagValue(argv, "--concurrency");
const concurrency = parseConcurrency(concurrencyArg);
const runRoot = argv.find((a) => !a.startsWith("--"));

if (!runRoot || !existsSync(runRoot)) {
  console.error(
    "Usage: node scripts/tier4-variance.mjs <run-root> [--track <file>] [--judge] [--refresh-judges] [--pair i,j] [--concurrency N]"
  );
  console.error("");
  console.error("Where <run-root> is a variance-scenario kept-workspace dir.");
  console.error("");
  console.error("  --track <file>     which file to compare (default: spec.allium)");
  console.error("  --judge            LLM-judge every pair (haiku, ~$0.05/pair, cached)");
  console.error("  --refresh-judges   re-evaluate all pairs even if cached");
  console.error("  --pair i,j         print the verdict for one pair (1-based indices)");
  console.error("  --concurrency N    pairs evaluated in parallel (default: 5)");
  process.exit(2);
}

const manifest = readVarianceManifest(runRoot);
if (!manifest) {
  console.error(
    `No .tier4-variance-manifest.json at ${runRoot}. Is this a variance-scenario run dir?`
  );
  process.exit(2);
}

// Discover per-run final specs. We trust the manifest for the canonical
// list of runs but read files from disk for the actual content.
const runs = readdirSync(path.join(runRoot, "runs"))
  .filter((d) => /^\d+$/.test(d))
  .map((d) => ({
    index: parseInt(d, 10),
    dir: d,
    finalPath: path.join(runRoot, "runs", d, "final", trackedFile),
  }))
  .filter((r) => existsSync(r.finalPath))
  .sort((a, b) => a.index - b.index);

if (runs.length < 2) {
  console.error(
    `Need at least 2 completed runs with ${trackedFile} to compare; found ${runs.length}.`
  );
  process.exit(2);
}

if (useJudge && !(await canJudge())) {
  console.error(
    "  --judge requested but the judge is unavailable: claude CLI not on PATH, " +
      "or no auth (set ANTHROPIC_API_KEY for bare, or `claude login` for OAuth)."
  );
  process.exit(2);
}

// Cache shape: { "<tracked-file>": { "<i>v<j>": { overallSeverity, recommendation, changes, cached_at } } }
const cacheFile = path.join(runRoot, ".variance-judges.json");
let judgeCache = readJudgeCache(cacheFile);
if (refreshJudges) delete judgeCache[trackedFile];
let cacheHits = 0;
let cacheMisses = 0;

// ---------------------------------------------------------------------------
// --pair drilldown — short-circuit the cluster report
// ---------------------------------------------------------------------------

if (pairArg) {
  const [a, b] = pairArg.split(",").map((n) => parseInt(n.trim(), 10));
  if (Number.isNaN(a) || Number.isNaN(b)) {
    console.error(`Invalid --pair value: ${pairArg}. Expected e.g. --pair 1,3`);
    process.exit(2);
  }
  await drilldownPair(a, b);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Cluster report
// ---------------------------------------------------------------------------

console.log(
  `\nVariance report for ${path.basename(runRoot)} (${runs.length} runs):\n`
);
console.log(`  Tracking: ${trackedFile}`);
console.log(`  Scenario: ${manifest.scenario_id} (${manifest.fixture}, model ${manifest.model})\n`);

// Per-run line-count table
const lineCounts = runs.map((r) => ({
  index: r.index,
  lines: readFileSync(r.finalPath, "utf-8").split("\n").length,
}));
const minLines = Math.min(...lineCounts.map((r) => r.lines));
const maxLines = Math.max(...lineCounts.map((r) => r.lines));
const medianLines = median(lineCounts.map((r) => r.lines));

console.log(`  Line counts: min=${minLines}, median=${medianLines}, max=${maxLines}`);
console.log("");
for (const r of lineCounts) {
  console.log(`    run-${pad2(r.index)}: ${r.lines.toString().padStart(4)} lines`);
}
console.log("");

// Pairwise diff line counts + (optional) judge severity. Severity is
// null when --judge is off; we still get a numeric delta either way.
//
// Pairs run concurrently up to `concurrency` in flight. JS is
// single-threaded between awaits, so the synchronous mutations of
// `judgeCache`, `cacheHits`, `cacheMisses` and the cache file write
// are safe under concurrent workers.
const pairTasks = [];
for (let i = 0; i < runs.length; i++) {
  for (let j = i + 1; j < runs.length; j++) {
    pairTasks.push({ a: runs[i], b: runs[j] });
  }
}

const freshNeeded = useJudge
  ? pairTasks.filter(({ a, b }) => !judgeCache[trackedFile]?.[`${a.index}v${b.index}`]).length
  : 0;
if (useJudge && freshNeeded > 0) {
  const conc = Math.min(concurrency, freshNeeded);
  console.log(
    `  Judging ${pairTasks.length} pair${pairTasks.length === 1 ? "" : "s"} (${freshNeeded} fresh, concurrency ${conc})...`
  );
  console.log("");
}

const pairs = await pMap(
  pairTasks,
  async ({ a, b }) => {
    const aText = readFileSync(a.finalPath, "utf-8");
    const bText = readFileSync(b.finalPath, "utf-8");
    const delta = await countChangedLines(a.finalPath, b.finalPath);
    let severity = null;
    let cached = false;
    let failure = null;
    if (useJudge && delta > 0) {
      const cacheKey = `${a.index}v${b.index}`;
      const hit = judgeCache[trackedFile]?.[cacheKey];
      if (hit) {
        cacheHits++;
        cached = true;
        severity = hit.overallSeverity;
      } else {
        const diff = await unifiedDiff(aText, bText);
        const verdict = await judgeSnapshotDiff({
          scenarioId: manifest.scenario_id,
          snapshotFile: `${trackedFile} (run-${pad2(a.index)} vs run-${pad2(b.index)})`,
          expected: aText,
          actual: bText,
          diff,
        });
        if (!verdict.ok) {
          failure = verdict.error;
        } else {
          cacheMisses++;
          judgeCache[trackedFile] ??= {};
          judgeCache[trackedFile][cacheKey] = {
            overallSeverity: verdict.overallSeverity,
            recommendation: verdict.recommendation,
            changes: verdict.changes,
            cached_at: new Date().toISOString(),
          };
          writeJudgeCache(cacheFile, judgeCache);
          severity = verdict.overallSeverity;
        }
      }
    }
    return { i: a.index, j: b.index, delta, severity, cached, failure };
  },
  concurrency,
);

// Print judge failures in pair order so the output is deterministic
// regardless of completion order under concurrency.
for (const p of pairs) {
  if (p.failure) {
    console.log(
      `    run-${pad2(p.i)} vs run-${pad2(p.j)}: judge failed: ${p.failure}`
    );
  }
}

// Pairwise matrix output. Compact text grid: rows = i, cols = j.
console.log("  Pairwise line-count deltas (upper triangle):");
console.log("");
const indices = runs.map((r) => r.index);
const header = "         " + indices.map((n) => `r${pad2(n)}`.padStart(7)).join("");
console.log(header);
for (const i of indices) {
  const row = [`    r${pad2(i)}:`];
  for (const j of indices) {
    if (j <= i) {
      row.push("      —");
    } else {
      const p = pairs.find((x) => x.i === i && x.j === j);
      row.push(p.delta.toString().padStart(6) + (severityMark(p.severity) || " "));
    }
  }
  console.log(row.join(""));
}
console.log("");
if (useJudge) {
  console.log(
    "    legend: ¹=cosmetic ²=structural ³=semantic (column shows worst severity)"
  );
  console.log("");
}

// Cluster summary. With --judge, two runs are equivalent (mergeable
// into a single behavioural cluster) when their pair verdict is
// non-semantic: cosmetic, structural, or zero-delta. Structural pairs
// describe the same behaviour with a different shape; merging them
// loses no observable behaviour. The merge question is "do these
// describe different behaviour?" — not "do these look the same?".
if (useJudge) {
  const equivalent = (p) =>
    p.delta === 0 ||
    p.severity === "cosmetic" ||
    p.severity === "structural";
  const clusters = unionFind(indices, pairs, equivalent);
  printClusterReport(clusters, pairs);
} else {
  console.log("  Run with --judge to get a verdict-driven cluster summary.");
  console.log("");
}

if (useJudge && (cacheHits || cacheMisses)) {
  console.log(
    `  Judge cache: ${cacheHits} hit${cacheHits === 1 ? "" : "s"}, ${cacheMisses} fresh evaluation${cacheMisses === 1 ? "" : "s"} (saved to ${path.relative(process.cwd(), cacheFile)})`
  );
  console.log("");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function drilldownPair(a, b) {
  const i = Math.min(a, b);
  const j = Math.max(a, b);
  const runA = runs.find((r) => r.index === i);
  const runB = runs.find((r) => r.index === j);
  if (!runA || !runB) {
    console.error(`No run pair ${i}/${j} (have indices: ${runs.map((r) => r.index).join(", ")}).`);
    process.exit(2);
  }
  const aText = readFileSync(runA.finalPath, "utf-8");
  const bText = readFileSync(runB.finalPath, "utf-8");
  const delta = await countChangedLines(runA.finalPath, runB.finalPath);

  console.log(
    `\nPair drilldown: run-${pad2(i)} vs run-${pad2(j)} (${trackedFile})`
  );
  console.log(`  delta: ${delta} lines`);
  console.log("");

  if (!useJudge) {
    console.log("  (pass --judge to see the verdict)");
    return;
  }
  const cacheKey = `${i}v${j}`;
  let verdict = judgeCache[trackedFile]?.[cacheKey];
  let tag = "cached";
  let elapsedMs;
  if (!verdict || refreshJudges) {
    const startedAt = Date.now();
    const diff = await unifiedDiff(aText, bText);
    const result = await judgeSnapshotDiff({
      scenarioId: manifest.scenario_id,
      snapshotFile: `${trackedFile} (run-${pad2(i)} vs run-${pad2(j)})`,
      expected: aText,
      actual: bText,
      diff,
    });
    elapsedMs = Date.now() - startedAt;
    if (!result.ok) {
      console.log(`  judge failed: ${result.error}`);
      return;
    }
    verdict = {
      overallSeverity: result.overallSeverity,
      recommendation: result.recommendation,
      changes: result.changes,
      cached_at: new Date().toISOString(),
    };
    judgeCache[trackedFile] ??= {};
    judgeCache[trackedFile][cacheKey] = verdict;
    writeJudgeCache(cacheFile, judgeCache);
    tag = undefined; // formatVerdict will use elapsedMs instead
  }
  console.log(
    formatVerdict(verdict, { prefix: "  ", tag, elapsedMs })
  );
  console.log("");
}

function printClusterReport(clusters, pairs) {
  console.log(
    "  Clusters (behaviourally-equivalent runs grouped — cosmetic + structural pairs treated as equivalent):"
  );
  console.log("");
  const labels = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const sortedClusters = clusters.slice().sort((a, b) => b.length - a.length);
  sortedClusters.forEach((c, k) => {
    const tag = c.length === 1 ? "singleton" : `cluster ${labels[k]}`;
    const ids = c.map((n) => `run-${pad2(n)}`).join(", ");
    console.log(`    ${tag}: ${ids}`);
  });
  console.log("");
  if (sortedClusters.length < 2) {
    console.log("  All runs are mutually cosmetic — distill variance does not propagate.");
    console.log("");
    return;
  }
  console.log("  Inter-cluster verdicts:");
  for (let a = 0; a < sortedClusters.length; a++) {
    for (let b = a + 1; b < sortedClusters.length; b++) {
      const pairList = [];
      for (const i of sortedClusters[a]) {
        for (const j of sortedClusters[b]) {
          const lo = Math.min(i, j);
          const hi = Math.max(i, j);
          const p = pairs.find((x) => x.i === lo && x.j === hi);
          if (p) pairList.push(p);
        }
      }
      const cosmetic = pairList.filter((p) => p.severity === "cosmetic").length;
      const structural = pairList.filter((p) => p.severity === "structural").length;
      const semantic = pairList.filter((p) => p.severity === "semantic").length;
      const labelA = sortedClusters[a].length === 1 ? `run-${pad2(sortedClusters[a][0])}` : `cluster ${labels[a]}`;
      const labelB = sortedClusters[b].length === 1 ? `run-${pad2(sortedClusters[b][0])}` : `cluster ${labels[b]}`;
      console.log(
        `    ${labelA} vs ${labelB}: ${pairList.length} pairs — cosmetic ${cosmetic}, structural ${structural}, semantic ${semantic}`
      );
    }
  }
  console.log("");
}

// Build equivalence classes among indices using `equivalent(pair)`
// as the union predicate. Returns an array of arrays of indices.
function unionFind(indices, pairs, equivalent) {
  const parent = new Map(indices.map((i) => [i, i]));
  const find = (x) => {
    while (parent.get(x) !== x) {
      parent.set(x, parent.get(parent.get(x)));
      x = parent.get(x);
    }
    return x;
  };
  const union = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  for (const p of pairs) if (equivalent(p)) union(p.i, p.j);
  const groups = new Map();
  for (const i of indices) {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(i);
  }
  return Array.from(groups.values());
}

function severityMark(sev) {
  if (sev === "cosmetic") return "¹";
  if (sev === "structural") return "²";
  if (sev === "semantic") return "³";
  return "";
}

function median(nums) {
  const sorted = nums.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
    : sorted[mid];
}

function pad2(n) {
  return n < 10 ? `0${n}` : String(n);
}

async function countChangedLines(a, b) {
  try {
    await execFileAsync("diff", ["-u", a, b]);
    return 0;
  } catch (e) {
    if (e.code !== 1) throw e;
    const out = String(e.stdout ?? "");
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

function readJudgeCache(file) {
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, "utf-8"));
  } catch (e) {
    console.warn(`  (variance-judge cache at ${file} malformed; starting fresh: ${e.message})`);
    return {};
  }
}

function writeJudgeCache(file, cache) {
  writeFileSync(file, JSON.stringify(cache, null, 2) + "\n");
}

function takeFlag(argv, name) {
  const i = argv.indexOf(name);
  if (i < 0) return false;
  argv.splice(i, 1);
  return true;
}

function takeFlagValue(argv, name) {
  const i = argv.indexOf(name);
  if (i < 0 || i === argv.length - 1) return null;
  const v = argv[i + 1];
  if (v.startsWith("--")) return null;
  argv.splice(i, 2);
  return v;
}

function parseConcurrency(arg) {
  if (arg == null) return 5;
  const n = parseInt(arg, 10);
  if (!Number.isFinite(n) || n < 1) {
    console.error(`Invalid --concurrency value: ${arg}. Expected a positive integer.`);
    process.exit(2);
  }
  return n;
}

// Bounded-concurrency map. Preserves input order in the result array.
async function pMap(items, mapper, concurrency) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (true) {
      const idx = next++;
      if (idx >= items.length) return;
      results[idx] = await mapper(items[idx], idx);
    }
  };
  const workers = Array.from(
    { length: Math.max(1, Math.min(concurrency, items.length)) },
    worker,
  );
  await Promise.all(workers);
  return results;
}
