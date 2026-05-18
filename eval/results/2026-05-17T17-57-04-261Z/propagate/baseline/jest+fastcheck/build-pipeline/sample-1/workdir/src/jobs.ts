/**
 * Scheduled jobs.
 *
 * Cadences:
 *   - cancel-stuck-builds: every 5 minutes
 *   - expire-old-artifacts: daily at 02:00 UTC
 *   - timeout-queued-builds: every 5 minutes
 */
import {
  ArtifactStatus,
  BuildStatus,
  QUEUED_TIMEOUT_MS,
  STUCK_AFTER_MS,
  Store,
  artifactIsExpired,
  buildIsStuck,
} from "./models.js";
import { cancelBuild, markBuildFailed } from "./services/builds.js";
import { markArtifactExpired } from "./services/artifacts.js";

/** Cancel any QUEUED build that has been queued longer than QUEUED_TIMEOUT_MS. */
export function timeoutQueuedBuilds(store: Store): string[] {
  const now = Date.now();
  const cancelled: string[] = [];
  for (const build of [...store.builds.values()]) {
    if (build.status !== BuildStatus.QUEUED) continue;
    if ((now - build.queuedAt.getTime()) <= QUEUED_TIMEOUT_MS) continue;
    cancelBuild(store, build.buildId);
    cancelled.push(build.buildId);
  }
  return cancelled;
}

/** Mark as FAILED any RUNNING build that has been running longer than STUCK_AFTER_MS. */
export function failStuckBuilds(store: Store): string[] {
  const failed: string[] = [];
  for (const build of [...store.builds.values()]) {
    if (!buildIsStuck(build)) continue;
    markBuildFailed(store, build.buildId, `build exceeded ${STUCK_AFTER_MS}ms running window`);
    failed.push(build.buildId);
  }
  return failed;
}

/** Sweep uploaded artifacts whose expiry has passed. */
export function expireOldArtifacts(store: Store): string[] {
  const expired: string[] = [];
  for (const artifact of [...store.artifacts.values()]) {
    if (artifact.status !== ArtifactStatus.UPLOADED) continue;
    if (!artifactIsExpired(artifact)) continue;
    markArtifactExpired(store, artifact.artifactId);
    expired.push(artifact.artifactId);
  }
  return expired;
}
