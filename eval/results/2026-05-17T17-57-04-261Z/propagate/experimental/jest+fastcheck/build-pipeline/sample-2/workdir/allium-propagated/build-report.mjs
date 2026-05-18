#!/usr/bin/env node
// Local Stage C runner: works around the v2-pending bug in
// plugins/experimental/scripts/run-suite.mjs whose adaptJestJson expects
// `testFilePath` + `testResults[].testResults[]` while real Jest emits
// `name` + `assertionResults[]`.
//
// Format and bucket semantics mirror run-suite.mjs::buildReport exactly.

import { readFileSync, writeFileSync, mkdtempSync, existsSync } from "fs";
import { spawnSync } from "child_process";
import path from "path";
import os from "os";

const MERGED_PATH = process.argv[2];
const TESTS_ROOT = process.argv[3];
const REPORT_PATH = process.argv[4];
const BACKEND_MANIFEST = process.argv[5];

const merged = JSON.parse(readFileSync(MERGED_PATH, "utf-8"));
const manifest = JSON.parse(readFileSync(BACKEND_MANIFEST, "utf-8"));
const skipMarker = manifest.skip_marker ?? "bridge-unresolved";

const tmpDir = mkdtempSync(path.join(os.tmpdir(), "propagate-stagec-"));
const reportPath = path.join(tmpDir, "report.json");

// runner: npx-style, but use locally installed jest
const runArgs = ["--json", `--outputFile=${reportPath}`];
const runner = spawnSync(path.resolve(TESTS_ROOT, "node_modules/.bin/jest"), runArgs, {
  cwd: TESTS_ROOT,
  stdio: ["ignore", "pipe", "pipe"],
  encoding: "utf-8",
});

if (!existsSync(reportPath)) {
  console.error("no jest report produced");
  console.error("stderr:", runner.stderr.slice(0, 800));
  process.exit(2);
}

const raw = JSON.parse(readFileSync(reportPath, "utf-8"));

// Build results in the same shape run-suite.mjs::buildReport expects.
const results = [];
for (const tr of raw.testResults ?? []) {
  const filePath = tr.name; // absolute path
  // Build the same key the obligation index uses: "<target_file>::<test_name>"
  // where target_file is relative to tests-root.
  const relFile = path.relative(TESTS_ROOT, filePath);
  for (const t of tr.assertionResults ?? []) {
    const id = `${relFile}::${t.fullName}`;
    if (t.status === "passed") {
      results.push({ test_id: id, outcome: "pass" });
    } else if (t.status === "pending" || t.status === "skipped") {
      const msg = (t.failureMessages ?? []).join("\n");
      const isBridgeUnresolved =
        msg.includes(skipMarker) || (t.fullName ?? "").includes(skipMarker);
      results.push({
        test_id: id,
        outcome: "skipped",
        markers: isBridgeUnresolved ? [skipMarker] : [],
        message: msg,
      });
    } else if (t.status === "failed") {
      const msg = (t.failureMessages ?? []).join("\n");
      const isError = /TypeError|ReferenceError|ImportError|MODULE_NOT_FOUND/.test(msg);
      results.push({
        test_id: id,
        outcome: isError ? "error" : "fail",
        kind: isError ? "Error" : "AssertionError",
        message: msg.slice(0, 500),
      });
    }
  }
}

// Obligation index — same as run-suite.mjs::indexObligationsByTestId.
const obligationByTestId = new Map();
for (const o of merged.obligations) {
  obligationByTestId.set(`${o.target_file}::${o.test_name}`, o.obligation_id);
}

const buckets = { pass: [], fail: [], error: [], bridge_unresolved: [], infra_gap: [] };
for (const r of results) {
  if (r.outcome === "pass") buckets.pass.push(r);
  else if (r.outcome === "fail") buckets.fail.push(r);
  else if (r.outcome === "error") buckets.error.push(r);
  else if (r.outcome === "skipped") {
    const isBridge = (r.markers ?? []).includes(skipMarker);
    if (isBridge) buckets.bridge_unresolved.push(r);
    else buckets.infra_gap.push(r);
  }
}

const totalObligations = merged.obligations.length;
const covered = new Set(
  buckets.pass.map((r) => obligationByTestId.get(r.test_id)).filter(Boolean),
);

const lines = [];
lines.push("# Propagation report");
lines.push("");
lines.push("## Summary");
lines.push("");
lines.push(`- Backend: ${manifest.id}`);
lines.push(`- Framework language: ${manifest.language}`);
lines.push(`- Obligations total: ${totalObligations}`);
lines.push(
  `- Obligations covered: ${covered.size}  (passing tests: ${buckets.pass.length})`,
);
lines.push(`- Bridge unresolved: ${buckets.bridge_unresolved.length}`);
lines.push(`- Likely real failures: ${buckets.fail.length}  ← human review`);
lines.push(`- Likely wrong bridges: ${buckets.error.length}  ← re-mapping`);
lines.push(`- Infrastructure gaps: ${buckets.infra_gap.length}`);
lines.push("");
lines.push(`Runner: \`npx jest --json --outputFile=${reportPath}\``);
lines.push(`Exit code: ${runner.status}`);
lines.push("");

function appendBucket(title, items) {
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

appendBucket("Failures (assertion / likely real)", buckets.fail);
appendBucket("Errors (likely wrong bridges)", buckets.error);
appendBucket("Bridge unresolved (stubs)", buckets.bridge_unresolved);
appendBucket("Other skips (infrastructure gaps)", buckets.infra_gap);

if (totalObligations > 0) {
  const pct = ((covered.size / totalObligations) * 100).toFixed(1);
  lines.push("---");
  lines.push("");
  lines.push(`Coverage: ${covered.size}/${totalObligations} obligations (${pct}%).`);
  lines.push("");
}

writeFileSync(REPORT_PATH, lines.join("\n"));
console.error(
  `local stage-c: ${results.length} test results -> ${REPORT_PATH} (exit=${runner.status})`,
);
