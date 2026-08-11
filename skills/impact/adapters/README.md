# Impact-map language adapters

A language adapter tells the `impact` skill how to look for implementation code in a particular language. The skill's pipeline is language-agnostic; everything that varies between Python, Go, TypeScript, Rust etc. lives here.

Adapters are Markdown files interpreted by the LLM, not compiled code. Consistency comes from following the five sections below in the same order. Do not invent additional sections.

## Adding a new adapter

Create `skills/impact/adapters/<language>.md` with exactly these five sections, in this order. Then add a fingerprint row to the table in [../SKILL.md](../SKILL.md) under "Language selection".

### 1. Fingerprint

How to tell this language is in use in the target project. List the files and globs the skill should check. If any match, this adapter activates.

Example (Python):

> - Presence of `pyproject.toml`, `setup.py` or `setup.cfg` at the project root.
> - Any `**/*.py` file inside the project root.

### 2. LSP plugin

Which Claude Code LSP plugin the skill must have installed. Name the plugin exactly as it appears in the marketplace. Supply a sentinel query that confirms the LSP is live before the pipeline runs.

Example (Python):

> **Plugin:** `pyright-lsp`.
>
> **Sentinel:** call `workspaceSymbol` with a query matching any public symbol the skill expects to exist in a Python project (e.g. a class name discovered from the spec). If the result is empty *and* no Python file in the project defines that symbol, pyright is likely not indexing — tell the user to install/enable `pyright-lsp`.

### 3. Name-variant generator

Given a spec identifier (PascalCase in Allium), list the identifiers a programmer is likely to have used in this language. Keep the rules simple and grounded in convention — do not brute-force every casing permutation.

Example (Python):

> For a spec entity `Candidacy`:
> - `Candidacy` — PascalCase class.
> - `candidacy` — snake_case module, variable, or function.
> - `create_candidacy`, `make_candidacy`, `new_candidacy` — factory functions.
> - `CandidacyService`, `CandidacyRepository` — service/repository classes.
>
> For a spec rule `ScheduleInterview`:
> - `schedule_interview` — function name.
> - `ScheduleInterview` — class (for command/event object style).
> - `handle_schedule_interview`, `on_schedule_interview` — handlers.

### 4. Project-root rule

What counts as "inside the project" when the pipeline bounds call-hierarchy expansion and `unmapped.code` collection. The adapter names the manifest file(s) or directory marker that defines the root, and the globs that count as project source files (excluding vendored code, tests, and generated files).

Example (Python):

> **Root:** the directory containing the nearest `pyproject.toml`, `setup.py` or `setup.cfg` walking up from the spec file.
>
> **Source globs:** `src/**/*.py`, `<package>/**/*.py` as declared in `pyproject.toml`.
>
> **Exclusions:** `tests/**`, `**/test_*.py`, `**/conftest.py`, `.venv/**`, `build/**`, `dist/**`, any directory on `.gitignore`.

### 5. Surface entry-point patterns

For each spec `surface` kind the language commonly implements, give the framework patterns the skill should search for. Broken out by framework because a single language typically has multiple competing frameworks.

Example (Python):

> **API surfaces:**
> - *Flask:* `@app.route`, `@blueprint.route`, `app.add_url_rule`.
> - *FastAPI:* `@app.get/post/put/delete/patch`, `@router.*`, `APIRouter`, `Depends`.
> - *Django:* `path(...)` / `re_path(...)` in `urls.py`; class-based views inheriting from `View`, `APIView` (DRF).
>
> **UI surfaces:** not typical for Python backends. Skip.
>
> **Integration surfaces:** `@celery.task`, `@app.task` (Celery); `@consumer`, `@subscribe` (message bus libraries); SDK methods with `@classmethod` on service clients.

## Confidence heuristic

Every adapter inherits this default confidence ladder. Override only if a language has strong conventions that make one signal load-bearing.

1. **High** — exact name match, docstring or symbol doc mentions the spec construct by name, single candidate in the workspace.
2. **Medium** — exact name match, single candidate, no docstring evidence.
3. **Low** — name variant match (not exact), or multiple candidates, or candidate lives in a test file.

Low-confidence links are still recorded; they just get flagged in the summary so `weed` treats them with suspicion.

## Things adapters must not do

- Do not define the JSON schema. That is fixed in [references/impact-map.md](../../../references/impact-map.md).
- Do not reimplement pipeline steps. That is fixed in [../SKILL.md](../SKILL.md).
- Do not branch on framework features in the adapter file — the five sections above are the whole contract.
- Do not add application-specific rules (e.g. "in this repo, handlers live in `handlers/`"). That is a project-level concern, not a language adapter.

If you find yourself wanting to add a sixth section, something is wrong with the pipeline's decomposition. Raise it as an issue rather than forking the adapter contract.
