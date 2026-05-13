// Walk a fixture tree and return discovered .allium files with their
// sidecar metadata. Convention:
//
//   <root>/<v>/valid/<category>/<name>.allium
//   <root>/<v>/invalid/<category>/<name>.allium
//   <root>/<v>/invalid/<category>/<name>.expected   # one regex per line
//   <root>/<v>/*/<category>/<name>.notes.md         # optional, ignored
//
// Plus, optionally:
//   <root>/drift.json — see tests/fixtures/language/drift.json. A drift
//   entry is keyed by the fixture's relative path (under <root>) and
//   says the language reference disagrees with current CLI behaviour.
//   The runner accepts the actual behaviour and emits a 'drift:' line
//   instead of pass/fail.
//
// Returns an array of:
//   { path, version, expectation: "valid"|"invalid", category,
//     expectedPatterns, drift }
//
// `drift` is null for non-drift fixtures, or an object copied from
// drift.json (typically { spec_says, cli_does, ref, since_cli_version }).

import { readdirSync, statSync, readFileSync, existsSync } from "fs";
import path from "path";

export function walk(rootDir) {
  const fixtures = [];
  if (!exists(rootDir)) return fixtures;

  const drift = loadDrift(rootDir);

  for (const version of listDirs(rootDir)) {
    for (const expectation of ["valid", "invalid"]) {
      const expDir = path.join(rootDir, version, expectation);
      if (!exists(expDir)) continue;
      for (const category of listDirs(expDir)) {
        const catDir = path.join(expDir, category);
        for (const entry of readdirSync(catDir)) {
          if (!entry.endsWith(".allium")) continue;
          const filePath = path.join(catDir, entry);
          const expectedFile = filePath.replace(/\.allium$/, ".expected");
          const expectedPatterns = exists(expectedFile)
            ? readPatterns(expectedFile)
            : [];
          const driftKey = path.relative(rootDir, filePath);
          fixtures.push({
            path: filePath,
            version,
            expectation,
            category,
            expectedPatterns,
            drift: drift[driftKey] ?? null,
          });
        }
      }
    }
  }
  return fixtures;
}

function loadDrift(rootDir) {
  const driftPath = path.join(rootDir, "drift.json");
  if (!existsSync(driftPath)) return {};
  const parsed = JSON.parse(readFileSync(driftPath, "utf-8"));
  // Strip _comment and other underscore-prefixed metadata keys.
  return Object.fromEntries(
    Object.entries(parsed).filter(([k]) => !k.startsWith("_"))
  );
}

function listDirs(dir) {
  return readdirSync(dir).filter((name) => {
    try {
      return statSync(path.join(dir, name)).isDirectory();
    } catch {
      return false;
    }
  });
}

function exists(p) {
  try {
    statSync(p);
    return true;
  } catch {
    return false;
  }
}

function readPatterns(file) {
  return readFileSync(file, "utf-8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .map((line) => new RegExp(line));
}
