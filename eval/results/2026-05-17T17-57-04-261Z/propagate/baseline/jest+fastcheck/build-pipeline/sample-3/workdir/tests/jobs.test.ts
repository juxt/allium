/**
 * Temporal / scheduled-job tests.
 *
 * Spec obligations covered:
 *   - temporal.TimeoutQueuedBuilds          (queuedAt + queued_timeout <= now)
 *   - rule_success.TimeoutQueuedBuilds      (queued -> cancelled when timed out)
 *   - rule_failure.TimeoutQueuedBuilds.1    (skipped when build.status != queued)
 *   - rule_success.FailStuckBuilds          (running -> failed when stuck)
 *   - rule_failure.FailStuckBuilds.1        (skipped when build.status != running)
 *   - rule_success.ExpireOldArtifacts       (uploaded -> expired when expiresAt past)
 *   - rule_failure.ExpireOldArtifacts.1     (skipped when artifact.status != uploaded)
 *
 * The implementation uses real wall-clock `Date.now()` and does not accept an
 * injected clock. To exercise the deadlines we position entity timestamps
 * relative to "now" by mutating queuedAt / startedAt / expiresAt after creation.
 * We don't sleep or race the wall clock; each test simply reads what the job
 * sweep does on the snapshot.
 */
import { describe, expect, test } from '@jest/globals';
import {
  ArtifactStatus,
  BuildStatus,
  QUEUED_TIMEOUT_MS,
  STUCK_AFTER_MS,
  Store,
} from '../src/models.js';
import {
  expireOldArtifacts,
  failStuckBuilds,
  timeoutQueuedBuilds,
} from '../src/jobs.js';
import {
  forceArtifactStatus,
  forceBuildStatus,
  makePendingArtifact,
  makePipeline,
  makeQueuedBuild,
  makeRunningBuild,
  makeUploadedArtifact,
} from './helpers.js';

describe('timeoutQueuedBuilds (TimeoutQueuedBuilds rule)', () => {
  test('rule_success: a queued build past queued_timeout is cancelled', () => {
    const store = new Store();
    makePipeline(store);
    const build = makeQueuedBuild(store);
    // Backdate queuedAt past the threshold.
    build.queuedAt = new Date(Date.now() - QUEUED_TIMEOUT_MS - 1_000);
    const cancelled = timeoutQueuedBuilds(store);
    expect(cancelled).toContain('b-1');
    expect(store.builds.get('b-1')!.status).toBe(BuildStatus.CANCELLED);
  });

  test('temporal: a build whose queuedAt is just inside the window is NOT cancelled', () => {
    const store = new Store();
    makePipeline(store);
    const build = makeQueuedBuild(store);
    // Stay safely inside the window.
    build.queuedAt = new Date(Date.now() - (QUEUED_TIMEOUT_MS - 10_000));
    const cancelled = timeoutQueuedBuilds(store);
    expect(cancelled).not.toContain('b-1');
    expect(store.builds.get('b-1')!.status).toBe(BuildStatus.QUEUED);
  });

  test('temporal: does not re-fire on the same already-cancelled build', () => {
    const store = new Store();
    makePipeline(store);
    const build = makeQueuedBuild(store);
    build.queuedAt = new Date(Date.now() - QUEUED_TIMEOUT_MS - 1_000);
    timeoutQueuedBuilds(store);
    expect(store.builds.get('b-1')!.status).toBe(BuildStatus.CANCELLED);
    // Second call: build is no longer queued, so it must not be touched.
    const second = timeoutQueuedBuilds(store);
    expect(second).toEqual([]);
    expect(store.builds.get('b-1')!.status).toBe(BuildStatus.CANCELLED);
  });

  test.each([BuildStatus.RUNNING, BuildStatus.SUCCESS, BuildStatus.FAILED, BuildStatus.CANCELLED])(
    'rule_failure: skips a build whose status is not queued (%s) even if queuedAt is ancient',
    (status: BuildStatus) => {
      const store = new Store();
      makePipeline(store);
      const build = makeQueuedBuild(store);
      build.queuedAt = new Date(Date.now() - QUEUED_TIMEOUT_MS - 10_000);
      forceBuildStatus(build, status);
      const result = timeoutQueuedBuilds(store);
      expect(result).not.toContain(build.buildId);
      // Status unchanged.
      expect(store.builds.get(build.buildId)!.status).toBe(status);
    },
  );
});

describe('failStuckBuilds (FailStuckBuilds rule)', () => {
  test('rule_success: a running build past stuck_after is marked failed', () => {
    const store = new Store();
    makePipeline(store);
    const build = makeRunningBuild(store);
    build.startedAt = new Date(Date.now() - STUCK_AFTER_MS - 1_000);
    const failed = failStuckBuilds(store);
    expect(failed).toContain('b-1');
    const after = store.builds.get('b-1')!;
    expect(after.status).toBe(BuildStatus.FAILED);
    expect(after.failureReason).not.toBeNull();
  });

  test('a running build inside the window is NOT marked failed', () => {
    const store = new Store();
    makePipeline(store);
    const build = makeRunningBuild(store);
    build.startedAt = new Date(Date.now() - (STUCK_AFTER_MS - 10_000));
    const failed = failStuckBuilds(store);
    expect(failed).not.toContain('b-1');
    expect(store.builds.get('b-1')!.status).toBe(BuildStatus.RUNNING);
  });

  test.each([BuildStatus.QUEUED, BuildStatus.SUCCESS, BuildStatus.FAILED, BuildStatus.CANCELLED])(
    'rule_failure: skips a build whose status is not running (%s) even if startedAt is ancient',
    (status: BuildStatus) => {
      const store = new Store();
      makePipeline(store);
      const build = makeRunningBuild(store);
      build.startedAt = new Date(Date.now() - STUCK_AFTER_MS - 10_000);
      forceBuildStatus(build, status);
      const result = failStuckBuilds(store);
      expect(result).not.toContain(build.buildId);
      expect(store.builds.get(build.buildId)!.status).toBe(status);
    },
  );
});

describe('expireOldArtifacts (ExpireOldArtifacts rule)', () => {
  test('rule_success: an uploaded artifact past expiresAt is marked expired', () => {
    const store = new Store();
    makePipeline(store);
    const artifact = makeUploadedArtifact(store);
    artifact.expiresAt = new Date(Date.now() - 1_000);
    const expired = expireOldArtifacts(store);
    expect(expired).toContain('a-1');
    expect(store.artifacts.get('a-1')!.status).toBe(ArtifactStatus.EXPIRED);
  });

  test('an uploaded artifact whose expiresAt is still in the future is NOT expired', () => {
    const store = new Store();
    makePipeline(store);
    makeUploadedArtifact(store);
    const expired = expireOldArtifacts(store);
    expect(expired).toEqual([]);
    expect(store.artifacts.get('a-1')!.status).toBe(ArtifactStatus.UPLOADED);
  });

  test('rule_failure: skips an artifact whose status is not uploaded (pending) even if expiresAt is past', () => {
    const store = new Store();
    makePipeline(store);
    const artifact = makePendingArtifact(store);
    artifact.expiresAt = new Date(Date.now() - 10_000);
    forceArtifactStatus(artifact, ArtifactStatus.PENDING);
    const expired = expireOldArtifacts(store);
    expect(expired).toEqual([]);
    expect(store.artifacts.get('a-1')!.status).toBe(ArtifactStatus.PENDING);
  });

  test('does not re-fire on an already-expired artifact', () => {
    const store = new Store();
    makePipeline(store);
    const artifact = makeUploadedArtifact(store);
    artifact.expiresAt = new Date(Date.now() - 10_000);
    expireOldArtifacts(store);
    const second = expireOldArtifacts(store);
    expect(second).toEqual([]);
    expect(store.artifacts.get('a-1')!.status).toBe(ArtifactStatus.EXPIRED);
  });
});
