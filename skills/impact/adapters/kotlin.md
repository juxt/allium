# Kotlin adapter

The Kotlin language adapter for the `impact` skill. Follows the five-section contract in [README.md](./README.md).

## 1. Fingerprint

Activate this adapter if any of the following is present in the target project:

- `build.gradle.kts` at the project root with the Kotlin plugin applied (`kotlin("jvm")`, `kotlin("multiplatform")`, `kotlin("android")`).
- `settings.gradle.kts` at the project root (Kotlin-DSL Gradle root, common for Kotlin-native projects).
- `pom.xml` at the project root declaring `kotlin-maven-plugin` (Kotlin-on-Maven, rarer).
- `AndroidManifest.xml` and `build.gradle.kts` / `build.gradle` (Android Kotlin project).
- Any `**/*.{kt,kts}` file inside the project root.

For mixed Kotlin/Java projects, load both adapters — many Spring / Android / server-side Kotlin codebases have `.java` sources alongside `.kt`. The Java adapter's Gradle / Maven project-root rules apply unchanged.

## 2. LSP plugin

**Plugin:** `kotlin-lsp` (from Anthropic's `claude-plugins-official` marketplace). Uses JetBrains' official Kotlin LSP server ([github.com/Kotlin/kotlin-lsp](https://github.com/Kotlin/kotlin-lsp)), not the community fwcd/kotlin-language-server.

**Requirements:** JDK 17 or later on PATH (`java -version`). The LSP server runs on the JVM. If a Java adapter is already active, the JDK requirement is shared.

**Install:**

```bash
# 1. Install JDK 17+ if you don't already have one (see the Java adapter
#    for detailed JDK install options; any working JDK 17+ satisfies both).
#    Verify: java -version

# 2. Install the Kotlin LSP binary so that `kotlin-lsp` resolves on the
#    global PATH. The Claude Code LSP tool spawns this binary from PATH.
#    macOS: brew install JetBrains/utils/kotlin-lsp
#    Other: download from https://github.com/Kotlin/kotlin-lsp/releases
#           and place the launcher on your PATH.

# Verify:
which kotlin-lsp     # must print a path
which java           # must print a path

# 3. In Claude Code, add the marketplace and install the plugin:
/plugin marketplace add anthropics/claude-plugins-official
/plugin install kotlin-lsp
```

After install, run `/reload-plugins` (or restart the session) and the built-in `LSP` tool will route `.kt` and `.kts` files to the Kotlin LSP server.

**Caveat — first-invocation cost.** Like JDT.LS, the Kotlin LSP indexes the Gradle / Maven classpath on cold start. For a project with Kotlin compiler plugins (KSP, kapt, serialisation) and many Gradle modules, expect a multi-second first-response delay. Retry once after 10–15 seconds before concluding the LSP is broken.

**Caveat — Gradle-KTS interpretation.** The LSP runs Gradle to resolve dependencies. If the project has compile errors in its `build.gradle.kts` or hasn't fetched dependencies, the LSP will report degraded symbol information. `./gradlew help` (or `build`) should succeed before running the impact pipeline on a fresh clone.

**Caveat — single-file indexing is likely here too.** Treat the LSP tool as a single-file symbol and type oracle by default (same guidance as the Python and Java adapters). The impact-skill pipeline uses Glob + per-file `documentSymbol`; do not rely on `workspaceSymbol` without empirically confirming it works for your setup.

**Sentinel:** open any `.kt` file in the project and call `documentSymbol` on it. If the LSP returns a non-empty symbol tree, the server is live. If the call errors with `Executable not found in $PATH`, `kotlin-lsp` isn't installed. If it errors on JDK version, JDK 17+ isn't the one on PATH. If it returns a nearly empty tree on a file that clearly has classes, the project probably hasn't had dependencies resolved yet — run `./gradlew help` first.

## 3. Name-variant generator

Given a spec identifier (PascalCase in Allium), emit variants following Kotlin convention.

**For entities and variants:**

- `<Name>` — PascalCase class, data class, sealed class, interface, object, enum, or type alias.
- `<Name>Impl`, `Default<Name>`, `Abstract<Name>` — implementation / default / abstract bases.
- `<Name>Service`, `<Name>Repository`, `<Name>UseCase`, `<Name>Interactor`, `<Name>Manager` — layered-architecture suffixes (clean architecture / Android MVVM / DDD).
- `<Name>ViewModel`, `<Name>UiState`, `<Name>Screen`, `<Name>Composable` — Android / Jetpack Compose component suffixes.
- `<Name>Dto`, `<Name>Entity`, `<Name>Model`, `<Name>Request`, `<Name>Response` — data-carrier suffixes.
- `<Name>.Companion` or `<Name>.Companion.create(...)` — companion-object factory pattern (Kotlin's idiomatic replacement for static factory methods).
- `<Name>Builder`, `<Name>Factory`, `<Name>Provider` — creational-pattern suffixes (when used explicitly rather than via companion objects).

**For rules and triggers:**

- `<verbPhrase>` — camelCase function (Allium `ScheduleInterview` → `scheduleInterview`).
- `<VerbPhrase>` — PascalCase command / handler / event class (CQRS-style or sealed-class event hierarchies).
- `<VerbPhrase>Command`, `<VerbPhrase>Handler`, `<VerbPhrase>UseCase`, `<VerbPhrase>Event` — clean-architecture / CQRS naming.
- `handle<VerbPhrase>`, `on<VerbPhrase>`, `process<VerbPhrase>`, `execute<VerbPhrase>` — handler method variants.
- `suspend fun <verbPhrase>(...)` — coroutine-based handlers; the `suspend` modifier is visible on the LSP symbol signature.

**For surfaces:**

- `<Name>Controller`, `<Name>Resource`, `<Name>Endpoint` — Spring / JAX-RS / Micronaut / Quarkus REST surfaces.
- `<name>Routes`, `<name>Routing` — Ktor routing modules (Kotlin convention is a top-level function taking `Route.() -> Unit`).
- `<Name>Fragment`, `<Name>Activity`, `<Name>Screen` — Android UI surface names.

**Case conversion:** splitting on CamelCase and converting the first char of each component to lower (camelCase for functions, PascalCase preserved for classes) is sufficient. Kotlin idiomatic extension functions are fine: a spec `Candidacy.schedule` may be realised as `fun Candidacy.schedule() = ...` — emit `schedule` as a plain name-variant candidate and rely on the call-hierarchy expansion to connect it back to the receiver type.

## 4. Project-root rule

**Root discovery:** walk upward from the spec file's directory.

- If a `settings.gradle.kts` or `settings.gradle` is found, that directory is the root (Gradle multi-module). This covers the majority of modern Kotlin projects.
- Otherwise the first directory containing `build.gradle.kts` or `build.gradle` is the root.
- Otherwise the first directory containing `pom.xml` is the root (Kotlin-on-Maven).
- For Android projects, the project root is the directory containing `settings.gradle*` — not an individual app module (`app/`, `library/`).
- Fallback: the first directory containing a `.git` folder.

**Source globs:**

- `src/main/kotlin/**/*.kt` — Gradle standard layout.
- `src/main/java/**/*.kt` — some Kotlin projects colocate `.kt` files under `src/main/java` (valid; Gradle accepts it).
- `*/src/main/kotlin/**/*.kt` at the root, recursing into each module (multi-module).
- Kotlin Multiplatform: `src/commonMain/kotlin/**/*.kt`, `src/jvmMain/kotlin/**/*.kt`, `src/androidMain/kotlin/**/*.kt`, `src/nativeMain/kotlin/**/*.kt` — all are first-class source sets. The impact pipeline should walk each source set the project actually declares.
- Android: `app/src/main/kotlin/**/*.kt`, `app/src/main/java/**/*.kt` (Android tolerates both), plus per-flavor source sets if the project uses product flavors.

**Exclusions (always):**

- `src/test/**`, `src/androidTest/**`, `src/integrationTest/**`, `src/functionalTest/**` — test sources.
- `target/**`, `build/**`, `out/**`, `.gradle/**` — build outputs and Gradle cache.
- `build/generated/**`, `build/tmp/**`, `build/intermediates/**` — annotation-processor / KSP / kapt / Android codegen output.
- `**/generated/**`, `**/*.kt.generated` — other codegen paths.
- `.idea/**`, `.settings/**`, `*.iml`, `local.properties`, `gradle.properties` — IDE / local-only metadata.
- `**/*.class`, `**/*.jar`, `**/*.aar` — compiled artefacts.
- `buildSrc/**` — Gradle build logic, not application behaviour (unless the spec describes build behaviour specifically).
- Any path matched by the project's `.gitignore`.

**Depth:** default call-hierarchy expansion depth is 2. Stop when a call crosses into a dependency JAR or the Kotlin standard library (`kotlin.*`, `kotlinx.*`). Be aware of:

- **Extension functions** may appear as methods on the receiver type in LSP results — prefer the file where the extension is declared.
- **Top-level functions** in Kotlin have no enclosing class; the LSP reports them as file-level symbols. Record the file + line, not a synthetic class name.
- **Companion objects** expose their members under `<Name>.Companion`; the LSP usually shows them as static-like. Prefer the declaring class's FQN with `.Companion.` in the path.
- **Inline functions** may be source-inlined at call sites; call-hierarchy results can be noisy. Treat inline-function call sites as valid edges.

## 5. Surface entry-point patterns

### API surfaces

**Ktor** (Kotlin-native, most common for Kotlin server-side):

- Routing DSL: `routing { get("/path") { ... } }`, `post`, `put`, `delete`, `patch`, `head`, `options`.
- Route blocks: `route("/path") { get { ... } }`, nested routing via `Route.yourModule()` top-level functions.
- Plugin installation: `install(ContentNegotiation) { ... }`, `install(Authentication) { ... }` — affects surface contracts.
- Application entry: `fun Application.module() { ... }` or `fun main() { embeddedServer(Netty, port = 8080) { module() }.start() }`.

**Spring Boot** (with Spring Kotlin support): same annotations as the [Java adapter](./java.md). `@RestController`, `@GetMapping`, `@RequestMapping`, etc. Spring Kotlin DSL (`router { GET("/path") { ... } }`) is also used; match `router { ... }` top-level bean definitions as surface containers.

**Micronaut / Quarkus:** same annotations as the Java adapter.

**JAX-RS (on Kotlin):** same annotations as the Java adapter.

**gRPC:** classes extending the generated `*ImplBase` from a `.proto`, written in Kotlin. Usually combined with `kotlinx.coroutines` for `suspend` RPCs.

**GraphQL (ExpediaGroup's graphql-kotlin):** `@GraphQLDescription` / `@GraphQLName` annotations on resolver classes; the functions are the surface operations.

### UI surfaces

**Android (XML views / Fragments / Activities):**

- Classes extending `AppCompatActivity`, `ComponentActivity`, `Fragment`, `DialogFragment`.
- `@AndroidEntryPoint` (Hilt) — marks injection-capable entry points.
- The Activity / Fragment class is the surface; its public methods are the user-observable behaviour.

**Jetpack Compose:**

- Functions annotated `@Composable` are the UI unit. PascalCase by convention.
- Screen-level composables typically live in `screens/`, `ui/`, `features/<feature>/`.
- The `@Composable` function is the surface entry point; its parameters are the `exposes` / `demands` contract.

**Compose Multiplatform / Kotlin Multiplatform Mobile:** same `@Composable` convention, source set varies (`src/commonMain/kotlin/**`).

### Integration surfaces

**Message brokers and queues:**

- Kafka (Spring): `@KafkaListener`.
- Kafka (plain): `Consumer.poll()` loops — grep the call sites; the enclosing function is the handler.
- RabbitMQ / AMQP (Spring): `@RabbitListener`.
- Ktor server WebSocket: `webSocket("/path") { ... }` inside a `routing { }` block.

**Coroutines-based handlers:**

- `Flow<T>` collectors: `.collect { ... }` calls where the lambda is the handler.
- `Channel<T>` receivers: `for (item in channel) { ... }` loops.
- `GlobalScope.launch`, `CoroutineScope.launch` — scope-bound background work; the launched block is the handler.
- Ktor client retrofit-style interfaces with `@GET`, `@POST` (Retrofit + Kotlin coroutines).

**Scheduled / background:**

- Spring: `@Scheduled(cron = ...)`.
- Quartz: classes implementing `Job`.
- Android WorkManager: classes extending `Worker`, `CoroutineWorker`, `ListenableWorker`. `doWork` / `startWork` is the surface entry.

**Event listeners (in-process):**

- Spring: `@EventListener`, `ApplicationListener<E>` — same as the Java adapter.
- Kotlin-idiomatic: `EventBus`-style libraries (GreenRobot, LiveData / StateFlow observers).

**Serverless handlers:**

- AWS Lambda: classes implementing `RequestHandler<I, O>` or `RequestStreamHandler`. Kotlin `suspend` variants exist via third-party wrappers.

**SDK / outbound client surfaces:**

- Classes named `<Name>Client`, `<Name>Gateway`, `<Name>Adapter`.
- Retrofit interfaces: `interface <Name>Api { @GET(...) suspend fun ... }` — each method is a contract entry.
- Ktor `HttpClient` wrapper classes — the public methods are the surface.

### What not to match as surfaces

- Anything under `src/test/**`, `src/androidTest/**`, or suffixed `Test` / `Tests` / `IT` / `Spec` — test classes and specs.
- Generated Kotlin files: Hilt `*_GeneratedInjector`, Dagger `*_Factory`, Room `*_Impl`, DataBinding, kapt `*.generated`, KSP-generated stubs.
- `buildSrc` modules — Gradle build logic, not application behaviour.
- `BuildConfig` and Android resource-binding classes (`R`, `Manifest`).
- Abstract controllers / handlers — follow `goToImplementation` to the concrete subclass and map the surface there.
- Companion-object-only classes that serve as namespaces for constants — not surfaces, just grouping.
- Jetpack Compose `@Preview` functions — these are IDE previews, not real UI surfaces.
- Ktor routing extensions defined in library code — map surfaces to the app's own `Application.module()` and its extension-function routes.
