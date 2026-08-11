# Clojure adapter

The Clojure / ClojureScript language adapter for the `impact` skill. Follows the five-section contract in [README.md](./README.md). Covers Clojure (JVM), ClojureScript, Babashka and `.cljc` shared sources — clojure-lsp treats all four as one language with per-dialect reader conditionals.

## 1. Fingerprint

Activate this adapter if any of the following is present in the target project:

- `deps.edn` at the project root (Clojure CLI / `tools.deps`).
- `project.clj` at the project root (Leiningen).
- `build.boot` at the project root (Boot — legacy, still seen).
- `shadow-cljs.edn` at the project root (ClojureScript via shadow-cljs).
- `bb.edn` at the project root (Babashka script project).
- Any `**/*.{clj,cljs,cljc,edn,bb}` file inside the project root.

If both `deps.edn` and `project.clj` exist, prefer `deps.edn` as the authoritative manifest; many projects keep `project.clj` purely for editor tooling. If `shadow-cljs.edn` is present alongside `deps.edn`, the project is a mixed Clojure/ClojureScript build — the adapter still activates once and walks both source sets.

## 2. LSP plugin

**Plugin:** `clojure-lsp` (from JUXT's `juxt-plugins` marketplace — the official Anthropic marketplace does not currently ship a Clojure LSP plugin). Uses the upstream `clojure-lsp` server ([github.com/clojure-lsp/clojure-lsp](https://github.com/clojure-lsp/clojure-lsp)), which wraps [clj-kondo](https://github.com/clj-kondo/clj-kondo) for static analysis.

**Requirements:** The GraalVM-compiled native binary has no runtime dependencies. The JAR distribution requires JDK 11 or later on PATH. Either is acceptable; the native binary is faster to start and is recommended for Claude Code use.

**Install:**

```bash
# 1. Install clojure-lsp so the `clojure-lsp` binary resolves on PATH.
#    The Claude Code LSP tool spawns this binary from PATH.
#    macOS:    brew install clojure-lsp/brew/clojure-lsp-native
#    Linux:    bash < <(curl -s https://raw.githubusercontent.com/clojure-lsp/clojure-lsp/master/install)
#    Arch:     pacman -S clojure-lsp      (or yay -S clojure-lsp-bin)
#    Nix:      nix-env -iA nixpkgs.clojure-lsp
#    Other:    download the native zip from
#              https://github.com/clojure-lsp/clojure-lsp/releases
#              and place `clojure-lsp` on PATH.

# Verify:
which clojure-lsp    # must print a path
clojure-lsp --version

# 2. In Claude Code, add the JUXT marketplace and install the plugin:
/plugin marketplace add juxt/juxt-plugins
/plugin install clojure-lsp@juxt-plugins
```

After install, run `/reload-plugins` (or restart the session) and the built-in `LSP` tool will route `.clj`, `.cljs`, `.cljc`, `.edn` and `.bb` files to clojure-lsp.

**Caveat — project indexing cost.** clojure-lsp indexes the full classpath on first contact, resolving `deps.edn` / `project.clj` dependencies into a `.lsp/.cache/` directory. On a fresh clone, the first invocation can take 10–30 seconds while it fetches dependencies and runs clj-kondo across the project. Subsequent calls are fast because the cache is reused. If the sentinel call below times out the first time, retry after 15–30 seconds before concluding the LSP is broken. If `clojure -P` (or `lein deps`) has never been run for this project, do that first — the LSP cannot index unresolved dependencies.

**Caveat — reader conditionals.** `.cljc` files contain `#?(:clj ... :cljs ...)` blocks; clojure-lsp returns symbols for the dialect indicated by the file's context (deduced from `deps.edn` / `shadow-cljs.edn`). If a spec construct is implemented behind a reader-conditional branch you cannot see (e.g. only the `:cljs` branch but the project is being probed as `:clj`), you may get a false "unmapped" result. Record the construct in `unmapped.spec` with a note, not a guess.

**Caveat — macro-heavy code.** Clojure relies heavily on macros (`defn`, `defroutes`, `defrecord`, `deftest`, `defmethod`, `defmulti`, `defschema`, custom DSLs). clj-kondo (and therefore clojure-lsp) reports macro-generated vars when it understands the macro; for unknown macros it either silently misses the vars or reports them with empty metadata. Most common macros have built-in clj-kondo support; project-specific DSLs may need `.clj-kondo/config.edn` hooks to be visible. Missing symbols from a custom macro are a tooling limitation, not a divergence.

**Caveat — single-file indexing is likely here too.** Treat the LSP tool as a single-file symbol and type oracle by default (same guidance as the Python, Java, TypeScript and Kotlin adapters). clojure-lsp is genuinely workspace-aware under normal editor use and `workspaceSymbol` queries do return project-wide results when the `.lsp/.cache/` is populated — but the Claude Code harness has only been verified in single-file mode to date. The impact-skill pipeline uses Glob + per-file `documentSymbol`; treat `workspaceSymbol` as a bonus signal if it works rather than a primary discovery mechanism.

**Sentinel:** open any `.clj` or `.cljs` file in the project and call `documentSymbol` on it. If clojure-lsp returns a non-empty symbol tree, the server is live. If the call errors with `Executable not found in $PATH`, `clojure-lsp` isn't installed — tell the user to run the install steps above. If it returns an empty or suspiciously shallow tree on a file that clearly contains `defn` / `defrecord` forms, the `.lsp/.cache/` is probably stale or missing — run `clojure -P` (or `lein deps`) in the project root, then retry.

## 3. Name-variant generator

Given a spec identifier (PascalCase in Allium), emit variants following Clojure convention. Clojure is **kebab-case-first** and case-distinctions carry meaning (PascalCase is reserved for types, records, protocols, and exceptions; everything else is kebab-case). The adapter reflects that.

**For entities and variants:**

- `<name-kebab>` — kebab-case var, function, namespace segment, or keyword (Allium `Candidacy` → `candidacy`).
- `<Name>` — PascalCase `defrecord`, `deftype`, `defprotocol`, or exception class.
- `-><Name>` and `map-><Name>` — the two factory functions auto-generated by `defrecord` / `deftype`. Always emit these when `<Name>` is a likely record/type.
- `create-<name-kebab>`, `make-<name-kebab>`, `new-<name-kebab>`, `build-<name-kebab>` — factory functions.
- `<name-kebab>?` — predicate function (Clojure convention for boolean-returning fns).
- `<name-kebab>!` — side-effecting function (Clojure convention for fns with observable side effects).
- `<name-kebab>-service`, `<name-kebab>-repository`, `<name-kebab>-store`, `<name-kebab>-manager` — layered-architecture namespaces or component keys.
- `I<Name>` — protocol name variant (older style, still seen; the `I` prefix is not idiomatic in modern Clojure but present in Java-influenced codebases).
- `:<name-kebab>` — keyword identifier. Treat keyword references as lower-confidence candidates: keywords often appear as keys in data (Integrant component keys, multimethod dispatch values, route identifiers) and are a strong signal even though they are not LSP-discoverable symbols in the `documentSymbol` tree. Use Grep to locate keyword literals and cross-reference them with nearby `defmethod` / `defmulti` / Integrant / Reitit forms.

**For rules and triggers:**

- `<verb-phrase-kebab>` — kebab-case function (Allium `ScheduleInterview` → `schedule-interview`).
- `<verb-phrase-kebab>!` — side-effecting variant (rules that mutate state typically use the bang suffix).
- `handle-<verb-phrase-kebab>`, `on-<verb-phrase-kebab>`, `process-<verb-phrase-kebab>`, `execute-<verb-phrase-kebab>` — handler functions.
- `<VerbPhrase>` — PascalCase record / exception for command or event objects (rarer in Clojure than Java; seen in CQRS-ish or event-sourced codebases).
- `:<verb-phrase-kebab>` — keyword used as multimethod dispatch value or event-name: grep `(defmethod <multi> :<verb-phrase-kebab> [...])` to find handlers.

**For surfaces:**

- `<name-kebab>-routes`, `<name-kebab>-handler`, `<name-kebab>-api`, `<name-kebab>-app` — namespace or var naming for route definitions and Ring handlers.
- `<name-kebab>-component`, `<name-kebab>-system` — Integrant / Component / Mount top-level system keys.
- `<name-kebab>-resource` — liberator-style resource definitions.

**Case conversion:** split a PascalCase spec identifier on CamelCase boundaries, lowercase each component, join with hyphens (`ScheduleXmlImport` → `schedule-xml-import`). Acronyms: treat `XML`, `HTTP`, `ID`, `URL`, `SQL` as single lowercased units (`schedule-xml-import`, not `schedule-x-m-l-import`); emit both conventions when the spec identifier contains an acronym, since style varies across codebases. Namespaces are dot-separated kebab segments (`my.app.candidacy`); when matching a spec entity against a namespace, match the final segment only.

## 4. Project-root rule

**Root discovery:** walk upward from the spec file's directory.

- If `deps.edn` is found, that directory is the root (tools.deps / Clojure CLI project). If `deps.edn` declares `:aliases` with `:local/root` dependencies, the referenced sub-projects have their own roots but participate in the same classpath — the top-level `deps.edn` directory remains the map root.
- Otherwise the first directory containing `project.clj` is the root (Leiningen). For multi-module Leiningen (`:sub` coordinates via lein-sub / lein-monolith), the topmost `project.clj` wins.
- Otherwise the first directory containing `build.boot` is the root.
- Otherwise the first directory containing `shadow-cljs.edn` is the root (ClojureScript-only project).
- Otherwise the first directory containing `bb.edn` is the root (Babashka-only project).
- Fallback: the first directory containing a `.git` folder.

**Source globs:**

- `src/**/*.{clj,cljs,cljc}` — Clojure / ClojureScript / shared sources (standard layout for tools.deps, Leiningen, and shadow-cljs).
- `src/main/clojure/**/*.clj` — Maven-style layout (seen when Clojure code is part of a larger JVM project; `clojure-maven-plugin`).
- `src/main/clojurescript/**/*.cljs` — same, ClojureScript counterpart.
- `dev/**/*.{clj,cljs,cljc}` — dev-only source directory (conventional in tools.deps projects with a `:dev` alias). Include when the spec describes dev-time behaviour; otherwise treat as out-of-scope.
- `resources/**/*.edn` — configuration data. Do not treat as source code for symbol discovery, but scan for keyword literals when mapping surfaces that use data-driven routing (Reitit route data, Integrant configs).
- `script/**/*.bb`, `scripts/**/*.bb`, `bb/**/*.clj` — Babashka scripts when `bb.edn` is present.

Honour any `:paths` / `:source-paths` / `:extra-paths` declared in `deps.edn`, `project.clj`, or `shadow-cljs.edn` — they override the defaults above. A project that puts its sources under `core/` instead of `src/` is perfectly valid.

**Exclusions (always):**

- `test/**`, `src/test/**`, `**/*_test.{clj,cljs,cljc}`, `**/test_*.{clj,cljs,cljc}` — test sources (both by directory convention and `_test` filename suffix, which is the canonical `cljs.test` / `clojure.test` runner expectation).
- `target/**` — build output (Leiningen and tools.deps build tools both write here).
- `.cpcache/**` — tools.deps classpath cache.
- `.shadow-cljs/**`, `.clj-kondo/.cache/**`, `.lsp/.cache/**` — tooling caches.
- `classes/**`, `out/**` — AOT-compiled output / shadow-cljs build output.
- `node_modules/**` — present when a ClojureScript project has JS dependencies.
- `resources/public/js/**`, `public/js/**` — ClojureScript compilation artefacts.
- `.cljs_rhino_repl/**`, `.nrepl-port`, `.cider-repl-history` — REPL state.
- `pom.xml`, `pom.xml.asc` — Maven descriptors generated by `clj -T:build` (not hand-authored).
- Any path matched by the project's `.gitignore`.

**Depth:** default call-hierarchy expansion depth is 2. Stop when a call crosses into a dependency JAR or `node_modules` (for ClojureScript). Be aware of:

- **Vars vs functions.** Clojure vars are first-class: a `defn` defines a var bound to a fn, and call sites reference the var (late-bound). clojure-lsp reports the var declaration as the symbol; call-hierarchy resolves through the var. Treat `(my.ns/foo ...)` and `my.ns/foo` the same — both are edges to `foo`.
- **Multimethods.** `(defmulti name dispatch-fn)` creates one var; each `(defmethod name dispatch-val [...] body)` adds a method to that multimethod but does **not** create a new var. clojure-lsp reports the `defmethod` as an implementation of the multimethod var. Record each `defmethod` as an edge back to the `defmulti`, and annotate the link with the dispatch value in `via`.
- **Protocols.** `defprotocol` declares signatures; `extend-protocol`, `extend-type`, or `defrecord ... <Protocol>` provide implementations. clojure-lsp can surface these relationships via `goToImplementation`; use that to bridge spec constructs that correspond to protocol method names.
- **Macros that define vars.** `defn`, `defn-`, `def`, `defrecord`, `deftype`, `defprotocol`, `defmethod`, `defschema`, `defroutes`, `defresource`, `deftest`, and project-specific DSL macros (`reg-event-db` in re-frame, `defcomponent` in some Component-ish libs) each produce analysable symbols when clj-kondo understands the macro. Unknown macros silently drop their defined vars; when a spec construct is unmapped and you suspect macro hiding, check `.clj-kondo/config.edn` / `.clj-kondo/hooks/`.
- **Anonymous inline fns (`#(...)`, `(fn [...] ...)`)** have no symbol; they are edges without endpoints. Record the enclosing named var as the edge target.
- **Namespace aliases.** A namespace required as `[my.app.candidacy :as c]` is called as `(c/create ...)`. clojure-lsp resolves the alias; record the edge to the real namespace, not the alias.

## 5. Surface entry-point patterns

Clojure's web ecosystem is unusually uniform under the hood: almost every framework compiles down to a **Ring handler** — a function `(fn [request] response)` or `(fn [request respond raise] nil)` — composed through middleware. The surface entry point is the routing-table entry that names that handler, not the handler function itself in isolation.

### API surfaces

**Ring / Ring-Jetty-Adapter / HTTP-Kit (the base layer):**

- A Ring handler is `(defn handler [request] ...)` — a unary fn from request map to response map.
- The server entry point is typically `(run-jetty handler {:port ...})` or `(run-server handler {:port ...})` in an `-main` or Integrant/Component start function.
- Middleware composition (`wrap-json-body`, `wrap-params`, etc.) appears as `(-> handler wrap-json-body wrap-params)` — not itself a surface, but its presence tells you which handler is the outermost.

**Compojure** (classic DSL over Ring):

- `(defroutes app-routes (GET "/path" [] handler) (POST "/path" [params] ...))`.
- Method macros: `GET`, `POST`, `PUT`, `DELETE`, `PATCH`, `HEAD`, `OPTIONS`, `ANY`, `context`.
- Each route clause is a surface entry; the inline body or the named handler var is the implementation.

**Reitit** (data-driven, most common in modern Clojure):

- Route data: `[["/path" {:get {:handler handler-var} :post {:handler other-handler}}]]`.
- Coercion and middleware in route data: `{:get {:parameters {...} :responses {...} :handler ...}}` — the `:parameters` / `:responses` nodes map directly onto surface `demands` / `provides` / `guarantees` contracts.
- Grep for the top-level route vector in a `-routes` namespace, then resolve each `:handler` keyword to its defining var via `documentSymbol` on the target file.

**Pedestal:**

- Interceptor chains: `[{:route-name :schedule-interview :handler handler-fn :enter (fn [ctx] ...)}]`.
- The `:route-name` keyword is a direct machine-readable identifier — a very strong signal when matching to a spec rule.

**Liberator:**

- `(defresource resource-name :allowed-methods [:get :post] :handle-ok (fn [ctx] ...))`.
- Each `defresource` is a surface. The `:handle-<method>` and `:decision-points` map to behaviour.

**Yada:**

- `(yada/resource {:methods {:get {:response ...}}})` — data-driven, similar shape to Reitit.

**Duct / Kit / Luminus frameworks:** these are project templates that compose Reitit / Compojure + Integrant / Component. The surface patterns are inherited from the underlying router; the framework contributes the lifecycle wiring.

**GraphQL (Lacinia):**

- Schema resolver map: `{:resolvers {:Query/fieldName resolver-fn :Mutation/fieldName ...}}`.
- Each `:TypeName/fieldName` keyword points at a resolver fn — map the spec operation to the resolver.

**gRPC (protojure):**

- `(defrecord ServiceImpl [] my.proto.Service (method-name [_ req] ...))` — the methods on a record extending a protobuf-generated protocol are the surface entries.

### UI surfaces

ClojureScript UI frameworks; uncommon for Clojure backends.

**Reagent / Re-frame:**

- Reagent components: fns returning Hiccup (`[:div ...]`). PascalCase is the *class* convention for React interop; Clojure components are typically named `<name-kebab>-component` or just `<name-kebab>` as a regular fn.
- Re-frame events: `(re-frame/reg-event-db :event-name (fn [db event] ...))` — the keyword `:event-name` is the surface identifier. The registered fn is the handler.
- Re-frame subscriptions: `(re-frame/reg-sub :sub-name (fn [db _] ...))` — same pattern; the keyword identifies the surface, the fn implements it.
- Re-frame effects: `(re-frame/reg-fx :effect-name ...)`.

**Fulcro:**

- `(defsc ComponentName [this props] {:query [...] :ident ...} body)` — `defsc` is the component-defining macro; the component name is the surface.
- Mutations: `(defmutation name [params] (action [env] ...))` — each `defmutation` is a surface operation.

**Hoplon / Om / Rum:** less common; follow the same pattern — a named var holds the UI component, its props are the `exposes` contract.

### Integration surfaces

**Message brokers:**

- Kafka (`jackdaw`): `(kafka/consumer {...})` followed by a `(loop [] (let [records (.poll consumer ...)] ...))` — the enclosing loop function is the handler; grep for `jackdaw.client/consumer` to find the entry points.
- Kafka (`kinsky`): similar; `(kinsky/consumer ...)` and a consume loop.
- RabbitMQ / AMQP (`langohr`): `(langohr.consumers/subscribe ch queue handler-fn)` — the third argument is the handler.
- Redis pub/sub (`carmine`): `(carmine/with-new-pubsub-listener ...)`, with a map of `channel → handler-fn`.

**Scheduled / background:**

- Quartzite: `(j/build ... (j/of-type MyJob))` where `MyJob` is a `(defrecord MyJob [] j/JobExecuteContext (execute [_ ctx] ...))`.
- `chime-core` / `at-at`: `(chime/chime-at times handler-fn)` — the handler fn is the surface.
- core.async scheduled loops: `(go-loop [] (<! (timeout ...)) (work) (recur))` — the enclosing named var is the surface.

**Event handlers (in-process):**

- core.async channels: `(go-loop [] (when-let [msg (<! ch)] (handle msg) (recur)))` — `handle` is the surface; the channel is the demand contract.
- Component / Integrant event topics: keywords in the system map point at the handler component.
- Manifold streams (`manifold.stream/consume`): `(s/consume handler stream)`.

**Integrant components** (lifecycle wiring):

- `(defmethod ig/init-key ::component-name [_ config] ...)` — each component key is a surface start-up; the method body's return value is the running component. `::component-name` is a namespaced keyword — match the spec construct by the local part (`component-name`).
- `(defmethod ig/halt-key! ::component-name [_ component] ...)` is the paired tear-down.
- Integrant components are frequently **not** surfaces themselves — they are how surfaces get wired. A Jetty component whose `::init-key` starts a Ring handler is lifecycle plumbing; the surface is the Ring handler it wraps. Judge case by case.

**Component (`stuartsierra/component`):**

- `(defrecord NameOfComponent [deps] component/Lifecycle (start [this] ...) (stop [this] ...))` — similar to Integrant; the record name is the component identifier.

**Mount:**

- `(defstate name-of-state :start (fn [] ...) :stop (fn [] ...))`.

**Serverless handlers:**

- AWS Lambda (Clojure via GraalVM or `hf.nrepl`): `(defn -handler [event context] ...)` or a `:gen-class` entry point.
- Babashka tasks: `bb.edn`'s `:tasks` map — each task name is a surface; the `:task` body is the implementation.

**SDK / outbound client surfaces:**

- Namespaces named `<name-kebab>-client`, `<name-kebab>-gateway`, `<name-kebab>-adapter`.
- `clj-http` / `hato` / `http-kit` wrapper fns: the exported fns of an `<name-kebab>-client` namespace are the surface entries.

### What not to match as surfaces

- Anything matched by the test exclusion globs in §4 — `*_test.{clj,cljs,cljc}`, `test/**`.
- `deftest`, `defspec`, `deftest-async` — test defs that happen to look like surface handlers.
- `user.clj` / `dev.clj` / `user.cljc` — REPL scratchpad namespaces.
- `build.clj`, `build/**` — tools.build scripts; build behaviour, not application behaviour.
- `.clj-kondo/hooks/**` — tooling, not application code.
- Macros that merely generate boilerplate (`defschema`, `defrecord` without body) — the *use* of the generated code is the surface; the definition is plumbing unless the spec specifically talks about the shape.
- Anonymous inline `(fn ...)` bodies passed as middleware — they are composition, not surfaces. Walk outward to the named var.
- Reagent `(r/atom ...)` or re-frame `reg-sub` subscriptions that only slice state — these are derived data, not surfaces. Map them to the event or component that reads them.
- `main` / `-main` entry points that only wire `run-jetty handler` — the surface is the handler; `-main` is the bootstrap.
- Integrant lifecycle methods whose bodies are only `(jetty/run-jetty ...)` or similar — as noted above, these are wiring for a surface, not the surface itself.
