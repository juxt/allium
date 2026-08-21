import { execFileSync } from "child_process";
import { mkdtempSync, mkdirSync, readFileSync, existsSync, rmSync } from "fs";
import path from "path";
import { tmpdir } from "os";

const hook = new URL("./loop-trace.mjs", import.meta.url).pathname;
let passed = 0;
let failed = 0;

function assert(name, cond) {
  if (cond) { console.log(`  pass: ${name}`); passed++; }
  else { console.log(`  FAIL: ${name}`); failed++; }
}

// Run the hook once (one event) with a synthetic payload and a project root.
function runHook(event, input, projectRoot) {
  try {
    execFileSync("node", [hook, event], {
      input: JSON.stringify(input),
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, CLAUDE_PROJECT_ROOT: projectRoot },
    });
  } catch {
    // the hook always exits 0; ignore
  }
}

function newProject({ withLoopDir }) {
  const dir = mkdtempSync(path.join(tmpdir(), "allium-timing-"));
  if (withLoopDir) mkdirSync(path.join(dir, ".allium-loop"));
  return dir;
}
function timings(dir) {
  const p = path.join(dir, ".allium-loop", "timings.jsonl");
  if (!existsSync(p)) return [];
  return readFileSync(p, "utf-8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

console.log("\n── loop-trace hook ──\n");

// 1. pre + post with a correlation id → one timing line, right agent, numeric duration.
{
  const dir = newProject({ withLoopDir: true });
  const payload = { tool_use_id: "abc", tool_name: "Task", tool_input: { subagent_type: "allium:weed" } };
  runHook("pre", payload, dir);
  runHook("post", payload, dir);
  const t = timings(dir);
  assert("records one timing for a paired pre/post", t.length === 1);
  assert("labels the timing with the subagent type", t[0]?.agent === "allium:weed");
  assert("duration is a non-negative number", typeof t[0]?.duration_ms === "number" && t[0].duration_ms >= 0);
  rmSync(dir, { recursive: true, force: true });
}

// 2. No .allium-loop dir → no-op, nothing written.
{
  const dir = newProject({ withLoopDir: false });
  const payload = { tool_use_id: "x", tool_name: "Task", tool_input: { subagent_type: "allium:weed" } };
  runHook("pre", payload, dir);
  runHook("post", payload, dir);
  assert("does nothing when no loop is active", !existsSync(path.join(dir, ".allium-loop", "timings.jsonl")));
  rmSync(dir, { recursive: true, force: true });
}

// 3. FIFO fallback when there is no correlation id: two calls pair in order.
{
  const dir = newProject({ withLoopDir: true });
  runHook("pre", { tool_name: "Task", tool_input: { subagent_type: "allium:distill" } }, dir);
  runHook("pre", { tool_name: "Task", tool_input: { subagent_type: "allium:propagate" } }, dir);
  runHook("post", { tool_name: "Task", tool_input: {} }, dir);
  runHook("post", { tool_name: "Task", tool_input: {} }, dir);
  const t = timings(dir);
  assert("pairs two unkeyed calls in FIFO order", t.length === 2 && t[0].agent === "allium:distill" && t[1].agent === "allium:propagate");
  rmSync(dir, { recursive: true, force: true });
}

// 4. A post with no matching pre writes nothing and does not crash.
{
  const dir = newProject({ withLoopDir: true });
  runHook("post", { tool_use_id: "orphan", tool_name: "Task", tool_input: { subagent_type: "allium:weed" } }, dir);
  assert("ignores an unpaired post", timings(dir).length === 0);
  rmSync(dir, { recursive: true, force: true });
}

// 5. Malformed stdin is swallowed (no crash, no output).
{
  const dir = newProject({ withLoopDir: true });
  try {
    execFileSync("node", [hook, "pre"], { input: "not json", encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, CLAUDE_PROJECT_ROOT: dir } });
    assert("survives malformed input", true);
  } catch {
    assert("survives malformed input", false);
  }
  rmSync(dir, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
