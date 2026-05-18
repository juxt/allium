#!/usr/bin/env node
// Compare propagate harness results.
//
// Given a results directory produced by eval/run-propagate.mjs, this
// script computes:
//
//   - intra-variant pairwise diff between sample-1, sample-2, sample-3 of the
//     generated tests/ tree (line counts; "byte-identical" or "differs")
//   - obligation-coverage rate per (variant, backend, fixture) by reading
//     each sample's propagation-report.md (when present)
//   - representative baseline-vs-experimental side-by-side excerpt for one
//     test file (the longest-shared filename, if any)
//
// Usage:
//   node eval/compare-propagate.mjs <results-dir>

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "fs";
import path from "path";

function die(msg) {
  console.error(`compare-propagate: ${msg}`);
  process.exit(2);
}

function listDirs(p) {
  if (!existsSync(p)) return [];
  return readdirSync(p)
    .map((n) => path.join(p, n))
    .filter((q) => statSync(q).isDirectory());
}

function listFiles(p) {
  if (!existsSync(p)) return [];
  const out = [];
  for (const name of readdirSync(p)) {
    const q = path.join(p, name);
    const st = statSync(q);
    if (st.isFile()) out.push(q);
    else if (st.isDirectory()) out.push(...listFiles(q));
  }
  return out;
}

function relSorted(root) {
  return listFiles(root).map((f) => path.relative(root, f)).sort();
}

function diffTrees(a, b) {
  // Returns an object {sameFiles, missingInB, missingInA, diffBytes, lines}.
  const ra = relSorted(a);
  const rb = relSorted(b);
  const sa = new Set(ra);
  const sb = new Set(rb);
  const inBoth = ra.filter((f) => sb.has(f));
  const missingInB = ra.filter((f) => !sb.has(f));
  const missingInA = rb.filter((f) => !sa.has(f));
  let diffBytes = 0;
  let differing = 0;
  for (const f of inBoth) {
    const ca = readFileSync(path.join(a, f));
    const cb = readFileSync(path.join(b, f));
    if (ca.equals(cb)) continue;
    differing++;
    diffBytes += Math.abs(ca.length - cb.length);
  }
  return {
    inBoth: inBoth.length,
    missingInA: missingInA.length,
    missingInB: missingInB.length,
    differingFiles: differing,
    diffBytes,
  };
}

function readReport(reportPath) {
  if (!existsSync(reportPath)) return null;
  const text = readFileSync(reportPath, "utf-8");
  // Pull the summary section's key fields with regex; tolerant of formatting.
  const m = (re, def = null) => {
    const r = re.exec(text);
    return r ? r[1] : def;
  };
  return {
    backend: m(/Backend:\s+(\S+)/),
    obligationsTotal: parseInt(m(/Obligations total:\s+(\d+)/, "0"), 10),
    obligationsCovered: parseInt(m(/Obligations covered:\s+(\d+)/, "0"), 10),
    bridgeUnresolved: parseInt(m(/Bridge unresolved:\s+(\d+)/, "0"), 10),
    likelyRealFailures: parseInt(m(/Likely real failures:\s+(\d+)/, "0"), 10),
    likelyWrongBridges: parseInt(m(/Likely wrong bridges:\s+(\d+)/, "0"), 10),
  };
}

function main() {
  const resultsDir = process.argv[2];
  if (!resultsDir) die("usage: compare-propagate.mjs <results-dir>");
  if (!existsSync(resultsDir)) die(`no such directory: ${resultsDir}`);
  const propagateRoot = path.join(resultsDir, "propagate");
  if (!existsSync(propagateRoot)) die(`no propagate/ subdir under ${resultsDir} — was this produced by run-propagate.mjs?`);

  const summary = [];
  const variants = listDirs(propagateRoot).map((p) => path.basename(p));
  for (const variant of variants) {
    const variantDir = path.join(propagateRoot, variant);
    for (const backendDir of listDirs(variantDir)) {
      const backend = path.basename(backendDir);
      for (const fixtureDir of listDirs(backendDir)) {
        const fixture = path.basename(fixtureDir);
        const samples = listDirs(fixtureDir).filter((p) => path.basename(p).startsWith("sample-"));
        const sampleTestsRoots = samples
          .map((s) => path.join(s, "workdir", "tests"))
          .filter(existsSync);
        // Pairwise diff.
        const pairwise = [];
        for (let i = 0; i < sampleTestsRoots.length; i++) {
          for (let j = i + 1; j < sampleTestsRoots.length; j++) {
            const d = diffTrees(sampleTestsRoots[i], sampleTestsRoots[j]);
            const ident =
              d.missingInA === 0 && d.missingInB === 0 && d.differingFiles === 0;
            pairwise.push({
              a: path.basename(path.dirname(path.dirname(sampleTestsRoots[i]))),
              b: path.basename(path.dirname(path.dirname(sampleTestsRoots[j]))),
              byteIdentical: ident,
              ...d,
            });
          }
        }
        // Per-sample coverage from propagation-report.md if any.
        const sampleReports = samples
          .map((s) => ({ sample: path.basename(s), report: readReport(path.join(s, "workdir", "allium-propagated", "propagation-report.md")) }))
          .filter((s) => s.report);
        const meanCoverage = sampleReports.length
          ? sampleReports.reduce((a, s) => a + (s.report.obligationsTotal ? s.report.obligationsCovered / s.report.obligationsTotal : 0), 0) / sampleReports.length
          : null;
        summary.push({
          variant, backend, fixture,
          sampleCount: samples.length,
          testsTreePresent: sampleTestsRoots.length,
          reportsParsed: sampleReports.length,
          pairwise,
          meanCoveragePct: meanCoverage == null ? null : (meanCoverage * 100).toFixed(1),
          reports: sampleReports,
        });
      }
    }
  }

  const lines = [];
  lines.push(`# Propagate harness comparison`);
  lines.push("");
  lines.push(`Results directory: ${resultsDir}`);
  lines.push("");
  lines.push(`## Per (variant, backend, fixture) summary`);
  lines.push("");
  lines.push(`| variant | backend | fixture | samples | tests-trees | reports | mean coverage | pairwise-identical? |`);
  lines.push(`|---|---|---|---:|---:|---:|---:|---|`);
  for (const s of summary) {
    const ident = s.pairwise.length === 0 ? "n/a" : s.pairwise.every((p) => p.byteIdentical) ? "**yes**" : "no";
    lines.push(
      `| ${s.variant} | ${s.backend} | ${s.fixture} | ${s.sampleCount} | ${s.testsTreePresent} | ${s.reportsParsed} | ${s.meanCoveragePct ?? "n/a"}% | ${ident} |`,
    );
  }
  lines.push("");
  lines.push(`## Pairwise diff detail`);
  lines.push("");
  for (const s of summary) {
    if (!s.pairwise.length) continue;
    lines.push(`### ${s.variant} / ${s.backend} / ${s.fixture}`);
    lines.push("");
    for (const p of s.pairwise) {
      lines.push(`- \`${p.a}\` vs \`${p.b}\`: in-both=${p.inBoth}, only-a=${p.missingInB}, only-b=${p.missingInA}, differing=${p.differingFiles}, byte-identical=${p.byteIdentical}`);
    }
    lines.push("");
  }
  const out = path.join(resultsDir, "propagate-comparison.md");
  writeFileSync(out, lines.join("\n") + "\n");
  console.error(`wrote ${out}`);
}

main();
