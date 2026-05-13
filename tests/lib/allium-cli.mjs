// Wrapper around the `allium` CLI. Returns { ok, stdout, stderr, code }
// uniformly so callers don't need to handle exec exceptions.

import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export async function isAvailable() {
  try {
    await execFileAsync("allium", ["--version"]);
    return true;
  } catch {
    return false;
  }
}

export async function check(filePath) {
  try {
    const { stdout, stderr } = await execFileAsync("allium", ["check", filePath]);
    return { ok: true, code: 0, stdout, stderr };
  } catch (e) {
    return {
      ok: false,
      code: typeof e.code === "number" ? e.code : 1,
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? String(e),
    };
  }
}
