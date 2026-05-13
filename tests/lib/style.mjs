// Terminal styling helpers.
//
// Pretty output (colors + emoji glyphs) when stdout is a TTY and the
// user hasn't opted out. Plain ASCII otherwise. Three opt-out paths:
//
//   --plain        flag (anywhere in argv) — explicit user request
//   NO_COLOR=...   env var (https://no-color.org/) — universal convention
//   stdout not TTY (piping to a file, CI logs without a PTY)
//
// One opt-in path:
//   FORCE_COLOR=...  — keep colors even when stdout isn't a TTY (useful
//                      for CI providers that log ANSI faithfully).
//
// All scripts that print user-facing output should import the markers
// and helpers here rather than hard-coding ANSI escapes; that way one
// import enforces the policy.

const argv = process.argv;
const hasPlainFlag = argv.includes("--plain");
const hasNoColor = "NO_COLOR" in process.env && process.env.NO_COLOR !== "";
const hasForceColor =
  "FORCE_COLOR" in process.env && process.env.FORCE_COLOR !== "0";
const isTTY = Boolean(process.stdout.isTTY);

export const enabled =
  !hasPlainFlag && !hasNoColor && (isTTY || hasForceColor);

// Whether the parent process is attached to an interactive terminal —
// used by long-running runners to decide whether to update progress
// in-place (using \r) or print a fresh line per tick. Distinct from
// `enabled`: pretty colours can be force-enabled via FORCE_COLOR for
// CI log viewers, but we should NEVER do in-place updating in
// non-TTY contexts (the \r and ANSI clear codes would just be litter).
//
// Callers should ALSO suppress in-place updating when --verbose is
// active — verbose pairs claude --debug, which streams stderr lines
// throughout the run, and those lines would clobber any \r-based
// heartbeat.
export const interactive = isTTY && !hasPlainFlag;

function code(c) {
  return enabled ? `\x1b[${c}m` : "";
}

export const RESET = code("0");
export const BOLD = code("1");
export const DIM = code("2");
export const RED = code("31");
export const GREEN = code("32");
export const YELLOW = code("33");
export const BLUE = code("34");
export const MAGENTA = code("35");
export const CYAN = code("36");
export const GRAY = code("90");

// Wrap text in one or more ANSI codes, restoring at the end.
export function color(text, ...codes) {
  if (!enabled) return text;
  return codes.join("") + text + RESET;
}

// Status markers. In pretty mode, compact glyphs that read at a glance
// across long fixture lists. In plain mode, the original `pass:` /
// `FAIL:` words so log greppers and test-result parsers still work.
export const MARKERS = enabled
  ? {
      pass: color("✓", GREEN),
      fail: color("✗", RED, BOLD),
      skip: color("⊘", GRAY),
      drift: color("◆", YELLOW),
      sectionGlyph: "🌱 ",
      okGlyph: color("✓", GREEN, BOLD),
      failGlyph: color("✗", RED, BOLD),
    }
  : {
      pass: "pass:",
      fail: "FAIL:",
      skip: "skip:",
      drift: "drift:",
      sectionGlyph: "",
      okGlyph: "OK",
      failGlyph: "FAIL",
    };

// Heading line for a tier or group. Always reset at the end so a
// trailing newline doesn't carry styles forward.
export function heading(text) {
  return enabled
    ? `${MARKERS.sectionGlyph}${color(text, BOLD)}`
    : text;
}
