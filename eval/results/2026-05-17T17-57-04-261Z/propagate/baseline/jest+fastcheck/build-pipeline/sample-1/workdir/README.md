# Build-pipeline fixture

A small build/CI pipeline service in **TypeScript**. Used as a third
fixture for the distill A/B harness to verify the skill generalises
across source languages, not just across Python codebases.

About 570 LOC across 9 TypeScript files. Built only against stdlib;
not intended to run.

## Domain

Three core entities plus one external entity:

| Entity            | File                            | Notes                                                  |
|-------------------|---------------------------------|--------------------------------------------------------|
| `Pipeline`        | `src/models.ts:33`              | named CI pipeline tied to a repo + default branch       |
| `Build`           | `src/models.ts:42`              | one CI run; status enum + start/finish timestamps       |
| `Artifact`        | `src/models.ts:54`              | produced by a successful build; has TTL + storage key   |
| `GithubPushEvent` | `src/models.ts:67`              | **External** — webhook payload from GitHub              |

## File layout

```
src/
├── index.ts                 # Router + Store + entrypoint
├── models.ts                # interfaces, enums, derived helpers
├── routes.ts                # 8 HTTP endpoints
├── webhooks.ts              # GitHub push receiver
├── jobs.ts                  # 3 scheduled jobs
├── services/
│   ├── builds.ts            # build lifecycle (queue / start / success / fail / cancel)
│   └── artifacts.ts         # artifact lifecycle (register / uploaded / expired)
└── integrations/
    └── storage.ts           # blob storage client (S3-shaped)
```

## Patterns exercised

| #  | Pattern                       | Where to find it                                                                |
|----|-------------------------------|----------------------------------------------------------------------------------|
| 1  | Status enums / state machines | `src/models.ts:9` PipelineStatus, `:15` BuildStatus, `:22` ArtifactStatus        |
| 2  | Guarded transitions           | `src/services/builds.ts` — `startBuild` (queued only), `markBuildSuccess` / `markBuildFailed` (running only), `cancelBuild` (queued/running), `enqueueBuild` (pipeline must be active) |
| 3  | Temporal rules                | `src/jobs.ts:22` `timeoutQueuedBuilds` (30 min), `:34` `failStuckBuilds` (1 hour), `:45` `expireOldArtifacts` (7-day TTL) |
| 4  | External entity (via webhook) | `src/models.ts:67` `GithubPushEvent` + `src/webhooks.ts:25` receiver — enqueues a build per matching active pipeline |
| 5  | Third-party integration       | `src/integrations/storage.ts` blob storage client                                |
| 6  | Implicit state machine        | `src/models.ts:96` `buildIsStuck` — derived from `(status, startedAt)`; no `stuck` enum value |
| 7  | Derived properties            | `src/models.ts:90` `buildDurationMs`, `:96` `buildIsStuck`, `:103` `artifactIsExpired`, `:108` `pipelineActiveBuildCount` |
| 8  | FK → relationship             | `src/models.ts:43` `Build.pipelineId: string` should distil to `pipeline: Pipeline`; same for `Artifact.buildId` → `build: Build`     |

(Scattered-logic pattern is not deliberately exercised here — kept the
fixture intentionally smaller as a generalisation smoke test rather than
a full pattern-coverage rerun.)

## Sanity check

```sh
cd fixtures/build-pipeline
# Type-check with TypeScript if you have it installed:
#   npx tsc --noEmit
```
