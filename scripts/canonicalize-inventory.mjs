#!/usr/bin/env node
// Inventory canonicalizer.
//
// Reads an LLM-produced inventory.json and writes a normalized form
// (inventory.canonical.json). The normalization is deterministic and
// idempotent: two inventories that differ only in convention (nullability
// encoding, array order, guidance whitespace) collapse to the same canonical
// JSON.
//
// What we normalize:
//   - Recursive alphabetical sort of every array of named records (by name,
//     or by `path` for webhooks/routes, or by `method+path` for routes too).
//   - Field nullability: prefer `type_hint: "T?"` and drop the `nullable: true`
//     flag. Equivalent forms collapse to one canonical form.
//   - Enum values: alphabetical.
//   - String normalization: trim leading/trailing whitespace; collapse internal
//     runs of whitespace to a single space; drop a trailing period for short
//     prose (so "X." and "X" canonicalize the same way).
//   - Guidance fields: same string normalization as above. NOT dropped (the
//     user wants full feature coverage), but normalized.
//   - JSON output: 2-space indent, sorted keys at every level — so two
//     canonical inventories with the same content are byte-identical.
//
// What we DO NOT normalize:
//   - Set membership (e.g., whether a derived property is present in one
//     inventory but not another). That's model-choice variance, not
//     convention drift. Use the SKILL.md tightenings to address it, or
//     run consensus-voting in a separate tool.
//
// Usage:
//   node eval/canonicalize-inventory.mjs <inventory.json> [<output.json>]

import { readFileSync, writeFileSync } from "fs";

function normString(s) {
  if (typeof s !== "string") return s;
  let v = s.trim().replace(/\s+/g, " ");
  // Drop a single trailing period — short prose like "X." vs "X" should
  // collapse. Don't strip from longer multi-sentence text (heuristic: only
  // strip when there's no other period in the string).
  if (v.endsWith(".") && v.indexOf(".") === v.length - 1) v = v.slice(0, -1);
  return v;
}

function normField(field) {
  const out = { ...field };
  // Nullability convention: prefer suffix `?` on type_hint, drop nullable.
  if (typeof out.type_hint === "string") {
    const t = out.type_hint.trim();
    const isNullable = out.nullable === true || t.endsWith("?");
    const baseType = t.endsWith("?") ? t.slice(0, -1) : t;
    out.type_hint = isNullable ? `${baseType}?` : baseType;
    if ("nullable" in out) delete out.nullable;
  }
  return out;
}

function sortByKey(arr, ...keys) {
  return [...arr].sort((a, b) => {
    for (const k of keys) {
      const av = String(a?.[k] ?? "");
      const bv = String(b?.[k] ?? "");
      const cmp = av.localeCompare(bv);
      if (cmp !== 0) return cmp;
    }
    return 0;
  });
}

function canonEntity(e) {
  const out = { ...e };
  if (Array.isArray(out.fields)) out.fields = sortByKey(out.fields.map(normField), "name");
  if (out.status_enum?.values) {
    out.status_enum = {
      ...out.status_enum,
      values: [...out.status_enum.values].sort(),
    };
  }
  if (Array.isArray(out.relationships)) out.relationships = sortByKey(out.relationships, "name");
  if (Array.isArray(out.derived_properties)) {
    out.derived_properties = sortByKey(out.derived_properties.map((d) => ({
      ...d,
      expression: typeof d.expression === "string" ? d.expression.trim() : d.expression,
    })), "name");
  }
  if (typeof out.guidance === "string") out.guidance = normString(out.guidance);
  return out;
}

function canonTransition(t) {
  const out = { ...t };
  if (Array.isArray(out.called_from)) out.called_from = [...out.called_from].sort();
  if (out.body) {
    const body = { ...out.body };
    if (Array.isArray(body.params)) body.params = sortByKey(body.params.map(normField), "name");
    if (Array.isArray(body.requires)) body.requires = [...body.requires].map((s) => String(s).trim()).sort();
    if (Array.isArray(body.lets)) body.lets = sortByKey(body.lets.map((l) => ({
      ...l,
      expression: typeof l.expression === "string" ? l.expression.trim() : l.expression,
    })), "name");
    if (Array.isArray(body.ensures)) {
      // Ensures are an ordered list semantically (assigns can depend on prior
      // ones). Keep code order EXCEPT canonicalize within each item.
      body.ensures = body.ensures.map(canonEnsuresItem);
    }
    out.body = body;
  }
  if (typeof out.guidance === "string") out.guidance = normString(out.guidance);
  return out;
}

function canonEnsuresItem(it) {
  const out = { ...it };
  if (out.kind === "create" && out.fields && typeof out.fields === "object") {
    out.fields = Object.fromEntries(
      Object.entries(out.fields).sort(([a], [b]) => a.localeCompare(b)),
    );
  }
  if (out.kind === "invoke" && out.args && typeof out.args === "object") {
    out.args = Object.fromEntries(
      Object.entries(out.args).sort(([a], [b]) => a.localeCompare(b)),
    );
  }
  return out;
}

function canonScheduledJob(j) {
  const out = { ...j };
  if (out.body) {
    const body = { ...out.body };
    if (typeof body.when === "string") body.when = body.when.trim();
    if (Array.isArray(body.requires)) body.requires = [...body.requires].map((s) => String(s).trim()).sort();
    if (Array.isArray(body.ensures)) body.ensures = body.ensures.map(canonEnsuresItem);
    out.body = body;
  }
  if (typeof out.guidance === "string") out.guidance = normString(out.guidance);
  return out;
}

function canonIntegration(i) {
  const out = { ...i };
  if (Array.isArray(out.operations)) {
    out.operations = sortByKey(out.operations.map((op) => ({
      ...op,
      params: Array.isArray(op.params) ? sortByKey(op.params.map(normField), "name") : op.params,
      preconditions: Array.isArray(op.preconditions)
        ? [...op.preconditions].map((s) => String(s).trim()).sort()
        : op.preconditions,
      raises: Array.isArray(op.raises) ? [...op.raises].sort() : op.raises,
    })), "name");
  }
  return out;
}

function canonValueType(v) {
  const out = { ...v };
  if (Array.isArray(out.fields)) out.fields = sortByKey(out.fields.map(normField), "name");
  return out;
}

function canonAuxEnum(e) {
  return { ...e, values: [...(e.values ?? [])].sort() };
}

function canonInvariant(inv) {
  return {
    ...inv,
    expression: typeof inv.expression === "string" ? inv.expression.trim() : inv.expression,
    enforced_by: Array.isArray(inv.enforced_by) ? [...inv.enforced_by].sort() : inv.enforced_by,
  };
}

function canonConfig(c) {
  return { ...c, value: typeof c.value === "string" ? c.value.trim() : c.value };
}

function canonRoute(r) {
  return { ...r };
}

function canonWebhook(w) {
  return {
    ...w,
    linking_rule: typeof w.linking_rule === "string" ? normString(w.linking_rule) : w.linking_rule,
  };
}

function canonInventory(inv) {
  return {
    header: inv.header ?? null,
    entities: sortByKey((inv.entities ?? []).map(canonEntity), "name"),
    value_types: sortByKey((inv.value_types ?? []).map(canonValueType), "name"),
    auxiliary_enumerations: sortByKey((inv.auxiliary_enumerations ?? []).map(canonAuxEnum), "name"),
    integrations: sortByKey((inv.integrations ?? []).map(canonIntegration), "name"),
    config: sortByKey((inv.config ?? []).map(canonConfig), "name"),
    transitions: sortByKey((inv.transitions ?? []).map(canonTransition), "name"),
    scheduled_jobs: sortByKey((inv.scheduled_jobs ?? []).map(canonScheduledJob), "name"),
    invariants: sortByKey((inv.invariants ?? []).map(canonInvariant), "name"),
    routes: sortByKey((inv.routes ?? []).map(canonRoute), "method", "path"),
    webhooks: sortByKey((inv.webhooks ?? []).map(canonWebhook), "path"),
  };
}

// Stable JSON serialization: 2-space indent + sorted keys at every level.
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
  const [, , inputPath, outputPath] = process.argv;
  if (!inputPath) {
    console.error("usage: node eval/canonicalize-inventory.mjs <inventory.json> [<output.json>]");
    process.exit(2);
  }
  const inv = JSON.parse(readFileSync(inputPath, "utf-8"));
  const canon = canonInventory(inv);
  const out = stableStringify(canon);
  if (outputPath) writeFileSync(outputPath, out);
  else process.stdout.write(out);
}

main();
