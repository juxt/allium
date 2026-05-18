/**
 * Derived values / projections / relationships.
 *
 * Obligations covered:
 *   - derived.Artifact.artifactIsExpired
 *   - derived.Build.buildIsStuck
 *   - entity-relationship.Build.artifacts
 *   - entity-relationship.Pipeline.builds
 *   - projection.Pipeline.active_builds
 */
import { describe, expect, it } from "@jest/globals";
import {
  BuildStatus,
  PipelineStatus,
  STUCK_AFTER_MS,
  Store,
  artifactIsExpired,
  buildIsStuck,
  pipelineActiveBuildCount,
} from "../src/models.js";
import {
  makeArtifact,
  makeBuild,
  makePipeline,
  storeWithBuild,
} from "./helpers.js";

describe("derived.Artifact.artifactIsExpired", () => {
  it("is false when expiresAt is null", () => {
    expect(artifactIsExpired(makeArtifact({ expiresAt: null }))).toBe(false);
  });

  it("is false when expiresAt is in the future", () => {
    const future = new Date(Date.now() + 60_000);
    expect(artifactIsExpired(makeArtifact({ expiresAt: future }))).toBe(false);
  });

  it("is true when expiresAt is in the past", () => {
    const past = new Date(Date.now() - 60_000);
    expect(artifactIsExpired(makeArtifact({ expiresAt: past }))).toBe(true);
  });
});

describe("derived.Build.buildIsStuck", () => {
  it("is false when status is not running", () => {
    const b = makeBuild({
      status: BuildStatus.QUEUED,
      startedAt: new Date(Date.now() - 2 * STUCK_AFTER_MS),
    });
    expect(buildIsStuck(b)).toBe(false);
  });

  it("is false when startedAt is null (status=running not yet reached)", () => {
    const b = makeBuild({ status: BuildStatus.RUNNING, startedAt: null });
    expect(buildIsStuck(b)).toBe(false);
  });

  it("is false when running for less than the stuck threshold", () => {
    const b = makeBuild({
      status: BuildStatus.RUNNING,
      startedAt: new Date(Date.now() - 60_000),
    });
    expect(buildIsStuck(b)).toBe(false);
  });

  it("is true when running past the stuck threshold", () => {
    const b = makeBuild({
      status: BuildStatus.RUNNING,
      startedAt: new Date(Date.now() - STUCK_AFTER_MS - 60_000),
    });
    expect(buildIsStuck(b)).toBe(true);
  });
});

describe("entity-relationship.Build.artifacts", () => {
  it("navigates from a build to its artifacts (filtered by buildId)", () => {
    const store = new Store();
    const b1 = makeBuild({ buildId: "b1", status: BuildStatus.SUCCESS });
    const b2 = makeBuild({ buildId: "b2", status: BuildStatus.SUCCESS });
    store.builds.set(b1.buildId, b1);
    store.builds.set(b2.buildId, b2);
    const a1 = makeArtifact({ artifactId: "a1", buildId: "b1" });
    const a2 = makeArtifact({ artifactId: "a2", buildId: "b1" });
    const a3 = makeArtifact({ artifactId: "a3", buildId: "b2" });
    store.artifacts.set(a1.artifactId, a1);
    store.artifacts.set(a2.artifactId, a2);
    store.artifacts.set(a3.artifactId, a3);

    const forB1 = [...store.artifacts.values()].filter((a) => a.buildId === b1.buildId);
    expect(forB1.map((a) => a.artifactId).sort()).toEqual(["a1", "a2"]);
  });
});

describe("entity-relationship.Pipeline.builds", () => {
  it("navigates from a pipeline to its builds (filtered by pipelineId)", () => {
    const store = new Store();
    const p1 = makePipeline({ pipelineId: "p1" });
    const p2 = makePipeline({ pipelineId: "p2" });
    store.pipelines.set(p1.pipelineId, p1);
    store.pipelines.set(p2.pipelineId, p2);
    const b1 = makeBuild({ buildId: "b1", pipelineId: "p1" });
    const b2 = makeBuild({ buildId: "b2", pipelineId: "p1" });
    const b3 = makeBuild({ buildId: "b3", pipelineId: "p2" });
    store.builds.set(b1.buildId, b1);
    store.builds.set(b2.buildId, b2);
    store.builds.set(b3.buildId, b3);

    const forP1 = [...store.builds.values()].filter((b) => b.pipelineId === p1.pipelineId);
    expect(forP1.map((b) => b.buildId).sort()).toEqual(["b1", "b2"]);
  });
});

describe("projection.Pipeline.active_builds", () => {
  it("counts only QUEUED and RUNNING builds on the pipeline", () => {
    const { store, pipeline } = storeWithBuild();
    // existing build is QUEUED — counts.
    store.builds.set(
      "b-running",
      makeBuild({ buildId: "b-running", status: BuildStatus.RUNNING }),
    );
    store.builds.set(
      "b-success",
      makeBuild({ buildId: "b-success", status: BuildStatus.SUCCESS }),
    );
    store.builds.set(
      "b-failed",
      makeBuild({ buildId: "b-failed", status: BuildStatus.FAILED }),
    );
    store.builds.set(
      "b-cancelled",
      makeBuild({ buildId: "b-cancelled", status: BuildStatus.CANCELLED }),
    );
    expect(pipelineActiveBuildCount(store, pipeline.pipelineId)).toBe(2);
  });

  it("counts zero when no active builds exist", () => {
    const { store, pipeline, build } = storeWithBuild({ status: BuildStatus.SUCCESS });
    expect(pipelineActiveBuildCount(store, pipeline.pipelineId)).toBe(0);
    expect(build.status).toBe(BuildStatus.SUCCESS); // sanity
  });

  it("only counts builds belonging to the given pipeline", () => {
    const store = new Store();
    const p1 = makePipeline({ pipelineId: "p1", status: PipelineStatus.ACTIVE });
    const p2 = makePipeline({ pipelineId: "p2", status: PipelineStatus.ACTIVE });
    store.pipelines.set(p1.pipelineId, p1);
    store.pipelines.set(p2.pipelineId, p2);
    store.builds.set(
      "b-p1-q",
      makeBuild({ buildId: "b-p1-q", pipelineId: "p1", status: BuildStatus.QUEUED }),
    );
    store.builds.set(
      "b-p2-r",
      makeBuild({ buildId: "b-p2-r", pipelineId: "p2", status: BuildStatus.RUNNING }),
    );
    expect(pipelineActiveBuildCount(store, "p1")).toBe(1);
    expect(pipelineActiveBuildCount(store, "p2")).toBe(1);
  });
});
