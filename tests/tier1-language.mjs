// Tier 1 — Language fixtures
//
// Walks tests/fixtures/language/, runs `allium check` against each .allium
// fixture in parallel, and asserts:
//
//   - valid/    files exit 0
//   - invalid/  files exit non-zero
//   - invalid/  files match every regex in their .expected sidecar
//
// Drift handling: fixtures listed in tests/fixtures/language/drift.json
// document a gap between the language reference and the CLI. The runner
// skips the regular invalid-check for these and emits a 'drift:' line
// instead, so the suite stays green while the gap stays visible. If
// the CLI ever starts emitting the expected diagnostic (the drift
// entry's expected_patterns now match), the runner FAILs the fixture
// to prompt removal of the stale drift entry.
//
// Usage:
//   node tests/tier1-language.mjs              # all fixtures
//   node tests/tier1-language.mjs entities     # filter by category
//   node tests/tier1-language.mjs --quiet      # suppress per-fixture pass lines

import path from "path";
import { fileURLToPath } from "url";
import { walk } from "./lib/fixture-walker.mjs";
import { check, isAvailable } from "./lib/allium-cli.mjs";
import { createReporter, summarise } from "./lib/reporter.mjs";
import { printBanner } from "./lib/banner.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);
const FIXTURES = path.join(HERE, "fixtures", "language");

export async function run({ filters = [], quiet = false } = {}) {
  const reporter = createReporter({ quiet });
  reporter.section("Tier 1 — language fixtures");

  if (!(await isAvailable())) {
    reporter.skip("tier1", "`allium` CLI not on PATH");
    return reporter.getCounters();
  }

  const fixtures = walk(FIXTURES).filter((f) => matches(f, filters));
  if (fixtures.length === 0) {
    reporter.skip("tier1", `no fixtures matched ${JSON.stringify(filters)}`);
    return reporter.getCounters();
  }

  await Promise.all(
    fixtures.map((fixture) => verify(fixture, reporter))
  );

  return reporter.getCounters();
}

function matches(fixture, filters) {
  if (filters.length === 0) return true;
  return filters.some(
    (f) =>
      f === fixture.category ||
      f === fixture.expectation ||
      f === fixture.version
  );
}

async function verify(fixture, reporter) {
  const name = path.relative(ROOT, fixture.path);
  const startedAt = Date.now();
  const result = await check(fixture.path);
  const elapsed = Date.now() - startedAt;
  const haystack = `${result.stdout}\n${result.stderr}`;

  // Drift handling first: if a fixture is in drift.json, the runner
  // accepts the actual CLI behaviour (which disagrees with the spec)
  // and emits a 'drift:' line. If the CLI ever starts producing the
  // diagnostic the .expected sidecar describes, the drift entry is
  // stale and the fixture FAILs to prompt its removal.
  if (fixture.drift) {
    const allPatternsMatch =
      fixture.expectedPatterns.length > 0 &&
      fixture.expectedPatterns.every((p) => p.test(haystack));
    if (allPatternsMatch && !result.ok) {
      reporter.fail(
        name,
        `drift entry is stale: CLI now emits the expected diagnostic — remove this fixture's entry from drift.json`,
        elapsed
      );
      return;
    }
    reporter.drift(
      name,
      `${fixture.drift.spec_says ?? "spec/CLI gap"} — CLI: ${
        fixture.drift.cli_does ?? "different behaviour"
      }`,
      elapsed
    );
    return;
  }

  if (fixture.expectation === "valid") {
    if (result.ok) {
      reporter.pass(name, elapsed);
    } else {
      reporter.fail(
        name,
        `expected pass, got exit ${result.code}: ${oneLine(result.stderr)}`,
        elapsed
      );
    }
    return;
  }

  // expectation === "invalid"
  if (result.ok) {
    reporter.fail(name, "expected failure, got exit 0", elapsed);
    return;
  }

  for (const pattern of fixture.expectedPatterns) {
    if (!pattern.test(haystack)) {
      reporter.fail(
        name,
        `expected pattern ${pattern} not found in CLI output`,
        elapsed
      );
      return;
    }
  }

  reporter.pass(name, elapsed);
}

function oneLine(s) {
  return (s ?? "").split("\n").filter(Boolean).join(" | ").slice(0, 200);
}

// CLI entry — only runs when invoked directly, not when imported.
if (import.meta.url === `file://${process.argv[1]}`) {
  printBanner();
  const filters = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const quiet = process.argv.includes("--quiet");
  const counters = await run({ filters, quiet });
  summarise("Tier 1", counters);
  process.exit(counters.failed === 0 ? 0 : 1);
}
