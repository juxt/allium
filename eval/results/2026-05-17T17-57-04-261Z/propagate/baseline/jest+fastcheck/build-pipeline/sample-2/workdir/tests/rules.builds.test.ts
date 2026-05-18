/**
 * Build lifecycle rule tests.
 *
 * Covers obligations:
 *   - rule-success.{EnqueueBuild, StartBuild, MarkBuildSuccess,
 *                   MarkBuildFailed, CancelBuild}
 *   - rule-failure.{EnqueueBuild, StartBuild, MarkBuildSuccess,
 *                   MarkBuildFailed, CancelBuild}.1
 *   - rule-entity-creation.EnqueueBuild.1
 *
 * Bridge: each rule maps to a service-layer function in src/services/builds.ts
 * (the spec's @guidance describes route → service correspondence).
 */
import { BuildStatus, PipelineStatus } from "../src/models.js";
import {
  BuildNotFoundError,
  BuildTransitionError,
  cancelBuild,
  enqueueBuild,
  markBuildFailed,
  markBuildSuccess,
  startBuild,
} from "../src/services/builds.js";
import { makeBuild, makePipeline, makeStore } from "./_fixtures.js";

// ---------------------------------------------------------------------------
// EnqueueBuild
// ---------------------------------------------------------------------------

describe("rule.EnqueueBuild", () => {
  test("success: creates a queued Build with all spec-mandated initial fields", () => {
    const p = makePipeline({ status: PipelineStatus.ACTIVE });
    const store = makeStore({ pipelines: [p] });

    const before = Date.now();
    const build = enqueueBuild(store, {
      buildId: "b-1",
      pipelineId: p.pipelineId,
      commitSha: "deadbeef",
      triggeredBy: "alice",
    });
    const after = Date.now();

    // rule_entity_creation: Build.created(...) field set
    expect(build).toEqual({
      buildId: "b-1",
      pipelineId: p.pipelineId,
      commitSha: "deadbeef",
      triggeredBy: "alice",
      status: BuildStatus.QUEUED,
      queuedAt: expect.any(Date),
      startedAt: null,
      finishedAt: null,
      failureReason: null,
    });
    expect(build.queuedAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(build.queuedAt.getTime()).toBeLessThanOrEqual(after);
    expect(store.builds.get("b-1")).toBe(build);
  });

  test.each([PipelineStatus.PAUSED, PipelineStatus.ARCHIVED])(
    "failure: rejected when pipeline.status = %s (requires active)",
    (status) => {
      const p = makePipeline({ status });
      const store = makeStore({ pipelines: [p] });
      expect(() =>
        enqueueBuild(store, {
          buildId: "b-1",
          pipelineId: p.pipelineId,
          commitSha: "deadbeef",
          triggeredBy: "alice",
        }),
      ).toThrow(BuildTransitionError);
      expect(store.builds.size).toBe(0);
    },
  );

  test("failure: rejected when pipeline does not exist", () => {
    const store = makeStore();
    expect(() =>
      enqueueBuild(store, {
        buildId: "b-1",
        pipelineId: "missing",
        commitSha: "deadbeef",
        triggeredBy: "alice",
      }),
    ).toThrow(BuildNotFoundError);
  });
});

// ---------------------------------------------------------------------------
// StartBuild
// ---------------------------------------------------------------------------

describe("rule.StartBuild", () => {
  test("success: queued build transitions to running and startedAt is set", () => {
    const b = makeBuild({ status: BuildStatus.QUEUED, startedAt: null });
    const store = makeStore({ builds: [b] });

    const before = Date.now();
    const out = startBuild(store, b.buildId);
    const after = Date.now();

    expect(out.status).toBe(BuildStatus.RUNNING);
    expect(out.startedAt).not.toBeNull();
    expect(out.startedAt!.getTime()).toBeGreaterThanOrEqual(before);
    expect(out.startedAt!.getTime()).toBeLessThanOrEqual(after);
  });

  test.each([
    BuildStatus.RUNNING,
    BuildStatus.SUCCESS,
    BuildStatus.FAILED,
    BuildStatus.CANCELLED,
  ])("failure: rejected when status = %s (requires queued)", (status) => {
    const b = makeBuild({ status, startedAt: new Date() });
    const store = makeStore({ builds: [b] });
    expect(() => startBuild(store, b.buildId)).toThrow(BuildTransitionError);
  });
});

// ---------------------------------------------------------------------------
// MarkBuildSuccess
// ---------------------------------------------------------------------------

describe("rule.MarkBuildSuccess", () => {
  test("success: running build transitions to success with finishedAt = now", () => {
    const b = makeBuild({
      status: BuildStatus.RUNNING,
      startedAt: new Date(Date.now() - 1000),
    });
    const store = makeStore({ builds: [b] });

    const before = Date.now();
    const out = markBuildSuccess(store, b.buildId);
    const after = Date.now();

    expect(out.status).toBe(BuildStatus.SUCCESS);
    expect(out.finishedAt).not.toBeNull();
    expect(out.finishedAt!.getTime()).toBeGreaterThanOrEqual(before);
    expect(out.finishedAt!.getTime()).toBeLessThanOrEqual(after);
  });

  test.each([
    BuildStatus.QUEUED,
    BuildStatus.SUCCESS,
    BuildStatus.FAILED,
    BuildStatus.CANCELLED,
  ])("failure: rejected when status = %s (requires running)", (status) => {
    const b = makeBuild({ status });
    const store = makeStore({ builds: [b] });
    expect(() => markBuildSuccess(store, b.buildId)).toThrow(BuildTransitionError);
  });
});

// ---------------------------------------------------------------------------
// MarkBuildFailed
// ---------------------------------------------------------------------------

describe("rule.MarkBuildFailed", () => {
  test("success: records reason, sets finishedAt, transitions to failed", () => {
    const b = makeBuild({
      status: BuildStatus.RUNNING,
      startedAt: new Date(Date.now() - 1000),
    });
    const store = makeStore({ builds: [b] });

    const before = Date.now();
    const out = markBuildFailed(store, b.buildId, "compilation error");
    const after = Date.now();

    expect(out.status).toBe(BuildStatus.FAILED);
    expect(out.failureReason).toBe("compilation error");
    expect(out.finishedAt!.getTime()).toBeGreaterThanOrEqual(before);
    expect(out.finishedAt!.getTime()).toBeLessThanOrEqual(after);
  });

  test.each([
    BuildStatus.QUEUED,
    BuildStatus.SUCCESS,
    BuildStatus.FAILED,
    BuildStatus.CANCELLED,
  ])("failure: rejected when status = %s (requires running)", (status) => {
    const b = makeBuild({ status });
    const store = makeStore({ builds: [b] });
    expect(() => markBuildFailed(store, b.buildId, "reason"))
      .toThrow(BuildTransitionError);
  });
});

// ---------------------------------------------------------------------------
// CancelBuild
// ---------------------------------------------------------------------------

describe("rule.CancelBuild", () => {
  test.each([BuildStatus.QUEUED, BuildStatus.RUNNING])(
    "success: cancels a %s build and stamps finishedAt",
    (status) => {
      const b = makeBuild({ status, startedAt: status === BuildStatus.RUNNING ? new Date() : null });
      const store = makeStore({ builds: [b] });

      const before = Date.now();
      const out = cancelBuild(store, b.buildId);
      const after = Date.now();

      expect(out.status).toBe(BuildStatus.CANCELLED);
      expect(out.finishedAt).not.toBeNull();
      expect(out.finishedAt!.getTime()).toBeGreaterThanOrEqual(before);
      expect(out.finishedAt!.getTime()).toBeLessThanOrEqual(after);
    },
  );

  test.each([BuildStatus.SUCCESS, BuildStatus.FAILED, BuildStatus.CANCELLED])(
    "failure: rejected when status = %s (requires queued or running)",
    (status) => {
      const b = makeBuild({ status });
      const store = makeStore({ builds: [b] });
      expect(() => cancelBuild(store, b.buildId)).toThrow(BuildTransitionError);
    },
  );

  test("failure: throws when build does not exist", () => {
    const store = makeStore();
    expect(() => cancelBuild(store, "missing")).toThrow(BuildNotFoundError);
  });
});
