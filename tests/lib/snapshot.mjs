// Snapshot helpers for Tier 4 end-to-end evals.
//
// Dual-mode comparison: a produced .allium file is compared against
// both a text snapshot and a model-JSON snapshot (from `allium model
// <file>`). The compare passes when EITHER matches. Rationale:
//
//   - Text snapshots cover everything the parser preserves (rules,
//     surfaces, contracts, comments, formatting). Strict but flake-prone
//     when the LLM reorders declarations or rephrases comments.
//   - Model snapshots normalise away cosmetic variation by going
//     through allium model. As of allium 3.0.4 the model command emits
//     entity-level structure only, so model alone is too lossy — but as
//     a flake-tolerance fallback when the text snapshot disagrees, it's
//     the right safety net.
//
// File layout per snapshot:
//
//   snapshots/<scenario>/<file>            # the canonical text
//   snapshots/<scenario>/<file>.model.json # allium model output (if .allium)
//
// `--update-snapshots` rewrites both. Non-.allium files snapshot only
// the text.

import { execFile } from "child_process";
import { promisify } from "util";
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdtempSync,
  rmSync,
} from "fs";
import { tmpdir } from "os";
import path from "path";

const execFileAsync = promisify(execFile);

export function normalise(text) {
  return text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\n*$/, "\n");
}

export function readSnapshot(path) {
  if (!existsSync(path)) return null;
  return normalise(readFileSync(path, "utf-8"));
}

export function writeSnapshot(path, text) {
  writeFileSync(path, normalise(text));
}

export function readModelSnapshot(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

export function writeModelSnapshot(path, modelJson) {
  writeFileSync(path, JSON.stringify(modelJson, null, 2) + "\n");
}

// Run `allium model <file>` and return parsed JSON, or null if the
// command fails (file not parseable, allium absent, etc).
export async function modelOf(filePath) {
  try {
    const { stdout } = await execFileAsync("allium", ["model", filePath]);
    return JSON.parse(stdout);
  } catch {
    return null;
  }
}

// Compare an actual produced file against text + model snapshots.
// Returns:
//   { match: true,  reason: "text"|"model" }
//   { match: false, textDiff, modelDiff }
//
// `match: true` when EITHER text OR model matches; this is the
// dual-mode "flake tolerance" semantic.
export async function compareDual({
  actualPath,
  expectedTextPath,
  expectedModelPath,
}) {
  const actualText = readFileSync(actualPath, "utf-8");
  const expectedText = readSnapshot(expectedTextPath);
  if (expectedText !== null) {
    if (normalise(actualText) === expectedText) {
      return { match: true, reason: "text" };
    }
  }

  // Text didn't match (or no text snapshot). Try model.
  const isAllium = actualPath.endsWith(".allium");
  if (isAllium) {
    const expectedModel = readModelSnapshot(expectedModelPath);
    if (expectedModel !== null) {
      const actualModel = await modelOf(actualPath);
      if (
        actualModel !== null &&
        JSON.stringify(actualModel) === JSON.stringify(expectedModel)
      ) {
        return { match: true, reason: "model" };
      }
    }
  }

  return {
    match: false,
    textDiff:
      expectedText === null
        ? `(no text snapshot at ${expectedTextPath})`
        : await unifiedDiff(expectedText, normalise(actualText)),
    modelDiff: isAllium
      ? expectedModelPath && existsSync(expectedModelPath)
        ? "(model also differs or could not be derived)"
        : `(no model snapshot at ${expectedModelPath})`
      : "(not an .allium file; model comparison N/A)",
  };
}

// Unified diff between two strings, via shell-out to `diff -u`. The
// previous in-JS implementation iterated lines in parallel ("expected
// line N vs actual line N"); a single insertion shifted everything
// after it and made every subsequent line look different, ballooning
// what should be a 6-line diff into 50 lines of churn. `diff -u` is
// universally available, gives canonical output, and handles
// inserts/deletes properly.
//
// Truncated to 200 lines so a wholesale rewrite doesn't drown the
// terminal. The kept-workspace comparison can be re-run for the full
// view if needed.
export async function unifiedDiff(expected, actual) {
  const tmp = mkdtempSync(path.join(tmpdir(), "allium-diff-"));
  try {
    const a = path.join(tmp, "expected");
    const b = path.join(tmp, "actual");
    writeFileSync(a, expected);
    writeFileSync(b, actual);
    let out;
    try {
      // `diff` exits 0 (same), 1 (differs) or 2 (error). 1 is fine
      // for our use; execFile rejects on non-zero so handle in catch.
      const result = await execFileAsync("diff", [
        "-u",
        "--label",
        "expected",
        "--label",
        "actual",
        a,
        b,
      ]);
      out = result.stdout;
    } catch (e) {
      // exit 1 = differences; that's the expected case for us
      if (e.code === 1) out = e.stdout ?? "";
      else throw e;
    }
    return truncate(out, 200);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function truncate(text, maxLines) {
  const lines = text.split("\n");
  if (lines.length <= maxLines) return text;
  return (
    lines.slice(0, maxLines).join("\n") +
    `\n... (truncated; full diff is ${lines.length} lines)`
  );
}
