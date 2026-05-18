/**
 * HTTP routes — the developer-facing API.
 *
 * Each handler is a thin wrapper over a service-layer call.
 */
import { router, store } from "./index.js";
import { receiveGithubPushEvent } from "./webhooks.js";
import {
  cancelBuild,
  enqueueBuild,
  markBuildFailed,
  markBuildSuccess,
  startBuild,
} from "./services/builds.js";
import {
  markArtifactUploaded,
  registerArtifact,
} from "./services/artifacts.js";

router.register("POST", "/builds", (body: {
  buildId: string;
  pipelineId: string;
  commitSha: string;
  triggeredBy: string;
}) => {
  const build = enqueueBuild(store, body);
  return { buildId: build.buildId, status: build.status };
});

router.register("POST", "/builds/:buildId/start", (body: { buildId: string }) => {
  const build = startBuild(store, body.buildId);
  return { buildId: build.buildId, status: build.status };
});

router.register("POST", "/builds/:buildId/success", (body: { buildId: string }) => {
  const build = markBuildSuccess(store, body.buildId);
  return { buildId: build.buildId, status: build.status };
});

router.register("POST", "/builds/:buildId/failed", (body: { buildId: string; reason: string }) => {
  const build = markBuildFailed(store, body.buildId, body.reason);
  return { buildId: build.buildId, status: build.status, failureReason: build.failureReason };
});

router.register("POST", "/builds/:buildId/cancel", (body: { buildId: string }) => {
  const build = cancelBuild(store, body.buildId);
  return { buildId: build.buildId, status: build.status };
});

router.register("POST", "/artifacts", (body: {
  artifactId: string;
  buildId: string;
  name: string;
  sizeBytes: number;
}) => {
  const artifact = registerArtifact(store, body);
  return { artifactId: artifact.artifactId, status: artifact.status };
});

router.register("POST", "/artifacts/:artifactId/uploaded", (body: {
  artifactId: string;
  storageKey: string;
}) => {
  const artifact = markArtifactUploaded(store, body.artifactId, body.storageKey);
  return { artifactId: artifact.artifactId, status: artifact.status };
});

router.register("POST", "/webhooks/github-push", (body: {
  eventId: string;
  repoFullName: string;
  branch: string;
  commitSha: string;
  pushedBy: string;
}) => receiveGithubPushEvent(store, body));
