# Java adapter

The Java language adapter for the `impact` skill. Follows the five-section contract in [README.md](./README.md).

## 1. Fingerprint

Activate this adapter if any of the following is present in the target project:

- `pom.xml` at the project root (Maven).
- `build.gradle`, `build.gradle.kts`, or `settings.gradle` / `settings.gradle.kts` at the project root (Gradle, including multi-module).
- `build.xml` at the project root (Ant — rare, legacy).
- Any `**/*.java` file inside the project root (fallback for manifest-less projects).

For multi-module builds, the project root is the directory of the **top-level** `pom.xml` or `settings.gradle*` — not an individual module's manifest.

## 2. LSP plugin

**Plugin:** `jdtls-lsp` (from Anthropic's `claude-plugins-official` marketplace). Uses Eclipse JDT.LS.

**Requirements:** Java 17 or later (JDK, not JRE) must be on PATH. `java -version` should print `openjdk version "17"` or higher.

**Install:**

```bash
# 1. Install JDK 17+ if you don't already have one.
#    macOS:    brew install openjdk@17
#    Ubuntu:   apt install openjdk-17-jdk
#    SDKMAN:   sdk install java 21-tem
#    Verify:   java -version

# 2. Install jdtls so that `jdtls` resolves on the global PATH. The
#    Claude Code LSP tool spawns this binary from PATH.
#    macOS:    brew install jdtls
#    Arch:     yay -S jdtls   (AUR)
#    Other:    download from https://download.eclipse.org/jdtls/snapshots/
#              extract to e.g. ~/.local/share/jdtls, then create a
#              wrapper script named `jdtls` on your PATH.

# Verify:
which jdtls       # must print a path
which java        # must print a path

# 3. In Claude Code, add the marketplace and install the plugin:
/plugin marketplace add anthropics/claude-plugins-official
/plugin install jdtls-lsp
```

After install, run `/reload-plugins` (or restart the session) and the built-in `LSP` tool will route Java files to JDT.LS.

**Caveat — first-invocation cost.** JDT.LS has a substantially higher cold-start cost than pyright: it indexes the project's classpath (Maven/Gradle dependencies, target/build outputs, generated sources) on first contact. Expect a multi-second delay on the first `documentSymbol` or `hover` call in a fresh session. Subsequent calls are fast. If the sentinel call below times out the first time, retry after 10–15 seconds before concluding the LSP is broken.

**Caveat — single-file indexing is likely here too.** Treat the LSP tool as a single-file symbol and type oracle by default (same guidance as the Python adapter). JDT.LS is more workspace-aware than pyright under normal usage, but the Claude Code harness has only been verified in single-file mode. The impact-skill pipeline uses Glob + per-file `documentSymbol`; do not rely on `workspaceSymbol` without empirically confirming it works for your setup.

**Sentinel:** open any `.java` file in the project and call `documentSymbol` on it. If JDT.LS returns a non-empty symbol tree, the server is live. If the call errors with `Executable not found in $PATH`, jdtls isn't installed — tell the user to run the install steps above. If it errors with a JDK-version message, Java 17+ isn't installed or isn't the one on PATH.

## 3. Name-variant generator

Given a spec identifier (PascalCase in Allium), emit variants following Java convention.

**For entities and variants:**

- `<Name>` — PascalCase class, interface, enum, or record.
- `<Name>Impl`, `Default<Name>`, `Abstract<Name>` — implementation / default / abstract-base classes.
- `I<Name>` — interface prefix (Hungarian-style, uncommon but present in some shops).
- `<Name>Service`, `<Name>Repository`, `<Name>Controller`, `<Name>Manager`, `<Name>Facade` — standard layered-architecture suffixes.
- `<Name>Dto`, `<Name>Entity`, `<Name>Model`, `<Name>Record` — data-carrier suffixes.
- `<Name>Factory`, `<Name>Builder`, `<Name>Provider` — creational-pattern suffixes.

**For rules and triggers:**

- `<verbPhraseCamel>` — camelCase method (Allium `ScheduleInterview` → `scheduleInterview`).
- `<VerbPhrase>` — PascalCase command/event/handler class.
- `<VerbPhrase>Command`, `<VerbPhrase>Handler`, `<VerbPhrase>Event` — CQRS / event-sourcing pattern.
- `handle<VerbPhrase>`, `on<VerbPhrase>`, `process<VerbPhrase>`, `execute<VerbPhrase>` — handler method variants.

**For surfaces:**

- `<Name>Controller`, `<Name>Resource`, `<Name>Endpoint` — REST controller classes (Spring / JAX-RS / Micronaut).
- `<Name>GrpcService` — gRPC service implementations.

**Case conversion:** splitting on CamelCase and converting the first char of each component to lower (camelCase for methods, PascalCase preserved for classes) is sufficient. Acronyms in identifiers: treat `XML`, `HTTP`, `ID`, `URL`, `SQL` etc. as single units both as `XML` and `Xml` — emit both variants when the spec uses an acronym (`ScheduleXmlImport` and `ScheduleXMLImport` as alternates).

## 4. Project-root rule

**Root discovery:** walk upward from the spec file's directory.

- If a `settings.gradle` or `settings.gradle.kts` is found, that directory is the root (multi-module Gradle).
- Otherwise the first directory containing `pom.xml` is the root — but for Maven multi-module, continue walking up: the topmost `pom.xml` whose `<packaging>` is `pom` wins. If none have `pom` packaging, the deepest-located `pom.xml` on the walk wins.
- Otherwise the first directory containing `build.gradle` / `build.gradle.kts` / `build.xml` is the root.
- Fallback: the first directory containing a `.git` folder.

**Source globs:**

- `src/main/java/**/*.java` (Maven and Gradle standard layout).
- For multi-module: `*/src/main/java/**/*.java` at the root, recursing into each module.
- Kotlin-mixed projects: also include `src/main/kotlin/**/*.kt` if the Kotlin adapter is not loaded; Kotlin call sites into Java types are resolvable by JDT.LS in many setups but the adapter's primary source remains `.java`.

**Exclusions (always):**

- `src/test/**`, `src/integrationTest/**` — test sources.
- `target/**` — Maven build output.
- `build/**`, `out/**` — Gradle / IntelliJ build output.
- `target/generated-sources/**`, `build/generated/**`, `**/generated/**` — annotation-processor and code-generator output (Lombok, MapStruct, Protobuf, QueryDSL).
- `.idea/**`, `.settings/**`, `.project`, `.classpath`, `*.iml` — IDE metadata.
- `**/*.class`, `**/*.jar`, `**/*.war`, `**/*.ear` — compiled artefacts.
- Any path matched by the project's `.gitignore`.

**Depth:** default call-hierarchy expansion depth is 2. Stop when a call crosses into a dependency JAR (anything outside the project's source set). Be aware that Lombok-generated methods (`getX`, `setX`, `builder()`) may appear as synthetic symbols — prefer the declaring field over the synthetic accessor when recording links.

## 5. Surface entry-point patterns

### API surfaces

**Spring Boot / Spring MVC:**

- Class-level: `@RestController`, `@Controller`, `@RequestMapping("/path")`.
- Method-level: `@GetMapping`, `@PostMapping`, `@PutMapping`, `@DeleteMapping`, `@PatchMapping`, `@RequestMapping(method = ...)`.
- Error handlers: `@ExceptionHandler`, `@ControllerAdvice`, `@RestControllerAdvice`.
- Outbound clients: `@FeignClient` interfaces (Spring Cloud) — treat as surface-level contracts the code demands from an external service.

**JAX-RS (Jakarta RESTful Web Services):**

- Class-level: `@Path("/path")`.
- Method-level: `@GET`, `@POST`, `@PUT`, `@DELETE`, `@HEAD`, `@OPTIONS`, `@PATCH`.
- Content negotiation: `@Produces(...)`, `@Consumes(...)` — relevant to contract `demands`/`fulfils`.

**Micronaut / Quarkus:** both accept Spring-style and JAX-RS annotations. Also:

- Micronaut: `@Controller("/path")` at class level, `@Get`, `@Post`, `@Put`, `@Delete`, `@Patch` at method level. `@Client(...)` for outbound HTTP clients.
- Quarkus: predominantly JAX-RS-style; `@RegisterRestClient` for MicroProfile REST clients.

**Servlet API (legacy):**

- `@WebServlet("/path")` on classes extending `HttpServlet`. `doGet`, `doPost`, etc. are the per-method entry points.

**gRPC:**

- Classes extending a generated `*ImplBase` class (from a `.proto`).
- Micronaut: `@GrpcService`. Spring: grpc-spring-boot-starter auto-registers `@GrpcService` beans.

### UI surfaces

Rare for Java backends. When present:

- **Thymeleaf / JSP:** `@Controller` methods returning view names — treat the controller method as the surface entry point, not the template.
- **JavaFX:** classes extending `Application`; controllers referenced from `.fxml` via `fx:controller=`; methods annotated `@FXML` are event handlers.
- **Swing / AWT (desktop, legacy):** classes extending `JFrame`, `JPanel`, `JDialog`; `ActionListener` implementations are event entry points.

### Integration surfaces

**Message brokers:**

- Kafka: `@KafkaListener(topics = ...)`.
- RabbitMQ / AMQP: `@RabbitListener(queues = ...)`, `@RabbitHandler`.
- JMS: `@JmsListener(destination = ...)`.
- Spring Cloud Stream: `@Bean Function<I, O>` / `Consumer<I>` / `Supplier<O>` binding names.

**Scheduled / background:**

- Spring: `@Scheduled(cron = ...)`, `@Scheduled(fixedRate = ...)`.
- Quartz: classes implementing `Job`, `execute(JobExecutionContext)`.
- Micronaut: `@Scheduled`.

**Event listeners (in-process):**

- Spring: `@EventListener`, `@TransactionalEventListener`, `ApplicationListener<E>` implementations.

**AWS Lambda handlers:**

- Classes implementing `RequestHandler<I, O>` or `RequestStreamHandler` — `handleRequest` is the surface entry point.
- The `MANIFEST.MF` / `pom.xml` `mainClass` or the deployment descriptor is the dispatch target.

**SDK / outbound client surfaces:**

- Classes named `<Name>Client`, `<Name>Gateway`, `<Name>Adapter`, `<Name>Proxy`.
- Feign interfaces annotated `@FeignClient(name = ...)`.
- MicroProfile REST clients annotated `@RegisterRestClient`.

### What not to match as surfaces

- Anything under `src/test/**` — test classes, even those annotated with route/handler annotations (e.g. `@WebMvcTest`-scoped controllers).
- Classes suffixed `Test`, `Tests`, `IT`, `E2E`, or annotated `@Test`, `@SpringBootTest`, `@WebMvcTest`, `@DataJpaTest`, etc.
- Abstract controllers / handlers — follow `goToImplementation` to the concrete subclass and map the surface there.
- Lombok-generated accessors surfaced by the LSP — prefer the declaring field or the method you authored.
- `@Configuration` / `@Bean` wiring classes — these are composition plumbing, not behavioural surfaces (unless the bean itself is a controller/listener, in which case that bean is the surface).
- Auto-generated stubs from `.proto`, OpenAPI codegen, or JAXB — map surfaces to the hand-authored service class that *implements* them, not the generated base.
