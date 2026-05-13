// LLM-as-judge for tier4 snapshot mismatches.
//
// When a snapshot fails, the unified diff tells you WHAT changed but
// not WHETHER it matters. This helper feeds the diff (plus expected
// and actual texts and the scenario context) to claude with the
// snapshot-diff rubric and gets back a structured assessment:
//
//   {
//     overall_severity: "cosmetic" | "structural" | "semantic",
//     recommendation:   "accept" | "investigate",
//     changes: [
//       { description: "...", severity: "cosmetic"|"structural"|"semantic" },
//       ...
//     ]
//   }
//
// The per-change list lets the user see WHICH changes are the worrying
// ones at a glance; the overall_severity gives the headline.
//
// Same auth-mode and JSON-extraction approach as tier3's judge.mjs:
// drop --json-schema (incompatible with OAuth/agent mode), use
// --output-format=json for the envelope, ask for raw JSON in the
// rubric prompt, strip markdown code fences before parsing.
//
// Default model is haiku — classification of a small text diff is
// well within its capabilities, ~30x cheaper than opus, ~$0.05 per
// failed snapshot.

import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { getAuthMode, runClaude, hasApiKey, isAvailable } from "./claude.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RUBRIC_PATH = path.join(
  HERE,
  "..",
  "fixtures",
  "evals",
  "rubrics",
  "snapshot-diff.md"
);

const DEFAULT_MODEL = "claude-haiku-4-5";

// Whether a snapshot judgment can be made: needs claude on PATH and
// either bare-mode auth (API key) or OAuth (claude logged in). Mirrors
// the gate logic in tier3-evals.mjs so snapshots and assertions
// behave consistently.
export async function canJudge() {
  if (!(await isAvailable())) return false;
  const mode = getAuthMode();
  if (mode === "bare" && !hasApiKey()) return false;
  return true;
}

export async function judgeSnapshotDiff({
  scenarioId,
  snapshotFile,
  expected,
  actual,
  diff,
  budgetUsd,
  model = DEFAULT_MODEL,
  timeoutMs,
}) {
  const authMode = getAuthMode();
  const effectiveBudget =
    budgetUsd ?? (authMode === "oauth" ? 0.5 : 0.1);
  const effectiveTimeout =
    timeoutMs ?? (authMode === "oauth" ? 3 * 60 * 1000 : 90 * 1000);

  const rubric = render(readFileSync(RUBRIC_PATH, "utf-8"), {
    scenario_id: scenarioId,
    snapshot_file: snapshotFile,
    expected,
    actual,
    diff,
  });

  const args = ["-p"];
  if (authMode === "bare") args.push("--bare");
  args.push(
    "--max-budget-usd",
    String(effectiveBudget),
    "--model",
    model,
    "--output-format",
    "json"
  );
  args.push(rubric);

  const result = await runClaude(args, {
    timeoutMs: effectiveTimeout,
    maxBuffer: 5 * 1024 * 1024,
  });

  if (!result.ok) {
    return { ok: false, error: explainFailure(result, effectiveBudget, effectiveTimeout) };
  }

  let envelope;
  try {
    envelope = JSON.parse(result.stdout);
  } catch (e) {
    return {
      ok: false,
      error: `claude envelope was not valid JSON: ${String(e).slice(0, 80)} | stdout=${preview(result.stdout)}`,
    };
  }
  if (envelope.is_error || envelope.subtype !== "success") {
    const subtype = envelope.subtype || "unknown";
    const errs = Array.isArray(envelope.errors) ? envelope.errors.join("; ") : "";
    return { ok: false, error: `claude returned ${subtype}${errs ? `: ${errs}` : ""}` };
  }

  const modelText = (envelope.result ?? "").trim();
  if (!modelText) {
    return {
      ok: false,
      error: `model returned empty result (cost=$${envelope.total_cost_usd ?? "?"}, turns=${envelope.num_turns ?? "?"})`,
    };
  }

  const cleaned = stripCodeFences(modelText);
  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    return {
      ok: false,
      error: `judge output was not valid JSON: ${String(e).slice(0, 80)} | response=${preview(cleaned)}`,
    };
  }

  const validSeverity = (s) =>
    s === "cosmetic" || s === "structural" || s === "semantic";
  const validRecommendation = (r) => r === "accept" || r === "investigate";
  const validChanges =
    Array.isArray(parsed?.changes) &&
    parsed.changes.length > 0 &&
    parsed.changes.every(
      (c) =>
        c &&
        typeof c.description === "string" &&
        validSeverity(c.severity)
    );
  const valid =
    parsed &&
    validSeverity(parsed.overall_severity) &&
    validRecommendation(parsed.recommendation) &&
    validChanges;
  if (!valid) {
    return {
      ok: false,
      error: `judge response did not match expected shape (overall_severity / recommendation / changes[]): ${preview(cleaned)}`,
    };
  }

  return {
    ok: true,
    overallSeverity: parsed.overall_severity,
    recommendation: parsed.recommendation,
    changes: parsed.changes.map((c) => ({
      description: c.description,
      severity: c.severity,
    })),
  };
}

function render(template, vars) {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) => {
    if (!(key in vars)) {
      throw new Error(`Snapshot-judge variable {{${key}}} not provided`);
    }
    return String(vars[key]);
  });
}

function stripCodeFences(text) {
  const m = text.match(/^\s*```(?:json|JSON)?\s*\n?([\s\S]*?)\n?\s*```\s*$/);
  return m ? m[1].trim() : text.trim();
}

function explainFailure(result, budget, timeoutMs) {
  if (result.timedOut) return `timed out after ${timeoutMs / 1000}s`;
  if (
    /budget|exceeded/i.test(result.stderr) ||
    /budget|exceeded/i.test(result.stdout)
  ) {
    return `budget $${budget} exceeded`;
  }
  return `exit ${result.code} | stderr=${preview(result.stderr)} | stdout=${preview(result.stdout)}`;
}

function preview(s, max = 240) {
  if (s == null || s.length === 0) return "<empty>";
  const oneLine = s.split("\n").filter(Boolean).join(" | ");
  if (!oneLine) return "<whitespace only>";
  return oneLine.length > max ? oneLine.slice(0, max) + "…" : oneLine;
}
