---
name: impact
description: "Build and query the repository impact map — a bidirectional graph linking Allium spec constructs to implementation code symbols. Use when the user wants to build or refresh the impact map, ask which code implements a spec entity or rule, ask which spec constructs cover a given symbol, or trace the blast radius of a proposed code change. Python is supported today; extensible to any language with an LSP via an adapter file."
---

# Impact

You build and query the repository impact map. The map is a bidirectional graph linking Allium spec constructs (entities, rules, triggers, surfaces) to implementation code symbols (functions, classes, methods). Other Allium skills read the map to avoid re-discovering spec↔code correspondences on every invocation.

You are narrow and mechanical. You do not write specs, you do not write implementation code, and you do not judge divergences. Your only side effect is writing JSON under `.allium/impact/` in the target project.

## Startup

1. Read [language reference](../../references/language-reference.md) for the Allium syntax.
2. Read [impact map reference](../../references/impact-map.md) for the schema and integration contract.
3. Locate the `.allium` files for the spec(s) being mapped.
4. Detect target language(s) from the project's fingerprint files (see §Adapters). Load the matching adapter(s) from `skills/impact/adapters/`. If no adapter matches, exit degraded (see §Degraded exit).
5. Verify the LSP tool is available for each chosen language. Call `workspaceSymbol` with a sentinel query (the adapter supplies one). If the LSP is not responding, exit degraded.
6. If the `allium` CLI is available, run `allium plan <spec>` and `allium model <spec>` to seed the spec-side nodes. Fall back to reading the `.allium` file directly.

### Degraded exit

The impact map is an optimisation, not a prerequisite. If you cannot produce a map — no adapter matches, the required LSP plugin is missing, LSP is installed but not indexing — do not refuse the invocation outright. Instead:

1. Do not write or modify any `.allium/impact/<spec>.json`.
2. Print a short, actionable message naming the exact cause (which fingerprints were checked, which LSP plugin to install).
3. Return a summary with `degraded: true` and a `reason` tag (`no-adapter`, `lsp-unavailable`, `lsp-not-indexing`).

The callers (weed, distill, propagate, tend) treat a degraded response as "no map available" and fall back to manual correlation. They must not hard-fail on your behalf.

## Modes

You operate in one of three modes, determined by the caller's request:

**Build.** Run the pipeline end-to-end for one or more spec files. Overwrite `.allium/impact/<spec>.json`. Emit a summary: node counts, link counts, count of `unmapped.spec`, count of `unmapped.code`, count of low-confidence links. Do not try to resolve unmapped nodes by guessing.

**Query.** Answer a targeted question against the existing map without rebuilding. Typical queries:
- "What code implements `Candidacy`?" → lookup `links` with `from: spec:Candidacy`.
- "What spec constructs reference `create_candidacy`?" → lookup `links` with `to: code:...create_candidacy`.
- "Which rules fan out from `ScheduleInterview`?" → walk `call_edges` from the mapped code node.
- "What breaks if I edit `src/foo/bar.py:42`?" → find code nodes at or containing that line, report their linked spec nodes and transitive callers.

If the map file does not exist, tell the caller to run Build first. Do not auto-build.

**Refresh.** Rebuild only the links whose target files have changed since the map's `commit` field (compare to `git log`), plus any links marked low-confidence. Do not touch high-confidence links pointing at unchanged files. Output the same summary as Build, plus the count of links refreshed vs skipped.

If no mode is specified, default to **Build** and warn the caller that refresh would be cheaper if a map already exists.

## How you work

### The pipeline (Build and Refresh)

Every step below uses only the built-in LSP tool and language-neutral Allium constructs. Per-language knowledge lives in the adapter. Ask the adapter at the marked steps; do not hardcode language specifics in this skill.

1. **Seed spec nodes.** From `allium plan` / `allium model` output (or direct `.allium` parse), list every entity, rule, trigger, surface, contract and invariant. Each becomes a `spec:<name>` node with `file` and `line` from the spec.

2. **Generate name variants.** For each spec node, ask the **adapter** for the identifier variants a programmer would likely choose in the target language. Do not invent variants — rely on the adapter's rules.

3. **Find candidate code symbols.** For each variant, call LSP `workspaceSymbol`. Collect candidates. Exclude test files per the adapter's project-root and test-directory rules.

4. **Confirm candidates.** For each candidate, call LSP `hover` and `documentSymbol`. Use the adapter's confidence heuristic to decide:
   - *Exact.* Single match, docstring/type/signature lines up → record a high-confidence link with `via: "name-match+hover"`.
   - *Ambiguous.* Multiple plausible matches → record each with `via: "name-match+ambiguous"` and mark low-confidence.
   - *None.* No candidate survives → add the spec node to `unmapped.spec`. Do not force a match.

5. **Expand the code-side graph.** For each confirmed code node, call `prepareCallHierarchy`, then `incomingCalls` and `outgoingCalls`. Record each edge in `call_edges`. Stop expanding at the project boundary defined by the adapter (same `pyproject.toml`, same `go.mod`, etc.). Stop at depth 2 by default; the adapter may override.

6. **Map surfaces.** For each spec `surface` block, ask the adapter for framework entry-point patterns (Python: `@app.route`, `@router.post`, `APIRouter` etc.; Go: `http.HandleFunc` etc.). Resolve them via `workspaceSymbol` and `findReferences`. Link surfaces to their entry points.

7. **Collect unmapped code.** Walk the project's source files per the adapter's globs. For each top-level symbol not referenced by any confirmed link or `call_edges` node, record the symbol in `unmapped.code`. This is the honest bit — `weed` reads it to find behaviour the spec is silent about.

8. **Emit JSON.** Write `.allium/impact/<spec>.json` atomically. On first build, also write `.allium/impact/.gitignore` with `*` so the cache never enters version control. Print the summary described in §Modes.

### Disambiguation

When `workspaceSymbol` returns multiple candidates for a spec name, never silently drop any of them:
- If the adapter's confidence heuristic picks one decisively, record the winner with high confidence and the losers under a `rejected_candidates` field on the link for debugging.
- If the heuristic is indecisive, record every surviving candidate as a separate link with low confidence. `weed` and `propagate` know how to read these.

### Honesty about unmapped

The `unmapped` section is load-bearing. `weed` uses `unmapped.spec` to find spec constructs that have no implementation and `unmapped.code` to find implementation behaviour the spec does not describe. If you suppress unmapped entries to make the summary look cleaner, you are actively hiding divergences. Do not do that.

## Adapters

Adapters are short Markdown files under `skills/impact/adapters/`. Each defines the five pieces of language-specific knowledge the pipeline needs. See [adapters/README.md](./adapters/README.md) for the authoring contract.

### Language selection

On startup, detect the target language by fingerprint:

| Fingerprint | Adapter |
|---|---|
| `pyproject.toml`, `setup.py`, `setup.cfg`, or `**/*.py` files | [python.md](./adapters/python.md) |

A spec may also declare its target language explicitly via a `language:` field on its `use` declarations or the caller may pass `--language <name>`. Explicit selection overrides auto-detection.

If a project mixes languages (e.g. a Python service with a TypeScript frontend), load every adapter whose fingerprint matches and run the pipeline once per language. Merge the results into a single map keyed by language.

### Currently supported

- **Python** — pyright-lsp. Covers Flask/FastAPI/Django surfaces, PascalCase classes, snake_case functions, `create_X`/`X_service`/`X_repository` patterns. `pyproject.toml` or `setup.py` defines the project root.

### Adding a language

Create `skills/impact/adapters/<lang>.md` following [adapters/README.md](./adapters/README.md). Add its fingerprint row to the table above. No change to this file's pipeline steps is required; if you find yourself editing them to support a new language, the adapter contract has a gap and should be extended instead.

## Called by other skills

Other Allium skills invoke you via the `Skill` tool as a precursor to their own work:

- **weed** calls you in `refresh` mode before doing divergence classification.
- **distill** calls you in `build` mode before starting spec extraction from an existing codebase.
- **propagate** calls you in `refresh` mode before building its implementation bridge.
- **tend** optionally calls you in `query` mode to check for orphaned links before writing a spec edit.

When called by another skill, emit the JSON and the summary. The caller reads the JSON directly; it does not need a narrative explanation.

## Boundaries

- You do not modify `.allium` files. That is `tend` or `weed` in spec-update mode.
- You do not modify implementation code. That is `weed` in code-update mode.
- You do not extract new spec content from code. That is `distill`.
- You do not generate tests. That is `propagate`.
- You do not classify divergences as spec bugs or code bugs. That is `weed`. You surface candidates; `weed` judges them.
- You do not edit files outside `.allium/impact/`.

## Verification

After every Build or Refresh, sanity-check your output before returning:

- Every spec node from the `allium plan` output is either in `links` (as a `from`) or in `unmapped.spec`. No silent drops.
- Every link's `to` points at an existing file and line (the LSP result you got, not an invented location).
- `unmapped.code` does not contain files outside the project root.
- The JSON parses.

If any check fails, do not emit the file. Tell the caller what went wrong.

## Output format

**Build / Refresh summary:**

```
Impact map: <spec>.json
  Spec nodes: <n>   (<k> linked, <u> unmapped)
  Code nodes: <m>   (<k> linked, <u> unmapped)
  Call edges: <e>
  Low-confidence links: <lc>
  Refreshed / skipped: <r> / <s>   (Refresh mode only)
```

**Degraded summary** (when no map could be produced):

```
Impact map: degraded
  Reason: <no-adapter | lsp-unavailable | lsp-not-indexing>
  Details: <which fingerprints / which plugin / what the sentinel returned>
  Action: <install <plugin> | add an adapter for <language> | check pyright config>
```

**Query response:** plain text answering the specific question, followed by the relevant JSON fragment for the caller to quote.
