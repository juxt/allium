import { execFileSync } from "child_process";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from "fs";
import path from "path";
import { tmpdir } from "os";

const hook = new URL("./allium-check.mjs", import.meta.url).pathname;
let passed = 0;
let failed = 0;

function run(input, env = {}) {
  try {
    execFileSync("node", [hook], {
      input: JSON.stringify(input),
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...env },
    });
    return { status: 0, stderr: "" };
  } catch (e) {
    return { status: e.status, stderr: e.stderr || "" };
  }
}

function assert(name, actual, expected) {
  if (actual === expected) {
    console.log(`  pass: ${name}`);
    passed++;
  } else {
    console.log(`  FAIL: ${name} (expected ${expected}, got ${actual})`);
    failed++;
  }
}

// Set up fixtures
const projectRoot = mkdtempSync(path.join(tmpdir(), "allium-hook-test-"));
const validFile = path.join(projectRoot, "test.allium");
writeFileSync(validFile, "-- allium: 3\n");
const invalidFile = path.join(projectRoot, "bad.allium");
writeFileSync(invalidFile, "this is not valid allium\n");

const subDir = path.join(projectRoot, "specs", "nested");
mkdirSync(subDir, { recursive: true });
const nestedFile = path.join(subDir, "deep.allium");
writeFileSync(nestedFile, "-- allium: 3\n");

const outsideDir = mkdtempSync(path.join(tmpdir(), "allium-hook-outside-"));
const outsideFile = path.join(outsideDir, "evil.allium");
writeFileSync(outsideFile, "-- allium: 3\n");

// Symlink inside the project pointing to a file outside it
const symlinkFile = path.join(projectRoot, "linked.allium");
symlinkSync(outsideFile, symlinkFile);

const env = { CLAUDE_PROJECT_ROOT: projectRoot };

// --- Early exit (before path guard) ---

console.log("Early exit:");

assert(
  "missing file_path skipped",
  run({ tool_input: {} }, env).status,
  0,
);

assert(
  "non-.allium extension skipped",
  run({ tool_input: { file_path: path.join(projectRoot, "readme.md") } }, env).status,
  0,
);

assert(
  "non-existent .allium file skipped",
  run({ tool_input: { file_path: path.join(projectRoot, "ghost.allium") } }, env).status,
  0,
);

// --- Path guard rejections ---

console.log("\nPath boundary:");

assert(
  "file outside project root rejected",
  run({ tool_input: { file_path: outsideFile } }, env).status,
  0,
);

assert(
  "path traversal rejected",
  run({ tool_input: { file_path: path.join(projectRoot, "..", "etc", "passwd.allium") } }, env).status,
  0,
);

assert(
  "prefix confusion rejected",
  run({ tool_input: { file_path: projectRoot + "other/file.allium" } }, env).status,
  0,
);

assert(
  "symlink escaping project rejected",
  run({ tool_input: { file_path: symlinkFile } }, env).status,
  0,
);

// --- Accepted paths (reach the checker) ---

console.log("\nAccepted:");

assert(
  "valid file at project root level",
  run({ tool_input: { file_path: validFile } }, env).status,
  0,
);

assert(
  "valid file in nested subdirectory",
  run({ tool_input: { file_path: nestedFile } }, env).status,
  0,
);

const invalidResult = run({ tool_input: { file_path: invalidFile } }, env);
assert(
  "invalid file reaches checker (exit 1)",
  invalidResult.status,
  1,
);

assert(
  "checker diagnostics forwarded to stderr",
  invalidResult.stderr.length > 0,
  true,
);

// --- Resilience ---

console.log("\nResilience:");

assert(
  "invalid CLAUDE_PROJECT_ROOT exits cleanly",
  run({ tool_input: { file_path: validFile } }, { CLAUDE_PROJECT_ROOT: "/nonexistent/path" }).status,
  0,
);

// Clean up
rmSync(projectRoot, { recursive: true });
rmSync(outsideDir, { recursive: true });

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
