/**
 * GitHub push webhook tests.
 *
 * Covers obligations:
 *   - rule-success.ReceiveGithubPushEvent  (both spec rules — single impl)
 *   - rule-entity-creation.ReceiveGithubPushEvent.1
 *
 * The spec has two ReceiveGithubPushEvent rules (one positional, one
 * payload-shaped); both map to the single receiveGithubPushEvent in
 * webhooks.ts. The spec's @guidance also requires the rule to enqueue a
 * build per active pipeline whose repoUrl ends with repoFullName and
 * whose defaultBranch matches branch.
 */
import {
  BuildStatus,
  PipelineStatus,
} from "../src/models.js";
import { receiveGithubPushEvent } from "../src/webhooks.js";
import { makePipeline, makeStore } from "./_fixtures.js";

describe("rule.ReceiveGithubPushEvent", () => {
  test("success: stores the GithubPushEvent with all spec-mandated fields", () => {
    const store = makeStore();
    const before = Date.now();
    const result = receiveGithubPushEvent(store, {
      eventId: "evt-1",
      repoFullName: "acme/widgets",
      branch: "main",
      commitSha: "abcd1234567890",
      pushedBy: "alice",
    });
    const after = Date.now();

    expect(result.eventId).toBe("evt-1");
    const stored = store.pushEvents.get("evt-1");
    expect(stored).toBeDefined();
    expect(stored!).toEqual({
      eventId: "evt-1",
      repoFullName: "acme/widgets",
      branch: "main",
      commitSha: "abcd1234567890",
      pushedBy: "alice",
      receivedAt: expect.any(Date),
    });
    expect(stored!.receivedAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(stored!.receivedAt.getTime()).toBeLessThanOrEqual(after);
  });

  test("enqueues a queued Build per matching ACTIVE pipeline (repo + branch match)", () => {
    const p1 = makePipeline({
      pipelineId: "p-1",
      repoUrl: "https://github.com/acme/widgets",
      defaultBranch: "main",
      status: PipelineStatus.ACTIVE,
    });
    const p2 = makePipeline({
      pipelineId: "p-2",
      repoUrl: "https://internal.example/acme/widgets",
      defaultBranch: "main",
      status: PipelineStatus.ACTIVE,
    });
    const store = makeStore({ pipelines: [p1, p2] });

    const result = receiveGithubPushEvent(store, {
      eventId: "evt-2",
      repoFullName: "acme/widgets",
      branch: "main",
      commitSha: "deadbeefcafe",
      pushedBy: "bob",
    });

    expect(result.enqueuedBuildIds.sort()).toEqual(
      [`${p1.pipelineId}-deadbee`, `${p2.pipelineId}-deadbee`].sort(),
    );
    for (const buildId of result.enqueuedBuildIds) {
      const b = store.builds.get(buildId)!;
      expect(b).toBeDefined();
      expect(b.status).toBe(BuildStatus.QUEUED);
      expect(b.commitSha).toBe("deadbeefcafe");
      expect(b.triggeredBy).toBe("bob");
    }
  });

  test("does NOT enqueue when pipeline status != ACTIVE", () => {
    const paused = makePipeline({
      pipelineId: "p-paused",
      repoUrl: "https://github.com/acme/widgets",
      defaultBranch: "main",
      status: PipelineStatus.PAUSED,
    });
    const archived = makePipeline({
      pipelineId: "p-archived",
      repoUrl: "https://github.com/acme/widgets",
      defaultBranch: "main",
      status: PipelineStatus.ARCHIVED,
    });
    const store = makeStore({ pipelines: [paused, archived] });

    const result = receiveGithubPushEvent(store, {
      eventId: "evt-3",
      repoFullName: "acme/widgets",
      branch: "main",
      commitSha: "abcdef1",
      pushedBy: "carol",
    });
    expect(result.enqueuedBuildIds).toEqual([]);
    expect(store.builds.size).toBe(0);
    // The event is still recorded — the rule's `ensures` includes creation.
    expect(store.pushEvents.get("evt-3")).toBeDefined();
  });

  test("does NOT enqueue when the branch doesn't match the pipeline default", () => {
    const p = makePipeline({
      pipelineId: "p-1",
      repoUrl: "https://github.com/acme/widgets",
      defaultBranch: "main",
      status: PipelineStatus.ACTIVE,
    });
    const store = makeStore({ pipelines: [p] });

    const result = receiveGithubPushEvent(store, {
      eventId: "evt-4",
      repoFullName: "acme/widgets",
      branch: "develop",
      commitSha: "abcdef1",
      pushedBy: "dan",
    });
    expect(result.enqueuedBuildIds).toEqual([]);
  });

  test("does NOT enqueue when the repoUrl doesn't end with repoFullName", () => {
    const p = makePipeline({
      pipelineId: "p-1",
      repoUrl: "https://github.com/other/repo",
      defaultBranch: "main",
      status: PipelineStatus.ACTIVE,
    });
    const store = makeStore({ pipelines: [p] });

    const result = receiveGithubPushEvent(store, {
      eventId: "evt-5",
      repoFullName: "acme/widgets",
      branch: "main",
      commitSha: "abcdef1",
      pushedBy: "eve",
    });
    expect(result.enqueuedBuildIds).toEqual([]);
  });
});
