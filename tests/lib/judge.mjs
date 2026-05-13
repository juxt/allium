// LLM-as-judge harness.
//
// Given a rubric template (markdown with {{placeholders}}), a workspace
// before/after snapshot, and the agent's transcript, ask Claude to
// score the run against the rubric criteria.
//
// IMPORTANT: this implementation deliberately does NOT use claude's
// `--json-schema` flag. Empirically (probed against claude 2.1.126,
// see commit log) `--json-schema` is incompatible with OAuth/agent
// mode: with --json-schema set and no --bare, the model returns
// "Done." (treating the prompt as agentic work) instead of the
// schema-conforming JSON. Disabling all tools via --disallowedTools
// does not help — the schema enforcement path itself is broken in
// agent mode.
//
// Workaround:
//
//   1. Use --output-format json so claude returns a stable envelope
//      around the model's text response (always exits cleanly with a
//      `result` field that holds the model output verbatim).
//   2. Ask for the JSON shape explicitly in the rubric prompt.
//   3. Strip markdown code fences from the response (haiku in
//      particular tends to wrap JSON in ```json ... ``` despite the
//      "no fences" instruction).
//   4. Parse the cleaned text. The expected shape is a JSON array of
//      verdict objects matching the rubric's instructions.
//
// Output the runner sees:
//   { ok: true,  verdicts: [ {criterion, verdict, reason}, ... ] }
//   { ok: false, error: <short reason>, raw: <first 1KB of model output> }
//
// Default model: haiku unless overridden. Judge is a low-stakes
// scoring call; haiku is plenty and ~30x cheaper than opus.

import { readFileSync } from "fs";

import { getAuthMode, runClaude } from "./claude.mjs";

const DEFAULT_JUDGE_MODEL = "claude-haiku-4-5";

export async function judge({
  rubricPath,
  variables,
  budgetUsd,
  model = DEFAULT_JUDGE_MODEL,
  timeoutMs,
  authMode = getAuthMode(),
}) {
  const rubric = render(readFileSync(rubricPath, "utf-8"), variables);

  // OAuth mode loads the user's CLAUDE.md, hooks, plugin sync and
  // auto-memory — adds startup tokens AND turns the call into an
  // agent run rather than a one-shot text response. Bigger budget and
  // longer timeout absorb the overhead.
  const effectiveBudget =
    budgetUsd ?? (authMode === "oauth" ? 0.5 : 0.1);
  const effectiveTimeout =
    timeoutMs ?? (authMode === "oauth" ? 3 * 60 * 1000 : 90 * 1000);

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
    return {
      ok: false,
      error: explainFailure(result, effectiveBudget, effectiveTimeout),
      raw: result.stdout,
    };
  }

  // claude --output-format json wraps the response in:
  //   {"type":"result","subtype":"success","result":"<model text>", ...}
  let envelope;
  try {
    envelope = JSON.parse(result.stdout);
  } catch (e) {
    return {
      ok: false,
      error: `claude envelope was not valid JSON: ${String(e).slice(0, 80)} | stdout=${preview(result.stdout)}`,
      raw: result.stdout.slice(0, 1000),
    };
  }

  if (envelope.is_error || envelope.subtype !== "success") {
    const subtype = envelope.subtype || "unknown";
    const errs = Array.isArray(envelope.errors)
      ? envelope.errors.join("; ")
      : "";
    return {
      ok: false,
      error: `claude returned ${subtype}${errs ? `: ${errs}` : ""}`,
      raw: result.stdout.slice(0, 1000),
    };
  }

  const modelText = (envelope.result ?? "").trim();
  if (!modelText) {
    return {
      ok: false,
      error: `model returned empty result (cost=$${envelope.total_cost_usd ?? "?"}, turns=${envelope.num_turns ?? "?"}, stop=${envelope.stop_reason ?? "?"}) — likely agent-mode pollution; consider setting ANTHROPIC_API_KEY and removing --oauth`,
      raw: result.stdout.slice(0, 1000),
    };
  }

  const cleaned = stripCodeFences(modelText);
  let verdicts;
  try {
    verdicts = JSON.parse(cleaned);
  } catch (e) {
    return {
      ok: false,
      error: `model output was not valid JSON: ${String(e).slice(0, 80)} | response=${preview(cleaned)}`,
      raw: modelText.slice(0, 1000),
    };
  }

  if (!Array.isArray(verdicts)) {
    return {
      ok: false,
      error: `model returned non-array: ${preview(cleaned)}`,
      raw: modelText.slice(0, 1000),
    };
  }

  return { ok: true, verdicts };
}

function render(template, vars) {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) => {
    if (!(key in vars)) {
      throw new Error(`Rubric variable {{${key}}} not provided`);
    }
    return String(vars[key]);
  });
}

// Strip ```json ... ``` or ``` ... ``` wrappers if the model added
// them despite the rubric's "no fences" instruction. Haiku in
// particular tends to do this.
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
  const stderrSummary = preview(result.stderr);
  const stdoutSummary = preview(result.stdout);
  return `exit ${result.code} | stderr=${stderrSummary} | stdout=${stdoutSummary}`;
}

function preview(s, max = 240) {
  if (s == null || s.length === 0) return "<empty>";
  const oneLine = s.split("\n").filter(Boolean).join(" | ");
  if (!oneLine) return "<whitespace only>";
  return oneLine.length > max ? oneLine.slice(0, max) + "…" : oneLine;
}
