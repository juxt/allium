// Tier 2 — Doc-example validation
//
// Walk skills/**/*.md, extract every Allium fenced block, and run
// `allium check` against each. A block is recognised when it has a
// `allium` info-string OR a `-- allium:` version marker on the first
// non-blank line. Blocks without the marker AND without the info-string
// are not Allium and are ignored.
//
// Per-block annotations (in an HTML comment immediately above the fence)
// override the default behaviour:
//
//   <!-- allium-test: skip          reason="..." -->
//   <!-- allium-test: expect-error  pattern="..." -->
//   <!-- allium-test: wrap          template="..." -->  (planned)
//
// Default for an unannotated, version-marked block: must `allium check`
// clean (exit 0). Default for an unannotated, info-string-only block
// (fragment): skip with a "no version marker, no wrap" reason — extend
// later by authoring wrapper templates under
// tests/fixtures/docs/wrappers/.
//
// Identical bodies (same sha1) are deduped. The reporter shows
// "N unique blocks across M occurrences".

import { readdirSync, statSync, mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { fileURLToPath } from "url";

import { extractFromFile } from "./lib/doc-extractor.mjs";
import { check, isAvailable } from "./lib/allium-cli.mjs";
import { createReporter, summarise } from "./lib/reporter.mjs";
import { printBanner } from "./lib/banner.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);
const SKILLS = path.join(ROOT, "skills");

export async function run({ filters = [], quiet = false } = {}) {
  const reporter = createReporter();
  reporter.section("Tier 2 — doc examples");

  if (!(await isAvailable())) {
    reporter.skip("tier2", "`allium` CLI not on PATH");
    return reporter.getCounters();
  }

  const mdFiles = walkMarkdown(SKILLS).filter((p) =>
    matchesFilter(p, filters)
  );

  const allBlocks = mdFiles.flatMap((f) =>
    extractFromFile(f, { repoRoot: ROOT })
  );
  const dedup = dedupeBySha(allBlocks);

  if (dedup.unique.length === 0) {
    reporter.skip("tier2", "no Allium blocks discovered");
    return reporter.getCounters();
  }

  const tmp = mkdtempSync(path.join(tmpdir(), "allium-tier2-"));
  try {
    await Promise.all(
      dedup.unique.map((block) => verify(block, tmp, reporter, quiet))
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }

  console.log(
    `  ${dedup.unique.length} unique blocks across ${allBlocks.length} occurrences`
  );

  return reporter.getCounters();
}

function walkMarkdown(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = path.join(dir, entry);
    const s = statSync(p);
    if (s.isDirectory()) {
      out.push(...walkMarkdown(p));
    } else if (entry.endsWith(".md")) {
      out.push(p);
    }
  }
  return out;
}

function matchesFilter(filePath, filters) {
  if (filters.length === 0) return true;
  const rel = path.relative(ROOT, filePath);
  return filters.some((f) => rel.includes(f));
}

function dedupeBySha(blocks) {
  const seen = new Map();
  for (const b of blocks) {
    if (!seen.has(b.sha1)) seen.set(b.sha1, b);
  }
  return { unique: [...seen.values()], all: blocks };
}

async function verify(block, tmpDir, reporter, quiet) {
  const id = `${path.relative(ROOT, block.file)}:${block.line}`;
  const annotation = block.annotation;

  if (annotation?.kind === "skip") {
    if (!quiet)
      reporter.skip(id, annotation.attrs.reason ?? "annotation: skip");
    return;
  }

  // Fragments without a version marker are not validatable on their own.
  // Skip until a wrap template is wired up.
  if (!block.hasVersionMarker && annotation?.kind !== "wrap") {
    if (!quiet)
      reporter.skip(id, "fragment without version marker; no wrap configured");
    return;
  }

  if (annotation?.kind === "wrap") {
    // Reserved for future use. Until wrap templates exist, surface as a
    // failure so the author knows the annotation is unimplemented.
    reporter.fail(id, "wrap annotation not yet implemented");
    return;
  }

  const file = path.join(tmpDir, `${block.sha1}.allium`);
  writeFileSync(file, block.body);
  const startedAt = Date.now();
  const result = await check(file);
  const elapsed = Date.now() - startedAt;

  if (annotation?.kind === "expect-error") {
    if (result.ok) {
      reporter.fail(id, "annotated expect-error but allium check passed", elapsed);
      return;
    }
    const pattern = new RegExp(annotation.attrs.pattern ?? ".");
    const haystack = `${result.stdout}\n${result.stderr}`;
    if (!pattern.test(haystack)) {
      reporter.fail(
        id,
        `expect-error annotation pattern ${pattern} not found in CLI output`,
        elapsed
      );
      return;
    }
    if (!quiet) reporter.pass(id, elapsed);
    return;
  }

  // Default: must check clean.
  if (result.ok) {
    if (!quiet) reporter.pass(id, elapsed);
  } else {
    reporter.fail(
      id,
      `expected clean check; got exit ${result.code}: ${oneLine(
        result.stdout
      )}`,
      elapsed
    );
  }
}

function oneLine(s) {
  return (s ?? "").split("\n").filter(Boolean).join(" | ").slice(0, 240);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  printBanner();
  const filters = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const quiet = process.argv.includes("--quiet");
  const counters = await run({ filters, quiet });
  summarise("Tier 2", counters);
  process.exit(counters.failed === 0 ? 0 : 1);
}
