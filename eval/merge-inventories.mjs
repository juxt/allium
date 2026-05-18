#!/usr/bin/env node
// Consensus inventory merger.
//
// Reads K canonical inventories produced by canonicalize-inventory.mjs and
// emits a single consensus inventory. The strategy:
//
//   - For each named list (entities, transitions, etc.), an item is included
//     iff it appears (by name) in at least ceil(K/2) of the inputs.
//   - For each scalar field on a kept item, the value is the *modal* value
//     across the inputs that contain that item. Ties break by first-occurrence
//     in input order (which is itself sorted alphabetically by sample name,
//     so the choice is deterministic).
//   - For each array field on a kept item, every element that appears in
//     at least ceil(K/2) of the inputs is kept (set-style majority); the
//     surviving elements are then re-merged recursively (so a field that's
//     an object is itself consensus-merged).
//   - For nested record arrays (e.g., entities[].fields[]), we recurse using
//     the `name` of each element as the key for set membership.
//
// The output is the canonical JSON form (sorted keys, 2-space indent) so
// running merge over the same K inputs always produces the same bytes.
//
// Usage:
//   node eval/merge-inventories.mjs <out.json> <inv1.json> <inv2.json> ...

import { readFileSync, writeFileSync } from "fs";

const KEY_FOR = {
  entities: "name",
  value_types: "name",
  auxiliary_enumerations: "name",
  integrations: "name",
  config: "name",
  transitions: "name",
  scheduled_jobs: "name",
  invariants: "name",
  routes: "path",                 // method+path could collide but path is enough here
  webhooks: "path",
  fields: "name",
  relationships: "name",
  derived_properties: "name",
  params: "name",
  operations: "name",
};

function mode(values) {
  // Modal value with deterministic tie-breaking (first-seen wins).
  const counts = new Map();
  for (const v of values) {
    const k = canonicalKey(v);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  let best = null;
  let bestCount = 0;
  let firstSeen = new Map();
  for (let i = 0; i < values.length; i++) {
    const k = canonicalKey(values[i]);
    if (!firstSeen.has(k)) firstSeen.set(k, i);
  }
  for (const [k, c] of counts.entries()) {
    if (c > bestCount || (c === bestCount && firstSeen.get(k) < firstSeen.get(canonicalKey(best)))) {
      bestCount = c;
      const idx = firstSeen.get(k);
      best = values[idx];
    }
  }
  return best;
}

function canonicalKey(v) {
  return JSON.stringify(v ?? null);
}

function majorityThreshold(k) {
  return Math.ceil(k / 2);
}

function mergeArrayOfRecords(arrays, keyName, k) {
  // Build a map name -> list of records that have that name.
  const groups = new Map();
  for (const arr of arrays) {
    for (const item of arr ?? []) {
      const key = item?.[keyName];
      if (key === undefined) continue;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    }
  }
  // Keep items appearing in >= ceil(K/2) of the inputs.
  const threshold = majorityThreshold(k);
  const kept = [...groups.entries()]
    .filter(([, items]) => items.length >= threshold)
    .map(([, items]) => mergeRecord(items, k));
  // Sort by key for determinism.
  kept.sort((a, b) => String(a[keyName] ?? "").localeCompare(String(b[keyName] ?? "")));
  return kept;
}

function mergeArrayOfPrimitives(arrays, k) {
  // For arrays of primitives (strings, numbers), take elements appearing
  // in >= ceil(K/2) of the inputs.
  const threshold = majorityThreshold(k);
  const counts = new Map();
  for (const arr of arrays) {
    const seen = new Set();
    for (const v of arr ?? []) {
      const key = canonicalKey(v);
      if (seen.has(key)) continue;
      seen.add(key);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  const kept = [...counts.entries()]
    .filter(([, c]) => c >= threshold)
    .map(([key]) => JSON.parse(key));
  return kept.sort();
}

function isArrayOfRecords(arr) {
  return Array.isArray(arr) && arr.length > 0 && typeof arr[0] === "object" && arr[0] !== null;
}

function mergeRecord(records, k) {
  // For each key present in any record, decide:
  //   - if all values are records: recursively merge (treat as object merge)
  //   - if all values are arrays of records: name-key merge
  //   - if all values are arrays of primitives: majority-element merge
  //   - otherwise (scalars or mixed): modal value
  const out = {};
  const allKeys = new Set();
  for (const r of records) for (const k of Object.keys(r ?? {})) allKeys.add(k);
  for (const key of [...allKeys].sort()) {
    const values = records.map((r) => r?.[key]).filter((v) => v !== undefined);
    if (values.length === 0) continue;
    const firstVal = values.find((v) => v !== null);
    if (firstVal === undefined) { out[key] = null; continue; }

    if (Array.isArray(firstVal)) {
      const innerArrays = values.filter(Array.isArray);
      // If known-named, use record-array merge.
      const innerKey = KEY_FOR[key];
      if (innerKey && isArrayOfRecords(firstVal)) {
        out[key] = mergeArrayOfRecords(innerArrays, innerKey, k);
      } else if (isArrayOfRecords(firstVal)) {
        // Unknown record array; fallback to first-input's value (modal won't
        // make sense). Conservative: take input-order earliest non-empty.
        out[key] = innerArrays.find((a) => a.length > 0) ?? [];
      } else {
        out[key] = mergeArrayOfPrimitives(innerArrays, k);
      }
    } else if (typeof firstVal === "object" && firstVal !== null) {
      out[key] = mergeRecord(values.filter((v) => v && typeof v === "object"), k);
    } else {
      out[key] = mode(values);
    }
  }
  return out;
}

function mergeInventories(inventories) {
  const k = inventories.length;
  return {
    header: mode(inventories.map((i) => i.header).filter(Boolean)) ?? null,
    entities: mergeArrayOfRecords(inventories.map((i) => i.entities), "name", k),
    value_types: mergeArrayOfRecords(inventories.map((i) => i.value_types), "name", k),
    auxiliary_enumerations: mergeArrayOfRecords(inventories.map((i) => i.auxiliary_enumerations), "name", k),
    integrations: mergeArrayOfRecords(inventories.map((i) => i.integrations), "name", k),
    config: mergeArrayOfRecords(inventories.map((i) => i.config), "name", k),
    transitions: mergeArrayOfRecords(inventories.map((i) => i.transitions), "name", k),
    scheduled_jobs: mergeArrayOfRecords(inventories.map((i) => i.scheduled_jobs), "name", k),
    invariants: mergeArrayOfRecords(inventories.map((i) => i.invariants), "name", k),
    routes: mergeArrayOfRecords(inventories.map((i) => i.routes), "path", k),
    webhooks: mergeArrayOfRecords(inventories.map((i) => i.webhooks), "path", k),
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
  const [, , outputPath, ...inputs] = process.argv;
  if (!outputPath || inputs.length === 0) {
    console.error("usage: node eval/merge-inventories.mjs <out.json> <inv1.json> <inv2.json> ...");
    process.exit(2);
  }
  const invs = inputs.map((p) => JSON.parse(readFileSync(p, "utf-8")));
  const merged = mergeInventories(invs);
  writeFileSync(outputPath, stableStringify(merged));
  console.error(`merged ${invs.length} inventories -> ${outputPath}`);
}

main();
