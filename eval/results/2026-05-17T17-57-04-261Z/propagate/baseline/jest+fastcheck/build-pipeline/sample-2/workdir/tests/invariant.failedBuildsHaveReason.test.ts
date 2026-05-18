/**
 * Invariant: FailedBuildsHaveReason.
 *
 *   for b in Builds: b.status = failed implies b.failureReason != null
 *
 * Covers obligation: invariant.FailedBuildsHaveReason.
 *
 * Walks the build lifecycle state machine via fast-check, choosing random
 * valid transitions on a random non-terminal start state, and asserts the
 * invariant after every step on every build in the store. The only
 * spec-correct way to reach BuildStatus.FAILED is through MarkBuildFailed,
 * which requires a non-null reason, so the invariant should always hold.
 */
import { jest } from "@jest/globals";
import fc from "fast-check";
import {
  Build,
  BuildStatus,
  PipelineStatus,
} from "../src/models.js";
import {
  cancelBuild,
  enqueueBuild,
  markBuildFailed,
  markBuildSuccess,
  startBuild,
} from "../src/services/builds.js";
import { failStuckBuilds } from "../src/jobs.js";
import { makePipeline, makeStore } from "./_fixtures.js";

type Edge =
  | { kind: "enqueue" }
  | { kind: "start" }
  | { kind: "success" }
  | { kind: "failed"; reason: string }
  | { kind: "cancel" }
  | { kind: "failStuckSweep"; advanceMs: number };

function invariantHolds(builds: Iterable<Build>): boolean {
  for (const b of builds) {
    if (b.status === BuildStatus.FAILED && b.failureReason === null) return false;
  }
  return true;
}

function applyEdge(
  store: ReturnType<typeof makeStore>,
  buildId: string,
  edge: Edge,
): void {
  switch (edge.kind) {
    case "enqueue":
      try {
        enqueueBuild(store, {
          buildId,
          pipelineId: "p-1",
          commitSha: "abc1234",
          triggeredBy: "tester",
        });
      } catch {
        // Pipeline may not be active or build already exists; ignore guard rejections.
      }
      break;
    case "start":
      try { startBuild(store, buildId); } catch { /* not queued */ }
      break;
    case "success":
      try { markBuildSuccess(store, buildId); } catch { /* not running */ }
      break;
    case "failed":
      try { markBuildFailed(store, buildId, edge.reason); } catch { /* not running */ }
      break;
    case "cancel":
      try { cancelBuild(store, buildId); } catch { /* not queued/running */ }
      break;
    case "failStuckSweep":
      // Advance fake time so a running build crosses the stuck threshold and
      // the job marks it failed via markBuildFailed (which always sets a reason).
      jest.setSystemTime(new Date(Date.now() + edge.advanceMs));
      failStuckBuilds(store);
      break;
  }
}

const edgeArb: fc.Arbitrary<Edge> = fc.oneof(
  fc.constant<Edge>({ kind: "enqueue" }),
  fc.constant<Edge>({ kind: "start" }),
  fc.constant<Edge>({ kind: "success" }),
  fc.record({ kind: fc.constant("failed" as const), reason: fc.string({ minLength: 1, maxLength: 32 }) }),
  fc.constant<Edge>({ kind: "cancel" }),
  fc.record({
    kind: fc.constant("failStuckSweep" as const),
    advanceMs: fc.integer({ min: 60 * 60 * 1000 + 1, max: 24 * 60 * 60 * 1000 }),
  }),
);

describe("invariant.FailedBuildsHaveReason", () => {
  beforeEach(() => jest.useFakeTimers().setSystemTime(new Date("2026-05-01T00:00:00Z")));
  afterEach(() => jest.useRealTimers());

  test("holds after every reachable transition (PBT walk)", () => {
    fc.assert(
      fc.property(fc.array(edgeArb, { minLength: 1, maxLength: 25 }), (edges) => {
        const pipeline = makePipeline({
          pipelineId: "p-1", status: PipelineStatus.ACTIVE,
        });
        const store = makeStore({ pipelines: [pipeline] });
        const buildId = "b-1";
        // Seed the store with a queued build so non-enqueue edges have a target.
        enqueueBuild(store, {
          buildId,
          pipelineId: pipeline.pipelineId,
          commitSha: "deadbeef",
          triggeredBy: "seed",
        });

        for (const edge of edges) {
          applyEdge(store, buildId, edge);
          expect(invariantHolds(store.builds.values())).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });

  test("counter-example: a hand-crafted FAILED build with null reason violates the invariant", () => {
    // Sanity check that invariantHolds actually detects the breach;
    // protects against the property test trivially passing.
    const store = makeStore();
    store.builds.set("bad", {
      buildId: "bad", pipelineId: "p", commitSha: "c",
      status: BuildStatus.FAILED, triggeredBy: "t",
      queuedAt: new Date(), startedAt: new Date(), finishedAt: new Date(),
      failureReason: null,
    });
    expect(invariantHolds(store.builds.values())).toBe(false);
  });
});
