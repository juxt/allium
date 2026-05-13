// Tier 4 — End-to-end pipeline evals
//
// Drives a multi-step pipeline (distill → tend → propagate) against a
// checked-in fixture project, then snapshots the produced .allium and
// generated test artefacts for comparison against accepted goldens.
//
// A scenario is a JSON file with a sequence of steps. Each step invokes
// one skill via `claude -p` against an isolated copy of the fixture
// directory. The cumulative workspace state at the end of the run is
// compared file-by-file against the scenario's accepted snapshot
// directory.
//
// Scenario JSON schema:
//
//   {
//     "id": "distill-only",
//     "fixture": "node-todo",
//     "steps": [
//       { "skill": "distill",
//         "prompt": "Use the distill skill to extract a spec from the JS files in this directory. Write the result to spec.allium." }
//     ],
//     "snapshot_files": ["spec.allium"],
//     "snapshot_dir": "snapshots/distill-only",
//     "budget_usd_per_step": 1.0,
//     "model": "sonnet"
//   }
//
// Tier 4 is gated behind --live (every scenario costs $0.50–$2). The
// runner copies fixture/<name>/starting-state/ into a tmp workspace,
// runs each step in sequence inside that workspace, then for every
// file in `snapshot_files` reads the produced text and compares it
// against snapshots/<file>. Pass --update-snapshots to overwrite the
// accepted snapshots from the actual output (review the diff before
// committing).
//
// Skip conditions match Tier 3: --live not passed; `claude` missing;
// ANTHROPIC_API_KEY missing; `allium` missing.

import {
  mkdtempSync,
  cpSync,
  readFileSync,
  rmSync,
  existsSync,
  mkdirSync,
  readdirSync,
  symlinkSync,
  lstatSync,
} from "fs";
import { tmpdir } from "os";
import path from "path";
import { fileURLToPath } from "url";

import {
  invoke,
  isAvailable as claudeAvailable,
  getAuthMode,
  canAuthenticate,
} from "./lib/claude.mjs";
import { isAvailable as alliumAvailable } from "./lib/allium-cli.mjs";
import {
  compareDual,
  writeSnapshot,
  writeModelSnapshot,
  modelOf,
} from "./lib/snapshot.mjs";
import { judgeSnapshotDiff, canJudge } from "./lib/snapshot-judge.mjs";
import { createReporter, summarise } from "./lib/reporter.mjs";
import { printBanner } from "./lib/banner.mjs";
import { interactive } from "./lib/style.mjs";
import {
  createManifest,
  appendStep,
  finalise,
  readManifest,
  createVarianceManifest,
  updateVarianceManifest,
  finaliseVariance,
  readVarianceManifest,
} from "./lib/tier4-manifest.mjs";
import { formatVerdict } from "./lib/judge-format.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const E2E_ROOT = path.join(HERE, "fixtures", "e2e");
const REPO_ROOT = path.dirname(HERE);
const KEPT_RUNS_ROOT = path.join(REPO_ROOT, "tests", ".tier4-runs");

export async function run({
  filters = [],
  live = false,
  quiet = false,
  updateSnapshots = false,
  verbose = false,
  keepWorkspace = false,
  workspaceOverride = null,
  judge = true,
  showDiff = false,
  repeats = null,
  concurrency = 3,
} = {}) {
  const reporter = createReporter();
  reporter.section("Tier 4 — end-to-end pipeline");

  // Replay mode: --workspace was passed. We don't call claude at all,
  // so live/auth checks don't apply. We do still need allium for the
  // model-snapshot comparator.
  const isReplay = Boolean(workspaceOverride);

  if (!isReplay) {
    if (!live) {
      reporter.skip("tier4", "not in --live mode (Tier 4 costs API spend)");
      return reporter.getCounters();
    }
    if (!(await claudeAvailable())) {
      reporter.skip("tier4", "`claude` CLI not on PATH");
      return reporter.getCounters();
    }
    const mode = getAuthMode();
    if (!canAuthenticate(mode)) {
      reporter.skip(
        "tier4",
        `auth mode '${mode}' has no credentials — set ANTHROPIC_API_KEY for bare, or pass --oauth to use claude's OAuth login`
      );
      return reporter.getCounters();
    }
  }
  if (!(await alliumAvailable())) {
    reporter.skip("tier4", "`allium` CLI not on PATH");
    return reporter.getCounters();
  }

  // In replay, scenario selection comes from the manifest (or filter
  // args as a fallback). Otherwise, normal discovery + filtering.
  let scenarios = discoverScenarios(E2E_ROOT);
  if (isReplay) {
    const inferredId = inferScenarioFromWorkspace(workspaceOverride);
    if (inferredId) scenarios = scenarios.filter((s) => s.data.id === inferredId);
    if (filters.length > 0) scenarios = scenarios.filter((s) => matches(s, filters));
    if (scenarios.length !== 1) {
      reporter.fail(
        "tier4-replay",
        `replay needs exactly one scenario; got ${scenarios.length}. Pass the scenario id as a positional arg if the workspace has no .tier4-manifest.json.`
      );
      return reporter.getCounters();
    }
  } else {
    scenarios = scenarios.filter((s) => matches(s, filters));
    if (scenarios.length === 0) {
      reporter.skip("tier4", "no scenarios matched filters");
      return reporter.getCounters();
    }
  }

  if (!quiet && !isReplay) console.log(`  auth mode: ${getAuthMode()}`);
  if (!quiet && isReplay) console.log(`  replay from: ${workspaceOverride}`);

  for (const scenario of scenarios) {
    if (isReplay) {
      await replayScenario(scenario, reporter, {
        quiet,
        verbose,
        updateSnapshots,
        workspaceOverride,
        judge,
        showDiff,
        repeats,
        concurrency,
      });
    } else {
      // Variance scenarios opt in via `repeat: N` in the JSON; the
      // CLI `--repeats N` flag overrides for cheap iteration on
      // smaller N first.
      const effectiveRepeats = repeats ?? scenario.data.repeat ?? 1;
      if (effectiveRepeats > 1) {
        await runVarianceScenario(scenario, reporter, {
          quiet,
          verbose,
          keepWorkspace,
          repeats: effectiveRepeats,
          concurrency,
        });
      } else {
        await runScenario(scenario, reporter, {
          quiet,
          updateSnapshots,
          verbose,
          keepWorkspace,
          judge,
          showDiff,
        });
      }
    }
  }

  return reporter.getCounters();
}

// If the user passed a runRoot (a kept-workspace dir) read the
// manifest to identify the scenario. Returns the scenario id, or null
// if the workspace has neither a per-run nor a variance manifest.
//
// Variance run-roots have .tier4-variance-manifest.json at the top
// level (per-run manifests live one level deeper under runs/NN/).
function inferScenarioFromWorkspace(workspacePath) {
  return (
    readManifest(workspacePath)?.scenario_id ??
    readVarianceManifest(workspacePath)?.scenario_id ??
    null
  );
}

function discoverScenarios(rootDir) {
  if (!existsSync(rootDir)) return [];
  const out = [];
  for (const fixture of readdirSync(rootDir)) {
    const scenariosDir = path.join(rootDir, fixture, "scenarios");
    if (!existsSync(scenariosDir)) continue;
    for (const entry of readdirSync(scenariosDir)) {
      if (!entry.endsWith(".json")) continue;
      const file = path.join(scenariosDir, entry);
      const data = JSON.parse(readFileSync(file, "utf-8"));
      out.push({
        file,
        fixtureName: fixture,
        fixtureRoot: path.join(rootDir, fixture),
        data,
      });
    }
  }
  return out;
}

function matches(scenario, filters) {
  if (filters.length === 0) return true;
  return filters.some(
    (f) => scenario.data.id === f || scenario.fixtureName === f
  );
}

async function runScenario(scenario, reporter, opts) {
  const { quiet, updateSnapshots, verbose, keepWorkspace, judge, showDiff } = opts;
  const { id, steps, model, fixture: _ignored } = scenario.data;
  const startingState = path.join(scenario.fixtureRoot, "starting-state");
  if (!existsSync(startingState)) {
    reporter.fail(id, `starting-state directory missing: ${startingState}`);
    return;
  }

  // Layout decision: kept runs live in tests/.tier4-runs/<id>-<ts>/
  // with a stable structure (starting-state/, workspace/, after-step-N-*,
  // final/ symlink, .tier4-manifest.json). Throwaway runs live in a
  // mkdtemp tmpdir, deleted in finally{}.
  const runRoot = keepWorkspace
    ? createKeptRunRoot(id)
    : mkdtempSync(path.join(tmpdir(), `allium-e2e-${id}-`));
  const workspace = keepWorkspace ? path.join(runRoot, "workspace") : runRoot;

  let manifest = null;
  let runResult = "in-progress";

  try {
    cpSync(startingState, workspace, { recursive: true });
    if (keepWorkspace) {
      cpSync(startingState, path.join(runRoot, "starting-state"), {
        recursive: true,
      });
      manifest = createManifest(runRoot, {
        scenarioId: id,
        fixture: scenario.fixtureName,
        authMode: getAuthMode(),
        model,
      });
    }

    const ok = await runSteps({
      scenario,
      runRoot,
      workspace,
      manifest,
      fromIndex: 0,
      reporter,
      opts: { quiet, verbose },
    });
    if (!ok) {
      runResult = "failed";
      return;
    }

    if (manifest) createOrUpdateFinalSymlink(runRoot, steps);

    await runSnapshotComparison(scenario, workspace, reporter, {
      quiet,
      updateSnapshots,
      judge,
      showDiff,
    });

    runResult = "success";
  } finally {
    if (manifest) finalise(runRoot, manifest, { result: runResult });
    if (keepWorkspace) {
      if (!quiet) console.log(`  workspace preserved at ${path.relative(REPO_ROOT, runRoot)}/`);
    } else {
      rmSync(runRoot, { recursive: true, force: true });
    }
  }
}

// Variance dispatcher. Used when a scenario sets `repeat: N` (or
// --repeats N is passed). Drives N independent runs of the same
// step sequence under a single parent kept-workspace dir, executes
// up to `concurrency` of them in parallel, and writes a parent
// variance manifest tracking per-run outcomes.
//
// Layout produced:
//   tests/.tier4-runs/<id>-<ts>/
//     .tier4-variance-manifest.json
//     starting-state/
//     runs/01/.tier4-manifest.json  runs/01/workspace/  runs/01/after-step-*/  runs/01/final/
//     runs/02/...
//
// Each runs/NN/ is structurally identical to a regular kept run, so
// any per-run tooling (the convergence script, snapshot inspectors)
// works against runs/NN/ unchanged.
//
// Variance scenarios skip the snapshot-comparison step — they have
// no golden baseline; the comparison is between runs and is performed
// by scripts/tier4-variance.mjs against the parent dir.
async function runVarianceScenario(scenario, reporter, opts) {
  const { quiet, verbose, keepWorkspace, repeats, concurrency } = opts;
  const { id, model } = scenario.data;

  if (!keepWorkspace) {
    reporter.fail(
      `${id}/variance`,
      "variance scenarios (repeat > 1) require --keep-workspace — otherwise the per-run dirs are deleted at the end of the run, defeating the purpose"
    );
    return;
  }

  const startingState = path.join(scenario.fixtureRoot, "starting-state");
  if (!existsSync(startingState)) {
    reporter.fail(id, `starting-state directory missing: ${startingState}`);
    return;
  }

  const effectiveConcurrency = Math.max(1, Math.min(concurrency, repeats));

  const runRoot = createKeptRunRoot(id);
  cpSync(startingState, path.join(runRoot, "starting-state"), { recursive: true });
  mkdirSync(path.join(runRoot, "runs"), { recursive: true });

  const varianceManifest = createVarianceManifest(runRoot, {
    scenarioId: id,
    fixture: scenario.fixtureName,
    repeat: repeats,
    concurrency: effectiveConcurrency,
    authMode: getAuthMode(),
    model,
  });

  if (!quiet) {
    console.log(
      `  variance: ${repeats} runs at concurrency ${effectiveConcurrency} → ${path.relative(REPO_ROOT, runRoot)}/`
    );
  }

  const indices = Array.from({ length: repeats }, (_, i) => i + 1);
  const outcomes = await executeVarianceWorkers({
    scenario,
    runRoot,
    startingState,
    indices,
    varianceManifest,
    concurrency: effectiveConcurrency,
    reporter,
    opts: { quiet, verbose },
  });

  const successes = outcomes.filter((o) => o.result === "success").length;
  const overall =
    successes === repeats ? "success" : successes === 0 ? "failed" : "partial";
  finaliseVariance(runRoot, varianceManifest, { result: overall });

  if (!quiet) {
    console.log(
      `  ${successes}/${repeats} runs succeeded; analyse with: node scripts/tier4-variance.mjs ${path.relative(REPO_ROOT, runRoot)}`
    );
  }
}

// Resume an interrupted or extended variance run. Pointing --workspace
// at a variance run-root that has fewer completed runs than the
// scenario's current `repeat` (or `--repeats` override) bumps it back
// up: completed runs are kept; missing or previously-failed runs are
// (re-)executed into the same parent dir, and the parent manifest's
// runs[] is appended/updated. The cluster analysis script then sees
// the full set.
//
// "Completed" means the per-run dir exists, has its own manifest, and
// the manifest's result is "success". Failed/in-progress runs are
// rerun from scratch (the old dir is wiped first).
async function resumeVarianceScenario(scenario, reporter, opts, varianceManifest) {
  const { quiet, verbose, workspaceOverride, repeats, concurrency } = opts;
  const { id } = scenario.data;
  const runRoot = workspaceOverride;
  const targetRepeats = repeats ?? scenario.data.repeat ?? varianceManifest.repeat;

  // Discover completed runs. A run is "complete" if runs/NN/ has a
  // per-run manifest whose result is "success".
  const completedIndices = listCompletedVarianceRuns(runRoot);
  const target = Math.max(targetRepeats, completedIndices.length);

  if (completedIndices.length > target) {
    reporter.fail(
      `${id}/variance-resume`,
      `workspace has ${completedIndices.length} completed runs but the scenario only wants ${target}. Lower --repeats or remove excess runs/NN/ dirs.`
    );
    return;
  }

  // What to execute = scenario.repeat indices minus the completed ones.
  // For 1..target, any index not in completedIndices is a candidate
  // (either never started, in-progress, or failed previously).
  const todo = [];
  for (let i = 1; i <= target; i++) {
    if (!completedIndices.includes(i)) todo.push(i);
  }

  if (todo.length === 0) {
    reporter.skip(
      `${id}/variance-resume`,
      `nothing to resume — ${completedIndices.length} runs already complete. Analyse with: node scripts/tier4-variance.mjs ${path.relative(REPO_ROOT, runRoot)}`
    );
    return;
  }

  // Need claude + auth to resume — same gate as a fresh run.
  if (!(await claudeAvailable())) {
    reporter.fail(`${id}/variance-resume`, "`claude` CLI not on PATH");
    return;
  }
  const mode = getAuthMode();
  if (!canAuthenticate(mode)) {
    reporter.fail(
      `${id}/variance-resume`,
      `auth mode '${mode}' has no credentials — set ANTHROPIC_API_KEY for bare, or pass --oauth to use claude's OAuth login`
    );
    return;
  }

  const effectiveConcurrency = Math.max(1, Math.min(concurrency, todo.length));

  // Wipe any pre-existing failed/in-progress dirs in the todo set so
  // each retry gets a fresh starting state and a clean manifest.
  for (const i of todo) {
    const d = path.join(runRoot, "runs", padIndex(i));
    if (existsSync(d)) rmSync(d, { recursive: true, force: true });
  }

  // Update parent manifest: bumped repeat, back to in-progress.
  varianceManifest.repeat = target;
  varianceManifest.concurrency = effectiveConcurrency;
  varianceManifest.result = "in-progress";
  varianceManifest.completed_at = null;
  // Drop any non-success run entries — they'll be re-added by the
  // worker as it finishes; this keeps the manifest in sync.
  varianceManifest.runs = varianceManifest.runs.filter(
    (r) => r.result === "success" && completedIndices.includes(r.index)
  );

  if (!quiet) {
    console.log(
      `  variance resume: ${completedIndices.length} prior runs reused, executing ${todo.length} new run${todo.length === 1 ? "" : "s"} at concurrency ${effectiveConcurrency} → ${path.relative(REPO_ROOT, runRoot)}/`
    );
    console.log(`  auth mode: ${mode}`);
  }

  const startingState = path.join(runRoot, "starting-state");
  if (!existsSync(startingState)) {
    reporter.fail(
      `${id}/variance-resume`,
      `parent starting-state missing at ${startingState}`
    );
    return;
  }

  const outcomes = await executeVarianceWorkers({
    scenario,
    runRoot,
    startingState,
    indices: todo,
    varianceManifest,
    concurrency: effectiveConcurrency,
    reporter,
    opts: { quiet, verbose },
  });

  // Outcomes here only cover the new runs. For the overall result,
  // combine with the preserved completed runs.
  const newSuccesses = outcomes.filter((o) => o.result === "success").length;
  const totalSuccesses = completedIndices.length + newSuccesses;
  const overall =
    totalSuccesses === target ? "success" : totalSuccesses === 0 ? "failed" : "partial";
  finaliseVariance(runRoot, varianceManifest, { result: overall });

  if (!quiet) {
    console.log(
      `  ${totalSuccesses}/${target} runs total now complete; analyse with: node scripts/tier4-variance.mjs ${path.relative(REPO_ROOT, runRoot)}`
    );
  }
}

// Drive the per-run worker pool. Returns the per-run outcome list,
// in input order (worker order is irrelevant to the caller — the
// parent manifest is what knows about each run).
//
// `indices` is the list of 1-based run indices to execute; for fresh
// runs that's 1..N, for resume it's the sparse list of missing ones.
//
// Per-run worker: copies starting-state into runs/NN/workspace/,
// creates a fresh per-run manifest, runs runSteps, and updates the
// parent manifest under a lock so two workers finishing concurrently
// don't race on the read-modify-write.
async function executeVarianceWorkers({
  scenario,
  runRoot,
  startingState,
  indices,
  varianceManifest,
  concurrency,
  reporter,
  opts,
}) {
  const { quiet, verbose } = opts;
  const { id, model } = scenario.data;

  const worker = async (runIndex) => {
    const runDir = `runs/${padIndex(runIndex)}`;
    const runRootForRun = path.join(runRoot, runDir);
    mkdirSync(runRootForRun, { recursive: true });
    cpSync(startingState, path.join(runRootForRun, "starting-state"), {
      recursive: true,
    });
    const workspace = path.join(runRootForRun, "workspace");
    cpSync(startingState, workspace, { recursive: true });

    const manifest = createManifest(runRootForRun, {
      scenarioId: id,
      fixture: scenario.fixtureName,
      authMode: getAuthMode(),
      model,
    });

    const startedMs = Date.now();
    let ok = false;
    try {
      ok = await runSteps({
        scenario,
        runRoot: runRootForRun,
        workspace,
        manifest,
        fromIndex: 0,
        reporter,
        opts: {
          quiet,
          verbose,
          runTag: `run-${padIndex(runIndex)}`,
        },
      });
    } catch (e) {
      reporter.fail(
        `${id}/run-${padIndex(runIndex)}`,
        `unexpected error: ${e.message ?? e}`
      );
      ok = false;
    }

    const duration = Math.round((Date.now() - startedMs) / 1000);
    const result = ok ? "success" : "failed";
    if (ok) createOrUpdateFinalSymlink(runRootForRun, scenario.data.steps);
    finalise(runRootForRun, manifest, { result });

    const costUsd = manifest.steps.reduce(
      (acc, s) => acc + (typeof s.cost_usd === "number" ? s.cost_usd : 0),
      0
    );

    await withVarianceLock(() =>
      updateVarianceManifest(runRoot, varianceManifest, {
        runIndex,
        runDir,
        result,
        durationSeconds: duration,
        costUsd: costUsd > 0 ? costUsd : null,
      })
    );

    return { runIndex, result, durationSeconds: duration, costUsd };
  };

  const outcomes = await withConcurrency(indices, concurrency, worker);

  if (!quiet && outcomes.length > 0) {
    console.log("");
    console.log(`  variance run summary for ${id}:`);
    for (const o of outcomes) {
      const tag = padIndex(o.runIndex);
      const cost = o.costUsd ? `$${o.costUsd.toFixed(2)}` : "n/a";
      const mins = (o.durationSeconds / 60).toFixed(1);
      console.log(`    run-${tag}: ${o.result} (${mins}min, ${cost})`);
    }
  }

  return outcomes;
}

// Read every runs/NN/ subdir under a variance run-root and return
// the indices whose per-run manifest reports result "success".
// In-progress and failed runs are NOT included — resume retries them.
function listCompletedVarianceRuns(runRoot) {
  const runsDir = path.join(runRoot, "runs");
  if (!existsSync(runsDir)) return [];
  return readdirSync(runsDir)
    .filter((d) => /^\d+$/.test(d))
    .map((d) => {
      const idx = parseInt(d, 10);
      const m = readManifest(path.join(runsDir, d));
      return m?.result === "success" ? idx : null;
    })
    .filter((idx) => idx !== null)
    .sort((a, b) => a - b);
}

// Two-digit zero-padded run index → "01".."99". Variance scenarios
// won't exceed 99 in practice; if they do, this still produces a
// lexicographically-sortable directory name.
function padIndex(n) {
  return n < 10 ? `0${n}` : String(n);
}

// Bounded-concurrency worker pool. Keeps at most `concurrency`
// promises in flight at a time, draining `items` in order. Returns
// results in input order. Used to run N variance pipelines under a
// configurable cap so we don't blast through rate limits.
async function withConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let idx = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (idx < items.length) {
        const i = idx++;
        results[i] = await worker(items[i], i);
      }
    })
  );
  return results;
}

// Serialises variance-manifest writes from parallel workers. Each
// worker's manifest update is a read-modify-write of the same JSON
// file; without a lock two workers finishing within milliseconds of
// each other could both read, both modify, and the second write
// overwrites the first's update. Chained promise queue is sufficient
// — manifest writes are cheap and infrequent.
let varianceLockTail = Promise.resolve();
function withVarianceLock(fn) {
  const next = varianceLockTail.then(fn, fn);
  varianceLockTail = next.catch(() => {});
  return next;
}

// Workspace-mode dispatcher. Three behaviours depending on what the
// workspace contains and how it compares to the scenario:
//
//   variance-resume  — workspace has a .tier4-variance-manifest.json
//                      (it's a variance run-root). Run only the missing
//                      or previously-failed runs into the same parent
//                      dir; previously-successful runs/NN/ are kept.
//   replay           — workspace has at least as many per-step
//                      checkpoints as the scenario has steps. Skip
//                      invokes; just run snapshot comparison against
//                      the last checkpoint.
//   resume           — workspace has fewer per-step checkpoints than
//                      scenario steps, AND existing checkpoints' skills
//                      match the scenario's prefix. Run only the
//                      missing steps starting from the last checkpoint
//                      as the working state. New checkpoints append
//                      into the same runRoot; manifest is appended to
//                      and re-finalised.
//
// If the prefix doesn't match (workspace was made from a different
// scenario, or the scenario's prior steps have been edited), fail
// with a clear message rather than silently doing the wrong thing.
async function replayScenario(scenario, reporter, opts) {
  const { workspaceOverride } = opts;
  if (!existsSync(workspaceOverride)) {
    reporter.fail(
      `${scenario.data.id}/replay`,
      `workspace not found: ${workspaceOverride}`
    );
    return;
  }

  // Variance run-roots are detectable by the parent-level variance
  // manifest. Dispatch to resume-variance rather than treating per-run
  // subdirs (which contain no top-level after-step-* checkpoints) as
  // a broken regular kept run.
  const varianceManifest = readVarianceManifest(workspaceOverride);
  if (varianceManifest) {
    await resumeVarianceScenario(scenario, reporter, opts, varianceManifest);
    return;
  }

  const checkpoints = listCheckpoints(workspaceOverride);
  const totalSteps = scenario.data.steps.length;

  // Validate prefix: every existing checkpoint's skill must match the
  // corresponding scenario step's skill.
  for (let i = 0; i < Math.min(checkpoints.length, totalSteps); i++) {
    const expected = scenario.data.steps[i].skill;
    const actual = checkpoints[i].skill;
    if (actual !== expected) {
      reporter.fail(
        `${scenario.data.id}/replay`,
        `workspace does not match scenario: checkpoint ${i + 1} is '${actual}' but scenario step ${i + 1} is '${expected}'. The workspace was made from a different scenario, or the scenario's prior steps have been edited.`
      );
      return;
    }
  }

  if (checkpoints.length > totalSteps) {
    reporter.fail(
      `${scenario.data.id}/replay`,
      `workspace has more checkpoints (${checkpoints.length}) than scenario steps (${totalSteps}). Either the scenario was trimmed or this workspace is from a different scenario version.`
    );
    return;
  }

  if (checkpoints.length < totalSteps) {
    // RESUME — scenario has new steps to run.
    await runResumeSteps(scenario, reporter, opts, workspaceOverride, checkpoints);
    return;
  }

  // REPLAY — checkpoints exhausted; just snapshot comparison.
  const { quiet, updateSnapshots, judge, showDiff } = opts;
  const workspace = resolveReplayWorkspace(workspaceOverride);
  await runSnapshotComparison(scenario, workspace, reporter, {
    quiet,
    updateSnapshots,
    judge,
    showDiff,
  });
}

// Resume invocation from after the last checkpoint. The existing
// manifest is appended to; the workspace/ subdir is replaced with
// a fresh copy of the last checkpoint as the starting state.
async function runResumeSteps(scenario, reporter, opts, runRoot, existingCheckpoints) {
  const { quiet, updateSnapshots, judge, showDiff } = opts;
  const { id, steps } = scenario.data;

  // Resume needs claude (we're going to invoke), same gate as a fresh run.
  if (!(await claudeAvailable())) {
    reporter.fail(`${id}/resume`, "`claude` CLI not on PATH");
    return;
  }
  const mode = getAuthMode();
  if (!canAuthenticate(mode)) {
    reporter.fail(
      `${id}/resume`,
      `auth mode '${mode}' has no credentials — set ANTHROPIC_API_KEY for bare, or pass --oauth to use claude's OAuth login`
    );
    return;
  }

  // Read existing manifest; resume needs it to append step entries.
  // If absent, the workspace wasn't made by tier4 with --keep-workspace
  // and resuming would corrupt state.
  const manifest = readManifest(runRoot);
  if (!manifest) {
    reporter.fail(
      `${id}/resume`,
      `workspace has no .tier4-manifest.json — can't resume safely. Use --update-snapshots or omit --workspace to start over.`
    );
    return;
  }

  // Prepare the working dir from the last checkpoint.
  const workspace = path.join(runRoot, "workspace");
  const lastCheckpoint = existingCheckpoints[existingCheckpoints.length - 1];
  rmSync(workspace, { recursive: true, force: true });
  cpSync(path.join(runRoot, lastCheckpoint.dirname), workspace, { recursive: true });

  if (!quiet) {
    console.log(
      `  resuming from step ${existingCheckpoints.length + 1} of ${steps.length} (${existingCheckpoints.length} prior checkpoint${existingCheckpoints.length === 1 ? "" : "s"} reused)`
    );
    console.log(`  auth mode: ${mode}`);
  }

  // Reset manifest state to in-progress for the duration of the resume.
  manifest.result = "in-progress";

  const ok = await runSteps({
    scenario,
    runRoot,
    workspace,
    manifest,
    fromIndex: existingCheckpoints.length,
    reporter,
    opts,
  });

  if (!ok) {
    finalise(runRoot, manifest, { result: "failed" });
    return;
  }

  createOrUpdateFinalSymlink(runRoot, steps);
  finalise(runRoot, manifest, { result: "success" });

  await runSnapshotComparison(scenario, workspace, reporter, {
    quiet,
    updateSnapshots,
    judge,
    showDiff,
  });

  if (!quiet) {
    console.log(`  workspace updated at ${path.relative(REPO_ROOT, runRoot)}/`);
  }
}

// Run a contiguous slice of scenario steps starting at `fromIndex`
// (zero-based), invoking claude per step against `workspace`. After
// each successful step, copy the workspace into a checkpoint and
// append the step entry to the manifest.
//
// Returns true when every step in the slice succeeded; false on the
// first claude failure (caller is responsible for finalising the
// manifest with result: "failed").
//
// Used by both fresh runs (fromIndex = 0) and resume mode
// (fromIndex = number of existing checkpoints).
async function runSteps({
  scenario,
  runRoot,
  workspace,
  manifest,
  fromIndex,
  reporter,
  opts,
}) {
  const { quiet, verbose, runTag } = opts;
  const { id, steps, model } = scenario.data;

  // In-place \r updating only when stdout is interactive AND --verbose
  // is off AND we are not under concurrency (runTag set → variance
  // worker — sibling workers' heartbeats would step on each other).
  const inPlaceTick = interactive && !verbose && !runTag;
  const tickInterval = inPlaceTick ? 1000 : 15000;

  // Prefix every log + reporter tag with the run identifier when set,
  // so concurrent workers' lines remain attributable in interleaved
  // output. `runTag: "run-03"` →  `[node-todo/run-03 2/5] weed`
  const runScope = runTag ? `${id}/${runTag}` : id;
  const stepTag = (stepIndex, skill) =>
    `[${runScope} ${stepIndex}/${steps.length}] ${skill}`;
  const reporterId = (stepIndex, skill) =>
    `${runScope}/step-${stepIndex}-${skill}`;

  for (let i = fromIndex; i < steps.length; i++) {
    const step = steps[i];
    const stepIndex = i + 1;
    const tag = stepTag(stepIndex, step.skill);
    if (!quiet) console.log(`  ${tag}`);
    const startedAt = new Date().toISOString();
    const stepStartedMs = Date.now();
    const result = await invoke({
      prompt: step.prompt,
      cwd: workspace,
      budgetUsd: scenario.data.budget_usd_per_step ?? 1.0,
      model,
      // 20 minutes per step. Distill on a multi-file fixture in
      // OAuth mode (1M-context Opus startup + agentic file reading)
      // can legitimately take 10-15 min; the previous 10-min cap was
      // hitting SIGTERM mid-run.
      timeoutMs: 20 * 60 * 1000,
      onTick: quiet ? undefined : heartbeat(`    ${tag}`, inPlaceTick),
      tickIntervalMs: tickInterval,
      onStderr: verbose ? (chunk) => process.stderr.write(chunk) : undefined,
      // Verbose pairs claude --debug with the live stderr tee.
      debug: verbose,
    });
    const stepElapsed = Date.now() - stepStartedMs;
    if (inPlaceTick && !quiet) clearHeartbeatLine();
    if (!result.ok) {
      reporter.fail(
        reporterId(stepIndex, step.skill),
        `claude exited ${result.code}`,
        stepElapsed
      );
      if (manifest) {
        appendStep(runRoot, manifest, {
          stepIndex,
          skill: step.skill,
          startedAt,
          result,
          checkpointDir: null,
        });
      }
      return false;
    }
    if (!quiet) reporter.pass(reporterId(stepIndex, step.skill), stepElapsed);

    if (manifest) {
      const checkpointDir = `after-step-${stepIndex}-${step.skill}`;
      cpSync(workspace, path.join(runRoot, checkpointDir), { recursive: true });
      appendStep(runRoot, manifest, {
        stepIndex,
        skill: step.skill,
        startedAt,
        result,
        checkpointDir,
      });
    }
  }
  return true;
}

// List existing per-step checkpoints in a runRoot, sorted by step
// index. Each entry: { dirname, n, skill }.
function listCheckpoints(runRoot) {
  return readdirSync(runRoot)
    .map((name) => {
      const m = name.match(/^after-step-(\d+)-(.+)$/);
      return m ? { dirname: name, n: parseInt(m[1], 10), skill: m[2] } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.n - b.n);
}

// Snapshot comparison block (extracted so both fresh runs and replay
// can use it). Reads each snapshot_file from the workspace and either
// compares it against the accepted snapshots (default) or rewrites
// the snapshots from it (--update-snapshots).
async function runSnapshotComparison(
  scenario,
  workspace,
  reporter,
  { quiet, updateSnapshots, judge = true, showDiff = false }
) {
  const { id, snapshot_files: snapshotFiles, snapshot_dir } = scenario.data;
  // Variance scenarios (and anything else without a golden baseline)
  // omit snapshot_files. Nothing to compare against.
  if (!Array.isArray(snapshotFiles) || snapshotFiles.length === 0) {
    if (!quiet) console.log(`  ${id}: no snapshot_files declared — skipping comparison`);
    return;
  }
  const snapshotDir = path.join(scenario.fixtureRoot, snapshot_dir);
  if (updateSnapshots) {
    mkdirSync(snapshotDir, { recursive: true });
  }

  // Resolve judge availability up-front (used both for gating the
  // judge call and for shaping the no-info hint when neither is set).
  const judgeAvailable = judge ? await canJudge() : false;

  for (const relPath of snapshotFiles) {
    const tag = `${id}/${relPath}`;
    const startedAt = Date.now();
    const actualPath = path.join(workspace, relPath);
    if (!existsSync(actualPath)) {
      reporter.fail(
        tag,
        `expected output ${relPath} was not produced`,
        Date.now() - startedAt
      );
      continue;
    }
    const textSnapshotPath = path.join(snapshotDir, relPath);
    const modelSnapshotPath = `${textSnapshotPath}.model.json`;

    if (updateSnapshots) {
      const actual = readFileSync(actualPath, "utf-8");
      mkdirSync(path.dirname(textSnapshotPath), { recursive: true });
      writeSnapshot(textSnapshotPath, actual);
      if (relPath.endsWith(".allium")) {
        const model = await modelOf(actualPath);
        if (model !== null) writeModelSnapshot(modelSnapshotPath, model);
      }
      if (!quiet) reporter.pass(`${tag} (updated)`, Date.now() - startedAt);
      continue;
    }

    const cmp = await compareDual({
      actualPath,
      expectedTextPath: textSnapshotPath,
      expectedModelPath: modelSnapshotPath,
    });

    if (cmp.match) {
      if (!quiet) reporter.pass(`${tag} (matched on ${cmp.reason})`, Date.now() - startedAt);
      continue;
    }

    // ---------------------------------------------------------------
    // Mismatch. The judge is the load-bearing pass/fail oracle.
    // ---------------------------------------------------------------

    // No judge configured (--no-judge) → treat any mismatch as a fail.
    if (!judge) {
      reporter.fail(
        tag,
        "snapshot mismatch (--no-judge in effect; pass --diff for the unified diff)",
        Date.now() - startedAt
      );
      maybePrintDiff(cmp, showDiff);
      continue;
    }

    // Judge wanted but can't run (no claude / no auth) → fail with hint.
    if (!judgeAvailable) {
      reporter.fail(
        tag,
        "snapshot mismatch (judge unavailable: no claude/auth; pass --diff for unified diff)",
        Date.now() - startedAt
      );
      maybePrintDiff(cmp, showDiff);
      continue;
    }

    // No baseline to compare against → can't ask the judge meaningfully.
    const expectedText = existsSync(textSnapshotPath)
      ? readFileSync(textSnapshotPath, "utf-8")
      : null;
    if (expectedText === null) {
      reporter.fail(
        tag,
        "no committed snapshot — run with --update-snapshots to capture",
        Date.now() - startedAt
      );
      maybePrintDiff(cmp, showDiff);
      continue;
    }

    const actualText = readFileSync(actualPath, "utf-8");
    const judgeStartedAt = Date.now();
    if (!quiet) console.log("    judge: assessing diff (haiku, ~$0.05, ~30s)…");
    const verdict = await judgeSnapshotDiff({
      scenarioId: id,
      snapshotFile: relPath,
      expected: expectedText,
      actual: actualText,
      diff: cmp.textDiff,
    });
    const judgeElapsed = Date.now() - judgeStartedAt;

    if (!verdict.ok) {
      // Judge couldn't deliver a verdict → fail with the underlying reason.
      reporter.fail(
        tag,
        `judge failed after ${formatMs(judgeElapsed)} — ${verdict.error}`,
        Date.now() - startedAt
      );
      maybePrintDiff(cmp, showDiff);
      continue;
    }

    // Verdict obtained — its recommendation gates pass/fail.
    if (verdict.recommendation === "accept") {
      if (!quiet) {
        reporter.pass(
          `${tag} (judge accepted: ${verdict.overallSeverity} drift)`,
          Date.now() - startedAt
        );
        console.log(formatVerdict(verdict, { prefix: "    ", elapsedMs: judgeElapsed }));
        maybePrintDiff(cmp, showDiff);
      }
    } else {
      reporter.fail(
        tag,
        "snapshot drift requires investigation",
        Date.now() - startedAt
      );
      console.log(formatVerdict(verdict, { prefix: "    ", elapsedMs: judgeElapsed }));
      maybePrintDiff(cmp, showDiff);
    }
  }
}

// Print the unified diff as an indented, demoted trailing block
// (only when --diff is set). Kept separate from reporter.fail's
// detail line so the judge verdict (or pass note) is the headline
// and the diff is supplementary.
function maybePrintDiff(cmp, showDiff) {
  if (!showDiff) return;
  console.log("    diff:");
  for (const line of cmp.textDiff.split("\n")) {
    console.log(`      ${line}`);
  }
  if (cmp.modelDiff && cmp.modelDiff !== "(not an .allium file; model comparison N/A)") {
    console.log(`    model diff: ${cmp.modelDiff}`);
  }
}

function formatMs(ms) {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

// Resolve the directory the snapshot comparison should read from.
// Three layouts are supported:
//   1. The user passed a kept-run root: <path>/final/ exists → use it
//   2. The user passed a kept-run root with no final/ (e.g. interrupted
//      run) but the workspace/ subdir exists → use that as a fallback
//   3. The user passed a directory containing the produced files
//      directly → use it as-is.
function resolveReplayWorkspace(p) {
  const final = path.join(p, "final");
  if (existsSync(final)) return final;
  const ws = path.join(p, "workspace");
  if (existsSync(ws)) return ws;
  return p;
}

// Create the kept-run root: tests/.tier4-runs/<scenarioId>-<UTC-ts>/
function createKeptRunRoot(scenarioId) {
  // ISO timestamp with `:` and `.` replaced (filesystem-friendly).
  const stamp = new Date()
    .toISOString()
    .replace(/[:.]/g, "-")
    .replace(/Z$/, "Z");
  const root = path.join(KEPT_RUNS_ROOT, `${scenarioId}-${stamp}`);
  mkdirSync(root, { recursive: true });
  return root;
}

// Create (or replace) the `final/` symlink to the latest checkpoint.
// Falls back to a recursive copy on filesystems where symlinks fail
// (Windows under WSL with weird mount options, etc.).
function createOrUpdateFinalSymlink(runRoot, steps) {
  if (steps.length === 0) return;
  const last = steps[steps.length - 1];
  const target = `after-step-${steps.length}-${last.skill}`;
  const link = path.join(runRoot, "final");
  // Remove any existing entry first (could be a stale symlink or a copy).
  try {
    const stat = lstatSync(link);
    if (stat.isSymbolicLink() || stat.isDirectory() || stat.isFile()) {
      rmSync(link, { recursive: true, force: true });
    }
  } catch {
    // Doesn't exist; fine.
  }
  try {
    symlinkSync(target, link, "dir");
  } catch {
    // Symlink creation failed (filesystem doesn't support it); fall
    // back to a recursive copy.
    cpSync(path.join(runRoot, target), link, { recursive: true });
  }
}

// Heartbeat callback for runClaude. Returns a function that prints
// "<prefix> ⏱ Ns elapsed" each time it's invoked, so the user can see
// the long-running step is still alive. When `inPlace` is true, the
// caller has decided in-place updating is safe (interactive TTY,
// no concurrent stderr stream) — write \r-prefixed and clear the
// rest of the line so each tick overwrites the last.
function heartbeat(prefix, inPlace) {
  return (elapsedMs) => {
    const seconds = Math.round(elapsedMs / 1000);
    if (inPlace) {
      // \r returns to column 0; \x1b[K clears the rest of the line so
      // earlier longer text doesn't bleed through.
      process.stdout.write(`\r${prefix} ⏱ ${seconds}s elapsed\x1b[K`);
    } else {
      console.log(`${prefix} ⏱ ${seconds}s elapsed`);
    }
  };
}

// Erase the in-place heartbeat line so the next reporter line lands
// cleanly. Safe to call when no heartbeat was active (it just emits
// a CR + clear; nothing visible changes).
function clearHeartbeatLine() {
  process.stdout.write("\r\x1b[K");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  printBanner();
  const argv = process.argv.slice(2);
  const filters = argv.filter((a) => !a.startsWith("--") && !isFlagValue(argv, a));
  const live = argv.includes("--live");
  const quiet = argv.includes("--quiet");
  const updateSnapshots = argv.includes("--update-snapshots");
  const verbose = argv.includes("--verbose");
  const keepWorkspace = argv.includes("--keep-workspace");
  const workspaceOverride = takeFlagValue(argv, "--workspace");
  const judge = !argv.includes("--no-judge");
  const showDiff = argv.includes("--diff");
  const repeatsArg = takeFlagValue(argv, "--repeats");
  const repeats = repeatsArg ? Math.max(1, parseInt(repeatsArg, 10)) : null;
  const concurrencyArg = takeFlagValue(argv, "--concurrency");
  const concurrency = concurrencyArg ? Math.max(1, parseInt(concurrencyArg, 10)) : 3;
  const counters = await run({
    filters,
    live,
    quiet,
    updateSnapshots,
    verbose,
    keepWorkspace,
    workspaceOverride,
    judge,
    showDiff,
    repeats,
    concurrency,
  });
  summarise("Tier 4", counters);
  process.exit(counters.failed === 0 ? 0 : 1);
}

// Read the value following a `--flag` argument (e.g. `--workspace /path`).
// Returns null if the flag is absent or has no value following it.
function takeFlagValue(argv, flag) {
  const i = argv.indexOf(flag);
  if (i < 0 || i === argv.length - 1) return null;
  const v = argv[i + 1];
  if (v.startsWith("--")) return null;
  return v;
}

// Used by the positional-arg filter to skip values that follow a
// `--flag <value>` pair so they aren't treated as scenario filters.
function isFlagValue(argv, candidate) {
  const valueFlags = ["--workspace", "--repeats", "--concurrency"];
  for (const f of valueFlags) {
    const i = argv.indexOf(f);
    if (i >= 0 && argv[i + 1] === candidate) return true;
  }
  return false;
}
