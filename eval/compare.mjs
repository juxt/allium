#!/usr/bin/env node
// Read a results directory produced by run.mjs and emit a report.
//
//   eval/results/<timestamp>/
//     run-config.json
//     <variant>/sample-<n>/spec.allium    (input — many)
//     report.md                            (output — one)
//
// The report covers:
//   - allium-check pass rate per variant
//   - intra-variant determinism (pairwise line diffs + entity/rule set deltas)
//   - inter-variant diff (sample-1 from each variant, unified text + structural)
//
// Usage:
//   node eval/compare.mjs eval/results/<timestamp>

import { spawnSync } from "child_process";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "fs";
import path from "path";

const ALLIUM_BIN = process.env.ALLIUM_BIN || "/opt/homebrew/bin/allium";

function fail(msg) { console.error(`error: ${msg}`); process.exit(2); }

function listDirs(p) {
  return readdirSync(p).filter((n) => statSync(path.join(p, n)).isDirectory());
}

function safeRun(cmd, args, opts = {}) {
  // Capture stdout/stderr/exit without throwing on non-zero exit.
  const r = spawnSync(cmd, args, { encoding: "utf-8", ...opts });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

function tryParseJSON(s) {
  try { return JSON.parse(s); } catch { return null; }
}

function alliumCheck(specPath) {
  const r = safeRun(ALLIUM_BIN, ["check", specPath]);
  const parsed = tryParseJSON(r.stdout);
  const diagnostics = parsed?.diagnostics ?? [];
  const errorCount = diagnostics.filter((d) => d.severity === "error").length;
  const warningCount = diagnostics.filter((d) => d.severity === "warning").length;
  const infoCount = diagnostics.filter((d) => d.severity === "info").length;
  return {
    // ok = no errors. Warnings/info don't fail a spec — `allium check` exits
    // 1 on any diagnostic, so we can't rely on the exit code alone.
    ok: errorCount === 0,
    errorCount,
    warningCount,
    infoCount,
    diagnostics,
    raw: r.stdout || r.stderr,
  };
}

function alliumModel(specPath) {
  // `allium model` extracts the domain model as structured JSON.
  // If a spec is unparseable, the call exits non-zero and we fall back to a
  // text-only structural read.
  const r = safeRun(ALLIUM_BIN, ["model", specPath]);
  if (r.status !== 0) return null;
  return tryParseJSON(r.stdout);
}

function structuralFromModel(model) {
  // `allium model` shape isn't guaranteed stable across versions — be
  // defensive. Walk a few likely keys and degrade gracefully.
  const entities = model?.entities ?? model?.domain?.entities ?? [];
  const rules = model?.rules ?? model?.domain?.rules ?? [];
  const entityNames = entities.map((e) => e?.name ?? e?.identifier).filter(Boolean);
  const ruleNames = rules.map((r) => r?.name ?? r?.identifier).filter(Boolean);
  const fieldCount = entities.reduce(
    (acc, e) => acc + (Array.isArray(e?.fields) ? e.fields.length : 0),
    0,
  );
  return {
    entityCount: entities.length,
    ruleCount: rules.length,
    fieldCount,
    entityNames: new Set(entityNames),
    ruleNames: new Set(ruleNames),
  };
}

function structuralFromText(specText) {
  // Fallback when `allium model` fails (typically: the spec doesn't parse).
  // We regex over top-level constructs by NAME so we still have a structural
  // fingerprint to compare across variants. This is coarser than `allium
  // model`'s output — it can't see relationships or type structure — but
  // when both specs fail parse, it's the only signal left.
  //
  // Top-level kinds per the v3 grammar:
  //   entity / external entity / variant       -> "entity-like"
  //   rule / trigger / invariant               -> "rule-like"
  //   enum / value / contract / surface /
  //     actor / config / defaults / given      -> tracked separately, not
  //                                               folded into rule/entity
  // We also count anonymous fields (`name: type`) under each entity-like
  // block, terminating on the next top-level keyword.
  const ENTITY_LIKE = /^(?:external\s+)?(?:entity|variant)\s+([A-Za-z_][A-Za-z0-9_]*)/;
  const RULE_LIKE = /^(?:rule|trigger|invariant)\s+([A-Za-z_][A-Za-z0-9_]*)/;
  const OTHER_TOP = /^(?:enum|value|contract|surface|actor|config|defaults?|given|use|namespace|integration|state_machine|job)\b/;
  const FIELD_LINE = /^\s{2,}[a-z_][a-z0-9_]*\s*:/;

  const lines = specText.split("\n");
  const entityNames = new Set();
  const ruleNames = new Set();
  const otherCounts = {};
  let fieldCount = 0;
  let inEntity = false;
  for (const line of lines) {
    const ent = line.match(ENTITY_LIKE);
    if (ent) { entityNames.add(ent[1]); inEntity = true; continue; }
    const rule = line.match(RULE_LIKE);
    if (rule) { ruleNames.add(rule[1]); inEntity = false; continue; }
    const other = line.match(OTHER_TOP);
    if (other) {
      const kind = line.trim().split(/\s+/)[0];
      otherCounts[kind] = (otherCounts[kind] ?? 0) + 1;
      inEntity = false;
      continue;
    }
    if (/^[A-Za-z]/.test(line)) inEntity = false;       // unknown new top-level
    if (inEntity && FIELD_LINE.test(line)) fieldCount++;
  }
  return {
    entityCount: entityNames.size,
    ruleCount: ruleNames.size,
    fieldCount,
    entityNames,
    ruleNames,
    otherCounts,
    fallback: true,
  };
}

function unifiedDiff(aPath, bPath) {
  const r = safeRun("diff", ["-u", aPath, bPath]);
  // diff exits 1 when files differ — that's not an error here.
  return r.stdout;
}

function lineDiffCount(aPath, bPath) {
  const diff = unifiedDiff(aPath, bPath);
  // Count +/- lines, excluding the "+++" / "---" header lines.
  let count = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+") || line.startsWith("-")) count++;
  }
  return count;
}

function setDiff(a, b) {
  const onlyA = [...a].filter((x) => !b.has(x));
  const onlyB = [...b].filter((x) => !a.has(x));
  return { onlyA, onlyB, jaccard: jaccard(a, b) };
}

function jaccard(a, b) {
  const u = new Set([...a, ...b]);
  if (u.size === 0) return 1;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / u.size;
}

function median(nums) {
  if (nums.length === 0) return null;
  const s = [...nums].sort((x, y) => x - y);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function summariseVariant(samples) {
  const entityCounts = samples.map((s) => s.structural.entityCount);
  const ruleCounts = samples.map((s) => s.structural.ruleCount);
  const fieldCounts = samples.map((s) => s.structural.fieldCount);
  const passCount = samples.filter((s) => s.check.ok).length;
  const fallbackCount = samples.filter((s) => s.structural.fallback).length;
  // Sum of `otherCounts` keys across samples (fallback-only).
  const otherTotals = {};
  for (const s of samples) {
    for (const [k, v] of Object.entries(s.structural.otherCounts ?? {})) {
      otherTotals[k] = (otherTotals[k] ?? 0) + v;
    }
  }

  // Pairwise diffs
  const pairLineDiffs = [];
  const pairEntityJaccards = [];
  const pairRuleJaccards = [];
  for (let i = 0; i < samples.length; i++) {
    for (let j = i + 1; j < samples.length; j++) {
      pairLineDiffs.push(lineDiffCount(samples[i].specPath, samples[j].specPath));
      pairEntityJaccards.push(jaccard(samples[i].structural.entityNames, samples[j].structural.entityNames));
      pairRuleJaccards.push(jaccard(samples[i].structural.ruleNames, samples[j].structural.ruleNames));
    }
  }

  return {
    sampleCount: samples.length,
    passCount,
    fallbackCount,
    entityCounts,
    ruleCounts,
    fieldCounts,
    otherTotals,
    medianEntityCount: median(entityCounts),
    medianRuleCount: median(ruleCounts),
    medianFieldCount: median(fieldCounts),
    pairLineDiffs,
    medianLineDiff: median(pairLineDiffs),
    medianEntityJaccard: median(pairEntityJaccards),
    medianRuleJaccard: median(pairRuleJaccards),
  };
}

function loadSamples(resultsDir) {
  const variants = listDirs(resultsDir).filter((d) =>
    existsSync(path.join(resultsDir, d, "sample-1")) ||
    existsSync(path.join(resultsDir, d, "sample-2"))
  );
  const byVariant = {};
  for (const v of variants) {
    const variantDir = path.join(resultsDir, v);
    const samples = [];
    for (const sd of listDirs(variantDir).sort()) {
      const specPath = path.join(variantDir, sd, "spec.allium");
      if (!existsSync(specPath)) continue;
      const text = readFileSync(specPath, "utf-8");
      const check = alliumCheck(specPath);
      const model = alliumModel(specPath);
      // `allium model` only surfaces the static domain model (entities, value
      // types, enums) — rules, triggers, invariants and surfaces live in
      // `allium plan` instead. So we always run the text scan to fill in the
      // rule-side counts even when `allium model` succeeds.
      //
      // Also: `allium model` returns 0 entities for specs it can't fully
      // parse (e.g. when entity blocks use the wrong delimiter syntax).
      // When that happens, the text scan often still finds the entity
      // declarations — so we prefer the larger of the two counts.
      const textual = structuralFromText(text);
      const fromModel = model ? structuralFromModel(model) : null;
      let structural;
      if (fromModel && fromModel.entityCount >= textual.entityCount) {
        structural = {
          ...fromModel,
          ruleCount: textual.ruleCount,
          ruleNames: textual.ruleNames,
          otherCounts: textual.otherCounts,
        };
      } else {
        // Either `allium model` failed or its entity count is suspiciously
        // smaller than the text count — trust the text scan, but keep
        // model-derived enum data if available.
        structural = {
          ...textual,
          fallback: true,
          ...(fromModel ? { modelEntityCount: fromModel.entityCount } : {}),
        };
      }
      samples.push({ name: sd, specPath, text, check, structural });
    }
    byVariant[v] = samples;
  }
  return byVariant;
}

function formatSetDiff(label, sd) {
  const lines = [`- ${label}: Jaccard ${sd.jaccard.toFixed(2)}`];
  if (sd.onlyA.length) lines.push(`  - only in A: ${sd.onlyA.join(", ")}`);
  if (sd.onlyB.length) lines.push(`  - only in B: ${sd.onlyB.join(", ")}`);
  return lines.join("\n");
}

function renderReport(resultsDir, byVariant, runConfig) {
  const lines = [];
  lines.push(`# A/B harness report`);
  lines.push("");
  lines.push(`- results dir: \`${resultsDir}\``);
  lines.push(`- started: ${runConfig?.startedAt ?? "(unknown)"}`);
  lines.push(`- model: ${runConfig?.opts?.model ?? "(user default)"}`);
  lines.push(`- prompt hash: \`${runConfig?.promptHash ?? "?"}\``);
  lines.push("");

  // Per-variant summary
  lines.push(`## Per-variant summary`);
  lines.push("");
  for (const [variant, samples] of Object.entries(byVariant)) {
    const s = summariseVariant(samples);
    lines.push(`### ${variant} (${s.sampleCount} samples)`);
    lines.push("");
    lines.push(`- \`allium check\` pass: **${s.passCount}/${s.sampleCount}**`);
    const sourceTag = s.fallbackCount === 0
      ? "entities/fields from `allium model`; rule-likes & others from text regex"
      : `${s.fallbackCount}/${s.sampleCount} fully text-regex (parse failed); the rest from \`allium model\` + text regex`;
    lines.push(`- structural counts: _${sourceTag}_`);
    lines.push(`- entity-like (entity / external entity / variant) median: **${s.medianEntityCount}** — per-sample: ${s.entityCounts.join(", ")}`);
    lines.push(`- rule-like (rule / trigger / invariant) median: **${s.medianRuleCount}** — per-sample: ${s.ruleCounts.join(", ")}`);
    lines.push(`- field count (median): **${s.medianFieldCount}** — per-sample: ${s.fieldCounts.join(", ")}`);
    const otherEntries = Object.entries(s.otherTotals).sort();
    if (otherEntries.length > 0) {
      const summary = otherEntries.map(([k, v]) => `${k}=${v}`).join(", ");
      lines.push(`- other top-level constructs (totals across samples): ${summary}`);
    }
    if (s.pairLineDiffs.length > 0) {
      lines.push(`- pairwise unified-diff lines: ${s.pairLineDiffs.join(", ")} (median **${s.medianLineDiff}**)`);
      lines.push(`- entity-name Jaccard across pairs (median): **${s.medianEntityJaccard?.toFixed(2)}**`);
      lines.push(`- rule-name Jaccard across pairs (median): **${s.medianRuleJaccard?.toFixed(2)}**`);
    } else {
      lines.push(`- only one sample — no determinism data`);
    }
    lines.push("");

    // Per-sample diagnostics from allium check
    for (const sample of samples) {
      const { errorCount, warningCount, infoCount } = sample.check;
      const tail = `${errorCount}E / ${warningCount}W / ${infoCount}I`;
      const status = sample.check.ok ? `pass (${tail})` : `FAIL (${tail})`;
      lines.push(`  - ${sample.name}: ${status}`);
      if (sample.check.diagnostics.length > 0) {
        const summary = sample.check.diagnostics.slice(0, 3).map((d) =>
          `${d.severity ?? "?"}@${d.location?.line ?? "?"}:${d.location?.col ?? "?"}: ${(d.message ?? "").slice(0, 80)}`
        );
        for (const line of summary) lines.push(`    - ${line}`);
        if (sample.check.diagnostics.length > 3) {
          lines.push(`    - … and ${sample.check.diagnostics.length - 3} more`);
        }
      }
    }
    lines.push("");
  }

  // Inter-variant diff (representative sample)
  const variants = Object.keys(byVariant);
  if (variants.length >= 2 && byVariant[variants[0]].length > 0 && byVariant[variants[1]].length > 0) {
    const [vA, vB] = variants;
    const sA = byVariant[vA][0];
    const sB = byVariant[vB][0];
    lines.push(`## Inter-variant diff: ${vA}/${sA.name} vs ${vB}/${sB.name}`);
    lines.push("");
    lines.push(`### Structural`);
    lines.push("");
    lines.push(formatSetDiff("entities", setDiff(sA.structural.entityNames, sB.structural.entityNames)));
    lines.push("");
    lines.push(formatSetDiff("rules", setDiff(sA.structural.ruleNames, sB.structural.ruleNames)));
    lines.push("");
    lines.push(`- field-count delta: ${sB.structural.fieldCount - sA.structural.fieldCount} (${vA}=${sA.structural.fieldCount}, ${vB}=${sB.structural.fieldCount})`);
    lines.push("");
    lines.push(`### Unified text diff`);
    lines.push("");
    lines.push("```diff");
    const diff = unifiedDiff(sA.specPath, sB.specPath).trim();
    lines.push(diff || "(no textual difference)");
    lines.push("```");
    lines.push("");
  }

  return lines.join("\n") + "\n";
}

function main() {
  const resultsDir = process.argv[2];
  if (!resultsDir) fail(`usage: node eval/compare.mjs <results-dir>`);
  if (!existsSync(resultsDir)) fail(`not found: ${resultsDir}`);

  const runConfigPath = path.join(resultsDir, "run-config.json");
  const runConfig = existsSync(runConfigPath) ? tryParseJSON(readFileSync(runConfigPath, "utf-8")) : null;

  const byVariant = loadSamples(resultsDir);
  if (Object.keys(byVariant).length === 0) fail(`no variant dirs with samples under ${resultsDir}`);

  const report = renderReport(resultsDir, byVariant, runConfig);
  const reportPath = path.join(resultsDir, "report.md");
  writeFileSync(reportPath, report);
  console.error(`wrote ${reportPath}`);
}

main();
