# jest+fastcheck backend conventions

This document tells Stage A subagents how to populate the
obligation-bridge inventory's `bridge` fields when targeting a TypeScript
codebase tested with Jest + fast-check. The schema is defined in
[`../../references/obligation-bridge-schema.md`](../../references/obligation-bridge-schema.md);
this file covers the *TypeScript-specific* parts.

## Symbol form

A bridge uses the universal `<path>::<symbol>` form. For TypeScript:

- `<path>` is a relative path from the inventory's `code_root` to a
  `.ts` (or `.tsx` / `.js` / `.jsx`) file. Example: `src/services/builds.ts`.
- `<symbol>` is the named export that witnesses the obligation:
  - **Named function export**: bare name. Example: `startBuild`.
  - **Method on an exported class**: `ClassName.method`. Example:
    `BuildService.start`.
  - **Exported const / enum / type**: bare identifier name. Example:
    `ARTIFACT_TTL_MS`, `BuildStatus`.
  - **Default export**: use the bare identifier the file exports;
    the import line will adjust accordingly.

No leading `module/`, no `function ` or `class ` keyword, no
parentheses, no type annotations. Pure exported identifier.

### Examples

| Construct                                                            | `bridge.primary_symbol`                       |
|----------------------------------------------------------------------|-----------------------------------------------|
| `export function startBuild(p: Pipeline): Build { ... }`             | `src/services/builds.ts::startBuild`          |
| `export class BuildService { start(p: Pipeline): Build { ... } }`    | `src/services/builds.ts::BuildService.start`  |
| Route handler `app.post("/builds/:id/cancel", cancelBuild)`          | `src/routes.ts::cancelBuild`                  |
| `export const ARTIFACT_TTL_MS = 7 * 24 * 60 * 60 * 1000;`            | `src/models.ts::ARTIFACT_TTL_MS`              |
| `export enum BuildStatus { ... }`                                    | `src/models.ts::BuildStatus`                  |
| Scheduled job `export function expireOldArtifacts(): void { ... }`   | `src/jobs.ts::expireOldArtifacts`             |

## Directory layout assumed by templates

```
<code_root>/
├── src/                       ← implementation
│   ├── models.ts
│   ├── routes.ts
│   ├── webhooks.ts
│   ├── jobs.ts
│   ├── services/
│   │   ├── builds.ts
│   │   └── artifacts.ts
│   └── integrations/
│       └── storage.ts
├── tests/                     ← propagate writes here
│   ├── pipeline.test.ts
│   ├── build.test.ts
│   └── ...
├── package.json
└── tsconfig.json
```

If the target project deviates (e.g. `__tests__/` directories
co-located with the source rather than a top-level `tests/`), v1 will
still write under `tests/`.

## Test-infrastructure assumptions

- **Test framework**: Jest. The runner command is `npx jest`.
- **PBT framework**: fast-check. State-machine tests use `fc.commands`
  + `fc.modelRun`.
- **Fixtures**: in-file factory functions. The translator writes a
  `const <fixture_name> = () => null;` stub into each test file that
  references a fixture; engineers replace these with real factories.
  (There is no auto-injection like pytest's `conftest.py`.)
- **Module resolution**: imports use relative paths. The translator
  rewrites `<path>` (relative to `code_root`) into a path relative to
  the test file's location.

## Injection points

| `injection_points[]` value | Idiom in generated tests           |
|----------------------------|------------------------------------|
| `clock`                    | `jest.useFakeTimers()`             |
| `random`                   | `jest.spyOn(Math, "random")`       |
| `network`                  | `jest.spyOn(<module>, "<method>")` |

These are passed to templates as `{{injection.clock}}` etc., resolved
from `manifest.json`'s `*_injection` fields. A project using `vitest`
or `sinon` instead of jest's built-ins can fork this backend with
adjusted manifest values.

## Stub form

When `bridge.confidence` resolves to `"low"` in the merged inventory,
the translator emits a skipped test using
`test.skip("<name> [bridge-unresolved]", () => {...})`. The string
`bridge-unresolved` is the `skip_marker` from `manifest.json` and is
what Stage C greps for in the runner report.

Example:

```typescript
test.skip("startBuild succeeds when pipeline active [bridge-unresolved]", () => {
  // TODO: bridge unresolved
  // candidates:
  //   - src/services/builds.ts::startBuild
  //   - src/routes.ts::startBuildRoute
  // preconditions:
  //   - Pipeline.status = active
});
```

## Self-check for Stage A subagents

- [ ] Every `bridge.primary_symbol` parses as `<path>::<symbol>` with
      exactly two colons.
- [ ] Every `<path>` exists relative to `code_root` and ends in one
      of `.ts`, `.tsx`, `.js`, `.jsx`.
- [ ] Every `<symbol>` is a valid TypeScript identifier or
      `ClassName.method` chain — no parentheses, no `function`/`class`
      keyword, no decorators.
- [ ] `fixtures_required[]` uses abstract names; no
      `() => {}`-shaped strings.
- [ ] `injection_points[]` uses one of `clock`, `random`, `network`.
