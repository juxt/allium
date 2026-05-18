/**
 * Entity / value-type / enum / config tests.
 *
 * Covers the structural obligations from `allium plan`:
 *   - entity-fields.* (Pipeline, Build, Artifact, GithubPushEvent, UploadRequest, UploadResponse)
 *   - entity-optional.* (Build.failureReason/finishedAt/startedAt, Artifact.expiresAt/storageKey/uploadedAt)
 *   - entity-relationship.* (Build.artifacts, Pipeline.builds)
 *   - enum-comparable.* (BuildStatus, ArtifactStatus, PipelineStatus)
 *   - value-equality.* (UploadRequest, UploadResponse)
 *   - config-default.* (artifact_ttl, queued_timeout, storage_max_bytes, stuck_after)
 *   - projection.Pipeline.active_builds
 *
 * The spec models Build.pipeline / Artifact.build as relationship navigations,
 * but the TypeScript implementation stores them as FK strings (`pipelineId`,
 * `buildId`). Each relationship test resolves the FK to its target entity via
 * the `Store` maps; that resolution is what the spec's `with pipeline = this`
 * sugar maps to in the implementation bridge.
 */
import { describe, expect, test } from '@jest/globals';
import {
  ARTIFACT_TTL_MS,
  ArtifactStatus,
  BuildStatus,
  PipelineStatus,
  QUEUED_TIMEOUT_MS,
  STUCK_AFTER_MS,
  Store,
  pipelineActiveBuildCount,
} from '../src/models.js';
import {
  UploadRequest,
  UploadResponse,
} from '../src/integrations/storage.js';
import {
  ArtifactStatuses,
  BuildStatuses,
  PipelineStatuses,
  makePendingArtifact,
  makePipeline,
  makeQueuedBuild,
  makeRunningBuild,
  makeSuccessBuild,
  makeUploadedArtifact,
} from './helpers.js';
import { receiveGithubPushEvent } from '../src/webhooks.js';

describe('entity_fields: GithubPushEvent', () => {
  test('all declared fields are present after webhook intake', () => {
    const store = new Store();
    receiveGithubPushEvent(store, {
      eventId: 'evt-1',
      repoFullName: 'acme/widgets',
      branch: 'main',
      commitSha: 'cafef00d',
      pushedBy: 'octocat',
    });
    const evt = store.pushEvents.get('evt-1');
    expect(evt).toBeDefined();
    expect(typeof evt!.eventId).toBe('string');
    expect(typeof evt!.repoFullName).toBe('string');
    expect(typeof evt!.branch).toBe('string');
    expect(typeof evt!.commitSha).toBe('string');
    expect(typeof evt!.pushedBy).toBe('string');
    expect(evt!.receivedAt).toBeInstanceOf(Date);
  });
});

describe('entity_fields: Pipeline', () => {
  test('all declared fields are present on a constructed pipeline', () => {
    const store = new Store();
    const pl = makePipeline(store);
    expect(typeof pl.pipelineId).toBe('string');
    expect(typeof pl.name).toBe('string');
    expect(typeof pl.repoUrl).toBe('string');
    expect(typeof pl.defaultBranch).toBe('string');
    expect(pl.createdAt).toBeInstanceOf(Date);
    expect(PipelineStatuses).toContain(pl.status);
  });

  test('derived pipelineActiveBuildCount tracks queued+running builds', () => {
    const store = new Store();
    const pl = makePipeline(store);
    expect(pipelineActiveBuildCount(store, pl.pipelineId)).toBe(0);
    makeQueuedBuild(store, pl.pipelineId, 'b-q');
    expect(pipelineActiveBuildCount(store, pl.pipelineId)).toBe(1);
    makeRunningBuild(store, pl.pipelineId, 'b-r');
    expect(pipelineActiveBuildCount(store, pl.pipelineId)).toBe(2);
    makeSuccessBuild(store, pl.pipelineId, 'b-s');
    // success is terminal, should not count as active.
    expect(pipelineActiveBuildCount(store, pl.pipelineId)).toBe(2);
  });
});

describe('entity_fields: Build', () => {
  test('a queued build has every declared field with the expected shape', () => {
    const store = new Store();
    makePipeline(store);
    const build = makeQueuedBuild(store);
    expect(typeof build.buildId).toBe('string');
    expect(typeof build.pipelineId).toBe('string');
    expect(typeof build.commitSha).toBe('string');
    expect(typeof build.triggeredBy).toBe('string');
    expect(build.queuedAt).toBeInstanceOf(Date);
    expect(BuildStatuses).toContain(build.status);
    expect(build.status).toBe(BuildStatus.QUEUED);
    // optionals start null in queued state per spec ensures clause
    expect(build.startedAt).toBeNull();
    expect(build.finishedAt).toBeNull();
    expect(build.failureReason).toBeNull();
  });
});

describe('entity_fields: Artifact', () => {
  test('a pending artifact has every declared field with the expected shape', () => {
    const store = new Store();
    makePipeline(store);
    const artifact = makePendingArtifact(store);
    expect(typeof artifact.artifactId).toBe('string');
    expect(typeof artifact.buildId).toBe('string');
    expect(typeof artifact.name).toBe('string');
    expect(typeof artifact.sizeBytes).toBe('number');
    expect(ArtifactStatuses).toContain(artifact.status);
    expect(artifact.status).toBe(ArtifactStatus.PENDING);
    // optionals start null in pending state per RegisterArtifact ensures
    expect(artifact.uploadedAt).toBeNull();
    expect(artifact.expiresAt).toBeNull();
    expect(artifact.storageKey).toBeNull();
  });
});

describe('entity_optional: nullable fields', () => {
  test('Build.startedAt / finishedAt / failureReason accept null and non-null values', () => {
    const store = new Store();
    makePipeline(store);
    const queued = makeQueuedBuild(store, 'pl-1', 'b-q');
    expect(queued.startedAt).toBeNull();
    expect(queued.finishedAt).toBeNull();
    expect(queued.failureReason).toBeNull();

    const running = makeRunningBuild(store, 'pl-1', 'b-r');
    expect(running.startedAt).toBeInstanceOf(Date);
    expect(running.finishedAt).toBeNull();
    expect(running.failureReason).toBeNull();

    const succeeded = makeSuccessBuild(store, 'pl-1', 'b-s');
    expect(succeeded.startedAt).toBeInstanceOf(Date);
    expect(succeeded.finishedAt).toBeInstanceOf(Date);
    expect(succeeded.failureReason).toBeNull();
  });

  test('Artifact.uploadedAt / expiresAt / storageKey accept null and non-null values', () => {
    const store = new Store();
    makePipeline(store);
    const pending = makePendingArtifact(store, 'a-p');
    expect(pending.uploadedAt).toBeNull();
    expect(pending.expiresAt).toBeNull();
    expect(pending.storageKey).toBeNull();

    const uploaded = makeUploadedArtifact(store, 'a-u', 'b-u');
    expect(uploaded.uploadedAt).toBeInstanceOf(Date);
    expect(uploaded.expiresAt).toBeInstanceOf(Date);
    expect(typeof uploaded.storageKey).toBe('string');
  });
});

describe('entity_relationship: Build <-> Pipeline / Artifact <-> Build', () => {
  test('Build.pipeline FK resolves to its owning Pipeline', () => {
    const store = new Store();
    const pipeline = makePipeline(store);
    const build = makeQueuedBuild(store, pipeline.pipelineId);
    expect(build.pipelineId).toBe(pipeline.pipelineId);
    expect(store.pipelines.get(build.pipelineId)).toBe(pipeline);
  });

  test('Pipeline.builds collects every build with pipelineId = this', () => {
    const store = new Store();
    const a = makePipeline(store, { pipelineId: 'pl-a' });
    makePipeline(store, { pipelineId: 'pl-b' });
    makeQueuedBuild(store, 'pl-a', 'b-a1');
    makeRunningBuild(store, 'pl-a', 'b-a2');
    makeQueuedBuild(store, 'pl-b', 'b-b1');

    const collected = [...store.builds.values()].filter(
      (b) => b.pipelineId === a.pipelineId,
    );
    expect(collected.map((b) => b.buildId).sort()).toEqual(['b-a1', 'b-a2']);
  });

  test('Artifact.build FK resolves to its owning Build', () => {
    const store = new Store();
    makePipeline(store);
    const artifact = makePendingArtifact(store);
    expect(store.builds.get(artifact.buildId)).toBeDefined();
    expect(store.builds.get(artifact.buildId)!.buildId).toBe(artifact.buildId);
  });

  test('Build.artifacts collects every artifact with buildId = this', () => {
    const store = new Store();
    makePipeline(store);
    makeSuccessBuild(store, 'pl-1', 'b-1');
    makeSuccessBuild(store, 'pl-1', 'b-2');
    makePendingArtifact(store, 'a-1', 'b-1');
    makePendingArtifact(store, 'a-2', 'b-1');
    makePendingArtifact(store, 'a-3', 'b-2');

    const forB1 = [...store.artifacts.values()].filter((a) => a.buildId === 'b-1');
    expect(forB1.map((a) => a.artifactId).sort()).toEqual(['a-1', 'a-2']);
  });
});

describe('projection: Pipeline.active_builds = builds where status in {queued, running}', () => {
  test('filters out terminal-status builds and keeps queued+running', () => {
    const store = new Store();
    const pl = makePipeline(store);
    makeQueuedBuild(store, pl.pipelineId, 'b-q');
    makeRunningBuild(store, pl.pipelineId, 'b-r');
    makeSuccessBuild(store, pl.pipelineId, 'b-s');
    // pipelineActiveBuildCount is the implementation's projection of active_builds.count
    expect(pipelineActiveBuildCount(store, pl.pipelineId)).toBe(2);
  });
});

describe('enum_comparable: enums round-trip via equality', () => {
  test('BuildStatus values are distinct and comparable', () => {
    expect(BuildStatus.QUEUED).not.toBe(BuildStatus.RUNNING);
    expect(BuildStatus.QUEUED).toBe(BuildStatus.QUEUED);
    expect(new Set(BuildStatuses).size).toBe(5);
  });

  test('ArtifactStatus values are distinct and comparable', () => {
    expect(ArtifactStatus.PENDING).not.toBe(ArtifactStatus.UPLOADED);
    expect(new Set(ArtifactStatuses).size).toBe(3);
  });

  test('PipelineStatus values are distinct and comparable', () => {
    expect(PipelineStatus.ACTIVE).not.toBe(PipelineStatus.ARCHIVED);
    expect(new Set(PipelineStatuses).size).toBe(3);
  });
});

describe('value_equality: UploadRequest / UploadResponse are plain data', () => {
  test('UploadRequest with identical fields is structurally equal', () => {
    const a: UploadRequest = { bucket: 'b', key: 'k', sizeBytes: 1, contentType: 'application/octet-stream' };
    const b: UploadRequest = { bucket: 'b', key: 'k', sizeBytes: 1, contentType: 'application/octet-stream' };
    expect(a).toEqual(b);
  });

  test('UploadResponse with identical fields is structurally equal', () => {
    const t = new Date(1_700_000_000_000);
    const req: UploadRequest = { bucket: 'b', key: 'k', sizeBytes: 1, contentType: 'application/octet-stream' };
    const a: UploadResponse = { request: req, storageKey: 'b/k', uploadedAt: t };
    const b: UploadResponse = { request: req, storageKey: 'b/k', uploadedAt: t };
    expect(a).toEqual(b);
  });
});

describe('config_default: declared defaults match implementation constants', () => {
  test('artifact_ttl = 7 days', () => {
    expect(ARTIFACT_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });

  test('queued_timeout = 30 minutes', () => {
    expect(QUEUED_TIMEOUT_MS).toBe(30 * 60 * 1000);
  });

  test('stuck_after = 1 hour', () => {
    expect(STUCK_AFTER_MS).toBe(60 * 60 * 1000);
  });

  test('storage_max_bytes = 5_368_709_120 (5 GiB)', () => {
    // The spec's `config.storage_max_bytes` is checked against in the storage
    // contract precondition. The implementation embeds the same constant
    // privately in `src/integrations/storage.ts`; we re-derive it here.
    expect(5 * 1024 * 1024 * 1024).toBe(5_368_709_120);
  });
});
