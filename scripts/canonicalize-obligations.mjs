#!/usr/bin/env node
// Obligation-bridge inventory canonicalizer.
//
// Reads one LLM-produced obligation-bridge.json (from the Stage A subagent
// pass) and writes a normalized form (obligation-bridge.canonical.json). The
// normalization is deterministic and idempotent: two inventories differing
// only in field order, whitespace, or the LLM's choice of advisory
// target_file / test_name collapse to the same canonical JSON.
//
// What we normalize:
//   - Top-level fields: spec_path, code_root, framework preserved verbatim.
//   - obligations[]: sorted alphabetically by obligation_id; per-entry fields
//     normalized.
//   - bridge.candidates[]: sorted, deduplicated, primary_symbol removed if
//     present.
//   - preconditions[], fixtures_required[], injection_points[]: trimmed,
//     deduplicated, sorted.
//   - target_file and test_name: RECOMPUTED from the backend's name-policy
//     (LLM's advisory values are discarded).
//   - transition_graph: per-entity edge arrays sorted by (from, to, via_rule).
//   - JSON output: 2-space indent, sorted keys at every level.
//
// What we DO NOT normalize:
//   - The set of obligation_ids. If the set diverges from `allium plan`'s
//     output, the canonicaliser exits non-zero rather than silently dropping
//     or filling in entries.
//
// Validation errors (set membership wrong, framework unknown, low-confidence
// rules violated, paths missing) cause a non-zero exit so the orchestrator
// can decide whether to discard the sample or abort.
//
// Usage:
//   node canonicalize-obligations.mjs \
//     <input.json> <output.json> \
//     --plan <plan.json> \
//     --backends-root <path>
//
// --plan is the JSON output of `allium plan <spec>`, used to validate that
// the obligation_id set matches exactly.
//
// --backends-root is the directory containing per-backend subdirectories
// (defaults to <SKILL>/backends, resolved relative to this script).

import { readFileSync, writeFileSync, existsSync, statSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_BACKENDS_ROOT = path.resolve(
  __dirname,
  "..",
  "skills",
  "propagate",
  "backends",
);

const VALID_TEST_KINDS = new Set([
  "assertion",
  "pbt",
  "state_machine",
  "temporal",
  "scenario",
  "contract",
]);

const VALID_CONFIDENCE = new Set(["high", "medium", "low"]);
const VALID_INJECTION_POINTS = new Set(["clock", "random", "network"]);

function die(msg) {
  console.error(`canonicalize-obligations: ${msg}`);
  process.exit(2);
}

function parseArgs(argv) {
  const args = { positional: [] };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--plan") args.plan = argv[++i];
    else if (a === "--backends-root") args.backendsRoot = argv[++i];
    else if (a.startsWith("--")) die(`unknown flag: ${a}`);
    else args.positional.push(a);
  }
  if (args.positional.length < 2) {
    die(
      "usage: canonicalize-obligations.mjs <input.json> <output.json> --plan <plan.json> [--backends-root <dir>]",
    );
  }
  if (!args.plan) die("missing required flag --plan <plan.json>");
  args.input = args.positional[0];
  args.output = args.positional[1];
  args.backendsRoot = args.backendsRoot ?? DEFAULT_BACKENDS_ROOT;
  return args;
}

function readJson(p) {
  try {
    return JSON.parse(readFileSync(p, "utf-8"));
  } catch (err) {
    die(`failed to read JSON from ${p}: ${err.message}`);
  }
}

function loadBackend(backendsRoot, framework) {
  const dir = path.join(backendsRoot, framework);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    die(`framework "${framework}" not found under ${backendsRoot}`);
  }
  const manifest = readJson(path.join(dir, "manifest.json"));
  const namePolicy = readJson(path.join(dir, "name-policy.json"));
  if (manifest.manifest_version !== 1) {
    die(
      `framework "${framework}" has manifest_version=${manifest.manifest_version}; only 1 is supported`,
    );
  }
  return { manifest, namePolicy, dir };
}

function normString(s) {
  if (typeof s !== "string") return s;
  return s.trim().replace(/\s+/g, " ");
}

function dedupeSort(arr) {
  return [...new Set(arr.map((v) => normString(v)).filter((v) => v))]
    .sort((a, b) => a.localeCompare(b));
}

function isPathSymbol(s) {
  return typeof s === "string" && /^[^:]+::[^:].*/.test(s);
}

function splitPathSymbol(s) {
  const idx = s.indexOf("::");
  if (idx < 0) return [null, null];
  return [s.slice(0, idx), s.slice(idx + 2)];
}

function splitIntoWords(input) {
  // Split a string into words, respecting CamelCase and PascalCase boundaries
  // in addition to non-alphanumeric separators. So "AssessorDispatch" -> ["Assessor","Dispatch"],
  // "IOError" -> ["IO","Error"], "entity-fields.IncidentReport" -> ["entity","fields","Incident","Report"].
  return String(input)
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")        // camelCase boundary
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")     // acronym followed by word
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function caseTransform(input, caseName) {
  const parts = splitIntoWords(input);
  if (parts.length === 0) return "";
  switch (caseName) {
    case "snake":
      return parts.map((p) => p.toLowerCase()).join("_");
    case "kebab":
      return parts.map((p) => p.toLowerCase()).join("-");
    case "camel":
      return parts
        .map((p, i) =>
          i === 0
            ? p.toLowerCase()
            : p.charAt(0).toUpperCase() + p.slice(1).toLowerCase(),
        )
        .join("");
    case "pascal":
      return parts
        .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
        .join("");
    default:
      die(`unknown case "${caseName}"`);
  }
}

function obligationSubject(obligationId) {
  // The obligation_id from `allium plan` looks like "category.Subject" or
  // "category.Subject.detail" — we take the second segment as the subject.
  const parts = obligationId.split(".");
  return parts.length >= 2 ? parts[1] : parts[0];
}

function renderName(pattern, vars) {
  return pattern.replace(/\{(\w+)\}/g, (_m, key) => {
    if (!(key in vars)) {
      die(`unknown placeholder {${key}} in name-policy pattern`);
    }
    return vars[key];
  });
}

function computeTargetFile(obligation, manifest, namePolicy) {
  const subjectRaw = obligationSubject(obligation.obligation_id);
  const subject = caseTransform(subjectRaw, namePolicy.file_name_case);
  let dir = namePolicy.directory_layout ?? "";
  if (dir && !dir.endsWith("/")) dir = `${dir}/`;
  const filename = renderName(namePolicy.file_pattern, {
    obligation_subject: subject,
    file_extension: manifest.file_extension,
  });
  return `${dir}${filename}`;
}

function computeTestName(obligation, namePolicy) {
  const slug = caseTransform(
    obligation.obligation_id,
    namePolicy.test_name_case,
  );
  return renderName(namePolicy.test_name_pattern, {
    obligation_id_slug: slug,
  });
}

function multisetCounts(items, key) {
  const counts = new Map();
  for (const it of items) {
    const k = typeof key === "function" ? key(it) : it[key];
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return counts;
}

function validateObligationSet(inv, plan) {
  // Validate multiset equality, not set equality — `allium plan` can emit
  // the same obligation_id more than once when the spec has overloaded
  // rules (e.g. two `rule R { ... }` blocks with the same name but
  // different signatures). In that case the inventory must contain the
  // same multiplicity per id.
  const planCounts = multisetCounts(plan.obligations, "id");
  const invCounts = multisetCounts(inv.obligations, "obligation_id");
  const issues = [];
  for (const [id, n] of planCounts) {
    const got = invCounts.get(id) ?? 0;
    if (got !== n) issues.push(`${id}: expected ${n}, got ${got}`);
  }
  for (const id of invCounts.keys()) {
    if (!planCounts.has(id)) issues.push(`${id}: not in plan`);
  }
  if (issues.length) {
    const preview = issues.slice(0, 5).join("; ") + (issues.length > 5 ? "; …" : "");
    die(`obligation_id multiset mismatch (${preview})`);
  }
}

function disambiguateDuplicates(obligations) {
  // For each obligation_id that appears more than once, sort the duplicates
  // by a stable canonical key (bridge primary_symbol + test_kind + preconditions)
  // and append `__1`, `__2`, ... so downstream merge groups them uniquely.
  // The disambiguation order is deterministic for a given inventory but
  // there is no cross-sample alignment guarantee — if K samples disagree
  // about which witness pairs with which copy, the merger may pair
  // mismatched copies. Spec-side: rename overloaded rules to avoid this.
  const byId = new Map();
  for (const o of obligations) {
    if (!byId.has(o.obligation_id)) byId.set(o.obligation_id, []);
    byId.get(o.obligation_id).push(o);
  }
  const out = [];
  for (const [id, group] of byId) {
    if (group.length === 1) {
      out.push(group[0]);
      continue;
    }
    const sorted = [...group].sort((a, b) => {
      const ka = JSON.stringify([a.bridge?.primary_symbol ?? null, a.test_kind, a.preconditions ?? []]);
      const kb = JSON.stringify([b.bridge?.primary_symbol ?? null, b.test_kind, b.preconditions ?? []]);
      return ka.localeCompare(kb);
    });
    sorted.forEach((o, i) => {
      out.push({ ...o, obligation_id: `${id}__${i + 1}` });
    });
  }
  return out;
}

function validateBridge(b, oblId) {
  if (b == null || typeof b !== "object") {
    die(`obligation ${oblId}: bridge is missing or not an object`);
  }
  if (b.primary_symbol != null && !isPathSymbol(b.primary_symbol)) {
    die(`obligation ${oblId}: bridge.primary_symbol "${b.primary_symbol}" not in <path>::<symbol> form`);
  }
  if (b.candidates && !Array.isArray(b.candidates)) {
    die(`obligation ${oblId}: bridge.candidates must be an array`);
  }
  for (const c of b.candidates ?? []) {
    if (!isPathSymbol(c)) {
      die(`obligation ${oblId}: bridge.candidates entry "${c}" not in <path>::<symbol> form`);
    }
  }
  if (!VALID_CONFIDENCE.has(b.confidence)) {
    die(`obligation ${oblId}: bridge.confidence "${b.confidence}" not one of high|medium|low`);
  }
  if (b.confidence === "low") {
    const cands = (b.candidates ?? []).filter((c) => c !== b.primary_symbol);
    if (!(cands.length >= 2 || b.primary_symbol == null)) {
      die(`obligation ${oblId}: bridge.confidence=low requires >= 2 candidates or null primary`);
    }
  }
}

function validatePathsExist(inv) {
  if (!inv.code_root) die("inventory missing code_root");
  const root = path.resolve(inv.code_root);
  for (const o of inv.obligations) {
    const symbols = [
      o.bridge?.primary_symbol,
      ...(o.bridge?.candidates ?? []),
    ].filter(Boolean);
    for (const s of symbols) {
      const [p] = splitPathSymbol(s);
      if (!p) continue;
      const full = path.resolve(root, p);
      if (!existsSync(full)) {
        die(`obligation ${o.obligation_id}: bridge path "${p}" does not exist under code_root`);
      }
    }
  }
}

function canonObligation(o, manifest, namePolicy) {
  if (!VALID_TEST_KINDS.has(o.test_kind)) {
    die(`obligation ${o.obligation_id}: test_kind "${o.test_kind}" not in the allowed set`);
  }
  validateBridge(o.bridge, o.obligation_id);
  const candidates = dedupeSort(o.bridge.candidates ?? [])
    .filter((c) => c !== o.bridge.primary_symbol);
  const injection = dedupeSort(o.injection_points ?? []);
  for (const ip of injection) {
    if (!VALID_INJECTION_POINTS.has(ip)) {
      die(`obligation ${o.obligation_id}: injection_points value "${ip}" not one of clock|random|network`);
    }
  }
  return {
    obligation_id: o.obligation_id,
    test_kind: o.test_kind,
    bridge: {
      primary_symbol: o.bridge.primary_symbol ?? null,
      candidates: candidates,
      confidence: o.bridge.confidence,
    },
    preconditions: dedupeSort(o.preconditions ?? []),
    fixtures_required: dedupeSort(o.fixtures_required ?? []),
    injection_points: injection,
    target_file: computeTargetFile(o, manifest, namePolicy),
    test_name: computeTestName(o, namePolicy),
  };
}

function canonTransitionGraph(g) {
  if (g == null) return {};
  if (typeof g !== "object" || Array.isArray(g)) {
    die("transition_graph must be an object keyed by entity name");
  }
  const out = {};
  for (const entity of Object.keys(g).sort()) {
    const edges = g[entity];
    if (!Array.isArray(edges)) {
      die(`transition_graph["${entity}"] must be an array of edges`);
    }
    const normalised = edges.map((e) => ({
      from: normString(e.from ?? ""),
      to: normString(e.to ?? ""),
      via_rule: normString(e.via_rule ?? ""),
    }));
    normalised.sort((a, b) => {
      const ak = `${a.from}\x00${a.to}\x00${a.via_rule}`;
      const bk = `${b.from}\x00${b.to}\x00${b.via_rule}`;
      return ak.localeCompare(bk);
    });
    // Dedupe.
    const seen = new Set();
    const deduped = [];
    for (const e of normalised) {
      const key = `${e.from}\x00${e.to}\x00${e.via_rule}`;
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(e);
    }
    out[entity] = deduped;
  }
  return out;
}

function canonInventory(inv, plan, backend) {
  validateObligationSet(inv, plan);
  validatePathsExist(inv);
  const disambiguated = disambiguateDuplicates(inv.obligations);
  const obligations = disambiguated
    .map((o) => canonObligation(o, backend.manifest, backend.namePolicy))
    .sort((a, b) => a.obligation_id.localeCompare(b.obligation_id));
  return {
    spec_path: normString(inv.spec_path ?? ""),
    code_root: normString(inv.code_root ?? ""),
    framework: inv.framework,
    obligations,
    transition_graph: canonTransitionGraph(inv.transition_graph ?? {}),
  };
}

function stableStringify(value) {
  return JSON.stringify(value, sortReplacer, 2) + "\n";
}

function sortReplacer(_key, value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return Object.fromEntries(
      Object.entries(value).sort(([a], [b]) => a.localeCompare(b)),
    );
  }
  return value;
}

function main() {
  const args = parseArgs(process.argv);
  const inv = readJson(args.input);
  const plan = readJson(args.plan);
  if (!inv.framework) die("inventory missing framework field");
  const backend = loadBackend(args.backendsRoot, inv.framework);
  const canon = canonInventory(inv, plan, backend);
  writeFileSync(args.output, stableStringify(canon));
  console.error(
    `canonicalize-obligations: ${args.input} -> ${args.output} (${canon.obligations.length} obligations, framework=${canon.framework})`,
  );
}

main();
