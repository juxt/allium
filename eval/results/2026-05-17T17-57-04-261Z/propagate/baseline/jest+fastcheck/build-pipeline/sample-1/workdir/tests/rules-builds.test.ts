/**
 * Build-lifecycle rule tests.
 *
 * Obligations covered:
 *   - rule-success.{EnqueueBuild, StartBuild, MarkBuildSuccess, MarkBuildFailed, CancelBuild}
 *   - rule-failure.{EnqueueBuild, StartBuild, MarkBuildSuccess, MarkBuildFailed, CancelBuild}.1
 *   - rule-entity-creation.EnqueueBuild.1
 *
 * Implementation bridge:
 *   spec rule              → service function
 *   EnqueueBuild           → enqueueBuild (src/services/builds.ts:18)
 *   StartBuild             → startBuild   (src/services/builds.ts:51)
 *   MarkBuildSuccess       → markBuildSuccess (src/services/builds.ts:61)
 *   MarkBuildFailed        → markBuildFailed  (src/services/builds.ts:71)
 *   CancelBuild            → cancelBuild      (src/services/builds.ts:86)
 */
import { describe, expect, it } from "@jest/globals";
import { BuildStatus, PipelineStatus, Store } from "../src/models.js";
import {
  BuildTransitionError,
  cancelBuild,
  enqueueBuild,
  markBuildFailed,
  markBuildSuccess,
  startBuild,
} from "../src/services/builds.js";
import { makeBuild, makePipeline, storeWithBuild } from "./helpers.js";

describe("rule EnqueueBuild", () => {
  it("succeeds when pipeline.status = active (rule-success)", () => {
    const store = new Store();
    const pipeline = makePipeline({ status: PipelineStatus.ACTIVE });
    store.pipelines.set(pipeline.pipelineId, pipeline);
    const before = Date.now();
    const build = enqueueBuild(store, {
      buildId: "b-new",
      pipelineId: pipeline.pipelineId,
      commitSha: "deadbeef",
      triggeredBy: "octocat",
    });
    expect(build.status).toBe(BuildStatus.QUEUED);
    // entity-creation fields from the spec ensures clause:
    expect(build.buildId).toBe("b-new");
    expect(build.commitSha).toBe("deadbeef");
    expect(build.failureReason).toBeNull();
    expect(build.finishedAt).toBeNull();
    expect(build.pipelineId).toBe(pipeline.pipelineId);
    expect(build.startedAt).toBeNull();
    expect(build.triggeredBy).toBe("octocat");
    expect(build.queuedAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(store.builds.get("b-new")).toBe(build);
  });

  it.each<[string, PipelineStatus]>([
    ["paused", PipelineStatus.PAUSED],
    ["archived", PipelineStatus.ARCHIVED],
  ])("is rejected when pipeline.status = %s (rule-failure)", (_label: string, status: PipelineStatus) => {
    const store = new Store();
    const pipeline = makePipeline({ status });
    store.pipelines.set(pipeline.pipelineId, pipeline);
    expect(() =>
      enqueueBuild(store, {
        buildId: "b-x",
        pipelineId: pipeline.pipelineId,
        commitSha: "x",
        triggeredBy: "u",
      }),
    ).toThrow(BuildTransitionError);
    expect(store.builds.has("b-x")).toBe(false);
  });
});

describe("rule StartBuild", () => {
  it("succeeds when build.status = queued (rule-success)", () => {
    const { store, build } = storeWithBuild({ status: BuildStatus.QUEUED });
    const before = Date.now();
    const result = startBuild(store, build.buildId);
    expect(result.status).toBe(BuildStatus.RUNNING);
    expect(result.startedAt).not.toBeNull();
    expect(result.startedAt!.getTime()).toBeGreaterThanOrEqual(before);
  });

  it.each<BuildStatus>([BuildStatus.RUNNING, BuildStatus.SUCCESS, BuildStatus.FAILED, BuildStatus.CANCELLED])(
    "is rejected when build.status = %s (rule-failure)",
    (status: BuildStatus) => {
      const { store, build } = storeWithBuild({
        status,
        startedAt: status === BuildStatus.QUEUED ? null : new Date(),
      });
      expect(() => startBuild(store, build.buildId)).toThrow(BuildTransitionError);
    },
  );
});

describe("rule MarkBuildSuccess", () => {
  it("succeeds when build.status = running (rule-success)", () => {
    const { store, build } = storeWithBuild({
      status: BuildStatus.RUNNING,
      startedAt: new Date(),
    });
    const before = Date.now();
    const result = markBuildSuccess(store, build.buildId);
    expect(result.status).toBe(BuildStatus.SUCCESS);
    expect(result.finishedAt).not.toBeNull();
    expect(result.finishedAt!.getTime()).toBeGreaterThanOrEqual(before);
  });

  it.each<BuildStatus>([BuildStatus.QUEUED, BuildStatus.SUCCESS, BuildStatus.FAILED, BuildStatus.CANCELLED])(
    "is rejected when build.status = %s (rule-failure)",
    (status: BuildStatus) => {
      const { store, build } = storeWithBuild({ status });
      expect(() => markBuildSuccess(store, build.buildId)).toThrow(BuildTransitionError);
    },
  );
});

describe("rule MarkBuildFailed", () => {
  it("succeeds when build.status = running, recording the reason (rule-success)", () => {
    const { store, build } = storeWithBuild({
      status: BuildStatus.RUNNING,
      startedAt: new Date(),
    });
    const before = Date.now();
    const result = markBuildFailed(store, build.buildId, "compilation error");
    expect(result.status).toBe(BuildStatus.FAILED);
    expect(result.failureReason).toBe("compilation error");
    expect(result.finishedAt).not.toBeNull();
    expect(result.finishedAt!.getTime()).toBeGreaterThanOrEqual(before);
  });

  it.each<BuildStatus>([BuildStatus.QUEUED, BuildStatus.SUCCESS, BuildStatus.FAILED, BuildStatus.CANCELLED])(
    "is rejected when build.status = %s (rule-failure)",
    (status: BuildStatus) => {
      const { store, build } = storeWithBuild({ status });
      expect(() => markBuildFailed(store, build.buildId, "x")).toThrow(BuildTransitionError);
    },
  );
});

describe("rule CancelBuild", () => {
  it.each<BuildStatus>([BuildStatus.QUEUED, BuildStatus.RUNNING])(
    "succeeds when build.status = %s (rule-success)",
    (status: BuildStatus) => {
      const { store, build } = storeWithBuild({
        status,
        startedAt: status === BuildStatus.RUNNING ? new Date() : null,
      });
      const before = Date.now();
      const result = cancelBuild(store, build.buildId);
      expect(result.status).toBe(BuildStatus.CANCELLED);
      expect(result.finishedAt).not.toBeNull();
      expect(result.finishedAt!.getTime()).toBeGreaterThanOrEqual(before);
    },
  );

  it.each<BuildStatus>([BuildStatus.SUCCESS, BuildStatus.FAILED, BuildStatus.CANCELLED])(
    "is rejected when build.status = %s (rule-failure)",
    (status: BuildStatus) => {
      const { store, build } = storeWithBuild({ status });
      expect(() => cancelBuild(store, build.buildId)).toThrow(BuildTransitionError);
    },
  );
});

describe("transition graph from rules", () => {
  it("queued → running via StartBuild", () => {
    const { store, build } = storeWithBuild({ status: BuildStatus.QUEUED });
    expect(startBuild(store, build.buildId).status).toBe(BuildStatus.RUNNING);
  });

  it("running → success via MarkBuildSuccess", () => {
    const { store, build } = storeWithBuild({
      status: BuildStatus.RUNNING,
      startedAt: new Date(),
    });
    expect(markBuildSuccess(store, build.buildId).status).toBe(BuildStatus.SUCCESS);
  });

  it("running → failed via MarkBuildFailed", () => {
    const { store, build } = storeWithBuild({
      status: BuildStatus.RUNNING,
      startedAt: new Date(),
    });
    expect(markBuildFailed(store, build.buildId, "r").status).toBe(BuildStatus.FAILED);
  });

  it("queued → cancelled and running → cancelled via CancelBuild", () => {
    {
      const { store, build } = storeWithBuild({ status: BuildStatus.QUEUED });
      expect(cancelBuild(store, build.buildId).status).toBe(BuildStatus.CANCELLED);
    }
    {
      const { store, build } = storeWithBuild({
        status: BuildStatus.RUNNING,
        startedAt: new Date(),
      });
      expect(cancelBuild(store, build.buildId).status).toBe(BuildStatus.CANCELLED);
    }
  });

  it("terminal states (success, failed, cancelled) reject all build-lifecycle rules", () => {
    for (const terminal of [BuildStatus.SUCCESS, BuildStatus.FAILED, BuildStatus.CANCELLED]) {
      const { store, build } = storeWithBuild({ status: terminal });
      expect(() => startBuild(store, build.buildId)).toThrow(BuildTransitionError);
      expect(() => markBuildSuccess(store, build.buildId)).toThrow(BuildTransitionError);
      expect(() => markBuildFailed(store, build.buildId, "x")).toThrow(BuildTransitionError);
      expect(() => cancelBuild(store, build.buildId)).toThrow(BuildTransitionError);
    }
  });

  it("reachability: queued → running → success (full happy path)", () => {
    const store = new Store();
    const pipeline = makePipeline();
    store.pipelines.set(pipeline.pipelineId, pipeline);

    const b = enqueueBuild(store, {
      buildId: "b-life",
      pipelineId: pipeline.pipelineId,
      commitSha: "abc",
      triggeredBy: "u",
    });
    expect(b.status).toBe(BuildStatus.QUEUED);
    expect(startBuild(store, b.buildId).status).toBe(BuildStatus.RUNNING);
    expect(markBuildSuccess(store, b.buildId).status).toBe(BuildStatus.SUCCESS);
  });
});

describe("invariant.FailedBuildsHaveReason", () => {
  it("MarkBuildFailed sets a non-null failureReason", () => {
    const { store, build } = storeWithBuild({
      status: BuildStatus.RUNNING,
      startedAt: new Date(),
    });
    const result = markBuildFailed(store, build.buildId, "tests failed");
    expect(result.status).toBe(BuildStatus.FAILED);
    expect(result.failureReason).not.toBeNull();
    expect(result.failureReason).toBe("tests failed");
  });

  it("after every state-changing rule, all FAILED builds have failureReason set", () => {
    const { store, build } = storeWithBuild({
      status: BuildStatus.RUNNING,
      startedAt: new Date(),
    });
    markBuildFailed(store, build.buildId, "lint");
    // Add a successful build alongside the failed one
    const b2 = makeBuild({ buildId: "b2", status: BuildStatus.SUCCESS });
    store.builds.set(b2.buildId, b2);

    const failed = [...store.builds.values()].filter((b) => b.status === BuildStatus.FAILED);
    for (const b of failed) {
      expect(b.failureReason).not.toBeNull();
    }
  });

  // Note: cancelBuild does not set failureReason — cancelled builds need not have one.
  it("cancelled builds are not required to have a failureReason", () => {
    const { store, build } = storeWithBuild({
      status: BuildStatus.RUNNING,
      startedAt: new Date(),
    });
    const result = cancelBuild(store, build.buildId);
    expect(result.status).toBe(BuildStatus.CANCELLED);
    // No invariant requires failureReason here.
    expect(result.failureReason).toBeNull();
  });
});
