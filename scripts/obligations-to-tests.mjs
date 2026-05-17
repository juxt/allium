#!/usr/bin/env node
// Obligation -> tests translator (deterministic core + backend dispatch).
//
// Reads a merged obligation-bridge.merged.json (from merge-obligations.mjs)
// and renders it through the backend named in the inventory's `framework`
// field. Pure function in spirit: given the same merged input and the same
// backend, two runs produce byte-identical output files.
//
// The translator core is backend-agnostic. All language-specific knowledge
// lives in:
//   - backends/<framework>/manifest.json       (runner, idioms, injection)
//   - backends/<framework>/name-policy.json    (already applied to inventory)
//   - backends/<framework>/templates/*.tmpl    (one per test_kind + file + fixture)
//
// Template placeholder grammar (implemented below; do not extend without
// updating backend-authoring-guide.md):
//   {{name}}                substitute value (dot-paths into context)
//   {{#each items}}…{{/each}} repeat body once per item (binds it and index)
//   {{#if cond}}…{{else}}…{{/if}} conditional (truthy = non-null, non-empty)
//   {{!comment}}            stripped from output
//
// Usage:
//   node obligations-to-tests.mjs <merged.json> --out <dir> [--backends-root <dir>]
//
// --out is the directory the generated test files are written to. The
// translator writes paths under this directory matching each obligation's
// target_file (which already includes the backend's directory_layout).

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
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

function die(msg) {
  console.error(`obligations-to-tests: ${msg}`);
  process.exit(2);
}

function parseArgs(argv) {
  const args = { positional: [] };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--out") args.out = argv[++i];
    else if (a === "--backends-root") args.backendsRoot = argv[++i];
    else if (a.startsWith("--")) die(`unknown flag: ${a}`);
    else args.positional.push(a);
  }
  if (args.positional.length < 1) die("usage: obligations-to-tests.mjs <merged.json> --out <dir>");
  if (!args.out) die("missing required flag --out <dir>");
  args.merged = args.positional[0];
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
  if (!existsSync(dir)) die(`framework "${framework}" not found under ${backendsRoot}`);
  const manifest = readJson(path.join(dir, "manifest.json"));
  if (manifest.manifest_version !== 1) {
    die(`framework "${framework}" has manifest_version=${manifest.manifest_version}; only 1 is supported`);
  }
  const namePolicy = readJson(path.join(dir, "name-policy.json"));
  const templates = {};
  const required = [
    "test-file",
    "assertion",
    "pbt-property",
    "state-machine",
    "stub-unresolved",
    "fixture",
  ];
  for (const t of required) {
    const p = path.join(dir, "templates", `${t}.tmpl`);
    if (!existsSync(p)) die(`backend ${framework}: missing template ${t}.tmpl`);
    templates[t] = readFileSync(p, "utf-8");
  }
  return { manifest, namePolicy, templates, dir };
}

// --- template parser & renderer ---------------------------------------------

// Compile templates into a node tree once, then render. The renderer is
// purely deterministic; it doesn't touch the filesystem or the clock.

function compileTemplate(src) {
  const tokens = tokenize(src);
  let i = 0;
  function parseList(stopAt) {
    const nodes = [];
    while (i < tokens.length) {
      const t = tokens[i];
      if (t.kind === "block" && stopAt && stopAt.includes(t.tag)) return nodes;
      if (t.kind === "text") {
        nodes.push({ kind: "text", value: t.value });
        i++;
      } else if (t.kind === "var") {
        nodes.push({ kind: "var", path: t.path });
        i++;
      } else if (t.kind === "comment") {
        i++;
      } else if (t.kind === "block") {
        if (t.tag.startsWith("#each ")) {
          const expr = t.tag.slice(6).trim();
          i++;
          const body = parseList(["/each"]);
          const end = tokens[i];
          if (!end || end.tag !== "/each") die(`template error: unterminated {{#each ${expr}}}`);
          i++;
          nodes.push({ kind: "each", path: expr.split("."), body });
        } else if (t.tag.startsWith("#if ")) {
          const expr = t.tag.slice(4).trim();
          i++;
          const thenBody = parseList(["else", "/if"]);
          let elseBody = [];
          if (tokens[i]?.tag === "else") {
            i++;
            elseBody = parseList(["/if"]);
          }
          const end = tokens[i];
          if (!end || end.tag !== "/if") die(`template error: unterminated {{#if ${expr}}}`);
          i++;
          nodes.push({ kind: "if", path: expr.split("."), thenBody, elseBody });
        } else {
          die(`template error: unknown block "${t.tag}"`);
        }
      }
    }
    return nodes;
  }
  return parseList(null);
}

function tokenize(src) {
  const tokens = [];
  const re = /\{\{([^}]+)\}\}/g;
  let last = 0;
  let m;
  while ((m = re.exec(src)) !== null) {
    if (m.index > last) tokens.push({ kind: "text", value: src.slice(last, m.index) });
    const inner = m[1].trim();
    if (inner.startsWith("!")) {
      tokens.push({ kind: "comment", value: inner.slice(1) });
    } else if (inner.startsWith("#") || inner.startsWith("/") || inner === "else") {
      tokens.push({ kind: "block", tag: inner });
    } else {
      tokens.push({ kind: "var", path: inner.split(".") });
    }
    last = re.lastIndex;
  }
  if (last < src.length) tokens.push({ kind: "text", value: src.slice(last) });
  return tokens;
}

function lookup(ctx, segs) {
  let v = ctx;
  for (const s of segs) {
    if (v == null) return undefined;
    v = v[s];
  }
  return v;
}

function truthy(v) {
  if (v == null) return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "string") return v.length > 0;
  if (typeof v === "number") return v !== 0;
  return true;
}

function render(nodes, ctx) {
  let out = "";
  for (const n of nodes) {
    if (n.kind === "text") out += n.value;
    else if (n.kind === "var") {
      const v = lookup(ctx, n.path);
      out += v == null ? "" : String(v);
    } else if (n.kind === "each") {
      const list = lookup(ctx, n.path);
      if (!Array.isArray(list)) continue;
      for (let i = 0; i < list.length; i++) {
        out += render(n.body, { ...ctx, it: list[i], index: i });
      }
    } else if (n.kind === "if") {
      const v = lookup(ctx, n.path);
      out += render(truthy(v) ? n.thenBody : n.elseBody, ctx);
    }
  }
  return out;
}

// --- import collection ------------------------------------------------------

// Each backend declares its imports in manifest.json:
//   imports.base           — always included
//   imports.pbt            — added for test_kind in PBT_KINDS
//   imports.state_machine  — added for test_kind state_machine
//   imports.temporal       — added for test_kind temporal (defaults to .pbt)
//   bridge_import.transform — named transform that turns <path>::<symbol>
//                              into an import line in the language's idiom.
//
// To add a new backend, add an entry under BRIDGE_IMPORT_TRANSFORMS below
// and declare it in the backend's manifest.json.

const PBT_KINDS = new Set(["pbt", "temporal"]);
const SM_KINDS = new Set(["state_machine"]);

const BRIDGE_IMPORT_TRANSFORMS = {
  // Python: "app/services.py::approve_claim" ->
  //   "from app.services import approve_claim"
  // Path is converted to a module-dotted path; symbol's top-level
  // identifier is the imported name (so "ClaimService.approve" -> "ClaimService").
  python_module({ bridgePath, topLevelSymbol }) {
    if (!bridgePath.endsWith(".py")) return null;
    const mod = bridgePath.slice(0, -3).replace(/\//g, ".");
    return `from ${mod} import ${topLevelSymbol}`;
  },

  // TypeScript: "src/services/claim.ts::approveClaim" ->
  //   "import { approveClaim } from \"../src/services/claim\";"
  // The path is rewritten relative to the target test file.
  typescript_relative({ bridgePath, topLevelSymbol, targetFile }) {
    if (!/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(bridgePath)) return null;
    const noExt = bridgePath.replace(/\.(ts|tsx|js|jsx|mjs|cjs)$/, "");
    // Compute relative-from-target-file. target_file is relative to
    // code_root (e.g. "tests/test_x.test.ts"); bridge path is too.
    let rel = path.relative(path.dirname(targetFile), noExt);
    if (!rel.startsWith(".")) rel = `./${rel}`;
    // Use forward slashes for TS even on Windows.
    rel = rel.split(path.sep).join("/");
    return `import { ${topLevelSymbol} } from "${rel}";`;
  },

  // Fallback: no import line (e.g. languages where every symbol is in scope).
  noop() {
    return null;
  },
};

function bridgeImportLine(manifest, obligation) {
  const sym = obligation.bridge?.primary_symbol;
  if (!sym) return null;
  const idx = sym.indexOf("::");
  if (idx < 0) return null;
  const bridgePath = sym.slice(0, idx);
  const symbol = sym.slice(idx + 2);
  const topLevelSymbol = symbol.split(".")[0];
  const transformName = manifest.bridge_import?.transform ?? "noop";
  const transform = BRIDGE_IMPORT_TRANSFORMS[transformName];
  if (!transform) {
    die(`backend ${manifest.id} declares unknown bridge_import.transform "${transformName}"`);
  }
  return transform({
    bridgePath,
    symbol,
    topLevelSymbol,
    targetFile: obligation.target_file,
    manifest,
  });
}

function importsForObligation(manifest, obligation, isLowConfidence) {
  const map = manifest.imports ?? {};
  const base = [...(map.base ?? [])];
  if (isLowConfidence) return base; // stub-unresolved only needs the base imports
  const kind = obligation.test_kind;
  const extra = [];
  if (PBT_KINDS.has(kind)) {
    const pbtList = kind === "temporal" && map.temporal ? map.temporal : map.pbt;
    if (pbtList) extra.push(...pbtList);
  }
  if (SM_KINDS.has(kind) && map.state_machine) extra.push(...map.state_machine);
  const bridgeLine = bridgeImportLine(manifest, obligation);
  if (bridgeLine) extra.push(bridgeLine);
  return [...base, ...extra];
}

function localNameFor(pathSymbol) {
  // The bare identifier we use in the test body. Returns null if no symbol.
  if (!pathSymbol) return null;
  const idx = pathSymbol.indexOf("::");
  if (idx < 0) return null;
  const symbol = pathSymbol.slice(idx + 2);
  return symbol.split(".")[0];
}

function sortImports(imports, style) {
  const uniq = [...new Set(imports)];
  if (style === "python") {
    // Convention: "import x" lines first, "from x import y" second; alphabetic within each.
    const importLines = uniq.filter((l) => l.startsWith("import ")).sort();
    const fromLines = uniq.filter((l) => l.startsWith("from ")).sort();
    return [...importLines, ...fromLines];
  }
  if (style === "typescript") {
    // External-first (no relative dot), then relative; alphabetic within group.
    const ext = uniq.filter((l) => !/from ["']\.\.?\//.test(l)).sort();
    const rel = uniq.filter((l) => /from ["']\.\.?\//.test(l)).sort();
    return [...ext, ...rel];
  }
  return uniq.sort();
}

// --- rendering pipeline -----------------------------------------------------

function pickTemplateName(testKind, isLowConfidence) {
  if (isLowConfidence) return "stub-unresolved";
  switch (testKind) {
    case "assertion":
    case "scenario":
    case "contract":
      return "assertion";
    case "pbt":
    case "temporal":
      return "pbt-property";
    case "state_machine":
      return "state-machine";
    default:
      return "assertion";
  }
}

function buildObligationContext(obligation, merged, backend) {
  const isLowConfidence = obligation.bridge.confidence === "low";
  const transitionGraph = inferTransitionGraphForEntity(obligation, merged.transition_graph);
  const stateMachineClassName = `${entityForObligation(obligation)}StateMachine`;
  return {
    obligation,
    test_name: obligation.test_name,
    bridge: {
      ...obligation.bridge,
      primary_symbol_local: localNameFor(obligation.bridge.primary_symbol) ?? "None",
    },
    preconditions: obligation.preconditions ?? [],
    fixtures_required: obligation.fixtures_required ?? [],
    injection_points: obligation.injection_points ?? [],
    injection: {
      clock: backend.manifest.clock_injection ?? "",
      random: backend.manifest.random_injection ?? "",
      network: backend.manifest.network_injection ?? "",
    },
    transition_graph_for_entity: transitionGraph,
    state_machine_class_name: stateMachineClassName,
    manifest: backend.manifest,
    name_policy: backend.namePolicy,
    is_low_confidence: isLowConfidence,
  };
}

function entityForObligation(obligation) {
  // obligation_id looks like "category.Subject" or "category.Subject.detail".
  const parts = obligation.obligation_id.split(".");
  return parts.length >= 2 ? parts[1] : parts[0];
}

function inferTransitionGraphForEntity(obligation, graph) {
  const entity = entityForObligation(obligation);
  return Array.isArray(graph?.[entity]) ? graph[entity] : [];
}

function renderObligation(obligation, merged, backend, compiledTemplates) {
  const isLowConfidence = obligation.bridge.confidence === "low";
  const tname = pickTemplateName(obligation.test_kind, isLowConfidence);
  const ctx = buildObligationContext(obligation, merged, backend);
  const body = render(compiledTemplates[tname], ctx);
  const imports = importsForObligation(backend.manifest, obligation, isLowConfidence);
  return { body, imports, fixtures: obligation.fixtures_required ?? [] };
}

function renderFixture(name, backend, compiledTemplates) {
  return render(compiledTemplates.fixture, {
    fixture_name: name,
    manifest: backend.manifest,
  });
}

function renderTestFile(perFile, backend, compiledTemplates) {
  const sortedImports = sortImports(perFile.imports, backend.manifest.imports_style);
  const fixtureBlocks = [...perFile.fixtures]
    .sort()
    .map((n) => renderFixture(n, backend, compiledTemplates));
  const testBlocks = [...perFile.tests].sort((a, b) => a.testName.localeCompare(b.testName)).map((t) => t.body);
  return render(compiledTemplates["test-file"], {
    imports: sortedImports,
    fixtures: fixtureBlocks,
    tests: testBlocks,
    manifest: backend.manifest,
  });
}

// --- main -------------------------------------------------------------------

function ensureDir(p) {
  mkdirSync(p, { recursive: true });
}

function writeFile(outRoot, relPath, content) {
  const full = path.join(outRoot, relPath);
  ensureDir(path.dirname(full));
  writeFileSync(full, content);
}

function main() {
  const args = parseArgs(process.argv);
  const merged = readJson(args.merged);
  if (!merged.framework) die("merged inventory missing framework");
  const backend = loadBackend(args.backendsRoot, merged.framework);

  const compiledTemplates = Object.fromEntries(
    Object.entries(backend.templates).map(([k, v]) => [k, compileTemplate(v)]),
  );

  // Accumulate per-file: imports, tests, fixtures.
  const perFile = new Map();
  for (const o of merged.obligations) {
    const file = o.target_file;
    if (!perFile.has(file)) perFile.set(file, { imports: [], tests: [], fixtures: new Set() });
    const acc = perFile.get(file);
    const { body, imports, fixtures } = renderObligation(o, merged, backend, compiledTemplates);
    acc.imports.push(...imports);
    acc.tests.push({ testName: o.test_name, body });
    for (const f of fixtures) acc.fixtures.add(f);
  }

  ensureDir(args.out);
  const written = [];
  for (const [file, acc] of [...perFile.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const content = renderTestFile({ imports: acc.imports, tests: acc.tests, fixtures: acc.fixtures }, backend, compiledTemplates);
    writeFile(args.out, file, content);
    written.push(file);
  }

  console.error(
    `obligations-to-tests: framework=${merged.framework} -> ${written.length} files under ${args.out}`,
  );
}

main();
