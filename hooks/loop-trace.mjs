// Records real per-subagent-call timing into the Allium loop's trace.
//
// Registered twice in hooks.json, matched to the subagent tool:
//   PreToolUse  → node loop-trace.mjs pre    (stamp the call's start)
//   PostToolUse → node loop-trace.mjs post   (write duration on return)
//
// Timing has to be captured outside the model — a subagent call isn't a Bash
// call the model can wrap in `date`, and the model can't read its own latency.
// A hook fires on the tool events, so it can. It writes one line per call to
// .allium-loop/timings.jsonl; the loop folds those durations into its trace and
// report (driving-the-loop §13). The model's trajectory + routing telemetry is
// the cross-harness baseline; this hook is the deterministic timing layer where
// hooks run (Claude Code and other editors that honour them).
//
// It only records while a loop is active (a .allium-loop/ dir exists), never
// blocks a call (always exits 0), and swallows its own errors.

import {
  existsSync,
  readFileSync,
  writeFileSync,
  appendFileSync,
  realpathSync,
} from "fs";
import path from "path";

process.on("uncaughtException", () => process.exit(0));

const event = process.argv[2]; // "pre" | "post"
if (event !== "pre" && event !== "post") process.exit(0);

let data = "";
for await (const chunk of process.stdin) data += chunk;

let input;
try {
  input = JSON.parse(data);
} catch {
  process.exit(0);
}

// The subagent's type is the useful label ("allium:weed"). Field placement
// varies by harness, so look in the likely spots; fall back to the tool name.
const toolInput = input.tool_input ?? input.tool_info ?? {};
const agent =
  toolInput.subagent_type ??
  toolInput.subagentType ??
  toolInput.agent ??
  input.tool_name ??
  input.tool ??
  "subagent";

// A correlation id pairs a pre with its post. If the harness doesn't provide
// one, fall back to FIFO, which is correct for the sequential phase calls the
// loop makes (a documented limitation under parallel calls).
const corrId =
  input.tool_use_id ?? input.toolUseId ?? toolInput.id ?? null;

// Resolve the project root the same way the allium-check hook does.
const payloadRoots = Array.isArray(input.workspace_roots) ? input.workspace_roots : [];
const roots = [process.env.CLAUDE_PROJECT_ROOT, ...payloadRoots].filter(Boolean);
if (roots.length === 0) roots.push(process.cwd());

let projectRoot = null;
for (const r of roots) {
  try {
    projectRoot = realpathSync(r);
    break;
  } catch {
    // try the next root
  }
}
if (!projectRoot) process.exit(0);

// Only trace while a loop is running; otherwise this is an unrelated subagent.
const loopDir = path.join(projectRoot, ".allium-loop");
if (!existsSync(loopDir)) process.exit(0);

const pendingPath = path.join(loopDir, ".timing-pending.json");
const timingsPath = path.join(loopDir, "timings.jsonl");
const now = Date.now();

function readPending() {
  try {
    const p = JSON.parse(readFileSync(pendingPath, "utf-8"));
    return { byId: p.byId ?? {}, fifo: Array.isArray(p.fifo) ? p.fifo : [] };
  } catch {
    return { byId: {}, fifo: [] };
  }
}
function writePending(p) {
  try {
    writeFileSync(pendingPath, JSON.stringify(p));
  } catch {
    // best-effort
  }
}

if (event === "pre") {
  const p = readPending();
  if (corrId) p.byId[corrId] = { start: now, agent };
  else p.fifo.push({ start: now, agent });
  writePending(p);
  process.exit(0);
}

// event === "post"
const p = readPending();
let rec = null;
if (corrId && p.byId[corrId]) {
  rec = p.byId[corrId];
  delete p.byId[corrId];
} else if (p.fifo.length > 0) {
  rec = p.fifo.shift();
}
writePending(p);

if (rec) {
  const line =
    JSON.stringify({
      ts: new Date(now).toISOString(),
      agent: rec.agent,
      duration_ms: now - rec.start,
    }) + "\n";
  try {
    appendFileSync(timingsPath, line);
  } catch {
    // best-effort
  }
}
process.exit(0);
