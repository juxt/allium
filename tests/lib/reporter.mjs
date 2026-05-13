// Shared pass/fail/skip/drift reporter used by every tier runner.
//
// A reporter accumulates counters and prints one-line results. Each tier
// builds its own reporter, then passes the totals back via getCounters() so
// the orchestrator can sum them and exit non-zero on any failure.
//
// Counter semantics:
//   pass   — fixture/scenario worked as expected
//   fail   — fixture/scenario produced unexpected behaviour; suite should fail
//   skip   — fixture/scenario was not run (missing dep, --live not passed, etc.)
//   drift  — fixture is in tests/fixtures/language/drift.json: the language
//            reference says the construct should produce a specific
//            diagnostic, but the CLI does not yet emit it. Drift items
//            do not fail the suite — they document the spec/CLI gap so
//            it stays visible. Removing the drift entry once the CLI
//            catches up turns the fixture back into a regular pass.
//
// `quiet` suppresses per-fixture pass lines but never suppresses counter
// updates. Failures, skips and drift always print regardless of quiet.
//
// Each pass/fail/skip/drift call accepts an optional `elapsedMs` (the wall
// time the test took). When provided, the reporter appends a dim-coloured
// duration like "(123ms)" / "(2.3s)" / "(1m 5s)" after the test name.
// section() also starts a tier-level wall-clock timer; summarise() prints
// the elapsed tier time. Sums of per-test times are NOT used because tier1
// and tier2 run their tests in parallel, so the wall clock is shorter
// than the sum.
//
// Styling (colors + glyphs in TTY, plain words otherwise) lives in
// ./style.mjs. See that file for opt-out flags (--plain, NO_COLOR).

import {
  MARKERS,
  heading,
  color,
  GREEN,
  RED,
  YELLOW,
  GRAY,
  BOLD,
  DIM,
  enabled as styleEnabled,
} from "./style.mjs";

export function createReporter({ prefix = "  ", quiet = false } = {}) {
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  let drifted = 0;
  const failures = [];
  let sectionStartedAt = null;

  function durationSuffix(elapsedMs) {
    if (typeof elapsedMs !== "number" || !Number.isFinite(elapsedMs)) return "";
    return " " + color(`(${formatDuration(elapsedMs)})`, DIM);
  }

  return {
    pass(name, elapsedMs) {
      if (!quiet) {
        console.log(`${prefix}${MARKERS.pass} ${name}${durationSuffix(elapsedMs)}`);
      }
      passed++;
    },
    fail(name, detail, elapsedMs) {
      const detailText = detail ? ` ${color("—", DIM)} ${detail}` : "";
      console.log(
        `${prefix}${MARKERS.fail} ${name}${durationSuffix(elapsedMs)}${detailText}`
      );
      failures.push(detail ? `${name} — ${detail}` : name);
      failed++;
    },
    skip(name, reason, elapsedMs) {
      console.log(
        `${prefix}${MARKERS.skip} ${name}${durationSuffix(elapsedMs)} ${color(
          "—",
          DIM
        )} ${color(reason, DIM)}`
      );
      skipped++;
    },
    drift(name, reason, elapsedMs) {
      console.log(
        `${prefix}${MARKERS.drift} ${name}${durationSuffix(elapsedMs)} ${color(
          "—",
          DIM
        )} ${color(reason, DIM)}`
      );
      drifted++;
    },
    section(title) {
      console.log(`\n${heading(title)}`);
      sectionStartedAt = Date.now();
    },
    getCounters() {
      return {
        passed,
        failed,
        skipped,
        drifted,
        failures,
        elapsedMs: sectionStartedAt ? Date.now() - sectionStartedAt : null,
      };
    },
  };
}

export function summarise(label, counters) {
  const { passed, failed, skipped, drifted = 0, elapsedMs } = counters;
  const status = failed === 0 ? MARKERS.okGlyph : MARKERS.failGlyph;
  const parts = [
    `${color(passed, GREEN)} passed`,
    `${color(failed, failed === 0 ? GRAY : RED + BOLD)} failed`,
    `${color(skipped, GRAY)} skipped`,
  ];
  if (drifted > 0) parts.push(`${color(drifted, YELLOW)} drift`);
  const durationSegment =
    typeof elapsedMs === "number"
      ? ` ${color(`(${formatDuration(elapsedMs)})`, DIM)}`
      : "";
  if (styleEnabled) {
    console.log(
      `\n${heading(label)} ${status} ${color("—", DIM)} ${parts.join(
        ", "
      )}${durationSegment}`
    );
  } else {
    const plainStatus = failed === 0 ? "OK" : "FAIL";
    const driftSegment = drifted > 0 ? `, ${drifted} drift` : "";
    const plainDuration =
      typeof elapsedMs === "number" ? ` (${formatDuration(elapsedMs)})` : "";
    console.log(
      `\n${label}: ${plainStatus} — ${passed} passed, ${failed} failed, ${skipped} skipped${driftSegment}${plainDuration}`
    );
  }
}

// Humanise a duration for inline display.
//   <1000ms                  → "123ms"
//   1000ms ≤ x < 60s        → "12.3s"
//   ≥60s                    → "1m 5s"
export function formatDuration(ms) {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) {
    const s = ms / 1000;
    // One decimal under 10s; whole seconds otherwise.
    return s < 10 ? `${s.toFixed(1)}s` : `${Math.round(s)}s`;
  }
  const totalSec = Math.round(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return s === 0 ? `${m}m` : `${m}m ${s}s`;
}
