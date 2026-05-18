/**
 * Build lifecycle: enqueue, start, mark success/failure, cancel.
 *
 * Each transition enforces guards on the build's current status. A
 * successful build is also the trigger for artifact uploads (handled
 * in artifacts.ts).
 */
import {
  Build,
  BuildStatus,
  PipelineStatus,
  Store,
} from "../models.js";

export class BuildTransitionError extends Error {}
export class BuildNotFoundError extends Error {}

export function enqueueBuild(
  store: Store,
  args: {
    buildId: string;
    pipelineId: string;
    commitSha: string;
    triggeredBy: string;
  },
): Build {
  const pipeline = store.pipelines.get(args.pipelineId);
  if (pipeline === undefined) {
    throw new BuildNotFoundError(`unknown pipeline ${args.pipelineId}`);
  }
  if (pipeline.status !== PipelineStatus.ACTIVE) {
    throw new BuildTransitionError(
      `pipeline ${args.pipelineId} is ${pipeline.status}; cannot enqueue`,
    );
  }
  const build: Build = {
    buildId: args.buildId,
    pipelineId: args.pipelineId,
    commitSha: args.commitSha,
    status: BuildStatus.QUEUED,
    triggeredBy: args.triggeredBy,
    queuedAt: new Date(),
    startedAt: null,
    finishedAt: null,
    failureReason: null,
  };
  store.builds.set(build.buildId, build);
  return build;
}

export function startBuild(store: Store, buildId: string): Build {
  const build = requireBuild(store, buildId);
  if (build.status !== BuildStatus.QUEUED) {
    throw new BuildTransitionError(`cannot start from ${build.status}`);
  }
  build.status = BuildStatus.RUNNING;
  build.startedAt = new Date();
  return build;
}

export function markBuildSuccess(store: Store, buildId: string): Build {
  const build = requireBuild(store, buildId);
  if (build.status !== BuildStatus.RUNNING) {
    throw new BuildTransitionError(`cannot mark success from ${build.status}`);
  }
  build.status = BuildStatus.SUCCESS;
  build.finishedAt = new Date();
  return build;
}

export function markBuildFailed(
  store: Store,
  buildId: string,
  reason: string,
): Build {
  const build = requireBuild(store, buildId);
  if (build.status !== BuildStatus.RUNNING) {
    throw new BuildTransitionError(`cannot mark failed from ${build.status}`);
  }
  build.status = BuildStatus.FAILED;
  build.failureReason = reason;
  build.finishedAt = new Date();
  return build;
}

export function cancelBuild(store: Store, buildId: string): Build {
  const build = requireBuild(store, buildId);
  if (build.status !== BuildStatus.QUEUED && build.status !== BuildStatus.RUNNING) {
    throw new BuildTransitionError(`cannot cancel from ${build.status}`);
  }
  build.status = BuildStatus.CANCELLED;
  build.finishedAt = new Date();
  return build;
}

function requireBuild(store: Store, buildId: string): Build {
  const build = store.builds.get(buildId);
  if (build === undefined) {
    throw new BuildNotFoundError(`unknown build ${buildId}`);
  }
  return build;
}
