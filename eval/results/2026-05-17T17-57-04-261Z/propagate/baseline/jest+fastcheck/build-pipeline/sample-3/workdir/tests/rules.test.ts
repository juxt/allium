/**
 * Rule tests.
 *
 * Each spec rule produces a rule_success obligation (preconditions met -> ensures
 * holds) and a rule_failure obligation (requires violated -> rule rejected). For
 * Enqueue / Receive / Register, an additional rule_entity_creation obligation
 * checks that the ensures-side Entity.created(...) populates the declared fields.
 *
 * Implementation bridge:
 *   rule EnqueueBuild             -> services/builds.ts enqueueBuild
 *   rule StartBuild               -> services/builds.ts startBuild
 *   rule MarkBuildSuccess         -> services/builds.ts markBuildSuccess
 *   rule MarkBuildFailed          -> services/builds.ts markBuildFailed
 *   rule CancelBuild              -> services/builds.ts cancelBuild
 *   rule RegisterArtifact         -> services/artifacts.ts registerArtifact
 *   rule MarkArtifactUploaded     -> services/artifacts.ts markArtifactUploaded
 *   rule MarkArtifactExpired      -> services/artifacts.ts markArtifactExpired
 *   rule ReceiveGithubPushEvent   -> webhooks.ts receiveGithubPushEvent
 *   rule TimeoutQueuedBuilds      -> jobs.ts timeoutQueuedBuilds   (covered in jobs.test.ts)
 *   rule FailStuckBuilds          -> jobs.ts failStuckBuilds       (covered in jobs.test.ts)
 *   rule ExpireOldArtifacts       -> jobs.ts expireOldArtifacts    (covered in jobs.test.ts)
 *
 * Failure tests assert that the implementation rejects the call via the
 * matching domain error class — that's how the TS implementation surfaces a
 * requires-violation. We don't assert a particular message, only the error
 * class plus that the store state is unchanged.
 */
import { describe, expect, test } from '@jest/globals';
import {
  ArtifactStatus,
  BuildStatus,
  PipelineStatus,
  Store,
} from '../src/models.js';
import {
  BuildNotFoundError,
  BuildTransitionError,
  cancelBuild,
  enqueueBuild,
  markBuildFailed,
  markBuildSuccess,
  startBuild,
} from '../src/services/builds.js';
import {
  ArtifactNotFoundError,
  ArtifactTransitionError,
  markArtifactExpired,
  markArtifactUploaded,
  registerArtifact,
} from '../src/services/artifacts.js';
import { receiveGithubPushEvent } from '../src/webhooks.js';
import {
  forceArtifactStatus,
  forceBuildStatus,
  makePendingArtifact,
  makePipeline,
  makeQueuedBuild,
  makeRunningBuild,
  makeSuccessBuild,
  makeUploadedArtifact,
} from './helpers.js';

// ---------------------------------------------------------------------------
// EnqueueBuild
// ---------------------------------------------------------------------------

describe('rule EnqueueBuild', () => {
  test('rule_success: enqueues a queued build when pipeline.status = active', () => {
    const store = new Store();
    makePipeline(store);
    const before = Date.now();
    const build = enqueueBuild(store, {
      buildId: 'b-1',
      pipelineId: 'pl-1',
      commitSha: 'cafef00d',
      triggeredBy: 'alice',
    });
    const after = Date.now();
    // rule-entity-creation.EnqueueBuild: all ensures fields are present
    expect(build.buildId).toBe('b-1');
    expect(build.pipelineId).toBe('pl-1');
    expect(build.commitSha).toBe('cafef00d');
    expect(build.triggeredBy).toBe('alice');
    expect(build.status).toBe(BuildStatus.QUEUED);
    expect(build.startedAt).toBeNull();
    expect(build.finishedAt).toBeNull();
    expect(build.failureReason).toBeNull();
    // queuedAt = now
    expect(build.queuedAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(build.queuedAt.getTime()).toBeLessThanOrEqual(after);
    expect(store.builds.get('b-1')).toBe(build);
  });

  test('rule_failure: rejects when pipeline.status != active (paused)', () => {
    const store = new Store();
    makePipeline(store, { status: PipelineStatus.PAUSED });
    expect(() =>
      enqueueBuild(store, {
        buildId: 'b-1',
        pipelineId: 'pl-1',
        commitSha: 'c',
        triggeredBy: 't',
      }),
    ).toThrow(BuildTransitionError);
    expect(store.builds.size).toBe(0);
  });

  test('rule_failure: rejects when pipeline.status != active (archived)', () => {
    const store = new Store();
    makePipeline(store, { status: PipelineStatus.ARCHIVED });
    expect(() =>
      enqueueBuild(store, {
        buildId: 'b-1',
        pipelineId: 'pl-1',
        commitSha: 'c',
        triggeredBy: 't',
      }),
    ).toThrow(BuildTransitionError);
    expect(store.builds.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// StartBuild
// ---------------------------------------------------------------------------

describe('rule StartBuild', () => {
  test('rule_success: moves a queued build to running and sets startedAt = now', () => {
    const store = new Store();
    makePipeline(store);
    makeQueuedBuild(store);
    const before = Date.now();
    const build = startBuild(store, 'b-1');
    const after = Date.now();
    expect(build.status).toBe(BuildStatus.RUNNING);
    expect(build.startedAt).toBeInstanceOf(Date);
    expect(build.startedAt!.getTime()).toBeGreaterThanOrEqual(before);
    expect(build.startedAt!.getTime()).toBeLessThanOrEqual(after);
  });

  test.each([BuildStatus.RUNNING, BuildStatus.SUCCESS, BuildStatus.FAILED, BuildStatus.CANCELLED])(
    'rule_failure: rejects start from non-queued status (%s)',
    (status: BuildStatus) => {
      const store = new Store();
      makePipeline(store);
      const build = makeQueuedBuild(store);
      forceBuildStatus(build, status);
      expect(() => startBuild(store, build.buildId)).toThrow(BuildTransitionError);
      expect(build.status).toBe(status);
    },
  );

  test('rule_failure: throws BuildNotFoundError for unknown buildId', () => {
    const store = new Store();
    expect(() => startBuild(store, 'no-such')).toThrow(BuildNotFoundError);
  });
});

// ---------------------------------------------------------------------------
// MarkBuildSuccess
// ---------------------------------------------------------------------------

describe('rule MarkBuildSuccess', () => {
  test('rule_success: a running build becomes success and gets finishedAt', () => {
    const store = new Store();
    makePipeline(store);
    makeRunningBuild(store);
    const before = Date.now();
    const build = markBuildSuccess(store, 'b-1');
    const after = Date.now();
    expect(build.status).toBe(BuildStatus.SUCCESS);
    expect(build.finishedAt).toBeInstanceOf(Date);
    expect(build.finishedAt!.getTime()).toBeGreaterThanOrEqual(before);
    expect(build.finishedAt!.getTime()).toBeLessThanOrEqual(after);
    expect(build.failureReason).toBeNull();
  });

  test.each([BuildStatus.QUEUED, BuildStatus.SUCCESS, BuildStatus.FAILED, BuildStatus.CANCELLED])(
    'rule_failure: rejects markSuccess from non-running status (%s)',
    (status: BuildStatus) => {
      const store = new Store();
      makePipeline(store);
      const build = makeQueuedBuild(store);
      forceBuildStatus(build, status);
      expect(() => markBuildSuccess(store, build.buildId)).toThrow(BuildTransitionError);
    },
  );
});

// ---------------------------------------------------------------------------
// MarkBuildFailed
// ---------------------------------------------------------------------------

describe('rule MarkBuildFailed', () => {
  test('rule_success: a running build becomes failed; reason and finishedAt are set', () => {
    const store = new Store();
    makePipeline(store);
    makeRunningBuild(store);
    const build = markBuildFailed(store, 'b-1', 'compiler exploded');
    expect(build.status).toBe(BuildStatus.FAILED);
    expect(build.failureReason).toBe('compiler exploded');
    expect(build.finishedAt).toBeInstanceOf(Date);
  });

  test.each([BuildStatus.QUEUED, BuildStatus.SUCCESS, BuildStatus.FAILED, BuildStatus.CANCELLED])(
    'rule_failure: rejects markFailed from non-running status (%s)',
    (status: BuildStatus) => {
      const store = new Store();
      makePipeline(store);
      const build = makeQueuedBuild(store);
      forceBuildStatus(build, status);
      expect(() => markBuildFailed(store, build.buildId, 'r')).toThrow(BuildTransitionError);
    },
  );
});

// ---------------------------------------------------------------------------
// CancelBuild
// ---------------------------------------------------------------------------

describe('rule CancelBuild', () => {
  test('rule_success: cancels a queued build', () => {
    const store = new Store();
    makePipeline(store);
    makeQueuedBuild(store);
    const build = cancelBuild(store, 'b-1');
    expect(build.status).toBe(BuildStatus.CANCELLED);
    expect(build.finishedAt).toBeInstanceOf(Date);
  });

  test('rule_success: cancels a running build', () => {
    const store = new Store();
    makePipeline(store);
    makeRunningBuild(store);
    const build = cancelBuild(store, 'b-1');
    expect(build.status).toBe(BuildStatus.CANCELLED);
    expect(build.finishedAt).toBeInstanceOf(Date);
  });

  test.each([BuildStatus.SUCCESS, BuildStatus.FAILED, BuildStatus.CANCELLED])(
    'rule_failure: rejects cancel from terminal status (%s)',
    (status: BuildStatus) => {
      const store = new Store();
      makePipeline(store);
      const build = makeQueuedBuild(store);
      forceBuildStatus(build, status);
      expect(() => cancelBuild(store, build.buildId)).toThrow(BuildTransitionError);
    },
  );
});

// ---------------------------------------------------------------------------
// RegisterArtifact
// ---------------------------------------------------------------------------

describe('rule RegisterArtifact', () => {
  test('rule_success: registers a pending artifact tied to a successful build', () => {
    const store = new Store();
    makePipeline(store);
    makeSuccessBuild(store);
    const artifact = registerArtifact(store, {
      artifactId: 'a-1',
      buildId: 'b-1',
      name: 'dist.tgz',
      sizeBytes: 1024,
    });
    // rule-entity-creation.RegisterArtifact: ensures-clause fields
    expect(artifact.artifactId).toBe('a-1');
    expect(artifact.buildId).toBe('b-1');
    expect(artifact.name).toBe('dist.tgz');
    expect(artifact.sizeBytes).toBe(1024);
    expect(artifact.status).toBe(ArtifactStatus.PENDING);
    expect(artifact.expiresAt).toBeNull();
    expect(artifact.storageKey).toBeNull();
    expect(artifact.uploadedAt).toBeNull();
    expect(store.artifacts.get('a-1')).toBe(artifact);
  });

  test.each([
    BuildStatus.QUEUED,
    BuildStatus.RUNNING,
    BuildStatus.FAILED,
    BuildStatus.CANCELLED,
  ])(
    'rule_failure.1: rejects when build.status != success (%s)',
    (status: BuildStatus) => {
      const store = new Store();
      makePipeline(store);
      const build = makeQueuedBuild(store);
      forceBuildStatus(build, status);
      expect(() =>
        registerArtifact(store, {
          artifactId: 'a-1',
          buildId: build.buildId,
          name: 'x',
          sizeBytes: 1,
        }),
      ).toThrow(ArtifactTransitionError);
      expect(store.artifacts.size).toBe(0);
    },
  );

  test('rule_failure.2: rejects when sizeBytes <= 0', () => {
    const store = new Store();
    makePipeline(store);
    makeSuccessBuild(store);
    expect(() =>
      registerArtifact(store, {
        artifactId: 'a-bad',
        buildId: 'b-1',
        name: 'x',
        sizeBytes: 0,
      }),
    ).toThrow(ArtifactTransitionError);
    expect(() =>
      registerArtifact(store, {
        artifactId: 'a-bad',
        buildId: 'b-1',
        name: 'x',
        sizeBytes: -1,
      }),
    ).toThrow(ArtifactTransitionError);
  });

  test('rule_failure: throws ArtifactNotFoundError for unknown build', () => {
    const store = new Store();
    expect(() =>
      registerArtifact(store, {
        artifactId: 'a-1',
        buildId: 'no-build',
        name: 'x',
        sizeBytes: 1,
      }),
    ).toThrow(ArtifactNotFoundError);
  });
});

// ---------------------------------------------------------------------------
// MarkArtifactUploaded
// ---------------------------------------------------------------------------

describe('rule MarkArtifactUploaded', () => {
  test('rule_success: pending -> uploaded; uploadedAt = now, expiresAt = now + ttl, storageKey assigned', () => {
    const store = new Store();
    makePipeline(store);
    makePendingArtifact(store);
    const before = Date.now();
    const artifact = markArtifactUploaded(store, 'a-1', 'bucket/object-key');
    const after = Date.now();
    expect(artifact.status).toBe(ArtifactStatus.UPLOADED);
    expect(artifact.uploadedAt).toBeInstanceOf(Date);
    expect(artifact.uploadedAt!.getTime()).toBeGreaterThanOrEqual(before);
    expect(artifact.uploadedAt!.getTime()).toBeLessThanOrEqual(after);
    expect(artifact.expiresAt).toBeInstanceOf(Date);
    // 7 days = 7 * 24 * 60 * 60 * 1000 ms
    expect(artifact.expiresAt!.getTime() - artifact.uploadedAt!.getTime()).toBe(
      7 * 24 * 60 * 60 * 1000,
    );
    expect(artifact.storageKey).toBe('bucket/object-key');
  });

  test.each([ArtifactStatus.UPLOADED, ArtifactStatus.EXPIRED])(
    'rule_failure: rejects markUploaded from non-pending status (%s)',
    (status: ArtifactStatus) => {
      const store = new Store();
      makePipeline(store);
      const artifact = makePendingArtifact(store);
      forceArtifactStatus(artifact, status);
      expect(() => markArtifactUploaded(store, 'a-1', 'k')).toThrow(ArtifactTransitionError);
    },
  );
});

// ---------------------------------------------------------------------------
// MarkArtifactExpired
// ---------------------------------------------------------------------------

describe('rule MarkArtifactExpired', () => {
  test('rule_success: uploaded -> expired', () => {
    const store = new Store();
    makePipeline(store);
    makeUploadedArtifact(store);
    const artifact = markArtifactExpired(store, 'a-1');
    expect(artifact.status).toBe(ArtifactStatus.EXPIRED);
  });

  test.each([ArtifactStatus.PENDING, ArtifactStatus.EXPIRED])(
    'rule_failure: rejects markExpired from non-uploaded status (%s)',
    (status: ArtifactStatus) => {
      const store = new Store();
      makePipeline(store);
      const artifact = makePendingArtifact(store);
      forceArtifactStatus(artifact, status);
      expect(() => markArtifactExpired(store, 'a-1')).toThrow(ArtifactTransitionError);
    },
  );
});

// ---------------------------------------------------------------------------
// ReceiveGithubPushEvent
// ---------------------------------------------------------------------------

describe('rule ReceiveGithubPushEvent', () => {
  test('rule_success / rule-entity-creation: stores the push event with all ensures-clause fields', () => {
    const store = new Store();
    const before = Date.now();
    receiveGithubPushEvent(store, {
      eventId: 'evt-1',
      repoFullName: 'acme/widgets',
      branch: 'main',
      commitSha: 'beef0001',
      pushedBy: 'octocat',
    });
    const after = Date.now();
    const evt = store.pushEvents.get('evt-1');
    expect(evt).toBeDefined();
    expect(evt!.eventId).toBe('evt-1');
    expect(evt!.repoFullName).toBe('acme/widgets');
    expect(evt!.branch).toBe('main');
    expect(evt!.commitSha).toBe('beef0001');
    expect(evt!.pushedBy).toBe('octocat');
    expect(evt!.receivedAt).toBeInstanceOf(Date);
    expect(evt!.receivedAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(evt!.receivedAt.getTime()).toBeLessThanOrEqual(after);
  });

  test('rule_success has no requires clause; receiving an event always succeeds, even with no matching pipelines', () => {
    const store = new Store();
    const result = receiveGithubPushEvent(store, {
      eventId: 'evt-2',
      repoFullName: 'no/match',
      branch: 'main',
      commitSha: 'f00d',
      pushedBy: 'who',
    });
    expect(result.enqueuedBuildIds).toEqual([]);
    expect(store.pushEvents.get('evt-2')).toBeDefined();
    expect(store.builds.size).toBe(0);
  });
});
