/**
 * Surface tests — HTTP Routes + Webhooks.
 *
 * Obligations covered:
 *   - surface-actor.Routes
 *   - surface-actor.Webhooks
 *   - surface-provides.Routes
 *   - surface-provides.Webhooks
 *   - rule-success.ReceiveGithubPushEvent (both signatures)
 *   - rule-entity-creation.ReceiveGithubPushEvent.1
 *
 * Implementation bridge:
 *   spec surface item        → HTTP path
 *   CancelBuild              → POST /builds/:buildId/cancel
 *   EnqueueBuild             → POST /builds
 *   MarkArtifactUploaded     → POST /artifacts/:artifactId/uploaded
 *   MarkBuildFailed          → POST /builds/:buildId/failed
 *   MarkBuildSuccess         → POST /builds/:buildId/success
 *   ReceiveGithubPushEvent   → POST /webhooks/github-push
 *   RegisterArtifact         → POST /artifacts
 *   StartBuild               → POST /builds/:buildId/start
 *
 * The Routes and Webhooks surfaces share the github-push path. The spec does
 * not declare a separate actor type; we treat the registered Router as the
 * realisation of the surface and check that each `provides` entry has a
 * route registered.
 */
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import { router, store } from "../src/index.js";
import "../src/routes.js"; // side-effect: registers routes
import { BuildStatus, PipelineStatus } from "../src/models.js";
import { makePipeline } from "./helpers.js";

interface RouteSpec {
  method: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
}

const expectedRoutes: ReadonlyArray<RouteSpec & { provides: string }> = [
  { method: "POST", path: "/builds", provides: "EnqueueBuild" },
  { method: "POST", path: "/builds/:buildId/start", provides: "StartBuild" },
  { method: "POST", path: "/builds/:buildId/success", provides: "MarkBuildSuccess" },
  { method: "POST", path: "/builds/:buildId/failed", provides: "MarkBuildFailed" },
  { method: "POST", path: "/builds/:buildId/cancel", provides: "CancelBuild" },
  { method: "POST", path: "/artifacts", provides: "RegisterArtifact" },
  { method: "POST", path: "/artifacts/:artifactId/uploaded", provides: "MarkArtifactUploaded" },
  { method: "POST", path: "/webhooks/github-push", provides: "ReceiveGithubPushEvent" },
];

function findRoute(method: string, path: string) {
  return router.routes.find((r) => r.method === method && r.path === path);
}

describe("surface-provides.Routes", () => {
  it.each(expectedRoutes)(
    "$method $path is registered (provides $provides)",
    ({ method, path }: RouteSpec & { provides: string }) => {
      const route = findRoute(method, path);
      expect(route).toBeDefined();
      expect(typeof route!.handler).toBe("function");
    },
  );

  it("no unexpected routes are registered (provides is exhaustive)", () => {
    const expectedKeys = new Set(expectedRoutes.map((r) => `${r.method} ${r.path}`));
    const actualKeys = new Set(router.routes.map((r) => `${r.method} ${r.path}`));
    expect(actualKeys).toEqual(expectedKeys);
  });
});

describe("surface-provides.Webhooks", () => {
  it("POST /webhooks/github-push is registered (provides ReceiveGithubPushEvent)", () => {
    expect(findRoute("POST", "/webhooks/github-push")).toBeDefined();
  });
});

describe("surface-actor (Routes vs Webhooks)", () => {
  // The spec declares both surfaces without distinguishing actors. The
  // routes share a webhook endpoint; both surfaces expose ReceiveGithubPushEvent.
  // The behavioural check here is that the github-push endpoint is reachable
  // under the same router (no separate actor partition is implemented).
  it("Routes surface includes the webhook endpoint that Webhooks also provides", () => {
    expect(findRoute("POST", "/webhooks/github-push")).toBeDefined();
  });

  // TODO[bridge ambiguous]: spec does not declare actor identifiers for either
  // surface (no `actor` line in spec.allium). With no actor distinction in
  // either spec or implementation, an actor-restriction test cannot be
  // generated. Revisit once the spec adds an actor section.
  it.skip("Routes is restricted to non-webhook actors (skipped — no actor distinction in spec)", () => {});
});

describe("provides — handler success path through router", () => {
  // Reset the shared store between tests to keep them order-independent.
  let originalState: {
    pipelines: Map<string, unknown>;
    builds: Map<string, unknown>;
    artifacts: Map<string, unknown>;
    pushEvents: Map<string, unknown>;
  };

  beforeEach(() => {
    originalState = {
      pipelines: new Map(store.pipelines),
      builds: new Map(store.builds),
      artifacts: new Map(store.artifacts),
      pushEvents: new Map(store.pushEvents),
    };
    store.pipelines.clear();
    store.builds.clear();
    store.artifacts.clear();
    store.pushEvents.clear();
  });

  afterEach(() => {
    store.pipelines.clear();
    store.builds.clear();
    store.artifacts.clear();
    store.pushEvents.clear();
    for (const [k, v] of originalState.pipelines) store.pipelines.set(k, v as never);
    for (const [k, v] of originalState.builds) store.builds.set(k, v as never);
    for (const [k, v] of originalState.artifacts) store.artifacts.set(k, v as never);
    for (const [k, v] of originalState.pushEvents) store.pushEvents.set(k, v as never);
  });

  it("POST /builds handler enqueues a build", () => {
    store.pipelines.set("pipe-1", makePipeline({ pipelineId: "pipe-1" }));
    const handler = findRoute("POST", "/builds")!.handler as (b: unknown) => {
      buildId: string;
      status: BuildStatus;
    };
    const out = handler({
      buildId: "b-via-route",
      pipelineId: "pipe-1",
      commitSha: "x",
      triggeredBy: "u",
    });
    expect(out).toEqual({ buildId: "b-via-route", status: BuildStatus.QUEUED });
    expect(store.builds.has("b-via-route")).toBe(true);
  });

  it("POST /webhooks/github-push handler stores the event and enqueues matching builds (rule ReceiveGithubPushEvent)", () => {
    const pipeline = makePipeline({
      pipelineId: "p1",
      repoUrl: "https://github.com/acme/widget",
      defaultBranch: "main",
      status: PipelineStatus.ACTIVE,
    });
    store.pipelines.set(pipeline.pipelineId, pipeline);

    const handler = findRoute("POST", "/webhooks/github-push")!.handler as (b: unknown) => {
      eventId: string;
      enqueuedBuildIds: string[];
    };
    const result = handler({
      eventId: "evt-1",
      repoFullName: "acme/widget",
      branch: "main",
      commitSha: "abcdef1234567890",
      pushedBy: "octocat",
    });
    expect(result.eventId).toBe("evt-1");
    // rule-entity-creation.ReceiveGithubPushEvent.1 — event is stored.
    expect(store.pushEvents.get("evt-1")).toBeDefined();
    expect(store.pushEvents.get("evt-1")!.branch).toBe("main");
    expect(store.pushEvents.get("evt-1")!.repoFullName).toBe("acme/widget");
    // Matching active pipeline → one build enqueued.
    expect(result.enqueuedBuildIds).toEqual(["p1-abcdef1"]);
    expect(store.builds.get("p1-abcdef1")!.status).toBe(BuildStatus.QUEUED);
  });

  it("github-push does not enqueue when no pipeline matches the repo/branch", () => {
    store.pipelines.set(
      "p1",
      makePipeline({
        pipelineId: "p1",
        repoUrl: "https://github.com/acme/widget",
        defaultBranch: "main",
        status: PipelineStatus.ACTIVE,
      }),
    );
    const handler = findRoute("POST", "/webhooks/github-push")!.handler as (b: unknown) => {
      eventId: string;
      enqueuedBuildIds: string[];
    };
    // Wrong branch — no match.
    const result = handler({
      eventId: "evt-2",
      repoFullName: "acme/widget",
      branch: "feature-x",
      commitSha: "abc1234",
      pushedBy: "octocat",
    });
    expect(result.enqueuedBuildIds).toEqual([]);
    expect(store.pushEvents.has("evt-2")).toBe(true);
  });

  it("github-push skips pipelines that are not active", () => {
    store.pipelines.set(
      "p-paused",
      makePipeline({
        pipelineId: "p-paused",
        repoUrl: "https://github.com/acme/widget",
        defaultBranch: "main",
        status: PipelineStatus.PAUSED,
      }),
    );
    const handler = findRoute("POST", "/webhooks/github-push")!.handler as (b: unknown) => {
      eventId: string;
      enqueuedBuildIds: string[];
    };
    const result = handler({
      eventId: "evt-3",
      repoFullName: "acme/widget",
      branch: "main",
      commitSha: "abc1234",
      pushedBy: "octocat",
    });
    expect(result.enqueuedBuildIds).toEqual([]);
  });
});
