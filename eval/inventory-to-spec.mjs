#!/usr/bin/env node
// Deterministic Allium spec generator.
//
// Reads inventory.json (the structured discovery output of the distill skill)
// and emits the canonical .allium spec to stdout (or to a given output path).
// The output is a pure function of the input — same JSON in, byte-identical
// spec out.
//
// Usage:
//   node eval/inventory-to-spec.mjs <inventory.json> [<output.allium>]
//   node eval/inventory-to-spec.mjs <inventory.json>           # to stdout

import { readFileSync, writeFileSync } from "fs";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DIVIDER = "------------------------------------------------------------";

const sortByName = (arr) => [...(arr ?? [])].sort((a, b) =>
  (a.name ?? "").localeCompare(b.name ?? "")
);

const snakeToPascal = (s) => String(s ?? "")
  .split(/[_\-\s]+/)
  .filter(Boolean)
  .map((p) => p[0].toUpperCase() + p.slice(1))
  .join("");

const moduleStemPascal = (modulePath) => {
  const stem = String(modulePath ?? "").split("/").pop().replace(/\.[^.]+$/, "");
  return snakeToPascal(stem);
};

const section = (title, body) => {
  if (!body || !body.trim()) return "";
  return `${DIVIDER}\n-- ${title}\n${DIVIDER}\n\n${body.trim()}\n`;
};

const blockJoin = (blocks) => blocks.filter((b) => b && b.trim()).join("\n\n");

// ---------------------------------------------------------------------------
// Field / type rendering
// ---------------------------------------------------------------------------

function renderField(field) {
  // type_hint may already encode nullability (e.g. "Claim?"); if so, don't
  // double the `?` even when `nullable: true` is also set.
  const t = String(field.type_hint ?? "").trim();
  const alreadyNullable = t.endsWith("?");
  const suffix = !alreadyNullable && field.nullable === true ? "?" : "";
  return `${field.name}: ${t}${suffix}`;
}

function renderFieldsBlock(fields, indentSpaces = 4) {
  const sorted = sortByName(fields);
  return sorted.map((f) => " ".repeat(indentSpaces) + renderField(f)).join("\n");
}

// ---------------------------------------------------------------------------
// Ensures clause rendering
// ---------------------------------------------------------------------------

function renderEnsuresItem(item, baseIndent) {
  const pad = " ".repeat(baseIndent);
  if (item.kind === "assign") {
    return `${pad}${item.lhs} = ${renderRhsValue(item.rhs)}`;
  }
  if (item.kind === "create") {
    const fields = Object.entries(item.fields ?? {}).sort(([a], [b]) => a.localeCompare(b));
    const inner = fields.map(([k, v]) => `${pad}    ${k}: ${renderRhsValue(v)}`).join(",\n");
    return `${pad}${item.entity}.created(\n${inner}\n${pad})`;
  }
  if (item.kind === "invoke") {
    const args = Object.entries(item.args ?? {}).sort(([a], [b]) => a.localeCompare(b));
    const argStr = args.map(([k, v]) => `${k}: ${renderRhsValue(v)}`).join(", ");
    return `${pad}${item.trigger}(${argStr})`;
  }
  throw new Error(`unknown ensures kind: ${JSON.stringify(item)}`);
}

function renderRhsValue(v) {
  // Render an RHS value verbatim if it looks like an expression/identifier;
  // quote bare empty strings (the inventory often carries an initial-default
  // empty string for fields like `findings: ""`, and we don't want `findings: ,`
  // to land in the spec). Numbers, booleans, null come through as identifiers.
  if (v === "" || v === null || v === undefined) return '""';
  return String(v);
}

function renderEnsuresClause(ensures, baseIndent) {
  const items = ensures ?? [];
  if (items.length === 0) return "";
  if (items.length === 1) {
    const rendered = renderEnsuresItem(items[0], 0);
    // Single-line iff the rendering has no newlines (i.e. not a create block).
    if (!rendered.includes("\n")) {
      return `${" ".repeat(baseIndent)}ensures: ${rendered}`;
    }
    // Multi-line single item (e.g. a create) — keep ensures: on its own line.
    return `${" ".repeat(baseIndent)}ensures:\n${renderEnsuresItem(items[0], baseIndent + 4)}`;
  }
  const head = `${" ".repeat(baseIndent)}ensures:`;
  const body = items.map((it) => renderEnsuresItem(it, baseIndent + 4)).join("\n");
  return `${head}\n${body}`;
}

function renderRequiresLines(requires, baseIndent) {
  return (requires ?? []).map((r) => `${" ".repeat(baseIndent)}requires: ${r}`).join("\n");
}

function renderLetsLines(lets, baseIndent, paramNames = []) {
  // Allium only accepts simple expressions and function calls on the RHS of a
  // `let`. Inline query forms like `first c in X where ...` are rejected.
  // When the LLM has written one of those, convert to a black-box function
  // call shape `find_<name>(<bound params used>)` and rely on @guidance to
  // carry the semantic detail.
  return (lets ?? []).map((l) => {
    const expr = String(l.expression ?? "").trim();
    const looksLikeFunctionCall = /^[a-zA-Z_][a-zA-Z0-9_]*\(/.test(expr);
    const looksLikeQuery = /^first\s|\s+where\s|\s+in\s+[A-Z]/.test(expr);
    let rhs = expr;
    if (!looksLikeFunctionCall && looksLikeQuery) {
      const fnName = "find_" + l.name;
      const usedParams = paramNames.filter((p) => new RegExp(`\\b${p}\\b`).test(expr));
      rhs = `${fnName}(${usedParams.join(", ")})`;
    }
    return `${" ".repeat(baseIndent)}let ${l.name} = ${rhs}`;
  }).join("\n");
}

function renderGuidanceBlock(text, baseIndent) {
  if (!text) return "";
  const pad = " ".repeat(baseIndent);
  return `${pad}@guidance\n${pad}    -- ${text}`;
}

// ---------------------------------------------------------------------------
// Section renderers
// ---------------------------------------------------------------------------

function renderHeader(header) {
  const name = header?.fixture_name ?? "Domain";
  const src = header?.source_package ?? "src/";
  return `-- allium: 3\n-- ${name}: distilled from ${src}.\n`;
}

function renderExternalEntities(entities) {
  const ext = sortByName((entities ?? []).filter((e) => e.kind === "external"));
  if (ext.length === 0) return "";
  const blocks = ext.map((e) => {
    const fields = renderFieldsBlock(e.fields);
    const guidance = e.guidance ? `-- ${e.guidance}\n` : "";
    return `${guidance}external entity ${e.name} {\n${fields}\n}`;
  });
  return section("External Entities", blockJoin(blocks));
}

function renderValueTypes(valueTypes) {
  const sorted = sortByName(valueTypes);
  if (sorted.length === 0) return "";
  const blocks = sorted.map((v) => {
    const fields = renderFieldsBlock(v.fields);
    return `value ${v.name} {\n${fields}\n}`;
  });
  return section("Value Types", blockJoin(blocks));
}

function renderContracts(integrations) {
  const sorted = sortByName(integrations);
  if (sorted.length === 0) return "";
  const blocks = sorted.map((i) => {
    const name = snakeToPascal(i.name) + "Service";
    const ops = (i.operations ?? []).map((op) => {
      const params = (op.params ?? []).map((p) => `${p.name}: ${p.type_hint}`).join(", ");
      return `    ${op.name}: (${params}) -> ${op.return_type}`;
    });

    // Build invariants per precondition, named per the derivation table.
    const invariants = [];
    for (const op of i.operations ?? []) {
      for (const pre of op.preconditions ?? []) {
        invariants.push(deriveInvariantFromPrecondition(pre));
      }
    }
    invariants.sort((a, b) => a.name.localeCompare(b.name));
    const invBlock = invariants
      .map((inv) => `    @invariant ${inv.name}\n        -- ${inv.expression}`)
      .join("\n\n");

    const opPart = ops.join("\n");
    const sep = opPart && invBlock ? "\n\n" : "";
    return `contract ${name} {\n${opPart}${sep}${invBlock}\n}`;
  });
  return section("Contracts", blockJoin(blocks));
}

function matchHandlerToTransition(handler, transitionsByName) {
  // Handler naming in routes (e.g. `triage_route`, `approve_claim_route`,
  // `mark_paid_route`) doesn't always match transition naming (`triage_claim`,
  // `approve_claim`, `mark_payout_paid`). We use token overlap:
  //   1. Strip `_route` suffix from the handler.
  //   2. Tokenise handler and each transition name on `_`.
  //   3. Score by intersection size; prefer longest match.
  //   4. Require at least one shared *action* token (i.e. one shared token).
  //   5. Among candidates, prefer the transition that contains all handler
  //      tokens (subset match), then longest by token count.
  const stripped = String(handler).replace(/_route$/, "");
  const handlerTokens = new Set(stripped.split("_"));
  if (handlerTokens.size === 0) return null;

  let bestName = null;
  let bestScore = -1;
  for (const [transitionName, specName] of transitionsByName.entries()) {
    const txTokens = new Set(transitionName.split("_"));
    let overlap = 0;
    for (const t of handlerTokens) if (txTokens.has(t)) overlap++;
    if (overlap === 0) continue;

    // Score: overlap size, with bonus for "handler tokens ⊆ transition tokens".
    const isSubset = [...handlerTokens].every((t) => txTokens.has(t));
    const score = overlap * 10 + (isSubset ? 5 : 0) + txTokens.size;
    if (score > bestScore) {
      bestScore = score;
      bestName = specName;
    }
  }
  return bestName;
}

function normalizeWhen(whenStr) {
  // Allium temporal triggers want the form `<var>: <Type>.<expr> <op> <rhs>`,
  // not `<var>: <Type>, <var>.<expr> <op> <rhs>`. The LLM frequently writes
  // the comma form; rewrite mechanically. We only rewrite when the right-hand
  // side starts with `<var>.<field>` (i.e., when we can safely fuse the type
  // and the field access).
  if (!whenStr) return "<missing when>";
  const m = String(whenStr).match(/^(\w+):\s*(\w+)\s*,\s*\1\.(.+)$/);
  if (m) {
    const [, varName, typeName, rest] = m;
    return `${varName}: ${typeName}.${rest}`;
  }
  return whenStr;
}

function deriveInvariantFromPrecondition(expr) {
  // Map the precondition expression to a (name, expression) pair per the table
  // in SKILL.md. The expression in the inventory is verbatim; the name is
  // derived. This intentionally re-derives names rather than trusting the LLM
  // to compute them, so naming is byte-stable across runs.
  const e = String(expr ?? "").trim();
  let name = "Precondition";

  // <x> > 0 or <x> >= 1
  const positive = e.match(/^([a-z_][a-z0-9_]*)\s*(?:>\s*0|>=\s*1)\s*$/i);
  if (positive) name = snakeToPascal(positive[1]) + "IsPositive";

  // len(<x>) == <n>
  const lenEq = e.match(/^len\(([a-z_][a-z0-9_]*)\)\s*==\s*(\d+)/i);
  if (lenEq) {
    const x = snakeToPascal(lenEq[1]);
    const n = lenEq[2];
    name = `${x}IsExactly${n}Digits`;
  }

  // len(<x>) >= 1 or not empty
  const nonEmpty = e.match(/^len\(([a-z_][a-z0-9_]*)\)\s*>=\s*1/i)
    || e.match(/^([a-z_][a-z0-9_]*)\s+is\s+non[_\s-]?empty/i);
  if (nonEmpty) name = snakeToPascal(nonEmpty[1]) + "IsNonEmpty";

  // <x> <= <const> or <x> < <const>
  const cap = e.match(/^([a-z_][a-z0-9_]*)\s*(?:<=|<)\s*\d/i);
  if (cap) name = snakeToPascal(cap[1]) + "WithinCap";

  // <x> matches <something>
  const match = e.match(/^([a-z_][a-z0-9_]*)\s+matches/i);
  if (match) name = snakeToPascal(match[1]) + "IsValidFormat";

  return { name, expression: e };
}

function renderEnumerations(entities, auxEnums) {
  const fromEntities = (entities ?? [])
    .map((e) => e.status_enum)
    .filter(Boolean)
    .map((se) => ({ name: se.name, values: se.values }));
  const allEnums = [...fromEntities, ...(auxEnums ?? [])];
  const sorted = sortByName(allEnums);
  if (sorted.length === 0) return "";
  const blocks = sorted.map((en) => {
    // Enum value order is a recurring inventory variance source; sort here so
    // the spec is canonical regardless of how the inventory listed them.
    const values = [...(en.values ?? [])].sort().join(" | ");
    return `enum ${en.name} { ${values} }`;
  });
  return section("Enumerations", blocks.join("\n\n"));
}

function renderEntity(e) {
  const fields = renderFieldsBlock(e.fields);

  const relationships = sortByName(e.relationships ?? []);
  const relLines = relationships.map((r) => {
    if (r.target) return `    ${r.name}: ${r.target} with ${r.with}`;
    if (r.from) return `    ${r.name}: ${r.from} where ${r.where}`;
    return `    ${r.name}: ???`;
  });

  const derived = sortByName(e.derived_properties ?? []);
  const derivedLines = derived.map((d) => `    ${d.name}: ${d.expression}`);

  const guidance = e.guidance ? `-- ${e.guidance}\n` : "";

  // Compose body with blank lines between sub-sections that exist.
  const sub = [];
  sub.push(fields);
  if (relLines.length) sub.push(relLines.join("\n"));
  if (derivedLines.length) sub.push(derivedLines.join("\n"));
  return `${guidance}entity ${e.name} {\n${sub.join("\n\n")}\n}`;
}

function renderEntities(entities) {
  const internal = sortByName((entities ?? []).filter((e) => e.kind !== "external"));
  if (internal.length === 0) return "";
  return section("Entities", blockJoin(internal.map(renderEntity)));
}

function renderConfig(config) {
  const items = sortByName(config);
  if (items.length === 0) return "";
  const lines = items.map((c) => `    ${c.name}: ${c.type_hint} = ${c.value}`);
  const body = `config {\n${lines.join("\n")}\n}`;
  return section("Config", body);
}

function renderRules(transitions, scheduledJobs, webhooks) {
  // Transitions and scheduled jobs both become `rule <PascalCase>` blocks,
  // alphabetised by their PascalCase spec name.
  const transitionRules = (transitions ?? []).map((t) => ({
    specName: snakeToPascal(t.name),
    kind: "transition",
    spec: t,
  }));
  const jobRules = (scheduledJobs ?? []).map((j) => ({
    specName: snakeToPascal(j.name),
    kind: "scheduled",
    spec: j,
  }));
  const webhookRules = (webhooks ?? []).map((w) => ({
    specName: `Receive${snakeToPascal(w.produces_entity)}`,
    kind: "webhook",
    spec: w,
  }));
  const all = [...transitionRules, ...jobRules, ...webhookRules]
    .sort((a, b) => a.specName.localeCompare(b.specName));
  if (all.length === 0) return "";

  const blocks = all.map((r) => {
    if (r.kind === "transition") return renderTransitionRule(r.specName, r.spec);
    if (r.kind === "scheduled") return renderScheduledRule(r.specName, r.spec);
    return renderWebhookRule(r.specName, r.spec);
  });
  return section("Rules", blockJoin(blocks));
}

function renderTransitionRule(specName, t) {
  const body = t.body ?? {};
  const sortedParams = (body.params ?? []).slice().sort((a, b) => a.name.localeCompare(b.name));
  const paramNames = sortedParams.map((p) => p.name);
  const whenLine = `    when: ${specName}(${paramNames.join(", ")})`;

  const parts = [whenLine];
  const lets = renderLetsLines(body.lets, 4, paramNames);
  if (lets) parts.push(lets);
  const requires = renderRequiresLines(body.requires, 4);
  if (requires) parts.push(requires);
  const ensures = renderEnsuresClause(body.ensures, 4);
  if (ensures) parts.push(ensures);
  const guidance = renderGuidanceBlock(t.guidance, 4);
  if (guidance) parts.push(guidance);

  return `rule ${specName} {\n${parts.join("\n")}\n}`;
}

function renderScheduledRule(specName, j) {
  const body = j.body ?? {};
  const whenLine = `    when: ${normalizeWhen(body.when)}`;
  const parts = [whenLine];
  const lets = renderLetsLines(body.lets, 4, []);
  if (lets) parts.push(lets);
  const requires = renderRequiresLines(body.requires, 4);
  if (requires) parts.push(requires);
  const ensures = renderEnsuresClause(body.ensures, 4);
  if (ensures) parts.push(ensures);
  const guidance = renderGuidanceBlock(j.guidance, 4);
  if (guidance) parts.push(guidance);
  return `rule ${specName} {\n${parts.join("\n")}\n}`;
}

function renderWebhookRule(specName, w) {
  const parts = [`    when: ${specName}(payload)`];
  parts.push(`    ensures: ${w.produces_entity}.created(payload)`);
  if (w.linking_rule) {
    parts.push(renderGuidanceBlock(w.linking_rule, 4));
  }
  return `rule ${specName} {\n${parts.filter((p) => p && p.trim()).join("\n")}\n}`;
}

function renderInvariants(invariants, inventory) {
  const sorted = sortByName(invariants);
  if (sorted.length === 0) return "";
  const reserved = collectReservedIdentifiers(inventory);
  const blocks = sorted.map((inv) => {
    const loopVar = inv.scope.toLowerCase()[0];
    const collection = pluralize(inv.scope);
    const qualified = qualifyExpression(inv.expression, loopVar, reserved);
    return `invariant ${inv.name} {\n    for ${loopVar} in ${collection}:\n        ${qualified}\n}`;
  });
  return section("Invariants", blockJoin(blocks));
}

function collectReservedIdentifiers(inventory) {
  // Identifiers that must NOT be prefixed when we qualify bare references:
  // enum literals (`approved`, `paid`, `denied`, etc.), config-block keys
  // (used as `config.X` — already qualified by the `config.` prefix at the
  // call site, so the bare key itself appears only in the config block).
  const reserved = new Set();
  for (const entity of inventory.entities ?? []) {
    for (const v of entity.status_enum?.values ?? []) reserved.add(v);
  }
  for (const en of inventory.auxiliary_enumerations ?? []) {
    for (const v of en.values ?? []) reserved.add(v);
  }
  // Language constants and operators that look like bare identifiers.
  for (const k of ["and", "or", "not", "in", "implies", "true", "false", "null",
    "now", "config", "for", "where", "with"]) {
    reserved.add(k);
  }
  return reserved;
}

function qualifyExpression(expression, loopVar, reservedSet) {
  // Add `<loopVar>.` before bare identifiers. Skips identifiers that are:
  //  - already qualified (preceded by `.`)
  //  - a function call (followed by `(`)
  //  - the loop variable itself
  //  - in the reserved set (enum literals, language keywords)
  const reserved = new Set(reservedSet);
  reserved.add(loopVar);
  return expression.replace(/\b([a-zA-Z_][a-zA-Z0-9_]*)\b/g, (match, ident, offset, str) => {
    if (reserved.has(ident)) return match;
    const prev = str[offset - 1];
    const next = str[offset + ident.length];
    if (prev === ".") return match;
    if (next === "(") return match;
    return `${loopVar}.${ident}`;
  });
}

function pluralize(word) {
  // Trivial pluralisation for the entity-name → collection-name idiom Allium
  // uses in `for X in Xs:`. Special-cases known irregulars; otherwise +s.
  const w = String(word ?? "");
  if (/y$/i.test(w)) return w.slice(0, -1) + "ies";
  return w + "s";
}

function renderSurfaces(routes, webhooks, transitions) {
  // Allium 3 surfaces use a `provides:` block listing the actions (triggers)
  // they expose. We derive the trigger set from each route's handler by
  // matching against the inventory's transitions. The HTTP method/path
  // detail goes into @guidance since the spec is meant to describe
  // behaviour, not wire protocol.
  const transitionsByName = new Map(
    (transitions ?? []).map((t) => [t.name, snakeToPascal(t.name)]),
  );

  const out = [];
  // Group routes by module.
  const byModule = new Map();
  for (const r of routes ?? []) {
    const key = moduleStemPascal(r.module);
    if (!byModule.has(key)) byModule.set(key, []);
    byModule.get(key).push(r);
  }
  const moduleNames = [...byModule.keys()].sort();
  for (const m of moduleNames) {
    const rs = byModule.get(m).slice().sort((a, b) => a.path.localeCompare(b.path));
    // Map each route's handler to a transition using token-overlap matching:
    // strip `_route` from the handler, tokenise both names, and match when the
    // handler's tokens are a subset of (or share the action token with) the
    // transition's tokens. Read-only routes without a transition match emit
    // nothing into `provides:` — they only appear in @guidance.
    const providedTriggers = new Set();
    for (const r of rs) {
      const trigName = matchHandlerToTransition(r.handler, transitionsByName);
      if (trigName) providedTriggers.add(trigName);
    }
    const trigList = [...providedTriggers].sort();
    const provides = trigList.length === 0
      ? ""
      : `    provides:\n${trigList.map((t) => `        ${t}`).join("\n")}`;
    const guidanceText = rs.map((r) => `${r.method} ${r.path} -> ${r.handler}`).join("; ");
    const guidance = renderGuidanceBlock(guidanceText, 4);
    const body = [provides, guidance].filter((p) => p && p.trim()).join("\n\n");
    out.push(`surface ${m} {\n${body}\n}`);
  }
  if ((webhooks ?? []).length > 0) {
    const ws = (webhooks ?? []).slice().sort((a, b) => a.path.localeCompare(b.path));
    const trigList = [...new Set(ws.map((w) => `Receive${snakeToPascal(w.produces_entity)}`))].sort();
    const provides = `    provides:\n${trigList.map((t) => `        ${t}`).join("\n")}`;
    const guidanceText = ws.map((w) => `POST ${w.path} -> ${w.produces_entity}`).join("; ");
    const guidance = renderGuidanceBlock(guidanceText, 4);
    out.push(`surface Webhooks {\n${provides}\n\n${guidance}\n}`);
  }
  if (out.length === 0) return "";
  return section("Surfaces", blockJoin(out));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function render(inventory) {
  const parts = [
    renderHeader(inventory.header),
    renderExternalEntities(inventory.entities),
    renderValueTypes(inventory.value_types),
    renderContracts(inventory.integrations),
    renderEnumerations(inventory.entities, inventory.auxiliary_enumerations),
    renderEntities(inventory.entities),
    renderConfig(inventory.config),
    renderRules(inventory.transitions, inventory.scheduled_jobs, inventory.webhooks),
    renderInvariants(inventory.invariants, inventory),
    renderSurfaces(inventory.routes, inventory.webhooks, inventory.transitions),
  ];
  return parts.filter((p) => p && p.trim()).join("\n");
}

function main() {
  const [, , inputPath, outputPath] = process.argv;
  if (!inputPath) {
    console.error("usage: node eval/inventory-to-spec.mjs <inventory.json> [<output.allium>]");
    process.exit(2);
  }
  const inv = JSON.parse(readFileSync(inputPath, "utf-8"));
  const spec = render(inv);
  if (outputPath) writeFileSync(outputPath, spec);
  else process.stdout.write(spec);
}

main();
