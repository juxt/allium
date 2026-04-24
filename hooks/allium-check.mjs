import { execFileSync } from "child_process";
import { realpathSync, statSync } from "fs";
import path from "path";

process.on("uncaughtException", () => process.exit(0));

let data = "";
for await (const chunk of process.stdin) {
  data += chunk;
}

let input;
try {
  input = JSON.parse(data);
} catch {
  process.exit(0);
}
// Claude Code sends { tool_input: { file_path } };
// Cursor sends { file_path, workspace_roots };
// Windsurf sends { tool_info: { file_path } }.
const filePath = input.tool_input?.file_path ?? input.file_path ?? input.tool_info?.file_path;

if (typeof filePath !== "string" || path.extname(filePath) !== ".allium") {
  process.exit(0);
}

let resolved;
try {
  resolved = realpathSync(filePath);
  if (!statSync(resolved).isFile()) process.exit(0);
} catch {
  process.exit(0);
}

// Claude Code sets CLAUDE_PROJECT_ROOT; Cursor provides workspace_roots in the payload.
const payloadRoots = Array.isArray(input.workspace_roots) ? input.workspace_roots : [];
const roots = [process.env.CLAUDE_PROJECT_ROOT, ...payloadRoots].filter(Boolean);
if (roots.length === 0) roots.push(process.cwd());

const resolvedRoots = [];
for (const r of roots) {
  try {
    resolvedRoots.push(realpathSync(r));
  } catch {
    // Skip unresolvable roots.
  }
}
if (!resolvedRoots.some((root) => resolved.startsWith(root + path.sep))) {
  process.exit(0);
}

try {
  execFileSync("allium", ["check", resolved], {
    encoding: "utf-8",
    stdio: "pipe",
  });
} catch (e) {
  if (e.code === "ENOENT") {
    process.exit(0);
  }
  // Write checker diagnostics to stderr — the hook framework
  // surfaces stderr to the model on non-zero exit.
  const output = (e.stderr || "") + (e.stdout || "");
  if (output) {
    process.stderr.write(output);
  }
  process.exit(1);
}
