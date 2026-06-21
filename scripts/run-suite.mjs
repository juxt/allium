#!/usr/bin/env node
// Stage C: backend-aware runner + report formatter.
//
// Reads a merged obligation-bridge.merged.json (to know the framework, the
// obligation set, and bridge confidence), executes the backend's runner
// command against the generated tests, parses the JSON/XML report via a
// per-format adapter, categorises outcomes, and emits propagation-report.md.
//
// The runner is intentionally read-only against the inventory pipeline:
// nothing here feeds back into Stage B. A future iteration could close the
// loop.
//
// Outcome categorisation (independent of backend):
//   - pass     → obligation covered
//   - fail     → assertion failure on a non-stub test (potential real bug)
//   - error    → exception unrelated to assertion (likely wrong bridge)
//   - skipped(bridge-unresolved) → low-confidence stub
//   - skipped(other)             → infrastructure gap
//
// Usage:
//   node run-suite.mjs <merged.json> --tests-root <dir> \
//        [--report <output.md>] [--backends-root <dir>]
//
// --tests-root is where the generated tests live (i.e. the directory the
// translator wrote to, typically `<code_root>` so the test runner can also
// resolve the implementation).

import { readFileSync, writeFileSync, existsSync, mkdtempSync } from "fs";
import { spawnSync } from "child_process";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_BACKENDS_ROOT = path.resolve(__dirname, "..", "skills", "propagate", "backends");

function die(msg) {
  console.error(`run-suite: ${msg}`);
  process.exit(2);
}

function parseArgs(argv) {
  const args = { positional: [] };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--tests-root") args.testsRoot = argv[++i];
    else if (a === "--report") args.report = argv[++i];
    else if (a === "--backends-root") args.backendsRoot = argv[++i];
    else if (a.startsWith("--")) die(`unknown flag: ${a}`);
    else args.positional.push(a);
  }
  if (args.positional.length < 1) die("usage: run-suite.mjs <merged.json> --tests-root <dir>");
  if (!args.testsRoot) die("missing required flag --tests-root <dir>");
  args.merged = args.positional[0];
  args.backendsRoot = args.backendsRoot ?? DEFAULT_BACKENDS_ROOT;
  args.report = args.report ?? "propagation-report.md";
  return args;
}

function readJson(p) {
  try { return JSON.parse(readFileSync(p, "utf-8")); }
  catch (err) { die(`failed to read JSON from ${p}: ${err.message}`); }
}

function loadBackend(backendsRoot, framework) {
  const dir = path.join(backendsRoot, framework);
  if (!existsSync(dir)) die(`framework "${framework}" not found under ${backendsRoot}`);
  return { manifest: readJson(path.join(dir, "manifest.json")), dir };
}

// --- adapters ---------------------------------------------------------------

const ADAPTERS = {
  "pytest-junitxml": adaptPytestJunitXml,
  "jest-json": adaptJestJson,
};

// Minimal XML parser tailored to JUnit-XML's <testsuite>/<testcase> shape.
function parseJunitXml(text) {
  // We only need testcase elements with their attributes and nested skipped/failure/error tags.
  const out = [];
  const re = /<testcase\b([^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const attrs = parseAttrs(m[1]);
    const body = m[3] ?? "";
    const tc = { ...attrs, status: "pass" };
    const skippedM = /<skipped\b([^>]*)(?:\/>|>([\s\S]*?)<\/skipped>)/.exec(body);
    const failureM = /<failure\b([^>]*)(?:\/>|>([\s\S]*?)<\/failure>)/.exec(body);
    const errorM = /<error\b([^>]*)(?:\/>|>([\s\S]*?)<\/error>)/.exec(body);
    if (skippedM) {
      tc.status = "skipped";
      tc.skipped = parseAttrs(skippedM[1]);
      tc.skipped.body = (skippedM[2] ?? "").trim();
    } else if (failureM) {
      tc.status = "fail";
      tc.failure = parseAttrs(failureM[1]);
      tc.failure.body = (failureM[2] ?? "").trim();
    } else if (errorM) {
      tc.status = "error";
      tc.error = parseAttrs(errorM[1]);
      tc.error.body = (errorM[2] ?? "").trim();
    }
    out.push(tc);
  }
  return out;
}

function parseAttrs(s) {
  const out = {};
  const re = /(\w+)="([^"]*)"/g;
  let m;
  while ((m = re.exec(s)) !== null) out[m[1]] = decodeEntities(m[2]);
  return out;
}

function decodeEntities(s) {
  return s
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

function adaptPytestJunitXml(text, manifest) {
  const cases = parseJunitXml(text);
  return cases.map((tc) => {
    const file = (tc.classname || "").replace(/\./g, "/") + ".py";
    const id = `${file}::${tc.name}`;
    if (tc.status === "pass") return { test_id: id, outcome: "pass" };
    if (tc.status === "skipped") {
      const msg = tc.skipped?.message ?? "";
      const isBridgeUnresolved = msg.includes(manifest.skip_marker ?? "bridge-unresolved");
      return {
        test_id: id,
        outcome: "skipped",
        markers: isBridgeUnresolved ? [manifest.skip_marker ?? "bridge-unresolved"] : [],
        message: msg,
      };
    }
    if (tc.status === "fail") {
      return {
        test_id: id,
        outcome: "fail",
        kind: tc.failure?.message ?? "AssertionError",
        message: (tc.failure?.body ?? "").slice(0, 500),
      };
    }
    if (tc.status === "error") {
      return {
        test_id: id,
        outcome: "error",
        kind: tc.error?.message ?? "Error",
        message: (tc.error?.body ?? "").slice(0, 500),
      };
    }
    return { test_id: id, outcome: "error", message: "unknown status" };
  });
}

function adaptJestJson(text, manifest) {
  // Jest --json schema:
  //   { testResults: [ { name|testFilePath, assertionResults: [ { fullName, status, failureMessages, ... } ] } ] }
  const data = JSON.parse(text);
  const out = [];
  for (const tr of data.testResults ?? []) {
    const filePath = tr.testFilePath ?? tr.name ?? "";
    for (const t of tr.assertionResults ?? tr.testResults ?? []) {
      const id = `${filePath}::${t.fullName}`;
      if (t.status === "passed") out.push({ test_id: id, outcome: "pass" });
      else if (t.status === "pending" || t.status === "skipped") {
        const msg = (t.failureMessages ?? []).join("\n");
        const isBridgeUnresolved = msg.includes(manifest.skip_marker ?? "bridge-unresolved")
          || (t.fullName ?? "").includes(manifest.skip_marker ?? "bridge-unresolved");
        out.push({
          test_id: id,
          outcome: "skipped",
          markers: isBridgeUnresolved ? [manifest.skip_marker ?? "bridge-unresolved"] : [],
          message: msg,
        });
      } else if (t.status === "failed") {
        const msg = (t.failureMessages ?? []).join("\n");
        const isError = /TypeError|ReferenceError|ImportError|MODULE_NOT_FOUND/.test(msg);
        out.push({
          test_id: id,
          outcome: isError ? "error" : "fail",
          kind: isError ? "Error" : "AssertionError",
          message: msg.slice(0, 500),
        });
      }
    }
  }
  return out;
}

// --- runner ----------------------------------------------------------------

function expandPlaceholders(template, vars) {
  if (Array.isArray(template)) return template.map((s) => expandPlaceholders(s, vars));
  return String(template).replace(/\{(\w+)\}/g, (_m, key) => (key in vars ? vars[key] : `{${key}}`));
}

function runRunner(manifest, testsRoot, reportPath) {
  const vars = { report_path: reportPath, test_root: testsRoot };
  const command = expandPlaceholders(manifest.runner.command, vars);
  const scopeArgs = expandPlaceholders(manifest.runner.scope_args ?? [], vars);
  const [cmd, ...rest] = [...command, ...scopeArgs];
  const result = spawnSync(cmd, rest, {
    cwd: testsRoot,
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf-8",
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    command: [cmd, ...rest].join(" "),
  };
}

// --- report -----------------------------------------------------------------

function buildReport(merged, results, runResult, manifest) {
  const obligationByTestId = indexObligationsByTestId(merged);
  const buckets = {
    pass: [],
    fail: [],
    error: [],
    bridge_unresolved: [],
    infra_gap: [],
  };
  for (const r of results) {
    if (r.outcome === "pass") buckets.pass.push(r);
    else if (r.outcome === "fail") buckets.fail.push(r);
    else if (r.outcome === "error") buckets.error.push(r);
    else if (r.outcome === "skipped") {
      const isBridge = (r.markers ?? []).includes(manifest.skip_marker ?? "bridge-unresolved");
      if (isBridge) buckets.bridge_unresolved.push(r);
      else buckets.infra_gap.push(r);
    }
  }
  const totalObligations = merged.obligations.length;
  const resolveOid = (testId) => {
    if (obligationByTestId.has(testId)) return obligationByTestId.get(testId);
    for (const [key, oid] of obligationByTestId.entries()) {
      if (testId.endsWith(key)) return oid;
    }
    return undefined;
  };
  const covered = new Set(buckets.pass.map((r) => resolveOid(r.test_id)).filter(Boolean));
  const lines = [];
  lines.push("# Propagation report");
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- Backend: ${manifest.id}`);
  lines.push(`- Framework language: ${manifest.language}`);
  lines.push(`- Obligations total: ${totalObligations}`);
  lines.push(`- Obligations covered: ${covered.size}  (passing tests: ${buckets.pass.length})`);
  lines.push(`- Bridge unresolved: ${buckets.bridge_unresolved.length}`);
  lines.push(`- Likely real failures: ${buckets.fail.length}  ← human review`);
  lines.push(`- Likely wrong bridges: ${buckets.error.length}  ← re-mapping`);
  lines.push(`- Infrastructure gaps: ${buckets.infra_gap.length}`);
  lines.push("");
  lines.push(`Runner: \`${runResult.command}\``);
  lines.push(`Exit code: ${runResult.status}`);
  lines.push("");

  appendBucket(lines, "Failures (assertion / likely real)", buckets.fail, obligationByTestId);
  appendBucket(lines, "Errors (likely wrong bridges)", buckets.error, obligationByTestId);
  appendBucket(lines, "Bridge unresolved (stubs)", buckets.bridge_unresolved, obligationByTestId);
  appendBucket(lines, "Other skips (infrastructure gaps)", buckets.infra_gap, obligationByTestId);

  if (totalObligations > 0) {
    const pct = ((covered.size / totalObligations) * 100).toFixed(1);
    lines.push("---");
    lines.push("");
    lines.push(`Coverage: ${covered.size}/${totalObligations} obligations (${pct}%).`);
    lines.push("");
  }
  return lines.join("\n");
}

function appendBucket(lines, title, items, obligationByTestId) {
  if (items.length === 0) return;
  lines.push(`## ${title}`);
  lines.push("");
  for (const r of items) {
    const oid = obligationByTestId.get(r.test_id) ?? "<unknown>";
    lines.push(`- \`${r.test_id}\` — obligation \`${oid}\``);
    if (r.message) {
      const trimmed = r.message.split("\n")[0].slice(0, 240);
      lines.push(`  - ${trimmed}`);
    }
  }
  lines.push("");
}

function indexObligationsByTestId(merged) {
  const map = new Map();
  for (const o of merged.obligations) {
    // Build the "<target_file>::<test_name>" key the way the adapter will emit it.
    map.set(`${o.target_file}::${o.test_name}`, o.obligation_id);
  }
  return map;
}

function reportPathFor() {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "propagate-stagec-"));
  return path.join(tmp, "report.xml");
}

function main() {
  const args = parseArgs(process.argv);
  const merged = readJson(args.merged);
  if (!merged.framework) die("merged inventory missing framework");
  const backend = loadBackend(args.backendsRoot, merged.framework);
  const format = backend.manifest.runner.report_format;
  const adapter = ADAPTERS[format];
  if (!adapter) die(`no adapter for report_format=${format}`);

  const reportPath = reportPathFor();
  const runResult = runRunner(backend.manifest, args.testsRoot, reportPath);

  let raw = "";
  if (existsSync(reportPath)) raw = readFileSync(reportPath, "utf-8");
  if (!raw) {
    console.error(`run-suite: runner produced no report at ${reportPath}`);
    console.error(`stdout: ${runResult.stdout.slice(0, 500)}`);
    console.error(`stderr: ${runResult.stderr.slice(0, 500)}`);
    process.exit(2);
  }
  const results = adapter(raw, backend.manifest);
  const report = buildReport(merged, results, runResult, backend.manifest);
  writeFileSync(args.report, report);
  console.error(
    `run-suite: ${results.length} test results -> ${args.report} (exit=${runResult.status})`,
  );
}

main();
