/**
 * Derived value and projection tests.
 *
 * Covers obligations:
 *   - derived.Artifact.artifactIsExpired
 *   - derived.Build.buildIsStuck
 *   - projection.Pipeline.active_builds
 *
 * Both derived getters depend on `Date.now()`. The implementation does not
 * accept an injected clock, so we fake the system clock via jest's modern
 * fake timers (which patches the global Date).
 */
import { jest } from "@jest/globals";
import {
  BuildStatus,
  PipelineStatus,
  STUCK_AFTER_MS,
  artifactIsExpired,
  buildIsStuck,
  pipelineActiveBuildCount,
} from "../src/models.js";
import {
  makeArtifact,
  makeBuild,
  makePipeline,
  makeStore,
} from "./_fixtures.js";

describe("derived.Artifact.artifactIsExpired", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  test("returns false when expiresAt is null (no expiry recorded)", () => {
    jest.setSystemTime(new Date("2026-06-01T00:00:00Z"));
    expect(artifactIsExpired(makeArtifact({ expiresAt: null }))).toBe(false);
  });

  test("returns false when now <= expiresAt", () => {
    jest.setSystemTime(new Date("2026-06-01T00:00:00Z"));
    const future = new Date("2026-06-02T00:00:00Z");
    expect(artifactIsExpired(makeArtifact({ expiresAt: future }))).toBe(false);
  });

  test("returns true when now > expiresAt", () => {
    jest.setSystemTime(new Date("2026-06-02T00:00:01Z"));
    const past = new Date("2026-06-02T00:00:00Z");
    expect(artifactIsExpired(makeArtifact({ expiresAt: past }))).toBe(true);
  });
});

describe("derived.Build.buildIsStuck", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  test("false when status is not running", () => {
    jest.setSystemTime(new Date("2026-06-01T10:00:00Z"));
    const queued = makeBuild({ status: BuildStatus.QUEUED, startedAt: null });
    const succeeded = makeBuild({
      status: BuildStatus.SUCCESS,
      startedAt: new Date("2026-06-01T00:00:00Z"),
    });
    expect(buildIsStuck(queued)).toBe(false);
    expect(buildIsStuck(succeeded)).toBe(false);
  });

  test("false when running but startedAt is null", () => {
    jest.setSystemTime(new Date("2026-06-01T10:00:00Z"));
    const b = makeBuild({ status: BuildStatus.RUNNING, startedAt: null });
    expect(buildIsStuck(b)).toBe(false);
  });

  test("false when running but elapsed <= stuck_after", () => {
    jest.setSystemTime(new Date("2026-06-01T10:00:00Z"));
    const b = makeBuild({
      status: BuildStatus.RUNNING,
      startedAt: new Date(Date.now() - STUCK_AFTER_MS),
    });
    expect(buildIsStuck(b)).toBe(false);
  });

  test("true when running and elapsed > stuck_after", () => {
    jest.setSystemTime(new Date("2026-06-01T10:00:00Z"));
    const b = makeBuild({
      status: BuildStatus.RUNNING,
      startedAt: new Date(Date.now() - STUCK_AFTER_MS - 1),
    });
    expect(buildIsStuck(b)).toBe(true);
  });
});

describe("projection.Pipeline.active_builds", () => {
  test("counts only QUEUED and RUNNING builds tied to the pipeline", () => {
    const p = makePipeline({ pipelineId: "p-1", status: PipelineStatus.ACTIVE });
    const builds = [
      makeBuild({ buildId: "b-q", pipelineId: "p-1", status: BuildStatus.QUEUED }),
      makeBuild({ buildId: "b-r", pipelineId: "p-1", status: BuildStatus.RUNNING }),
      makeBuild({ buildId: "b-s", pipelineId: "p-1", status: BuildStatus.SUCCESS }),
      makeBuild({ buildId: "b-f", pipelineId: "p-1", status: BuildStatus.FAILED }),
      makeBuild({ buildId: "b-c", pipelineId: "p-1", status: BuildStatus.CANCELLED }),
      // Different pipeline — must not be counted
      makeBuild({ buildId: "b-x", pipelineId: "p-2", status: BuildStatus.QUEUED }),
    ];
    const store = makeStore({ pipelines: [p], builds });

    expect(pipelineActiveBuildCount(store, "p-1")).toBe(2);
    expect(pipelineActiveBuildCount(store, "p-2")).toBe(1);
    expect(pipelineActiveBuildCount(store, "p-unknown")).toBe(0);
  });
});
