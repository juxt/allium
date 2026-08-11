# TypeScript adapter

The TypeScript / JavaScript language adapter for the `impact` skill. Follows the five-section contract in [README.md](./README.md). Covers both TypeScript and JavaScript projects — the LSP treats `.js` / `.jsx` as untyped TS.

## 1. Fingerprint

Activate this adapter if any of the following is present in the target project:

- `tsconfig.json` at the project root (TypeScript).
- `jsconfig.json` at the project root (type-checked JavaScript).
- `package.json` at the project root with a `typescript` dependency (direct or indirect).
- Any `**/*.{ts,tsx,mts,cts}` file inside the project root.
- `package.json` at the project root plus any `**/*.{js,jsx,mjs,cjs}` file (fallback for plain JS projects).

For monorepos — workspaces declared in `package.json`, pnpm `pnpm-workspace.yaml`, Nx, Turborepo, Lerna — the project root is the top-level workspace root, and per-package `tsconfig.json` files are loaded as sub-project boundaries.

## 2. LSP plugin

**Plugin:** `typescript-lsp` (from Anthropic's `claude-plugins-official` marketplace). Uses `typescript-language-server` on top of the `typescript` package's `tsserver`.

**Requirements:** Node.js and npm (or yarn / pnpm) on PATH.

**Install:**

```bash
# 1. Install the language server and the TypeScript package globally so
#    `typescript-language-server` resolves on the global PATH. The
#    Claude Code LSP tool spawns this binary from PATH — project-local
#    installs under node_modules/.bin will NOT be picked up.
npm install -g typescript-language-server typescript

# (yarn global add and pnpm add -g also work, provided their global
#  bin directory is on PATH.)

# Verify:
which typescript-language-server   # must print a path
which node                         # must print a path

# 2. In Claude Code, add the marketplace and install the plugin:
/plugin marketplace add anthropics/claude-plugins-official
/plugin install typescript-lsp
```

After install, run `/reload-plugins` (or restart the session) and the built-in `LSP` tool will route TypeScript and JavaScript files to the server.

**Caveat — tsconfig awareness.** `typescript-language-server` spawns a `tsserver` process that reads the nearest `tsconfig.json` / `jsconfig.json` walking up from the opened file. If a file lives outside every `tsconfig.json`'s `include` / `files` list, tsserver will report it as loose-mode (no type information, limited symbol intelligence). When building the impact map, avoid pointing the LSP at files that are `exclude`d from the nearest `tsconfig.json` — they'll return degraded results.

**Caveat — single-file indexing is likely here too.** Treat the LSP tool as a single-file symbol and type oracle by default (same guidance as the Python adapter). `tsserver` is more workspace-aware than pyright under normal IDE usage, but the Claude Code harness has only been verified in single-file mode. The impact-skill pipeline uses Glob + per-file `documentSymbol`; do not rely on `workspaceSymbol` without empirically confirming it works for your setup.

**Sentinel:** open any `.ts` or `.tsx` file in the project and call `documentSymbol` on it. If tsserver returns a non-empty symbol tree, the server is live. If the call errors with `Executable not found in $PATH`, the language server isn't installed — tell the user to run the install steps above. If it returns a minimal tree for a file that clearly has classes or exports, the file is likely outside the project's `tsconfig.json` scope.

## 3. Name-variant generator

Given a spec identifier (PascalCase in Allium), emit variants following TypeScript / JavaScript convention.

**For entities and variants:**

- `<Name>` — PascalCase class, interface, type alias, or enum (TS).
- `I<Name>` — interface prefix (uncommon in modern TS but present in codebases migrated from C# / Java).
- `<name>` — camelCase variable, function, or named export (Allium `Candidacy` → `candidacy`).
- `create<Name>`, `make<Name>`, `new<Name>` — factory functions in camelCase.
- `<Name>Service`, `<Name>Repository`, `<Name>Store`, `<Name>Manager`, `<Name>Provider` — layered-architecture classes.
- `use<Name>` — React hook convention (Allium `Candidacy` → `useCandidacy`).
- `<Name>Props`, `<Name>State`, `<Name>Schema`, `<Name>Dto` — component / schema / DTO suffixes.

**For rules and triggers:**

- `<verbPhrase>` — camelCase function (Allium `ScheduleInterview` → `scheduleInterview`).
- `<VerbPhrase>` — PascalCase class (command / handler / controller style).
- `handle<VerbPhrase>`, `on<VerbPhrase>`, `process<VerbPhrase>`, `execute<VerbPhrase>` — handler method / function variants.
- `<VerbPhrase>Handler`, `<VerbPhrase>Command`, `<VerbPhrase>UseCase` — CQRS / clean-architecture naming.

**For surfaces:**

- `<Name>Router`, `<Name>Controller`, `<Name>Resolver` — framework-specific route / handler containers.
- `<Name>Page`, `<Name>Layout`, `<Name>View`, `<Name>Screen` — UI surface containers (Next.js / React / React Native).
- `<name>Api`, `<name>Routes`, `<name>Resolvers` — module-level naming.

**Case conversion:** splitting on CamelCase is sufficient. Modern TS discourages the `I<Name>` interface prefix but emit it as a lower-priority alternate when a spec identifier is an interface-like name. For React components specifically, always emit both PascalCase (the component itself) and `use<Name>` (the conventional hook).

## 4. Project-root rule

**Root discovery:** walk upward from the spec file's directory.

- If a `pnpm-workspace.yaml`, a `package.json` with a `workspaces` field, or an `nx.json` / `turbo.json` is found, that directory is the monorepo root. Per-package `tsconfig.json` files remain sub-project boundaries.
- Otherwise the first directory containing `tsconfig.json` or `jsconfig.json` is the project root.
- Otherwise the first directory containing `package.json` is the root.
- Fallback: the first directory containing a `.git` folder.

**Source globs:**

- If `tsconfig.json` declares `include` / `files`, honour them.
- Otherwise default to `src/**/*.{ts,tsx,mts,cts}` and `<root>/**/*.{ts,tsx}`.
- For Next.js: `pages/**/*.{ts,tsx}` and `app/**/*.{ts,tsx}` in addition to `src/**`.
- For monorepos: `packages/*/src/**/*.{ts,tsx}`, `apps/*/src/**/*.{ts,tsx}`, or whatever the `workspaces` glob declares.

**Exclusions (always):**

- `node_modules/**` — dependency code.
- `dist/**`, `build/**`, `out/**`, `.next/**`, `.nuxt/**`, `.turbo/**`, `.vercel/**` — build outputs.
- `coverage/**` — test-coverage reports.
- `**/*.test.{ts,tsx,js,jsx}`, `**/*.spec.{ts,tsx,js,jsx}`, `**/__tests__/**`, `**/__mocks__/**` — test code and mocks.
- `**/*.d.ts` — ambient type declarations (unless the project's own `.d.ts` files are load-bearing behaviour).
- `**/*.stories.{ts,tsx,js,jsx}`, `**/*.mdx` — Storybook / MDX.
- `**/*.generated.{ts,tsx}`, `**/generated/**` — GraphQL / OpenAPI / Prisma / Protobuf codegen output.
- Any path matched by the project's `.gitignore`.

**Depth:** default call-hierarchy expansion depth is 2. Stop when a call crosses into `node_modules`. Note: barrel re-exports (`export * from "./foo"`) can inflate reference counts; prefer the declared source of a symbol over its re-export sites when recording links.

## 5. Surface entry-point patterns

### API surfaces

**Express:**

- `app.get|post|put|delete|patch(...)`, `router.get|post|...`.
- Middleware signatures: `(req, res, next) => ...`.

**Fastify:**

- `fastify.get|post|...`, `fastify.route({ method, url, handler })`.
- Plugin registration: `fastify.register(plugin)`.

**Koa:**

- `router.get|post|...` via `@koa/router`; middleware signature `(ctx, next) => ...`.

**NestJS:**

- Class-level decorators: `@Controller('/path')`, `@Resolver()`, `@WebSocketGateway()`.
- Method-level decorators: `@Get`, `@Post`, `@Put`, `@Delete`, `@Patch`, `@Options`, `@Head`; GraphQL `@Query`, `@Mutation`, `@Subscription`; WebSocket `@SubscribeMessage`.
- Dependency injection via constructor — relevant to surface `demands` contracts.

**Hono:**

- `app.get|post|...`, `app.route(path, sub)`.

**Next.js:**

- App Router: `app/**/route.{ts,tsx}` files exporting named HTTP methods (`export async function GET(request) { … }`).
- Pages Router: `pages/api/**/*.{ts,tsx}` files exporting a default handler.
- Server Actions: functions annotated with `"use server"` inside server components.

**tRPC:**

- Router definitions: `t.router({ procedure: t.procedure.query(...) | .mutation(...) })`.
- Procedure calls are the surface entry points; the input / output types are the contract obligations.

**GraphQL:**

- Apollo Server / Mercurius resolvers — resolver functions on the `Query`, `Mutation`, `Subscription` root types.
- NestJS `@Resolver()` + `@Query` / `@Mutation`.

### UI surfaces

**React / Next.js:**

- Components: PascalCase functions or classes in `components/**`, `app/**/page.tsx`, `pages/**/*.tsx`. The component is the surface entry point.
- Hooks: `use<Name>` in `hooks/**` — treat as the surface's state contract when the spec refers to them by name.
- Server components (Next.js app router): `app/**/page.tsx`, `app/**/layout.tsx` — server-rendered surfaces.

**Vue / Svelte / Solid:**

- `.vue` / `.svelte` / `.jsx` single-file components — the `<script>` block is the behavioural entry; LSP may treat the file as opaque. Fall back to grep + document-symbol on the script region.

**React Native:**

- Screen components in `screens/**` or registered via a navigator; PascalCase, surfaced the same way as web React components.

### Integration surfaces

**Job queues / scheduling:**

- BullMQ: `new Worker(queueName, handler)` — the handler is the surface entry point.
- Bree / node-cron: `cron.schedule(expr, handler)`.
- Temporal: `@activity.defn` / `@workflow.defn` (TypeScript SDK).

**Message bus / event handlers:**

- Kafka (kafkajs): `consumer.run({ eachMessage })` — the `eachMessage` handler.
- NATS / RabbitMQ: `subscriber.subscribe(subject, handler)`, `channel.consume(queue, handler)`.
- WebSocket servers: `ws.on('message', handler)`.
- NestJS event emitter: `@OnEvent('event.name')`.

**Serverless handlers:**

- AWS Lambda: exported `handler` functions; CloudFormation / SAM / Serverless Framework descriptors point to them.
- Vercel / Netlify functions: files under `api/**` (Vercel) or `netlify/functions/**` — default export is the handler.
- Cloudflare Workers: exported `fetch` handler (`export default { async fetch(request) { … } }`).

**SDK / outbound client surfaces:**

- Classes named `<Name>Client`, `<Name>Sdk`, `<Name>Gateway`, `<Name>ApiClient`.
- `fetch` / `axios` / `ky` wrapper modules where the exported functions are the surface entry points.
- GraphQL clients: generated hooks from `graphql-codegen` (skip the generated file — see exclusions — and map the surface to the call site).

### What not to match as surfaces

- Anything matched by the test exclusion globs in §4.
- `*.stories.{ts,tsx}` Storybook entries — these are component *previews*, not real surfaces.
- Barrel files (`index.ts` re-exports) — they're routing, not surface definitions.
- `*.d.ts` ambient declarations — types only, no behaviour.
- Auto-generated GraphQL hooks, Prisma clients, Protobuf stubs — map the surface to the hand-authored handler / resolver that uses them.
- Higher-order components (HOCs) whose only purpose is wrapping — follow through to the inner component.
- Abstract NestJS `@Injectable()` base classes whose subclasses are where the real routing lives — follow `goToImplementation`.
