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

// Second workspace root for multi-root tests
const secondRoot = mkdtempSync(path.join(tmpdir(), "allium-hook-second-"));
const secondRootFile = path.join(secondRoot, "other.allium");
writeFileSync(secondRootFile, "-- allium: 3\n");
const secondRootInvalid = path.join(secondRoot, "broken.allium");
writeFileSync(secondRootInvalid, "this is not valid allium\n");

// Symlink inside the project pointing to a file outside it
const symlinkFile = path.join(projectRoot, "linked.allium");
symlinkSync(outsideFile, symlinkFile);

const claudeEnv = { CLAUDE_PROJECT_ROOT: projectRoot };

// --- Claude Code format: { tool_input: { file_path } } ---

console.log("Claude Code — early exit:");

assert(
  "missing file_path skipped",
  run({ tool_input: {} }, claudeEnv).status,
  0,
);

assert(
  "non-.allium extension skipped",
  run({ tool_input: { file_path: path.join(projectRoot, "readme.md") } }, claudeEnv).status,
  0,
);

assert(
  "non-existent .allium file skipped",
  run({ tool_input: { file_path: path.join(projectRoot, "ghost.allium") } }, claudeEnv).status,
  0,
);

console.log("\nClaude Code — path boundary:");

assert(
  "file outside project root rejected",
  run({ tool_input: { file_path: outsideFile } }, claudeEnv).status,
  0,
);

assert(
  "path traversal rejected",
  run({ tool_input: { file_path: path.join(projectRoot, "..", "etc", "passwd.allium") } }, claudeEnv).status,
  0,
);

assert(
  "prefix confusion rejected",
  run({ tool_input: { file_path: projectRoot + "other/file.allium" } }, claudeEnv).status,
  0,
);

assert(
  "symlink escaping project rejected",
  run({ tool_input: { file_path: symlinkFile } }, claudeEnv).status,
  0,
);

console.log("\nClaude Code — accepted:");

assert(
  "valid file at project root level",
  run({ tool_input: { file_path: validFile } }, claudeEnv).status,
  0,
);

assert(
  "valid file in nested subdirectory",
  run({ tool_input: { file_path: nestedFile } }, claudeEnv).status,
  0,
);

const invalidResult = run({ tool_input: { file_path: invalidFile } }, claudeEnv);
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

console.log("\nClaude Code — resilience:");

assert(
  "invalid CLAUDE_PROJECT_ROOT exits cleanly",
  run({ tool_input: { file_path: validFile } }, { CLAUDE_PROJECT_ROOT: "/nonexistent/path" }).status,
  0,
);

// --- Cursor format: { file_path, workspace_roots } ---

console.log("\nCursor — early exit:");

assert(
  "missing file_path skipped",
  run({ workspace_roots: [projectRoot] }).status,
  0,
);

assert(
  "non-.allium extension skipped",
  run({ file_path: path.join(projectRoot, "readme.md"), workspace_roots: [projectRoot] }).status,
  0,
);

assert(
  "non-existent .allium file skipped",
  run({ file_path: path.join(projectRoot, "ghost.allium"), workspace_roots: [projectRoot] }).status,
  0,
);

console.log("\nCursor — path boundary:");

assert(
  "file outside workspace roots rejected",
  run({ file_path: outsideFile, workspace_roots: [projectRoot] }).status,
  0,
);

assert(
  "symlink escaping workspace rejected",
  run({ file_path: symlinkFile, workspace_roots: [projectRoot] }).status,
  0,
);

console.log("\nCursor — accepted:");

assert(
  "valid file at workspace root level",
  run({ file_path: validFile, workspace_roots: [projectRoot] }).status,
  0,
);

assert(
  "valid file in nested subdirectory",
  run({ file_path: nestedFile, workspace_roots: [projectRoot] }).status,
  0,
);

const cursorInvalidResult = run({ file_path: invalidFile, workspace_roots: [projectRoot] });
assert(
  "invalid file reaches checker (exit 1)",
  cursorInvalidResult.status,
  1,
);

assert(
  "checker diagnostics forwarded to stderr",
  cursorInvalidResult.stderr.length > 0,
  true,
);

console.log("\nCursor — resilience:");

assert(
  "missing workspace_roots falls back to cwd",
  run({ file_path: validFile }).status,
  0,
);

assert(
  "empty workspace_roots falls back to cwd",
  run({ file_path: validFile, workspace_roots: [] }).status,
  0,
);

// --- Windsurf format: { tool_info: { file_path }, ... } ---
// Windsurf sends file_path inside tool_info. Working directory defaults to
// workspace root, so no workspace_roots equivalent — cwd is the fallback.

console.log("\nWindsurf — early exit:");

assert(
  "missing tool_info.file_path skipped",
  run({ tool_info: {} }).status,
  0,
);

assert(
  "non-.allium extension skipped",
  run({ tool_info: { file_path: path.join(projectRoot, "readme.md") } }, claudeEnv).status,
  0,
);

console.log("\nWindsurf — accepted:");

assert(
  "valid file via tool_info.file_path",
  run({ tool_info: { file_path: validFile } }, claudeEnv).status,
  0,
);

const windsurfInvalidResult = run({ tool_info: { file_path: invalidFile } }, claudeEnv);
assert(
  "invalid file via tool_info.file_path reaches checker",
  windsurfInvalidResult.status,
  1,
);

// --- Format precedence ---

console.log("\nFormat precedence:");

assert(
  "tool_input.file_path wins over top-level file_path",
  run({ tool_input: { file_path: invalidFile }, file_path: validFile, workspace_roots: [projectRoot] }, claudeEnv).status,
  1,
);

assert(
  "tool_input.file_path wins over tool_info.file_path",
  run({ tool_input: { file_path: invalidFile }, tool_info: { file_path: validFile } }, claudeEnv).status,
  1,
);

assert(
  "top-level file_path used when tool_input has no file_path",
  run({ tool_input: {}, file_path: invalidFile, workspace_roots: [projectRoot] }).status,
  1,
);

assert(
  "tool_info.file_path used when tool_input and file_path absent",
  run({ tool_info: { file_path: invalidFile } }, claudeEnv).status,
  1,
);

// --- Multiple workspace roots ---

console.log("\nMultiple workspace roots:");

assert(
  "file in first workspace root accepted",
  run({ file_path: validFile, workspace_roots: [projectRoot, secondRoot] }).status,
  0,
);

assert(
  "file in second workspace root accepted",
  run({ file_path: secondRootFile, workspace_roots: [projectRoot, secondRoot] }).status,
  0,
);

const secondRootInvalidResult = run({ file_path: secondRootInvalid, workspace_roots: [projectRoot, secondRoot] });
assert(
  "invalid file in second workspace root reaches checker",
  secondRootInvalidResult.status,
  1,
);

assert(
  "file outside all workspace roots rejected",
  run({ file_path: outsideFile, workspace_roots: [projectRoot, secondRoot] }).status,
  0,
);

// --- Root precedence ---
// Use invalid files so exit 1 = checker ran (accepted), exit 0 = rejected at boundary.

console.log("\nRoot precedence:");

assert(
  "file in CLAUDE_PROJECT_ROOT accepted even when workspace_roots points elsewhere",
  run({ file_path: invalidFile, workspace_roots: [outsideDir] }, claudeEnv).status,
  1,
);

assert(
  "file in workspace_roots but not CLAUDE_PROJECT_ROOT also accepted (multi-root)",
  run({ file_path: outsideFile, workspace_roots: [outsideDir] }, claudeEnv).status,
  0,
);

// outsideFile is valid allium, so exit 0 above could be acceptance + valid check.
// Use a dedicated invalid file outside the project root to distinguish.
const outsideInvalid = path.join(outsideDir, "outside-bad.allium");
writeFileSync(outsideInvalid, "this is not valid allium\n");

assert(
  "invalid file in workspace_roots reaches checker when CLAUDE_PROJECT_ROOT also set",
  run({ file_path: outsideInvalid, workspace_roots: [outsideDir] }, claudeEnv).status,
  1,
);

// --- Malformed input ---

console.log("\nMalformed input:");

function runRaw(rawStdin, env = {}) {
  try {
    execFileSync("node", [hook], {
      input: rawStdin,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...env },
    });
    return { status: 0, stderr: "" };
  } catch (e) {
    return { status: e.status, stderr: e.stderr || "" };
  }
}

assert(
  "invalid JSON exits cleanly",
  runRaw("{not json}", claudeEnv).status,
  0,
);

assert(
  "empty stdin exits cleanly",
  runRaw("", claudeEnv).status,
  0,
);

// --- Root prefix confusion ---

console.log("\nRoot prefix confusion:");

// Create /tmp/allium-hook-prefix- and /tmp/allium-hook-prefix-XYZ so one is a
// string prefix of the other (before the path separator).
const prefixBase = mkdtempSync(path.join(tmpdir(), "allium-hook-prefix-"));
const prefixExtended = mkdtempSync(path.join(tmpdir(), "allium-hook-prefix-"));
const prefixBaseFile = path.join(prefixBase, "a.allium");
writeFileSync(prefixBaseFile, "-- allium: 3\n");
const prefixExtendedFile = path.join(prefixExtended, "b.allium");
writeFileSync(prefixExtendedFile, "-- allium: 3\n");

assert(
  "file in root A not accepted under root B when A is a string prefix of B",
  run({ file_path: prefixBaseFile, workspace_roots: [prefixExtended] }).status,
  0,
);

assert(
  "file in root B not accepted under root A when A is a string prefix of B",
  run({ file_path: prefixExtendedFile, workspace_roots: [prefixBase] }).status,
  0,
);

assert(
  "both roots present, file in A accepted",
  run({ file_path: prefixBaseFile, workspace_roots: [prefixBase, prefixExtended] }).status,
  0,
);

assert(
  "both roots present, file in B accepted",
  run({ file_path: prefixExtendedFile, workspace_roots: [prefixBase, prefixExtended] }).status,
  0,
);

// --- Trailing slash on roots ---

console.log("\nTrailing slash on roots:");

assert(
  "workspace_root with trailing slash still accepts file",
  run({ file_path: validFile, workspace_roots: [projectRoot + "/"] }).status,
  0,
);

assert(
  "CLAUDE_PROJECT_ROOT with trailing slash still accepts file",
  run({ tool_input: { file_path: validFile } }, { CLAUDE_PROJECT_ROOT: projectRoot + "/" }).status,
  0,
);

assert(
  "workspace_root with trailing slash still rejects outside file",
  run({ file_path: outsideFile, workspace_roots: [projectRoot + "/"] }).status,
  0,
);

// --- Empty string CLAUDE_PROJECT_ROOT ---

console.log("\nEmpty CLAUDE_PROJECT_ROOT:");

assert(
  "empty string CLAUDE_PROJECT_ROOT falls back to workspace_roots",
  run({ file_path: validFile, workspace_roots: [projectRoot] }, { CLAUDE_PROJECT_ROOT: "" }).status,
  0,
);

assert(
  "empty string CLAUDE_PROJECT_ROOT without workspace_roots falls back to cwd",
  run({ file_path: validFile }, { CLAUDE_PROJECT_ROOT: "" }).status,
  0,
);

// --- All roots unresolvable ---

console.log("\nAll roots unresolvable:");

assert(
  "all workspace_roots invalid exits cleanly",
  run({ file_path: validFile, workspace_roots: ["/nonexistent/a", "/nonexistent/b"] }).status,
  0,
);

assert(
  "CLAUDE_PROJECT_ROOT and workspace_roots all invalid exits cleanly",
  run(
    { file_path: validFile, workspace_roots: ["/nonexistent/a"] },
    { CLAUDE_PROJECT_ROOT: "/nonexistent/b" },
  ).status,
  0,
);

// --- Symlinked workspace root ---

console.log("\nSymlinked workspace root:");

const symlinkRoot = path.join(outsideDir, "link-to-project");
symlinkSync(projectRoot, symlinkRoot);

assert(
  "file accepted when workspace_root is a symlink to the real root",
  run({ file_path: validFile, workspace_roots: [symlinkRoot] }).status,
  0,
);

assert(
  "file outside symlinked root still rejected",
  run({ file_path: outsideFile, workspace_roots: [symlinkRoot] }).status,
  0,
);

// --- Spaces and special characters in paths ---

console.log("\nSpecial characters in paths:");

const spacesDir = mkdtempSync(path.join(tmpdir(), "allium hook spaces-"));
const spacesFile = path.join(spacesDir, "my spec.allium");
writeFileSync(spacesFile, "-- allium: 3\n");
const spacesInvalid = path.join(spacesDir, "my broken spec.allium");
writeFileSync(spacesInvalid, "this is not valid allium\n");

assert(
  "file with spaces in path accepted",
  run({ file_path: spacesFile, workspace_roots: [spacesDir] }).status,
  0,
);

const spacesInvalidResult = run({ file_path: spacesInvalid, workspace_roots: [spacesDir] });
assert(
  "invalid file with spaces in path reaches checker",
  spacesInvalidResult.status,
  1,
);

const unicodeDir = mkdtempSync(path.join(tmpdir(), "allium-hök-ünïcödé-"));
const unicodeFile = path.join(unicodeDir, "spëc.allium");
writeFileSync(unicodeFile, "-- allium: 3\n");

assert(
  "file with unicode in path accepted",
  run({ file_path: unicodeFile, workspace_roots: [unicodeDir] }).status,
  0,
);

// --- Non-string file_path ---

console.log("\nNon-string file_path:");

assert(
  "numeric file_path exits cleanly",
  run({ file_path: 42, workspace_roots: [projectRoot] }).status,
  0,
);

assert(
  "boolean file_path exits cleanly",
  run({ file_path: true, workspace_roots: [projectRoot] }).status,
  0,
);

assert(
  "null file_path exits cleanly",
  run({ file_path: null, workspace_roots: [projectRoot] }).status,
  0,
);

assert(
  "array file_path exits cleanly",
  run({ file_path: [validFile], workspace_roots: [projectRoot] }).status,
  0,
);

assert(
  "numeric tool_input.file_path exits cleanly",
  run({ tool_input: { file_path: 99 } }, claudeEnv).status,
  0,
);

// --- Non-string workspace_roots entries ---

console.log("\nNon-string workspace_roots entries:");

assert(
  "numeric workspace_root skipped, valid root still works",
  run({ file_path: validFile, workspace_roots: [42, projectRoot] }).status,
  0,
);

assert(
  "null workspace_root skipped, valid root still works",
  run({ file_path: validFile, workspace_roots: [null, projectRoot] }).status,
  0,
);

assert(
  "all non-string workspace_roots exits cleanly",
  run({ file_path: validFile, workspace_roots: [42, true, null] }).status,
  0,
);

// --- workspace_roots not an array ---

console.log("\nworkspace_roots not an array:");

assert(
  "string workspace_roots exits cleanly",
  run({ file_path: validFile, workspace_roots: projectRoot }).status,
  0,
);

assert(
  "numeric workspace_roots exits cleanly",
  run({ file_path: validFile, workspace_roots: 42 }).status,
  0,
);

assert(
  "boolean workspace_roots exits cleanly",
  run({ file_path: validFile, workspace_roots: true }).status,
  0,
);

// --- Non-object tool_input ---

console.log("\nNon-object tool_input:");

assert(
  "string tool_input exits cleanly",
  run({ tool_input: "hello" }, claudeEnv).status,
  0,
);

assert(
  "numeric tool_input exits cleanly",
  run({ tool_input: 42 }, claudeEnv).status,
  0,
);

assert(
  "null tool_input exits cleanly",
  run({ tool_input: null }, claudeEnv).status,
  0,
);

// --- Empty string file_path ---

console.log("\nEmpty string file_path:");

assert(
  "empty string file_path exits cleanly",
  run({ file_path: "", workspace_roots: [projectRoot] }).status,
  0,
);

assert(
  "empty string tool_input.file_path exits cleanly",
  run({ tool_input: { file_path: "" } }, claudeEnv).status,
  0,
);

// --- file_path equals root directory ---

console.log("\nfile_path equals root:");

// Create a directory that ends in .allium so it passes the extension check
const rootAsFile = mkdtempSync(path.join(tmpdir(), "allium-hook-rootdir-"));
const alliumDir = path.join(rootAsFile, "specs.allium");
mkdirSync(alliumDir);

assert(
  "file_path that is a directory exits cleanly",
  run({ file_path: alliumDir, workspace_roots: [rootAsFile] }).status,
  0,
);

assert(
  "file_path equal to workspace root exits cleanly",
  run({ file_path: rootAsFile + path.sep + "test.allium", workspace_roots: [rootAsFile] }).status,
  0,
);

// Clean up
rmSync(projectRoot, { recursive: true });
rmSync(outsideDir, { recursive: true });
rmSync(secondRoot, { recursive: true });
rmSync(prefixBase, { recursive: true });
rmSync(prefixExtended, { recursive: true });
rmSync(spacesDir, { recursive: true });
rmSync(unicodeDir, { recursive: true });
rmSync(rootAsFile, { recursive: true });

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
