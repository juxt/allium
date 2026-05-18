import {
  Artifact,
  ArtifactStatus,
  Build,
  BuildStatus,
  GithubPushEvent,
  Pipeline,
  PipelineStatus,
  Store,
} from "../src/models.js";

export function makePipeline(overrides: Partial<Pipeline> = {}): Pipeline {
  return {
    pipelineId: "pipe-1",
    name: "default",
    repoUrl: "https://github.com/acme/widget",
    status: PipelineStatus.ACTIVE,
    defaultBranch: "main",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

export function makeBuild(overrides: Partial<Build> = {}): Build {
  return {
    buildId: "build-1",
    pipelineId: "pipe-1",
    commitSha: "abc1234deadbeef",
    status: BuildStatus.QUEUED,
    triggeredBy: "octocat",
    queuedAt: new Date("2026-01-01T00:00:00Z"),
    startedAt: null,
    finishedAt: null,
    failureReason: null,
    ...overrides,
  };
}

export function makeArtifact(overrides: Partial<Artifact> = {}): Artifact {
  return {
    artifactId: "art-1",
    buildId: "build-1",
    name: "bundle.tar.gz",
    sizeBytes: 1024,
    status: ArtifactStatus.PENDING,
    uploadedAt: null,
    expiresAt: null,
    storageKey: null,
    ...overrides,
  };
}

export function makePushEvent(
  overrides: Partial<GithubPushEvent> = {},
): GithubPushEvent {
  return {
    eventId: "evt-1",
    repoFullName: "acme/widget",
    branch: "main",
    commitSha: "abc1234deadbeef",
    pushedBy: "octocat",
    receivedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

/** Builds a store seeded with an active pipeline and a build in the given state. */
export function storeWithBuild(buildOverrides: Partial<Build> = {}): {
  store: Store;
  pipeline: Pipeline;
  build: Build;
} {
  const store = new Store();
  const pipeline = makePipeline();
  store.pipelines.set(pipeline.pipelineId, pipeline);
  const build = makeBuild(buildOverrides);
  store.builds.set(build.buildId, build);
  return { store, pipeline, build };
}

/** Builds a store seeded with an active pipeline, a SUCCESS build, and a pending artifact. */
export function storeWithArtifact(
  artifactOverrides: Partial<Artifact> = {},
): {
  store: Store;
  pipeline: Pipeline;
  build: Build;
  artifact: Artifact;
} {
  const { store, pipeline, build } = storeWithBuild({
    status: BuildStatus.SUCCESS,
    startedAt: new Date("2026-01-01T00:00:00Z"),
    finishedAt: new Date("2026-01-01T00:10:00Z"),
  });
  const artifact = makeArtifact(artifactOverrides);
  store.artifacts.set(artifact.artifactId, artifact);
  return { store, pipeline, build, artifact };
}
