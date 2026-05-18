/**
 * Test fixture helpers used across the propagated test suite.
 *
 * Each helper produces a freshly-built entity in a known state so individual
 * tests don't need to repeat the lifecycle scaffolding. Time-dependent helpers
 * accept an explicit `now` argument so temporal tests can position the entity
 * arbitrarily before/at/after deadlines without faking the system clock.
 */
import {
  Artifact,
  ArtifactStatus,
  Build,
  BuildStatus,
  Pipeline,
  PipelineStatus,
  Store,
} from '../src/models.js';
import { enqueueBuild, startBuild, markBuildSuccess } from '../src/services/builds.js';
import { registerArtifact, markArtifactUploaded } from '../src/services/artifacts.js';

export function makePipeline(
  store: Store,
  overrides: Partial<Pipeline> = {},
): Pipeline {
  const pipeline: Pipeline = {
    pipelineId: overrides.pipelineId ?? 'pl-1',
    name: overrides.name ?? 'pipeline-1',
    repoUrl: overrides.repoUrl ?? 'git@github.com:acme/widgets.git',
    status: overrides.status ?? PipelineStatus.ACTIVE,
    defaultBranch: overrides.defaultBranch ?? 'main',
    createdAt: overrides.createdAt ?? new Date('2026-01-01T00:00:00Z'),
  };
  store.pipelines.set(pipeline.pipelineId, pipeline);
  return pipeline;
}

/**
 * Build a queued Build for a pre-existing active pipeline using the production
 * enqueueBuild path. Returns the build in `queued` state.
 */
export function makeQueuedBuild(
  store: Store,
  pipelineId = 'pl-1',
  buildId = 'b-1',
): Build {
  return enqueueBuild(store, {
    buildId,
    pipelineId,
    commitSha: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
    triggeredBy: 'alice',
  });
}

/** Run the full queued -> running transition via startBuild. */
export function makeRunningBuild(
  store: Store,
  pipelineId = 'pl-1',
  buildId = 'b-1',
): Build {
  makeQueuedBuild(store, pipelineId, buildId);
  return startBuild(store, buildId);
}

/** Run queued -> running -> success via markBuildSuccess. */
export function makeSuccessBuild(
  store: Store,
  pipelineId = 'pl-1',
  buildId = 'b-1',
): Build {
  makeRunningBuild(store, pipelineId, buildId);
  return markBuildSuccess(store, buildId);
}

/**
 * Build a pending artifact tied to a succeeded build (created on demand) using
 * registerArtifact. Returns the artifact in `pending` state.
 */
export function makePendingArtifact(
  store: Store,
  artifactId = 'a-1',
  buildId = 'b-1',
  pipelineId = 'pl-1',
): Artifact {
  if (!store.builds.has(buildId)) {
    makeSuccessBuild(store, pipelineId, buildId);
  }
  return registerArtifact(store, {
    artifactId,
    buildId,
    name: 'dist.tgz',
    sizeBytes: 1024,
  });
}

/** Walk pending -> uploaded via markArtifactUploaded. */
export function makeUploadedArtifact(
  store: Store,
  artifactId = 'a-1',
  buildId = 'b-1',
  pipelineId = 'pl-1',
  storageKey = 'bucket/object',
): Artifact {
  makePendingArtifact(store, artifactId, buildId, pipelineId);
  return markArtifactUploaded(store, artifactId, storageKey);
}

/**
 * Force an artifact's status. Used to set up illegal source states for
 * negative tests where the production lifecycle wouldn't normally produce
 * that state.
 */
export function forceArtifactStatus(
  artifact: Artifact,
  status: ArtifactStatus,
): Artifact {
  artifact.status = status;
  return artifact;
}

export function forceBuildStatus(
  build: Build,
  status: BuildStatus,
): Build {
  build.status = status;
  return build;
}

export const BuildStatuses: BuildStatus[] = [
  BuildStatus.QUEUED,
  BuildStatus.RUNNING,
  BuildStatus.SUCCESS,
  BuildStatus.FAILED,
  BuildStatus.CANCELLED,
];

export const ArtifactStatuses: ArtifactStatus[] = [
  ArtifactStatus.PENDING,
  ArtifactStatus.UPLOADED,
  ArtifactStatus.EXPIRED,
];

export const PipelineStatuses: PipelineStatus[] = [
  PipelineStatus.ACTIVE,
  PipelineStatus.PAUSED,
  PipelineStatus.ARCHIVED,
];
