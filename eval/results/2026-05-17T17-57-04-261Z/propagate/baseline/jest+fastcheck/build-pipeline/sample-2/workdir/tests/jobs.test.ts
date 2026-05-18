/**
 * Temporal job tests.
 *
 * Covers obligations:
 *   - rule-success.{TimeoutQueuedBuilds, FailStuckBuilds, ExpireOldArtifacts}
 *   - rule-failure.{TimeoutQueuedBuilds.1, FailStuckBuilds.1, ExpireOldArtifacts.1}
 *   - temporal.TimeoutQueuedBuilds (fires at deadline, not before; no re-fire)
 *
 * Bridge: src/jobs.ts. The implementation uses wall-clock Date.now() with no
 * injected clock; we patch the global system clock via jest fake timers, which
 * is the only seam available without modifying the implementation.
 */
import { jest } from "@jest/globals";
import {
  ArtifactStatus,
  BuildStatus,
  QUEUED_TIMEOUT_MS,
  STUCK_AFTER_MS,
} from "../src/models.js";
import {
  expireOldArtifacts,
  failStuckBuilds,
  timeoutQueuedBuilds,
} from "../src/jobs.js";
import { makeArtifact, makeBuild, makeStore } from "./_fixtures.js";

// ---------------------------------------------------------------------------
// TimeoutQueuedBuilds
// ---------------------------------------------------------------------------

describe("rule.TimeoutQueuedBuilds (temporal)", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  test("success: cancels a queued build whose queuedAt + queued_timeout < now", () => {
    const queuedAt = new Date("2026-05-01T00:00:00Z");
    jest.setSystemTime(new Date(queuedAt.getTime() + QUEUED_TIMEOUT_MS + 1));

    const b = makeBuild({ status: BuildStatus.QUEUED, queuedAt });
    const store = makeStore({ builds: [b] });

    const cancelled = timeoutQueuedBuilds(store);

    expect(cancelled).toEqual([b.buildId]);
    expect(store.builds.get(b.buildId)!.status).toBe(BuildStatus.CANCELLED);
  });

  test("temporal boundary: does NOT fire when now == queuedAt + queued_timeout (impl uses <=)", () => {
    // The implementation uses `(now - queuedAt) <= QUEUED_TIMEOUT_MS` then
    // `continue`, i.e. it cancels only when (now - queuedAt) > timeout.
    const queuedAt = new Date("2026-05-01T00:00:00Z");
    jest.setSystemTime(new Date(queuedAt.getTime() + QUEUED_TIMEOUT_MS));

    const b = makeBuild({ status: BuildStatus.QUEUED, queuedAt });
    const store = makeStore({ builds: [b] });

    expect(timeoutQueuedBuilds(store)).toEqual([]);
    expect(store.builds.get(b.buildId)!.status).toBe(BuildStatus.QUEUED);
  });

  test("temporal boundary: does NOT fire before deadline", () => {
    const queuedAt = new Date("2026-05-01T00:00:00Z");
    jest.setSystemTime(new Date(queuedAt.getTime() + QUEUED_TIMEOUT_MS - 1));

    const b = makeBuild({ status: BuildStatus.QUEUED, queuedAt });
    const store = makeStore({ builds: [b] });

    expect(timeoutQueuedBuilds(store)).toEqual([]);
    expect(store.builds.get(b.buildId)!.status).toBe(BuildStatus.QUEUED);
  });

  test("does not re-fire: a second sweep after the build has been cancelled is a no-op", () => {
    const queuedAt = new Date("2026-05-01T00:00:00Z");
    jest.setSystemTime(new Date(queuedAt.getTime() + QUEUED_TIMEOUT_MS + 1));

    const b = makeBuild({ status: BuildStatus.QUEUED, queuedAt });
    const store = makeStore({ builds: [b] });

    expect(timeoutQueuedBuilds(store)).toEqual([b.buildId]);
    // Second sweep: build is now CANCELLED, so the `status !== QUEUED` guard
    // short-circuits and nothing is cancelled again.
    expect(timeoutQueuedBuilds(store)).toEqual([]);
  });

  test.each([
    BuildStatus.RUNNING,
    BuildStatus.SUCCESS,
    BuildStatus.FAILED,
    BuildStatus.CANCELLED,
  ])("failure-equivalent: skips build whose status = %s (requires queued)", (status) => {
    const queuedAt = new Date("2026-05-01T00:00:00Z");
    jest.setSystemTime(new Date(queuedAt.getTime() + QUEUED_TIMEOUT_MS + 1));

    const b = makeBuild({ status, queuedAt });
    const store = makeStore({ builds: [b] });

    expect(timeoutQueuedBuilds(store)).toEqual([]);
    expect(store.builds.get(b.buildId)!.status).toBe(status);
  });
});

// ---------------------------------------------------------------------------
// FailStuckBuilds
// ---------------------------------------------------------------------------

describe("rule.FailStuckBuilds", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  test("success: fails a running build whose startedAt + stuck_after < now", () => {
    const now = new Date("2026-05-01T10:00:00Z");
    jest.setSystemTime(now);
    const b = makeBuild({
      status: BuildStatus.RUNNING,
      startedAt: new Date(now.getTime() - STUCK_AFTER_MS - 1),
    });
    const store = makeStore({ builds: [b] });

    const failed = failStuckBuilds(store);

    expect(failed).toEqual([b.buildId]);
    const after = store.builds.get(b.buildId)!;
    expect(after.status).toBe(BuildStatus.FAILED);
    expect(after.failureReason).not.toBeNull();
    expect(after.finishedAt).not.toBeNull();
  });

  test.each([
    BuildStatus.QUEUED,
    BuildStatus.SUCCESS,
    BuildStatus.FAILED,
    BuildStatus.CANCELLED,
  ])("failure-equivalent: skips build whose status = %s (requires running)", (status) => {
    const now = new Date("2026-05-01T10:00:00Z");
    jest.setSystemTime(now);
    const b = makeBuild({
      status,
      startedAt: new Date(now.getTime() - STUCK_AFTER_MS - 1),
    });
    const store = makeStore({ builds: [b] });

    expect(failStuckBuilds(store)).toEqual([]);
    expect(store.builds.get(b.buildId)!.status).toBe(status);
  });

  test("skips running build still inside the stuck window", () => {
    const now = new Date("2026-05-01T10:00:00Z");
    jest.setSystemTime(now);
    const b = makeBuild({
      status: BuildStatus.RUNNING,
      startedAt: new Date(now.getTime() - STUCK_AFTER_MS + 1),
    });
    const store = makeStore({ builds: [b] });

    expect(failStuckBuilds(store)).toEqual([]);
    expect(store.builds.get(b.buildId)!.status).toBe(BuildStatus.RUNNING);
  });
});

// ---------------------------------------------------------------------------
// ExpireOldArtifacts
// ---------------------------------------------------------------------------

describe("rule.ExpireOldArtifacts", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  test("success: marks an uploaded artifact past expiresAt as EXPIRED", () => {
    const now = new Date("2026-05-15T00:00:00Z");
    jest.setSystemTime(now);
    const art = makeArtifact({
      status: ArtifactStatus.UPLOADED,
      uploadedAt: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
      expiresAt: new Date(now.getTime() - 1),
      storageKey: "b/k",
    });
    const store = makeStore({ artifacts: [art] });

    const expired = expireOldArtifacts(store);

    expect(expired).toEqual([art.artifactId]);
    expect(store.artifacts.get(art.artifactId)!.status).toBe(ArtifactStatus.EXPIRED);
  });

  test.each([ArtifactStatus.PENDING, ArtifactStatus.EXPIRED])(
    "failure-equivalent: skips artifact whose status = %s (requires uploaded)",
    (status) => {
      const now = new Date("2026-05-15T00:00:00Z");
      jest.setSystemTime(now);
      const art = makeArtifact({
        status,
        expiresAt: new Date(now.getTime() - 1),
      });
      const store = makeStore({ artifacts: [art] });

      expect(expireOldArtifacts(store)).toEqual([]);
      expect(store.artifacts.get(art.artifactId)!.status).toBe(status);
    },
  );

  test("skips uploaded artifact whose expiresAt is still in the future", () => {
    const now = new Date("2026-05-15T00:00:00Z");
    jest.setSystemTime(now);
    const art = makeArtifact({
      status: ArtifactStatus.UPLOADED,
      expiresAt: new Date(now.getTime() + 1000),
      storageKey: "b/k",
    });
    const store = makeStore({ artifacts: [art] });

    expect(expireOldArtifacts(store)).toEqual([]);
    expect(store.artifacts.get(art.artifactId)!.status).toBe(ArtifactStatus.UPLOADED);
  });
});
