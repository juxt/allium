#!/usr/bin/env node
// Consensus merger for K canonical obligation-bridge inventories.
//
// Inputs: K obligation-bridge.canonical.json files produced by
//         canonicalize-obligations.mjs.
//
// Output: 1 obligation-bridge.merged.json, byte-deterministic.
//
// Merge rules (distinct from distill's merge — the obligation set is fixed
// by `allium plan`, so we vote per-field within each obligation rather than
// over set membership):
//
//   - The set of obligation_ids is identical across K by construction (the
//     canonicaliser rejects any sample that deviates), so no membership
//     vote is needed. If we see a mismatch here, abort.
//   - For each obligation:
//     - test_kind: modal value across K, first-occurrence tie-break.
//     - bridge.primary_symbol: modal value. If no strict majority
//       (>= ceil(K/2) + 1 of K with at least 2 samples; or unanimous for
//       K<=2), set primary_symbol = null, populate candidates with all
//       observed primaries, and downgrade confidence to "low".
//     - bridge.candidates: set-union of all candidates observed across K,
//       minus the merged primary_symbol.
//     - bridge.confidence:
//         "low"  if the consensus was forced (no majority on primary)
//                or any sample voted low for the same primary.
//         lowest of {samples voting for the merged primary}'s confidences
//                otherwise.
//     - preconditions, fixtures_required, injection_points:
//         elements appearing in >= ceil(K/2) of the samples (set-style
//         majority); sorted output.
//     - target_file / test_name: must be identical across K (the
//       canonicaliser computes them deterministically from name-policy);
//       if they differ, abort with a misconfiguration error.
//   - transition_graph: per-entity union of edges appearing in >= ceil(K/2)
//     of the samples; per-edge unanimity is expected (allium model is
//     deterministic). Disagreements are logged to stderr as warnings.
//   - framework: must be identical across K; otherwise abort.
//
// The output JSON has sorted keys at every depth, identical to the
// canonicaliser's output.
//
// Usage:
//   node merge-obligations.mjs <out.json> <inv1.canonical.json> <inv2.canonical.json> ...

import { readFileSync, writeFileSync } from "fs";

function die(msg) {
  console.error(`merge-obligations: ${msg}`);
  process.exit(2);
}

function warn(msg) {
  console.error(`merge-obligations: warning: ${msg}`);
}

function readJson(p) {
  try {
    return JSON.parse(readFileSync(p, "utf-8"));
  } catch (err) {
    die(`failed to read JSON from ${p}: ${err.message}`);
  }
}

function majorityThreshold(k) {
  return Math.ceil(k / 2);
}

function strictMajorityThreshold(k) {
  // For "strict majority on primary_symbol" we want more than half.
  // For K=3: 2 of 3 is enough; for K=5: 3 of 5; for K=2: requires 2 (unanimous).
  return Math.floor(k / 2) + 1;
}

function modeOrNull(values, threshold) {
  const counts = new Map();
  const firstSeen = new Map();
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    const k = JSON.stringify(v ?? null);
    counts.set(k, (counts.get(k) ?? 0) + 1);
    if (!firstSeen.has(k)) firstSeen.set(k, i);
  }
  let bestKey = null;
  let bestCount = 0;
  let bestFirst = Infinity;
  for (const [k, c] of counts.entries()) {
    if (c > bestCount || (c === bestCount && firstSeen.get(k) < bestFirst)) {
      bestKey = k;
      bestCount = c;
      bestFirst = firstSeen.get(k);
    }
  }
  if (bestCount < threshold) return { value: null, count: bestCount, total: values.length };
  return { value: bestKey === null ? null : JSON.parse(bestKey), count: bestCount, total: values.length };
}

function modalValue(values) {
  // No threshold — just pick most common with deterministic tie-break.
  return modeOrNull(values, 1).value;
}

function majorityElements(arrays, k) {
  const threshold = majorityThreshold(k);
  const counts = new Map();
  for (const arr of arrays) {
    const seen = new Set();
    for (const v of arr ?? []) {
      const key = JSON.stringify(v);
      if (seen.has(key)) continue;
      seen.add(key);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .filter(([, c]) => c >= threshold)
    .map(([key]) => JSON.parse(key))
    .sort();
}

function mergeBridge(samples, k) {
  // samples is the array of bridge objects, one per K.
  const primaries = samples.map((s) => s.primary_symbol ?? null);
  const strict = strictMajorityThreshold(k);
  const primaryResult = modeOrNull(primaries, strict);

  let mergedPrimary;
  let confidence;
  let forcedLow = false;
  if (primaryResult.value !== null && primaryResult.count >= strict) {
    mergedPrimary = primaryResult.value;
    const voters = samples.filter((s) => s.primary_symbol === mergedPrimary);
    const rank = { high: 2, medium: 1, low: 0 };
    let lowest = "high";
    for (const v of voters) {
      if (rank[v.confidence] < rank[lowest]) lowest = v.confidence;
    }
    confidence = lowest;
  } else {
    mergedPrimary = null;
    forcedLow = true;
    confidence = "low";
  }

  // Candidates: union of all candidates from all samples, plus any
  // primary_symbol that's not the merged primary, minus the merged primary.
  const candSet = new Set();
  for (const s of samples) {
    for (const c of s.candidates ?? []) candSet.add(c);
    if (s.primary_symbol && s.primary_symbol !== mergedPrimary) {
      candSet.add(s.primary_symbol);
    }
  }
  if (mergedPrimary) candSet.delete(mergedPrimary);
  const candidates = [...candSet].sort();

  // Force low confidence if we had to fall back, or if there's any low
  // among the samples that vote for the merged primary.
  if (!forcedLow) {
    const voters = samples.filter((s) => s.primary_symbol === mergedPrimary);
    if (voters.some((v) => v.confidence === "low")) confidence = "low";
  }

  return {
    primary_symbol: mergedPrimary,
    candidates,
    confidence,
  };
}

function mergeObligation(samples, k) {
  const id = samples[0].obligation_id;
  for (const s of samples) {
    if (s.obligation_id !== id) {
      die(`obligation_id mismatch within a merge group: ${id} vs ${s.obligation_id}`);
    }
  }
  const tfs = new Set(samples.map((s) => s.target_file));
  if (tfs.size !== 1) {
    die(`obligation ${id}: target_file differs across samples (${[...tfs].join(", ")}) — name-policy not applied identically`);
  }
  const tns = new Set(samples.map((s) => s.test_name));
  if (tns.size !== 1) {
    die(`obligation ${id}: test_name differs across samples (${[...tns].join(", ")}) — name-policy not applied identically`);
  }
  return {
    obligation_id: id,
    test_kind: modalValue(samples.map((s) => s.test_kind)),
    bridge: mergeBridge(samples.map((s) => s.bridge), k),
    preconditions: majorityElements(samples.map((s) => s.preconditions ?? []), k),
    fixtures_required: majorityElements(samples.map((s) => s.fixtures_required ?? []), k),
    injection_points: majorityElements(samples.map((s) => s.injection_points ?? []), k),
    target_file: [...tfs][0],
    test_name: [...tns][0],
  };
}

function mergeTransitionGraph(graphs, k) {
  const allEntities = new Set();
  for (const g of graphs) for (const key of Object.keys(g ?? {})) allEntities.add(key);
  const out = {};
  for (const entity of [...allEntities].sort()) {
    const edgeArrays = graphs.map((g) => g?.[entity] ?? []);
    // Build set of edges with their counts.
    const counts = new Map();
    for (const arr of edgeArrays) {
      const seen = new Set();
      for (const e of arr) {
        const key = JSON.stringify({ from: e.from, to: e.to, via_rule: e.via_rule });
        if (seen.has(key)) continue;
        seen.add(key);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
    const threshold = majorityThreshold(k);
    const edges = [];
    for (const [key, c] of counts.entries()) {
      if (c >= threshold) edges.push(JSON.parse(key));
      else warn(`transition_graph[${entity}]: edge ${key} appears in ${c}/${k} samples (below ${threshold}); dropping`);
    }
    edges.sort((a, b) => {
      const ak = `${a.from}\x00${a.to}\x00${a.via_rule}`;
      const bk = `${b.from}\x00${b.to}\x00${b.via_rule}`;
      return ak.localeCompare(bk);
    });
    out[entity] = edges;
  }
  return out;
}

function mergeInventories(inventories) {
  if (inventories.length === 0) die("no inventories given");
  const k = inventories.length;

  // Framework must match across all samples.
  const frameworks = new Set(inventories.map((i) => i.framework));
  if (frameworks.size !== 1) {
    die(`framework differs across samples: ${[...frameworks].join(", ")}`);
  }

  // spec_path and code_root must match (they should be set by the
  // orchestrator, not freely chosen by subagents).
  const specPaths = new Set(inventories.map((i) => i.spec_path));
  if (specPaths.size !== 1) die(`spec_path differs across samples: ${[...specPaths].join(", ")}`);
  const codeRoots = new Set(inventories.map((i) => i.code_root));
  if (codeRoots.size !== 1) die(`code_root differs across samples: ${[...codeRoots].join(", ")}`);

  // Group obligations by obligation_id; every inventory must contribute
  // exactly one entry per id (canonicaliser enforced this against `plan`).
  const groups = new Map();
  for (const inv of inventories) {
    for (const o of inv.obligations) {
      if (!groups.has(o.obligation_id)) groups.set(o.obligation_id, []);
      groups.get(o.obligation_id).push(o);
    }
  }
  for (const [id, items] of groups) {
    if (items.length !== k) {
      die(`obligation ${id}: appears in ${items.length}/${k} samples (canonicaliser should have caught this)`);
    }
  }

  const mergedObligations = [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, items]) => mergeObligation(items, k));

  return {
    spec_path: [...specPaths][0],
    code_root: [...codeRoots][0],
    framework: [...frameworks][0],
    obligations: mergedObligations,
    transition_graph: mergeTransitionGraph(inventories.map((i) => i.transition_graph ?? {}), k),
    consensus_metadata: {
      sample_count: k,
      generated_at: null, // intentionally null so the output is reproducible across time
    },
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
    die("usage: merge-obligations.mjs <out.json> <inv1.canonical.json> <inv2.canonical.json> ...");
  }
  const invs = inputs.map(readJson);
  const merged = mergeInventories(invs);
  writeFileSync(outputPath, stableStringify(merged));
  const lowCount = merged.obligations.filter((o) => o.bridge.confidence === "low").length;
  console.error(
    `merge-obligations: ${invs.length} inventories -> ${outputPath} (${merged.obligations.length} obligations, ${lowCount} low-confidence)`,
  );
}

main();
