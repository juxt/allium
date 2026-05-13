// Tier 3 — Skill behavioural evals
//
// For each scenario in tests/fixtures/evals/scenarios/*.json:
//   1. mkdtemp a workspace
//   2. write the setup files into it
//   3. run `claude -p '<prompt>'` against the workspace, with our skills
//      loaded via --plugin-dir
//   4. run each assertion against the resulting workspace state
//   5. tear down
//
// Tier 3 is gated behind --live because every scenario costs API spend.
// Without --live the runner skips, never fails. Without `claude` on PATH
// or ANTHROPIC_API_KEY set, same.
//
// Scenario JSON schema (see tests/fixtures/evals/scenarios/README.md
// once authored):
//
//   {
//     "id": "tend-fix-syntax-error",
//     "skill": "tend",
//     "setup": { "files": { "<rel-path>": "<content>" } },
//     "prompt": "/tend fix the syntax error in broken.allium",
//     "budget_usd": 0.5,
//     "model": "sonnet",
//     "assertions": [
//       { "type": "file-exists", "path": "broken.allium" },
//       { "type": "cli-passes",  "cmd": ["allium", "check", "broken.allium"] },
//       { "type": "judge", "rubric": "tend.md",
//         "criteria": ["minimal-edit", "preserves-intent"] }
//     ]
//   }
//
// Assertions are evaluated in order; failures are reported but later
// assertions still run so the report is complete.

import {
  mkdtempSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  statSync,
  readFileSync,
  rmSync,
  existsSync,
} from "fs";
import { tmpdir } from "os";
import path from "path";
import { fileURLToPath } from "url";
import { execFile } from "child_process";
import { promisify } from "util";

import {
  invoke,
  isAvailable as claudeAvailable,
  getAuthMode,
  canAuthenticate,
} from "./lib/claude.mjs";
import { judge } from "./lib/judge.mjs";
import { isAvailable as alliumAvailable } from "./lib/allium-cli.mjs";
import { createReporter, summarise } from "./lib/reporter.mjs";
import { printBanner } from "./lib/banner.mjs";
import { interactive } from "./lib/style.mjs";

const execFileAsync = promisify(execFile);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCENARIOS_DIR = path.join(HERE, "fixtures", "evals", "scenarios");
const RUBRICS_DIR = path.join(HERE, "fixtures", "evals", "rubrics");

export async function run({ filters = [], live = false, quiet = false, verbose = false } = {}) {
  const reporter = createReporter();
  reporter.section("Tier 3 — skill behavioural evals");

  if (!live) {
    reporter.skip("tier3", "not in --live mode (Tier 3 costs API spend)");
    return reporter.getCounters();
  }
  if (!(await claudeAvailable())) {
    reporter.skip("tier3", "`claude` CLI not on PATH");
    return reporter.getCounters();
  }
  const mode = getAuthMode();
  if (!canAuthenticate(mode)) {
    reporter.skip(
      "tier3",
      `auth mode '${mode}' has no credentials — set ANTHROPIC_API_KEY for bare, or pass --oauth to use claude's OAuth login`
    );
    return reporter.getCounters();
  }

  const scenarios = loadScenarios(SCENARIOS_DIR).filter((s) =>
    matches(s, filters)
  );
  if (scenarios.length === 0) {
    reporter.skip("tier3", "no scenarios matched filters");
    return reporter.getCounters();
  }

  if (!quiet) console.log(`  auth mode: ${mode}`);

  for (const scenario of scenarios) {
    await runScenario(scenario, reporter, quiet, verbose);
  }

  return reporter.getCounters();
}

function loadScenarios(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => ({
      file: path.join(dir, f),
      data: JSON.parse(readFileSync(path.join(dir, f), "utf-8")),
    }));
}

function matches(scenario, filters) {
  if (filters.length === 0) return true;
  return filters.some(
    (f) => scenario.data.id === f || scenario.data.skill === f
  );
}

async function runScenario(scenario, reporter, quiet, verbose) {
  const { id, skill, setup, prompt, assertions, budget_usd, model } =
    scenario.data;
  const workspace = mkdtempSync(path.join(tmpdir(), `allium-eval-${id}-`));
  let beforeSnapshot;
  let afterSnapshot;

  try {
    writeSetup(workspace, setup);
    beforeSnapshot = snapshot(workspace);

    if (!quiet) console.log(`  running: ${id}`);
    const inPlaceTick = interactive && !verbose;
    const tickInterval = inPlaceTick ? 1000 : 15000;
    const invokeStartedAt = Date.now();
    const result = await invoke({
      prompt,
      cwd: workspace,
      budgetUsd: budget_usd,
      model,
      onTick: quiet ? undefined : heartbeat(`    ${id}`, inPlaceTick),
      tickIntervalMs: tickInterval,
      onStderr: verbose ? (chunk) => process.stderr.write(chunk) : undefined,
      debug: verbose,
    });
    const invokeElapsed = Date.now() - invokeStartedAt;
    if (inPlaceTick && !quiet) clearHeartbeatLine();

    afterSnapshot = snapshot(workspace);

    if (!result.ok) {
      reporter.fail(`${id}/invoke`, `claude exited ${result.code}`, invokeElapsed);
      return;
    }
    if (!quiet) reporter.pass(`${id}/invoke`, invokeElapsed);

    for (const assertion of assertions) {
      await runAssertion(
        assertion,
        { id, skill, workspace, prompt, beforeSnapshot, afterSnapshot, transcript: result.stdout },
        reporter,
        quiet
      );
    }
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
}

function writeSetup(workspace, setup) {
  if (!setup?.files) return;
  for (const [relPath, content] of Object.entries(setup.files)) {
    const full = path.join(workspace, relPath);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
}

function snapshot(dir) {
  const out = {};
  walk(dir, (relPath) => {
    out[relPath] = readFileSync(path.join(dir, relPath), "utf-8");
  });
  return out;
}

function walk(dir, fn, prefix = "") {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) walk(full, fn, path.join(prefix, entry));
    else fn(path.join(prefix, entry));
  }
}

async function runAssertion(assertion, ctx, reporter, quiet) {
  const tag = `${ctx.id}/${assertion.type}`;
  const startedAt = Date.now();
  const elapsed = () => Date.now() - startedAt;
  switch (assertion.type) {
    case "file-exists":
      if (existsSync(path.join(ctx.workspace, assertion.path))) {
        if (!quiet) reporter.pass(tag, elapsed());
      } else {
        reporter.fail(tag, `expected file ${assertion.path} to exist`, elapsed());
      }
      break;

    case "cli-passes":
      try {
        await execFileAsync(assertion.cmd[0], assertion.cmd.slice(1), {
          cwd: ctx.workspace,
        });
        if (!quiet) reporter.pass(tag, elapsed());
      } catch (e) {
        reporter.fail(
          tag,
          `${assertion.cmd.join(" ")} exited ${e.code ?? "non-zero"}`,
          elapsed()
        );
      }
      break;

    case "judge": {
      if (!(await alliumAvailable())) {
        reporter.skip(tag, "judge skipped: `allium` not on PATH", elapsed());
        return;
      }
      const rubricPath = path.join(RUBRICS_DIR, assertion.rubric);
      if (!existsSync(rubricPath)) {
        reporter.fail(tag, `rubric not found: ${rubricPath}`, elapsed());
        return;
      }
      const verdict = await judge({
        rubricPath,
        variables: {
          before: JSON.stringify(ctx.beforeSnapshot, null, 2),
          after: JSON.stringify(ctx.afterSnapshot, null, 2),
          prompt: ctx.prompt,
          criteria: (assertion.criteria ?? []).join(", "),
        },
      });
      const judgeElapsed = elapsed();
      if (!verdict.ok) {
        reporter.fail(tag, `judge failed: ${verdict.error}`, judgeElapsed);
        return;
      }
      // The judge call's wall clock is reported once on the parent
      // tag; per-criterion lines are scoring breakdowns within that
      // single call and don't have meaningful sub-times.
      if (!quiet) reporter.pass(tag, judgeElapsed);
      for (const v of verdict.verdicts) {
        const subTag = `${tag}:${v.criterion}`;
        if (v.verdict === "pass") {
          if (!quiet) reporter.pass(`${subTag} — ${v.reason}`);
        } else {
          reporter.fail(subTag, `${v.verdict}: ${v.reason}`);
        }
      }
      break;
    }

    default:
      reporter.fail(tag, `unknown assertion type: ${assertion.type}`, elapsed());
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
      process.stdout.write(`\r${prefix} ⏱ ${seconds}s elapsed\x1b[K`);
    } else {
      console.log(`${prefix} ⏱ ${seconds}s elapsed`);
    }
  };
}

// Erase the in-place heartbeat line so the next reporter line lands
// cleanly.
function clearHeartbeatLine() {
  process.stdout.write("\r\x1b[K");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  printBanner();
  const filters = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const live = process.argv.includes("--live");
  const quiet = process.argv.includes("--quiet");
  const verbose = process.argv.includes("--verbose");
  const counters = await run({ filters, live, quiet, verbose });
  summarise("Tier 3", counters);
  process.exit(counters.failed === 0 ? 0 : 1);
}
