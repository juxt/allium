import { execFileSync } from "child_process";
import { extname } from "path";

let data = "";
for await (const chunk of process.stdin) {
  data += chunk;
}

const input = JSON.parse(data);
const filePath = input.tool_input?.file_path;

if (!filePath || extname(filePath) !== ".allium") {
  process.exit(0);
}

try {
  execFileSync("allium", ["check", filePath], {
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
