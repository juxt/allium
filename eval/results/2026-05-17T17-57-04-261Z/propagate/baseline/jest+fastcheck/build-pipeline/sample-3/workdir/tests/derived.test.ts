/**
 * Derived-value tests.
 *
 * Spec obligations covered:
 *   - derived.Build.buildIsStuck  (status = running and startedAt != null and (now - startedAt) > config.stuck_after)
 *   - derived.Artifact.artifactIsExpired  (expiresAt != null and now > expiresAt)
 *
 * The implementation uses real wall-clock time (`Date.now()`) rather than an
 * injected clock; we exercise the predicate by positioning entity timestamps
 * relative to "now" rather than mocking the clock. For the (now - startedAt)
 * test we leave a generous millisecond margin so test scheduling jitter can't
 * flip the predicate.
 */
import { describe, expect, test } from '@jest/globals';
import {
  ArtifactStatus,
  BuildStatus,
  STUCK_AFTER_MS,
  Store,
  artifactIsExpired,
  buildDurationMs,
  buildIsStuck,
} from '../src/models.js';
import { forceArtifactStatus, makeRunningBuild, makeUploadedArtifact, makePipeline } from './helpers.js';

describe('derived: Build.buildIsStuck', () => {
  test('false for a queued build (no startedAt)', () => {
    const store = new Store();
    makePipeline(store);
    // queued -> startedAt null, status queued; both gates fail.
    const build = {
      ...makeRunningBuild(store, 'pl-1', 'b-1'),
      status: BuildStatus.QUEUED,
      startedAt: null,
    };
    expect(buildIsStuck(build)).toBe(false);
  });

  test('false for a running build whose startedAt is within the stuck window', () => {
    const store = new Store();
    makePipeline(store);
    const build = makeRunningBuild(store);
    // running with startedAt = now is well inside the 1-hour stuck window.
    expect(buildIsStuck(build)).toBe(false);
  });

  test('true for a running build whose startedAt exceeds the stuck threshold', () => {
    const store = new Store();
    makePipeline(store);
    const build = makeRunningBuild(store);
    // Backdate startedAt past the stuck threshold (with a small safety margin).
    build.startedAt = new Date(Date.now() - STUCK_AFTER_MS - 1000);
    expect(buildIsStuck(build)).toBe(true);
  });

  test('false when status is not running, even if startedAt is far in the past', () => {
    const store = new Store();
    makePipeline(store);
    const build = makeRunningBuild(store);
    build.startedAt = new Date(Date.now() - STUCK_AFTER_MS - 60_000);
    build.status = BuildStatus.SUCCESS;
    expect(buildIsStuck(build)).toBe(false);
  });
});

describe('derived: Artifact.artifactIsExpired', () => {
  test('false when expiresAt is null', () => {
    const store = new Store();
    makePipeline(store);
    const uploaded = makeUploadedArtifact(store);
    uploaded.expiresAt = null;
    expect(artifactIsExpired(uploaded)).toBe(false);
  });

  test('false when expiresAt is in the future', () => {
    const store = new Store();
    makePipeline(store);
    const uploaded = makeUploadedArtifact(store);
    // markArtifactUploaded sets expiresAt to now + 7 days, so it's in the future
    expect(artifactIsExpired(uploaded)).toBe(false);
  });

  test('true when expiresAt is in the past', () => {
    const store = new Store();
    makePipeline(store);
    const uploaded = makeUploadedArtifact(store);
    uploaded.expiresAt = new Date(Date.now() - 1000);
    expect(artifactIsExpired(uploaded)).toBe(true);
  });

  test('artifactIsExpired predicate does not require artifact status be uploaded; spec separately gates the rule', () => {
    // The spec models artifactIsExpired as a pure derived predicate over
    // (expiresAt, now); the requires/uploaded gate lives on rule
    // ExpireOldArtifacts, not on the predicate itself.
    const store = new Store();
    makePipeline(store);
    const uploaded = makeUploadedArtifact(store);
    forceArtifactStatus(uploaded, ArtifactStatus.PENDING);
    uploaded.expiresAt = new Date(Date.now() - 1000);
    expect(artifactIsExpired(uploaded)).toBe(true);
  });
});

describe('derived: buildDurationMs (auxiliary derived helper exposed by the implementation)', () => {
  test('null when startedAt is null', () => {
    const store = new Store();
    makePipeline(store);
    const queued = makeRunningBuild(store);
    queued.startedAt = null;
    expect(buildDurationMs(queued)).toBeNull();
  });

  test('finished - started when both timestamps are set', () => {
    const store = new Store();
    makePipeline(store);
    const build = makeRunningBuild(store);
    build.startedAt = new Date(1_000);
    build.finishedAt = new Date(11_000);
    expect(buildDurationMs(build)).toBe(10_000);
  });
});
