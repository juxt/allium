// One-shot startup banner showing the tool versions the suite will
// exercise. Printed once per process, regardless of how many entry
// points call `printBanner()` (the orchestrator AND any directly-run
// tier runner both call it; only the first call prints).
//
// Output (pretty mode):
//   🌱 Allium test suite
//      allium 3.2.3 (language versions: 1, 2, 3)
//
// Output (plain mode):
//   Allium test suite
//      allium 3.2.3 (language versions: 1, 2, 3)
//
// When `allium` is not on PATH, the banner says so but does not error —
// individual tiers will skip cleanly when they need the CLI.

import { execFileSync } from "child_process";
import { heading, color, GRAY } from "./style.mjs";

let _printed = false;

export function printBanner() {
  if (_printed) return;
  _printed = true;

  let alliumVersion = "not installed";
  try {
    alliumVersion = execFileSync("allium", ["--version"], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    // Stays as "not installed".
  }

  console.log(`\n${heading("Allium test suite")}`);
  console.log(color(`   ${alliumVersion}`, GRAY));
}
