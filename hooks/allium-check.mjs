import { execFileSync } from "child_process";
import { realpathSync } from "fs";
import path from "path";

let data = "";
for await (const chunk of process.stdin) {
  data += chunk;
}

const input = JSON.parse(data);
const filePath = input.tool_input?.file_path;

if (!filePath || path.extname(filePath) !== ".allium") {
  process.exit(0);
}

let resolved;
try {
  resolved = realpathSync(filePath);
} catch {
  process.exit(0);
}

let projectRoot;
try {
  projectRoot = realpathSync(process.env.CLAUDE_PROJECT_ROOT ?? process.cwd());
} catch {
  process.exit(0);
}
if (!resolved.startsWith(projectRoot + path.sep)) {
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
