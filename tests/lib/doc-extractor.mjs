// Extract Allium fenced code blocks from a markdown file.
//
// A block is recognised when either:
//   1. the fence has an `allium` info-string (```allium), OR
//   2. the fence has no info-string AND the first non-blank line of the
//      block matches /^-- allium:/.
//
// Each recognised block carries optional metadata from an HTML-comment
// annotation that immediately precedes the opening fence (allowing one
// blank line). Three annotation forms are supported:
//
//   <!-- allium-test: skip reason="..." -->
//   <!-- allium-test: expect-error pattern="..." -->
//   <!-- allium-test: wrap template="..." -->
//
// Annotation order is `<!-- allium-test: <kind> key="value" key="value" -->`.
// Unrecognised annotations are ignored with a warning at extraction time;
// the runner can decide whether to fail or skip them.

import { readFileSync, existsSync } from "fs";
import { createHash } from "crypto";
import path from "path";

// ---------------------------------------------------------------------------
// Overrides
//
// tests/fixtures/docs/overrides.json holds annotations for blocks whose
// markdown source we can't or don't want to edit (third-party docs, large
// canonical references where in-line HTML comments would be visually
// noisy). Format:
//
//   {
//     "skills/path/to/file.md": {
//       "<starting-line>": { "kind": "skip", "reason": "..." }
//     }
//   }
//
// The line number is the line of the opening fence, 1-indexed, matching
// the `line` field on extracted blocks. Override beats in-line annotation.
// ---------------------------------------------------------------------------

let _overridesCache = null;

export function loadOverrides(repoRoot) {
  if (_overridesCache) return _overridesCache;
  const overridePath = path.join(
    repoRoot,
    "tests",
    "fixtures",
    "docs",
    "overrides.json"
  );
  if (!existsSync(overridePath)) {
    _overridesCache = {};
    return _overridesCache;
  }
  _overridesCache = JSON.parse(readFileSync(overridePath, "utf-8"));
  return _overridesCache;
}

function lookupOverride(overrides, repoRoot, filePath, line) {
  const rel = path.relative(repoRoot, filePath);
  const fileOverrides = overrides[rel];
  if (!fileOverrides) return null;
  const entry = fileOverrides[String(line)];
  if (!entry) return null;
  const { kind, ...attrs } = entry;
  return { kind, attrs };
}

const FENCE_RE = /^```(\S*)\s*$/;
const ANNOTATION_RE = /^\s*<!--\s*allium-test:\s*(\w+(?:-\w+)*)\s*(.*?)\s*-->\s*$/;
const ATTR_RE = /(\w+)="([^"]*)"/g;

export function extractFromFile(filePath, { repoRoot } = {}) {
  const src = readFileSync(filePath, "utf-8");
  const lines = src.split("\n");
  const blocks = [];
  const overrides = repoRoot ? loadOverrides(repoRoot) : {};
  let i = 0;

  while (i < lines.length) {
    const fenceMatch = lines[i].match(FENCE_RE);
    if (!fenceMatch) {
      i++;
      continue;
    }

    const openLine = i;
    const infoString = fenceMatch[1];
    const closeLine = findClosingFence(lines, i + 1);
    if (closeLine === -1) {
      // unclosed fence — skip rest of file
      break;
    }

    const body = lines.slice(i + 1, closeLine).join("\n");
    if (isAllium(infoString, body)) {
      const inline = findAnnotation(lines, openLine);
      const override = repoRoot
        ? lookupOverride(overrides, repoRoot, filePath, openLine + 1)
        : null;
      blocks.push({
        file: filePath,
        line: openLine + 1, // 1-indexed for human reporting
        body,
        infoString,
        hasVersionMarker: /^\s*-- allium:/m.test(body),
        annotation: override ?? inline,
        annotationSource: override ? "override" : inline ? "inline" : null,
        sha1: sha1(body),
      });
    }
    i = closeLine + 1;
  }

  return blocks;
}

function findClosingFence(lines, start) {
  for (let i = start; i < lines.length; i++) {
    if (/^```\s*$/.test(lines[i])) return i;
  }
  return -1;
}

function isAllium(infoString, body) {
  if (infoString === "allium") return true;
  if (infoString !== "") return false;
  // no info-string: only treat as Allium if a version marker is present
  return /^-- allium:/m.test(stripLeadingBlank(body));
}

function stripLeadingBlank(body) {
  return body.replace(/^\s*\n+/, "");
}

function findAnnotation(lines, openLine) {
  // Allow one blank line between annotation and opening fence
  for (let offset = 1; offset <= 2; offset++) {
    const idx = openLine - offset;
    if (idx < 0) return null;
    const line = lines[idx];
    if (line.trim() === "") continue;
    const m = line.match(ANNOTATION_RE);
    return m ? parseAnnotation(m[1], m[2]) : null;
  }
  return null;
}

function parseAnnotation(kind, attrSrc) {
  const attrs = {};
  let m;
  ATTR_RE.lastIndex = 0;
  while ((m = ATTR_RE.exec(attrSrc)) !== null) {
    attrs[m[1]] = m[2];
  }
  return { kind, attrs };
}

function sha1(s) {
  return createHash("sha1").update(s).digest("hex").slice(0, 12);
}
