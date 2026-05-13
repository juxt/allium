// Wrapper around `claude -p` (Claude Code in non-interactive mode).
//
// Used by Tier 3 to invoke skills against fixture workspaces. The
// project's local skill content is loaded via --plugin-dir so the eval
// tests THIS working copy of the skills, not whatever's installed via
// the marketplace.
//
// Two auth modes:
//
//   bare (default) — runs with --bare, which strips hooks, LSP, plugin
//     sync, auto-memory, CLAUDE.md auto-discovery and OAuth/keychain
//     reads. Auth comes strictly from ANTHROPIC_API_KEY (or apiKeyHelper
//     via --settings). Best for CI and hermetic runs.
//
//   oauth — drops --bare, letting claude use its normal OAuth login.
//     No API key needed. Trade-off: claude will auto-load CLAUDE.md
//     from parent directories, fire hooks, read auto-memory, and so on.
//     For local dev where you want quick feedback without setting up
//     an API key, accept the modest pollution.
//
// Mode selection (first match wins):
//   --oauth flag in argv         → oauth
//   ALLIUM_TIER3_AUTH=oauth env  → oauth
//   --bare flag in argv          → bare (explicit)
//   ALLIUM_TIER3_AUTH=bare env   → bare (explicit)
//   default                      → bare
//
// Local-only invocations isolated to a tmp workspace. `--allowedTools
// "Edit Write Read Bash"` keeps the agent off the network (no
// WebFetch / WebSearch) regardless of mode.

import { execFile, spawn } from "child_process";
import { promisify } from "util";
import path from "path";
import { fileURLToPath } from "url";

const execFileAsync = promisify(execFile);

// Spawn-based runner that ACTUALLY closes stdin (execFile silently
// ignores the `stdio` option — it's spawn-only). Without this, claude
// detects a non-TTY stdin and prints "no stdin data received in 3s,
// proceeding without it" on every call, adding 3 seconds of latency
// and noise to every invocation.
//
// Options:
//   cwd            working directory for the spawned process
//   timeoutMs      SIGTERM after this many ms; SIGKILL 2s later
//   maxBuffer      truncate stdout/stderr beyond this size (default 10MB)
//   onTick(ms)     called every tickIntervalMs while the process runs.
//                  Useful for heartbeat output so the user sees the
//                  run is still alive during long silent waits.
//   tickIntervalMs how often to call onTick (default 15s)
//   onStdout(buf)  called with each stdout chunk as it arrives.
//                  Lets verbose mode tee output live without losing
//                  the buffered final response.
//   onStderr(buf)  same for stderr. Claude's progress messages
//                  (token counts, tool calls, plugin activity) go
//                  here, so streaming this gives the most useful
//                  live feedback.
//
// Returns { ok, code, stdout, stderr, timedOut }.
export function runClaude(
  args,
  {
    cwd,
    timeoutMs,
    maxBuffer = 10 * 1024 * 1024,
    onTick,
    tickIntervalMs = 15_000,
    onStdout,
    onStderr,
  } = {}
) {
  return new Promise((resolve) => {
    const proc = spawn("claude", args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const chunks = { stdout: [], stderr: [] };
    let stdoutLen = 0;
    let stderrLen = 0;
    let timedOut = false;
    let killed = false;

    const onData = (which) => (data) => {
      // Stream chunk to the live callback if any, before buffering.
      const liveCb = which === "stdout" ? onStdout : onStderr;
      if (liveCb) liveCb(data);

      const len = data.length;
      const totalRef = which === "stdout" ? stdoutLen : stderrLen;
      if (totalRef + len > maxBuffer) {
        // truncate to fit
        const remaining = Math.max(0, maxBuffer - totalRef);
        if (remaining > 0) chunks[which].push(data.slice(0, remaining));
        if (which === "stdout") stdoutLen = maxBuffer; else stderrLen = maxBuffer;
        return;
      }
      chunks[which].push(data);
      if (which === "stdout") stdoutLen += len; else stderrLen += len;
    };

    proc.stdout.on("data", onData("stdout"));
    proc.stderr.on("data", onData("stderr"));

    const timer = timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          killed = true;
          proc.kill("SIGTERM");
          // SIGKILL fallback if process doesn't exit promptly
          setTimeout(() => proc.kill("SIGKILL"), 2000).unref();
        }, timeoutMs)
      : null;

    const startedAt = Date.now();
    const tick = onTick
      ? setInterval(() => onTick(Date.now() - startedAt), tickIntervalMs)
      : null;
    if (tick) tick.unref();

    proc.on("error", (err) => {
      if (timer) clearTimeout(timer);
      if (tick) clearInterval(tick);
      resolve({
        ok: false,
        code: -1,
        stdout: Buffer.concat(chunks.stdout).toString("utf-8"),
        stderr: String(err),
        timedOut: false,
      });
    });

    proc.on("close", (code, signal) => {
      if (timer) clearTimeout(timer);
      if (tick) clearInterval(tick);
      const stdout = Buffer.concat(chunks.stdout).toString("utf-8");
      const stderr = Buffer.concat(chunks.stderr).toString("utf-8");
      resolve({
        ok: !killed && code === 0,
        code: code ?? (signal ? -1 : 0),
        stdout,
        stderr,
        timedOut,
      });
    });
  });
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..");

export async function isAvailable() {
  try {
    await execFileAsync("claude", ["--version"]);
    return true;
  } catch {
    return false;
  }
}

export function hasApiKey() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export function getAuthMode() {
  if (process.argv.includes("--oauth")) return "oauth";
  if (process.env.ALLIUM_TIER3_AUTH === "oauth") return "oauth";
  if (process.argv.includes("--bare")) return "bare";
  if (process.env.ALLIUM_TIER3_AUTH === "bare") return "bare";
  return "bare";
}

// Whether the current auth mode has its prerequisites satisfied.
// Bare needs ANTHROPIC_API_KEY; OAuth trusts that `claude` is already
// logged in (if it isn't, the call fails with "Not logged in" and the
// runner surfaces that as a fixture-level failure).
export function canAuthenticate(mode = getAuthMode()) {
  if (mode === "bare") return hasApiKey();
  return true;
}

// Run claude -p with the given prompt against a workspace directory.
//
// Returns { ok, stdout, stderr, code, envelope }.
//
//   stdout    — the model's text response (extracted from envelope.result
//               when --output-format=json; same as before for text mode)
//   envelope  — the full claude envelope when --output-format=json was
//               used and parsing succeeded. Has fields like
//               total_cost_usd, session_id, stop_reason, num_turns
//               that the tier4 manifest writer captures per step. Null
//               when envelope parsing failed (logged as a warning).
//
// Default output format is "json" — the envelope metadata is useful
// for cost/duration tracking and zero existing caller reads
// invoke()'s stdout in a way that depends on the text format (the
// agent communicates by writing files into the workspace; the model
// text is informational at most). Pass `outputFormat: "text"` to
// opt back in to the old shape.
export async function invoke({
  prompt,
  cwd,
  budgetUsd = 0.5,
  model,
  allowedTools = ["Edit", "Write", "Read", "Bash"],
  timeoutMs = 5 * 60 * 1000,
  authMode = getAuthMode(),
  onTick,
  tickIntervalMs,
  onStderr,
  debug = false,
  outputFormat = "json",
}) {
  const args = ["-p"];
  if (authMode === "bare") args.push("--bare");
  if (debug) args.push("--debug");
  args.push(
    "--plugin-dir",
    REPO_ROOT,
    "--max-budget-usd",
    String(budgetUsd),
    "--allowedTools",
    allowedTools.join(" "),
    "--output-format",
    outputFormat
  );
  if (model) args.push("--model", model);
  args.push(prompt);

  const result = await runClaude(args, {
    cwd,
    timeoutMs,
    onTick,
    tickIntervalMs,
    onStderr,
  });

  if (outputFormat !== "json" || !result.ok) {
    return { ...result, envelope: null };
  }

  // Parse the envelope. On parse failure, surface stdout as-is so
  // callers that don't need the metadata still work.
  try {
    const envelope = JSON.parse(result.stdout);
    return {
      ...result,
      stdout: envelope.result ?? result.stdout,
      envelope,
    };
  } catch {
    return { ...result, envelope: null };
  }
}
