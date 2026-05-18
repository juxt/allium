/**
 * Surface tests.
 *
 * Covers obligations:
 *   - surface-provides.Routes
 *   - surface-actor.Routes
 *   - surface-provides.Webhooks
 *   - surface-actor.Webhooks
 *
 * Bridge: src/routes.ts registers each spec-declared route on a Router
 * obtained from src/index.ts. The real index.ts has a circular import
 * with routes.ts (index does a side-effect `import "./routes.js"` *after*
 * declaring `export const router = new Router()`, but ESM hoists the
 * import to the top, so under a strict ESM loader routes.ts evaluates
 * while `router` is still in TDZ). To exercise routes.ts under jest's
 * ESM loader without touching the implementation we mock src/index.js
 * with a stub router that records registrations.
 */
import { jest } from "@jest/globals";

interface RegisteredRoute {
  method: string;
  path: string;
  handler: (...args: unknown[]) => unknown;
}

const registered: RegisteredRoute[] = [];

const fakeStore = {
  pipelines: new Map(),
  builds: new Map(),
  artifacts: new Map(),
  pushEvents: new Map(),
};

jest.unstable_mockModule("../src/index.js", () => ({
  store: fakeStore,
  router: {
    routes: registered,
    register: (
      method: string,
      path: string,
      handler: (...args: unknown[]) => unknown,
    ) => {
      registered.push({ method, path, handler });
    },
  },
}));

// Side-effect import — must come after the mock is registered, hence
// the dynamic import inside beforeAll.
let routesLoaded = false;

beforeAll(async () => {
  await import("../src/routes.js");
  routesLoaded = true;
});

interface RouteSpec {
  method: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
  /** The spec construct this route fulfils. */
  provides: string;
}

// Derived from the Routes surface @guidance in spec.allium.
const ROUTES_SURFACE: RouteSpec[] = [
  { method: "POST", path: "/builds",                          provides: "EnqueueBuild" },
  { method: "POST", path: "/builds/:buildId/start",           provides: "StartBuild" },
  { method: "POST", path: "/builds/:buildId/success",         provides: "MarkBuildSuccess" },
  { method: "POST", path: "/builds/:buildId/failed",          provides: "MarkBuildFailed" },
  { method: "POST", path: "/builds/:buildId/cancel",          provides: "CancelBuild" },
  { method: "POST", path: "/artifacts",                       provides: "RegisterArtifact" },
  { method: "POST", path: "/artifacts/:artifactId/uploaded",  provides: "MarkArtifactUploaded" },
  { method: "POST", path: "/webhooks/github-push",            provides: "ReceiveGithubPushEvent" },
];

describe("surface.Routes", () => {
  test("registers a route for every spec-provided operation", () => {
    expect(routesLoaded).toBe(true);
    for (const r of ROUTES_SURFACE) {
      const match = registered.find(
        (entry) => entry.method === r.method && entry.path === r.path,
      );
      expect(match).toBeDefined();
      expect(typeof match!.handler).toBe("function");
    }
  });

  test("actor: every spec route is enumerable on the same shared router (no per-actor gating)", () => {
    // The spec doesn't declare a typed actor, so this obligation reduces to:
    // the eight Routes operations are all reachable on the one shared router
    // that any caller can see. No alternate router or guarding wrapper exists.
    const paths = registered.map((r) => `${r.method} ${r.path}`);
    for (const r of ROUTES_SURFACE) {
      expect(paths).toContain(`${r.method} ${r.path}`);
    }
  });
});

describe("surface.Webhooks", () => {
  test("provides ReceiveGithubPushEvent at POST /webhooks/github-push", () => {
    const route = registered.find(
      (r) => r.method === "POST" && r.path === "/webhooks/github-push",
    );
    expect(route).toBeDefined();
    expect(typeof route!.handler).toBe("function");
  });

  test("actor: webhook handler is reachable on the public router with no actor guard", () => {
    // No actor restriction declared; verifying handler is callable end-to-end
    // through the registration entry confirms there's no gatekeeping wrapper.
    fakeStore.pipelines.clear();
    fakeStore.builds.clear();
    fakeStore.artifacts.clear();
    fakeStore.pushEvents.clear();
    const route = registered.find(
      (r) => r.method === "POST" && r.path === "/webhooks/github-push",
    )!;
    expect(() =>
      route.handler({
        eventId: "evt-webhook-actor",
        repoFullName: "acme/widgets",
        branch: "main",
        commitSha: "deadbe",
        pushedBy: "carol",
      }),
    ).not.toThrow();
  });
});
