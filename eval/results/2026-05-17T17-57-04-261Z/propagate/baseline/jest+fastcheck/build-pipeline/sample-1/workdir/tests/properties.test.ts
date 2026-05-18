/**
 * Property-based tests (fast-check).
 *
 * Obligations covered:
 *   - invariant.FailedBuildsHaveReason (PBT walk)
 *   - state-machine — random walk through build transition graph
 *   - state-machine — random walk through artifact transition graph
 *   - entity-optional smoke (Build, Artifact)
 *
 * The build transition graph derived from the spec rules:
 *   queued   → running           (StartBuild)
 *   running  → success           (MarkBuildSuccess)
 *   running  → failed            (MarkBuildFailed)
 *   queued   → cancelled         (CancelBuild)
 *   running  → cancelled         (CancelBuild)
 *
 * The artifact transition graph:
 *   pending  → uploaded          (MarkArtifactUploaded)
 *   uploaded → expired           (MarkArtifactExpired)
 */
import { describe, expect, it } from "@jest/globals";
import fc from "fast-check";
import {
  ArtifactStatus,
  BuildStatus,
  PipelineStatus,
  Store,
} from "../src/models.js";
import {
  BuildTransitionError,
  cancelBuild,
  enqueueBuild,
  markBuildFailed,
  markBuildSuccess,
  startBuild,
} from "../src/services/builds.js";
import {
  ArtifactTransitionError,
  markArtifactExpired,
  markArtifactUploaded,
  registerArtifact,
} from "../src/services/artifacts.js";
import { makeBuild, makePipeline } from "./helpers.js";

const BUILD_ACTIONS = [
  "start",
  "success",
  "fail",
  "cancel",
] as const;
type BuildAction = (typeof BUILD_ACTIONS)[number];

const validBuildTransitions: Record<BuildStatus, BuildAction[]> = {
  [BuildStatus.QUEUED]: ["start", "cancel"],
  [BuildStatus.RUNNING]: ["success", "fail", "cancel"],
  [BuildStatus.SUCCESS]: [],
  [BuildStatus.FAILED]: [],
  [BuildStatus.CANCELLED]: [],
};

function applyBuildAction(store: Store, buildId: string, action: BuildAction): void {
  switch (action) {
    case "start":
      startBuild(store, buildId);
      return;
    case "success":
      markBuildSuccess(store, buildId);
      return;
    case "fail":
      markBuildFailed(store, buildId, "pbt failure");
      return;
    case "cancel":
      cancelBuild(store, buildId);
      return;
  }
}

describe("PBT: build transition graph honours rule guards", () => {
  it("any valid action sequence from QUEUED reaches a terminal state, every step keeps invariants", () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom(...BUILD_ACTIONS), { minLength: 1, maxLength: 10 }),
        (actions: BuildAction[]) => {
          const store = new Store();
          const pipeline = makePipeline();
          store.pipelines.set(pipeline.pipelineId, pipeline);
          const build = enqueueBuild(store, {
            buildId: "b",
            pipelineId: pipeline.pipelineId,
            commitSha: "x",
            triggeredBy: "u",
          });
          expect(build.status).toBe(BuildStatus.QUEUED);

          for (const action of actions) {
            const current = store.builds.get("b")!.status;
            const allowed = validBuildTransitions[current];
            if (allowed.includes(action)) {
              applyBuildAction(store, "b", action);
              // invariant.FailedBuildsHaveReason
              for (const b of store.builds.values()) {
                if (b.status === BuildStatus.FAILED) {
                  expect(b.failureReason).not.toBeNull();
                }
              }
            } else {
              expect(() => applyBuildAction(store, "b", action)).toThrow(
                BuildTransitionError,
              );
              // Status is unchanged after a rejected transition.
              expect(store.builds.get("b")!.status).toBe(current);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("once a build reaches a terminal status, no further transitions are accepted", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(BuildStatus.SUCCESS, BuildStatus.FAILED, BuildStatus.CANCELLED),
        fc.array(fc.constantFrom(...BUILD_ACTIONS), { minLength: 1, maxLength: 5 }),
        (terminal: BuildStatus, actions: BuildAction[]) => {
          const store = new Store();
          const pipeline = makePipeline();
          store.pipelines.set(pipeline.pipelineId, pipeline);
          store.builds.set(
            "b",
            makeBuild({
              buildId: "b",
              pipelineId: pipeline.pipelineId,
              status: terminal,
              startedAt: new Date(),
              finishedAt: new Date(),
              failureReason: terminal === BuildStatus.FAILED ? "x" : null,
            }),
          );
          for (const action of actions) {
            expect(() => applyBuildAction(store, "b", action)).toThrow(
              BuildTransitionError,
            );
            expect(store.builds.get("b")!.status).toBe(terminal);
          }
        },
      ),
      { numRuns: 50 },
    );
  });
});

const ARTIFACT_ACTIONS = ["upload", "expire"] as const;
type ArtifactAction = (typeof ARTIFACT_ACTIONS)[number];

const validArtifactTransitions: Record<ArtifactStatus, ArtifactAction[]> = {
  [ArtifactStatus.PENDING]: ["upload"],
  [ArtifactStatus.UPLOADED]: ["expire"],
  [ArtifactStatus.EXPIRED]: [],
};

function applyArtifactAction(store: Store, id: string, action: ArtifactAction): void {
  switch (action) {
    case "upload":
      markArtifactUploaded(store, id, "bucket/k");
      return;
    case "expire":
      markArtifactExpired(store, id);
      return;
  }
}

describe("PBT: artifact transition graph honours rule guards", () => {
  it("rejected actions throw and do not change the state", () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom(...ARTIFACT_ACTIONS), { minLength: 1, maxLength: 8 }),
        (actions: ArtifactAction[]) => {
          const store = new Store();
          const build = makeBuild({ status: BuildStatus.SUCCESS });
          store.builds.set(build.buildId, build);
          const artifact = registerArtifact(store, {
            artifactId: "a",
            buildId: build.buildId,
            name: "n",
            sizeBytes: 1,
          });
          expect(artifact.status).toBe(ArtifactStatus.PENDING);

          for (const action of actions) {
            const current = store.artifacts.get("a")!.status;
            const allowed = validArtifactTransitions[current];
            if (allowed.includes(action)) {
              applyArtifactAction(store, "a", action);
            } else {
              expect(() => applyArtifactAction(store, "a", action)).toThrow(
                ArtifactTransitionError,
              );
              expect(store.artifacts.get("a")!.status).toBe(current);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe("PBT: invariant.FailedBuildsHaveReason holds across random rule sequences", () => {
  it("for any sequence of build rules, all FAILED builds have a non-null failureReason", () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom(...BUILD_ACTIONS), { minLength: 0, maxLength: 12 }),
        fc.array(fc.string({ minLength: 1, maxLength: 16 }), { minLength: 1, maxLength: 4 }),
        (actions: BuildAction[], reasons: string[]) => {
          const store = new Store();
          const pipeline = makePipeline();
          store.pipelines.set(pipeline.pipelineId, pipeline);
          for (let i = 0; i < 3; i++) {
            enqueueBuild(store, {
              buildId: `b${i}`,
              pipelineId: pipeline.pipelineId,
              commitSha: `c${i}`,
              triggeredBy: "u",
            });
          }

          let reasonIdx = 0;
          for (const action of actions) {
            for (const b of [...store.builds.values()]) {
              const allowed = validBuildTransitions[b.status];
              if (!allowed.includes(action)) continue;
              try {
                if (action === "fail") {
                  markBuildFailed(store, b.buildId, reasons[reasonIdx++ % reasons.length]);
                } else {
                  applyBuildAction(store, b.buildId, action);
                }
              } catch {
                // transitions can race with prior mutations; just skip
              }
            }
          }

          for (const b of store.builds.values()) {
            if (b.status === BuildStatus.FAILED) {
              expect(b.failureReason).not.toBeNull();
              expect((b.failureReason as string).length).toBeGreaterThan(0);
            }
          }
        },
      ),
      { numRuns: 50 },
    );
  });
});

describe("PBT: EnqueueBuild only succeeds for ACTIVE pipelines", () => {
  it("non-active pipeline statuses always reject", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(PipelineStatus.PAUSED, PipelineStatus.ARCHIVED),
        fc.string({ minLength: 1, maxLength: 16 }),
        fc.string({ minLength: 1, maxLength: 40 }),
        (status: PipelineStatus, buildId: string, commitSha: string) => {
          const store = new Store();
          const pipeline = makePipeline({ status });
          store.pipelines.set(pipeline.pipelineId, pipeline);
          expect(() =>
            enqueueBuild(store, {
              buildId,
              pipelineId: pipeline.pipelineId,
              commitSha,
              triggeredBy: "u",
            }),
          ).toThrow(BuildTransitionError);
        },
      ),
      { numRuns: 50 },
    );
  });
});

describe("PBT: RegisterArtifact rejects non-positive sizeBytes for any input", () => {
  it("zero or negative sizeBytes always rejected, even on a SUCCESS build", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -10_000_000, max: 0 }),
        fc.string({ minLength: 1, maxLength: 16 }),
        (size: number, name: string) => {
          const store = new Store();
          const build = makeBuild({ status: BuildStatus.SUCCESS });
          store.builds.set(build.buildId, build);
          expect(() =>
            registerArtifact(store, {
              artifactId: "a-bad",
              buildId: build.buildId,
              name,
              sizeBytes: size,
            }),
          ).toThrow(ArtifactTransitionError);
          expect(store.artifacts.has("a-bad")).toBe(false);
        },
      ),
      { numRuns: 50 },
    );
  });
});

describe("PBT: pending artifact has all storage fields null until upload", () => {
  it("registerArtifact always leaves uploadedAt, expiresAt, storageKey null", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 24 }),
        fc.string({ minLength: 1, maxLength: 24 }),
        fc.integer({ min: 1, max: 1_000_000 }),
        (artifactId: string, name: string, sizeBytes: number) => {
          const store = new Store();
          const build = makeBuild({ status: BuildStatus.SUCCESS });
          store.builds.set(build.buildId, build);
          const a = registerArtifact(store, {
            artifactId,
            buildId: build.buildId,
            name,
            sizeBytes,
          });
          expect(a.status).toBe(ArtifactStatus.PENDING);
          expect(a.uploadedAt).toBeNull();
          expect(a.expiresAt).toBeNull();
          expect(a.storageKey).toBeNull();
        },
      ),
      { numRuns: 50 },
    );
  });
});
