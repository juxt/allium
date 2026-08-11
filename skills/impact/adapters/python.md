# Python adapter

The Python language adapter for the `impact` skill. Follows the five-section contract in [README.md](./README.md).

## 1. Fingerprint

Activate this adapter if any of the following is present in the target project:

- `pyproject.toml` at the project root.
- `setup.py` or `setup.cfg` at the project root.
- Any `**/*.py` file inside the project root (fallback for scripts-only projects with no packaging manifest).

## 2. LSP plugin

**Plugin:** `pyright-lsp` (from Anthropic's `claude-plugins-official` marketplace).

**Install:**

```bash
# 1. Install pyright so that `pyright-langserver` resolves on the global
#    PATH. The Claude Code LSP tool spawns this binary from PATH — it
#    does not inspect per-project venvs — so `uv pip install pyright`
#    inside a project venv will NOT work for Claude Code:
uv tool install pyright

# (pip install pyright and npm install -g pyright also work, provided
#  their install location ends up on PATH.)

# Verify:
which pyright-langserver   # must print a path

# 2. In Claude Code, add the marketplace and install the plugin:
/plugin marketplace add anthropics/claude-plugins-official
/plugin install pyright-lsp
```

After install, run `/reload-plugins` (or restart the session) and the built-in `LSP` tool will route Python files to pyright.

**Caveat — single-file indexing:** In the Claude Code harness, pyright runs per invocation against the file passed in `filePath`; it does not index the wider workspace. Empirically:

- `documentSymbol` and `hover` return the expected per-file results.
- `findReferences` only returns hits in the single file, not across the workspace.
- `workspaceSymbol` returns empty.
- Cross-file `goToDefinition` does not resolve project-internal imports (they appear as `reportMissingImports`).

Treat the LSP tool as a **single-file symbol and type oracle**, not a workspace index. The impact-skill pipeline reflects this: symbol discovery uses Glob + per-file `documentSymbol`, not `workspaceSymbol`. Do not issue `workspaceSymbol` calls expecting workspace-wide results — they will mislead the caller.

**Sentinel:** open any `.py` file in the project and call `documentSymbol` on it. If pyright returns a non-empty symbol tree, the LSP server is live. If the call errors with `Executable not found in $PATH`, pyright is not installed — tell the user to run the install steps above.

## 3. Name-variant generator

Given a spec identifier (PascalCase in Allium), emit variants following Python convention.

**For entities and variants:**

- `<Name>` — PascalCase class.
- `<name_snake>` — snake_case module, variable, function, or dataclass attribute.
- `create_<name_snake>`, `make_<name_snake>`, `new_<name_snake>` — factory functions.
- `<Name>Service`, `<Name>Repository`, `<Name>Manager` — service/repository/manager classes.
- `<name_snake>_service`, `<name_snake>_repository` — the same in snake_case when the code uses modules rather than classes.

**For rules and triggers:**

- `<verb_phrase_snake>` — function name (Allium `ScheduleInterview` → `schedule_interview`).
- `<VerbPhrase>` — class (command/event object style).
- `handle_<verb_phrase_snake>`, `on_<verb_phrase_snake>`, `process_<verb_phrase_snake>` — handler functions.
- `_<verb_phrase_snake>` — leading underscore for internal implementations of the same rule.

**For surfaces:**

- `<Name>Router`, `<Name>View`, `<Name>Endpoint` — framework-specific route containers.
- `<name_snake>_routes`, `<name_snake>_api` — module names in URL/router setup.

**Case conversion:** splitting on CamelCase is sufficient; do not try to stem verbs or handle plurals. If a spec identifier contains an underscore or is already snake_case, emit it verbatim as well.

## 4. Project-root rule

**Root discovery:** walk upward from the spec file's directory. The first directory containing `pyproject.toml`, `setup.py` or `setup.cfg` is the project root. If none is found, use the first directory containing a `.git` folder.

**Source globs:**

- If `pyproject.toml` declares `[tool.setuptools.packages.find]` or `[tool.poetry]` packages, use those package directories.
- Otherwise default to `src/**/*.py` and `<root>/**/*.py`.

**Exclusions (always):**

- `tests/**`, `test/**`, `**/test_*.py`, `**/*_test.py`, `**/conftest.py` — test code.
- `.venv/**`, `venv/**`, `env/**` — virtual environments.
- `build/**`, `dist/**`, `*.egg-info/**` — build artefacts.
- `__pycache__/**`, `*.pyc`.
- Any path matched by the project's `.gitignore`.
- `migrations/**` when using Django or Alembic — these are generated from models, not hand-authored behaviour.

**Depth:** default call-hierarchy expansion depth is 2. Stop when a call crosses into a third-party package (imports from outside the project root).

## 5. Surface entry-point patterns

### API surfaces

**Flask:**

- Decorators: `@app.route`, `@<blueprint>.route`.
- Functions: `app.add_url_rule(...)`.
- View-class pattern: `MethodView` subclasses registered via `add_url_rule(..., view_func=View.as_view(...))`.

**FastAPI / Starlette:**

- Decorators: `@app.get`, `@app.post`, `@app.put`, `@app.delete`, `@app.patch`, `@app.head`, `@app.options`.
- Router decorators: `@router.<method>` where `router = APIRouter(...)`.
- Dependency injection: `Depends(...)` arguments indicate the surface's dependencies and belong in the surface's `demands` contracts when present.

**Django:**

- URL patterns: `path(...)` and `re_path(...)` entries in `urls.py` / `urlpatterns`.
- Class-based views: subclasses of `View`, `TemplateView`, `ListView`, `DetailView`, `CreateView`, `UpdateView`, `DeleteView`.
- DRF: subclasses of `APIView`, `ViewSet`, `ModelViewSet`, `GenericAPIView`; `@api_view(...)` decorator for function-based DRF views.

**Quart / Sanic / aiohttp / Tornado:** same shape as Flask/FastAPI — look for `@app.route`, `@app.<method>`, or framework-specific `RouteTableDef.get/post`.

### UI surfaces

Rare for Python backends. When present:

- Jinja / Django template rendering points (`render_template`, `TemplateResponse`) — treat the view function as the surface entry point, not the template itself.

### Integration surfaces

**Task queues:**

- Celery: `@celery.task`, `@app.task`, `@shared_task`.
- RQ: functions enqueued via `queue.enqueue(func, ...)` — grep the call sites to find the handlers.
- Dramatiq: `@dramatiq.actor`.

**Message bus / event handlers:**

- Kafka/faust: `@app.agent(topic)`.
- pub/sub libraries: `@subscriber(...)`, `@consumer(...)`, `@on_event(...)`.
- AWS Lambda: functions matching `def handler(event, context)` or `def lambda_handler(event, context)`.

**SDK / client surfaces (outbound):**

- Service client classes exposing public methods — look for classes named `<Name>Client`, `<Name>SDK`, `<Name>Gateway`. Public (non-underscore) methods are the surface entry points.

### What not to match as surfaces

- Internal helpers, private methods (leading underscore).
- Test fixtures, even if they look like route handlers.
- Abstract base classes whose subclasses are where the real routing lives — follow `goToImplementation` to the concrete class and map the surface to that.
