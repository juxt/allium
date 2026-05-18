/**
 * Shared fixtures for the propagated test suite.
 *
 * The implementation has no factory layer, so these helpers build entity
 * shapes directly and route mutation through the service-layer code under
 * test. Time is controlled via jest fake timers (no clock seam in the impl).
 */
import {
  Artifact,
  ArtifactStatus,
  Build,
  BuildStatus,
  Pipeline,
  PipelineStatus,
  Store,
} from "../src/models.js";

export function makePipeline(over: Partial<Pipeline> = {}): Pipeline {
  return {
    pipelineId: "pipe-1",
    name: "primary",
    repoUrl: "https://github.com/acme/widgets",
    status: PipelineStatus.ACTIVE,
    defaultBranch: "main",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...over,
  };
}

export function makeBuild(over: Partial<Build> = {}): Build {
  return {
    buildId: "build-1",
    pipelineId: "pipe-1",
    commitSha: "deadbeefcafef00d",
    status: BuildStatus.QUEUED,
    triggeredBy: "alice",
    queuedAt: new Date("2026-01-01T00:00:00Z"),
    startedAt: null,
    finishedAt: null,
    failureReason: null,
    ...over,
  };
}

export function makeArtifact(over: Partial<Artifact> = {}): Artifact {
  return {
    artifactId: "art-1",
    buildId: "build-1",
    name: "bundle.tar.gz",
    sizeBytes: 1024,
    status: ArtifactStatus.PENDING,
    uploadedAt: null,
    expiresAt: null,
    storageKey: null,
    ...over,
  };
}

export function makeStore(opts: {
  pipelines?: Pipeline[];
  builds?: Build[];
  artifacts?: Artifact[];
} = {}): Store {
  const store = new Store();
  for (const p of opts.pipelines ?? []) store.pipelines.set(p.pipelineId, p);
  for (const b of opts.builds ?? []) store.builds.set(b.buildId, b);
  for (const a of opts.artifacts ?? []) store.artifacts.set(a.artifactId, a);
  return store;
}
