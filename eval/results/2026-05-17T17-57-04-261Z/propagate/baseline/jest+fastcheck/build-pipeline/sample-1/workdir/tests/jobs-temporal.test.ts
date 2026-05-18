/**
 * Temporal-rule / job tests.
 *
 * Obligations covered:
 *   - rule-success.{TimeoutQueuedBuilds, FailStuckBuilds, ExpireOldArtifacts}
 *   - rule-failure.{TimeoutQueuedBuilds.1, FailStuckBuilds.1, ExpireOldArtifacts.1}
 *   - temporal.TimeoutQueuedBuilds — fires at deadline, not before, no re-fire
 *
 * Implementation bridge:
 *   spec rule          → job function
 *   TimeoutQueuedBuilds → timeoutQueuedBuilds (src/jobs.ts:22)
 *   FailStuckBuilds     → failStuckBuilds     (src/jobs.ts:35)
 *   ExpireOldArtifacts  → expireOldArtifacts  (src/jobs.ts:46)
 *
 * Time-injection seam: the implementation reads wall-clock time via
 * Date.now(); we control time with jest's fake timers (Date.now() and
 * new Date() honour jest.setSystemTime).
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import {
  ARTIFACT_TTL_MS,
  ArtifactStatus,
  BuildStatus,
  QUEUED_TIMEOUT_MS,
  STUCK_AFTER_MS,
  Store,
} from "../src/models.js";
import {
  expireOldArtifacts,
  failStuckBuilds,
  timeoutQueuedBuilds,
} from "../src/jobs.js";
import { makeArtifact, makeBuild, makePipeline } from "./helpers.js";

const T0 = new Date("2026-01-01T00:00:00Z").getTime();

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date(T0));
});

afterEach(() => {
  jest.useRealTimers();
});

describe("temporal rule TimeoutQueuedBuilds", () => {
  it("does not fire before the deadline (queuedAt + queued_timeout > now)", () => {
    const store = new Store();
    store.builds.set(
      "b",
      makeBuild({
        buildId: "b",
        status: BuildStatus.QUEUED,
        queuedAt: new Date(T0),
      }),
    );
    // advance to just before the deadline
    jest.setSystemTime(new Date(T0 + QUEUED_TIMEOUT_MS));
    expect(timeoutQueuedBuilds(store)).toEqual([]);
    expect(store.builds.get("b")!.status).toBe(BuildStatus.QUEUED);
  });

  it("fires at the deadline boundary (queuedAt + queued_timeout < now → cancelled)", () => {
    const store = new Store();
    store.builds.set(
      "b",
      makeBuild({
        buildId: "b",
        status: BuildStatus.QUEUED,
        queuedAt: new Date(T0),
      }),
    );
    // advance past the deadline by 1 ms
    jest.setSystemTime(new Date(T0 + QUEUED_TIMEOUT_MS + 1));
    expect(timeoutQueuedBuilds(store)).toEqual(["b"]);
    expect(store.builds.get("b")!.status).toBe(BuildStatus.CANCELLED);
  });

  it("does not re-fire on the same already-cancelled build", () => {
    const store = new Store();
    store.builds.set(
      "b",
      makeBuild({
        buildId: "b",
        status: BuildStatus.QUEUED,
        queuedAt: new Date(T0),
      }),
    );
    jest.setSystemTime(new Date(T0 + QUEUED_TIMEOUT_MS + 1));
    expect(timeoutQueuedBuilds(store)).toEqual(["b"]);
    // second invocation: build is cancelled now, requires queued — skipped.
    expect(timeoutQueuedBuilds(store)).toEqual([]);
  });

  it("rule-failure: skips builds whose status is not queued", () => {
    const store = new Store();
    for (const status of [
      BuildStatus.RUNNING,
      BuildStatus.SUCCESS,
      BuildStatus.FAILED,
      BuildStatus.CANCELLED,
    ]) {
      store.builds.set(
        `b-${status}`,
        makeBuild({
          buildId: `b-${status}`,
          status,
          queuedAt: new Date(T0),
          startedAt: status === BuildStatus.RUNNING ? new Date(T0) : null,
        }),
      );
    }
    jest.setSystemTime(new Date(T0 + QUEUED_TIMEOUT_MS + 60_000));
    expect(timeoutQueuedBuilds(store)).toEqual([]);
  });
});

describe("temporal rule FailStuckBuilds", () => {
  it("does not fire before the stuck threshold", () => {
    const store = new Store();
    store.builds.set(
      "b",
      makeBuild({
        buildId: "b",
        status: BuildStatus.RUNNING,
        startedAt: new Date(T0),
      }),
    );
    jest.setSystemTime(new Date(T0 + STUCK_AFTER_MS - 1));
    expect(failStuckBuilds(store)).toEqual([]);
    expect(store.builds.get("b")!.status).toBe(BuildStatus.RUNNING);
  });

  it("fires once past the stuck threshold (RUNNING → FAILED with reason)", () => {
    const store = new Store();
    store.builds.set(
      "b",
      makeBuild({
        buildId: "b",
        status: BuildStatus.RUNNING,
        startedAt: new Date(T0),
      }),
    );
    jest.setSystemTime(new Date(T0 + STUCK_AFTER_MS + 1));
    expect(failStuckBuilds(store)).toEqual(["b"]);
    const after = store.builds.get("b")!;
    expect(after.status).toBe(BuildStatus.FAILED);
    expect(after.failureReason).not.toBeNull();
  });

  it("does not re-fire on already-failed builds", () => {
    const store = new Store();
    store.builds.set(
      "b",
      makeBuild({
        buildId: "b",
        status: BuildStatus.RUNNING,
        startedAt: new Date(T0),
      }),
    );
    jest.setSystemTime(new Date(T0 + STUCK_AFTER_MS + 1));
    expect(failStuckBuilds(store)).toEqual(["b"]);
    expect(failStuckBuilds(store)).toEqual([]);
  });

  it("rule-failure: skips RUNNING builds with null startedAt", () => {
    const store = new Store();
    store.builds.set(
      "b",
      makeBuild({
        buildId: "b",
        status: BuildStatus.RUNNING,
        startedAt: null,
      }),
    );
    jest.setSystemTime(new Date(T0 + STUCK_AFTER_MS + 60_000));
    expect(failStuckBuilds(store)).toEqual([]);
    expect(store.builds.get("b")!.status).toBe(BuildStatus.RUNNING);
  });

  it("rule-failure: skips builds with status != running", () => {
    const store = new Store();
    for (const status of [
      BuildStatus.QUEUED,
      BuildStatus.SUCCESS,
      BuildStatus.FAILED,
      BuildStatus.CANCELLED,
    ]) {
      store.builds.set(
        `b-${status}`,
        makeBuild({
          buildId: `b-${status}`,
          status,
          startedAt: new Date(T0),
        }),
      );
    }
    jest.setSystemTime(new Date(T0 + STUCK_AFTER_MS + 60_000));
    expect(failStuckBuilds(store)).toEqual([]);
  });
});

describe("temporal rule ExpireOldArtifacts", () => {
  it("does not fire before expiry", () => {
    const store = new Store();
    store.artifacts.set(
      "a",
      makeArtifact({
        artifactId: "a",
        status: ArtifactStatus.UPLOADED,
        uploadedAt: new Date(T0),
        expiresAt: new Date(T0 + ARTIFACT_TTL_MS),
      }),
    );
    jest.setSystemTime(new Date(T0 + ARTIFACT_TTL_MS - 1));
    expect(expireOldArtifacts(store)).toEqual([]);
    expect(store.artifacts.get("a")!.status).toBe(ArtifactStatus.UPLOADED);
  });

  it("fires once after expiry (UPLOADED → EXPIRED)", () => {
    const store = new Store();
    store.artifacts.set(
      "a",
      makeArtifact({
        artifactId: "a",
        status: ArtifactStatus.UPLOADED,
        uploadedAt: new Date(T0),
        expiresAt: new Date(T0 + ARTIFACT_TTL_MS),
      }),
    );
    jest.setSystemTime(new Date(T0 + ARTIFACT_TTL_MS + 1));
    expect(expireOldArtifacts(store)).toEqual(["a"]);
    expect(store.artifacts.get("a")!.status).toBe(ArtifactStatus.EXPIRED);
  });

  it("rule-failure: skips PENDING artifacts (status != uploaded)", () => {
    const store = new Store();
    store.artifacts.set(
      "a",
      makeArtifact({
        artifactId: "a",
        status: ArtifactStatus.PENDING,
        uploadedAt: null,
        expiresAt: null,
      }),
    );
    jest.setSystemTime(new Date(T0 + ARTIFACT_TTL_MS + 60_000));
    expect(expireOldArtifacts(store)).toEqual([]);
  });

  it("rule-failure: skips EXPIRED artifacts (already terminal)", () => {
    const store = new Store();
    store.artifacts.set(
      "a",
      makeArtifact({
        artifactId: "a",
        status: ArtifactStatus.EXPIRED,
        uploadedAt: new Date(T0),
        expiresAt: new Date(T0),
      }),
    );
    jest.setSystemTime(new Date(T0 + ARTIFACT_TTL_MS + 60_000));
    expect(expireOldArtifacts(store)).toEqual([]);
  });

  it("scoped to expired ones only — fresh UPLOADED artifacts are left alone", () => {
    const store = new Store();
    store.artifacts.set(
      "old",
      makeArtifact({
        artifactId: "old",
        status: ArtifactStatus.UPLOADED,
        uploadedAt: new Date(T0 - 2 * ARTIFACT_TTL_MS),
        expiresAt: new Date(T0 - ARTIFACT_TTL_MS),
      }),
    );
    store.artifacts.set(
      "fresh",
      makeArtifact({
        artifactId: "fresh",
        status: ArtifactStatus.UPLOADED,
        uploadedAt: new Date(T0),
        expiresAt: new Date(T0 + ARTIFACT_TTL_MS),
      }),
    );
    expect(expireOldArtifacts(store)).toEqual(["old"]);
    expect(store.artifacts.get("old")!.status).toBe(ArtifactStatus.EXPIRED);
    expect(store.artifacts.get("fresh")!.status).toBe(ArtifactStatus.UPLOADED);
  });
});

describe("temporal scenarios: builds-pipeline interaction", () => {
  it("queued build that times out becomes CANCELLED and stops counting toward active builds", () => {
    const store = new Store();
    const pipeline = makePipeline({ pipelineId: "p1" });
    store.pipelines.set(pipeline.pipelineId, pipeline);
    store.builds.set(
      "b1",
      makeBuild({
        buildId: "b1",
        pipelineId: "p1",
        status: BuildStatus.QUEUED,
        queuedAt: new Date(T0),
      }),
    );
    jest.setSystemTime(new Date(T0 + QUEUED_TIMEOUT_MS + 1));
    timeoutQueuedBuilds(store);
    expect(store.builds.get("b1")!.status).toBe(BuildStatus.CANCELLED);
  });
});
