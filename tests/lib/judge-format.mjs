// Pretty-print a snapshot-judge verdict as a `judge:` headline plus
// per-change list. Returns a single string; the caller is responsible
// for emitting it (console.log, etc.).
//
// Plain mode (no TTY / NO_COLOR):
//
//   judge (21.9s): SEMANTIC — recommend investigate (4 changes)
//     • [semantic  ] Rule signatures changed …
//     • [structural] todo.owner removed from TodoAPI exposure
//
// Pretty mode (TTY): same shape, severity tags coloured —
// semantic in red+bold, structural in yellow, cosmetic in green.
//
// Options:
//   prefix     — prepended to every line (controls left-hand indent).
//   elapsedMs  — when set, rendered as ` (Ns)` after `judge`.
//   tag        — free-form parenthetical override (e.g. "cached").
//                Takes precedence over elapsedMs when both are given.

import {
  color,
  RED,
  YELLOW,
  GREEN,
  BOLD,
  enabled as styleEnabled,
} from "./style.mjs";

export function formatVerdict(verdict, { prefix = "", elapsedMs, tag } = {}) {
  const longest = Math.max(...verdict.changes.map((c) => c.severity.length));
  const sevTag = (sev) => {
    const text = `[${sev.padEnd(longest)}]`;
    if (!styleEnabled) return text;
    if (sev === "semantic") return color(text, RED, BOLD);
    if (sev === "structural") return color(text, YELLOW);
    return color(text, GREEN);
  };
  const overall = (sev) => {
    const upper = sev.toUpperCase();
    if (!styleEnabled) return upper;
    if (sev === "semantic") return color(upper, RED, BOLD);
    if (sev === "structural") return color(upper, YELLOW, BOLD);
    return color(upper, GREEN, BOLD);
  };
  const recommend = (r) => {
    if (!styleEnabled) return r;
    return color(r, r === "investigate" ? RED : GREEN);
  };
  const parenContent = tag ?? (elapsedMs != null ? formatMs(elapsedMs) : null);
  const paren = parenContent ? ` (${parenContent})` : "";
  const headline = `${overall(verdict.overallSeverity)} — recommend ${recommend(verdict.recommendation)} (${verdict.changes.length} change${verdict.changes.length === 1 ? "" : "s"})`;
  const lines = [`${prefix}judge${paren}: ${headline}`];
  for (const c of verdict.changes) {
    lines.push(`${prefix}  • ${sevTag(c.severity)} ${c.description}`);
  }
  return lines.join("\n");
}

function formatMs(ms) {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
