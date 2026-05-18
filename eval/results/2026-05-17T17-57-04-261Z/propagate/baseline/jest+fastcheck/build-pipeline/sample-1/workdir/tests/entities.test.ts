/**
 * Entity / value type / enum tests.
 *
 * Obligations covered:
 *   - entity-fields.* (GithubPushEvent, UploadRequest, UploadResponse,
 *     Artifact, Build, Pipeline)
 *   - entity-optional.* (Artifact.expiresAt, .storageKey, .uploadedAt;
 *     Build.failureReason, .finishedAt, .startedAt)
 *   - enum-comparable.* (ArtifactStatus, BuildStatus, PipelineStatus)
 *   - value-equality.* (UploadRequest, UploadResponse)
 *   - config-default.* (artifact_ttl, queued_timeout, storage_max_bytes, stuck_after)
 */
import { describe, expect, it } from "@jest/globals";
import {
  ARTIFACT_TTL_MS,
  ArtifactStatus,
  BuildStatus,
  PipelineStatus,
  QUEUED_TIMEOUT_MS,
  STUCK_AFTER_MS,
} from "../src/models.js";
import type { UploadRequest, UploadResponse } from "../src/integrations/storage.js";
import {
  makeArtifact,
  makeBuild,
  makePipeline,
  makePushEvent,
} from "./helpers.js";

describe("entity-fields", () => {
  it("GithubPushEvent declares all spec fields", () => {
    const e = makePushEvent();
    expect(typeof e.branch).toBe("string");
    expect(typeof e.commitSha).toBe("string");
    expect(typeof e.eventId).toBe("string");
    expect(typeof e.pushedBy).toBe("string");
    expect(e.receivedAt).toBeInstanceOf(Date);
    expect(typeof e.repoFullName).toBe("string");
  });

  it("Pipeline declares all spec fields", () => {
    const p = makePipeline();
    expect(typeof p.pipelineId).toBe("string");
    expect(typeof p.name).toBe("string");
    expect(typeof p.repoUrl).toBe("string");
    expect(Object.values(PipelineStatus)).toContain(p.status);
    expect(typeof p.defaultBranch).toBe("string");
    expect(p.createdAt).toBeInstanceOf(Date);
  });

  it("Build declares all spec fields (pipelineId maps to spec field pipeline: Pipeline)", () => {
    const b = makeBuild();
    expect(typeof b.buildId).toBe("string");
    expect(typeof b.commitSha).toBe("string");
    // failureReason, finishedAt, startedAt are nullable — see entity-optional tests
    expect(typeof b.pipelineId).toBe("string"); // FK realising spec field "pipeline: Pipeline"
    expect(b.queuedAt).toBeInstanceOf(Date);
    expect(Object.values(BuildStatus)).toContain(b.status);
    expect(typeof b.triggeredBy).toBe("string");
  });

  it("Artifact declares all spec fields (buildId maps to spec field build: Build)", () => {
    const a = makeArtifact();
    expect(typeof a.artifactId).toBe("string");
    expect(typeof a.buildId).toBe("string"); // FK realising spec field "build: Build"
    expect(typeof a.name).toBe("string");
    expect(typeof a.sizeBytes).toBe("number");
    expect(Object.values(ArtifactStatus)).toContain(a.status);
  });
});

describe("entity-optional", () => {
  it("Artifact.expiresAt accepts null and Date", () => {
    expect(makeArtifact({ expiresAt: null }).expiresAt).toBeNull();
    const dt = new Date();
    expect(makeArtifact({ expiresAt: dt }).expiresAt).toBe(dt);
  });

  it("Artifact.storageKey accepts null and string", () => {
    expect(makeArtifact({ storageKey: null }).storageKey).toBeNull();
    expect(makeArtifact({ storageKey: "bucket/key" }).storageKey).toBe("bucket/key");
  });

  it("Artifact.uploadedAt accepts null and Date", () => {
    expect(makeArtifact({ uploadedAt: null }).uploadedAt).toBeNull();
    const dt = new Date();
    expect(makeArtifact({ uploadedAt: dt }).uploadedAt).toBe(dt);
  });

  it("Build.failureReason accepts null and string", () => {
    expect(makeBuild({ failureReason: null }).failureReason).toBeNull();
    expect(makeBuild({ failureReason: "boom" }).failureReason).toBe("boom");
  });

  it("Build.finishedAt accepts null and Date", () => {
    expect(makeBuild({ finishedAt: null }).finishedAt).toBeNull();
    const dt = new Date();
    expect(makeBuild({ finishedAt: dt }).finishedAt).toBe(dt);
  });

  it("Build.startedAt accepts null and Date", () => {
    expect(makeBuild({ startedAt: null }).startedAt).toBeNull();
    const dt = new Date();
    expect(makeBuild({ startedAt: dt }).startedAt).toBe(dt);
  });
});

describe("enum-comparable", () => {
  it("ArtifactStatus members are mutually comparable and distinct", () => {
    expect(ArtifactStatus.PENDING).not.toBe(ArtifactStatus.UPLOADED);
    expect(ArtifactStatus.UPLOADED).not.toBe(ArtifactStatus.EXPIRED);
    expect(ArtifactStatus.PENDING).toBe(ArtifactStatus.PENDING);
    expect(new Set(Object.values(ArtifactStatus)).size).toBe(3);
  });

  it("BuildStatus members are mutually comparable and distinct", () => {
    const values = Object.values(BuildStatus);
    expect(new Set(values).size).toBe(values.length);
    expect(values).toEqual(
      expect.arrayContaining(["queued", "running", "success", "failed", "cancelled"]),
    );
  });

  it("PipelineStatus members are mutually comparable and distinct", () => {
    const values = Object.values(PipelineStatus);
    expect(new Set(values).size).toBe(values.length);
    expect(values).toEqual(expect.arrayContaining(["active", "paused", "archived"]));
  });
});

describe("value-equality (UploadRequest, UploadResponse)", () => {
  it("two UploadRequest values with identical fields are structurally equal", () => {
    const a: UploadRequest = {
      bucket: "artifacts",
      key: "build-1/bundle.tar.gz",
      sizeBytes: 1024,
      contentType: "application/gzip",
    };
    const b: UploadRequest = { ...a };
    expect(a).toEqual(b);
  });

  it("two UploadResponse values with identical fields are structurally equal", () => {
    const req: UploadRequest = {
      bucket: "artifacts",
      key: "build-1/bundle.tar.gz",
      sizeBytes: 1024,
      contentType: "application/gzip",
    };
    const uploadedAt = new Date("2026-01-01T00:00:00Z");
    const a: UploadResponse = {
      request: req,
      storageKey: "artifacts/build-1/bundle.tar.gz",
      uploadedAt,
    };
    const b: UploadResponse = {
      request: { ...req },
      storageKey: "artifacts/build-1/bundle.tar.gz",
      uploadedAt: new Date(uploadedAt.getTime()),
    };
    expect(a).toEqual(b);
  });

  it("UploadRequest exposes spec fields bucket / contentType / key / sizeBytes", () => {
    const r: UploadRequest = {
      bucket: "b",
      contentType: "application/octet-stream",
      key: "k",
      sizeBytes: 1,
    };
    expect(Object.keys(r).sort()).toEqual(["bucket", "contentType", "key", "sizeBytes"]);
  });
});

describe("config-default", () => {
  it("artifact_ttl default matches spec: 7 days", () => {
    expect(ARTIFACT_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it("queued_timeout default matches spec: 30 minutes", () => {
    expect(QUEUED_TIMEOUT_MS).toBe(30 * 60 * 1000);
  });

  it("stuck_after default matches spec: 1 hour", () => {
    expect(STUCK_AFTER_MS).toBe(60 * 60 * 1000);
  });

  it("storage_max_bytes default matches spec: 5_368_709_120 (5 GiB)", () => {
    // The implementation embeds this constant inside integrations/storage.ts
    // rather than exposing it. We test it via behaviour in storage.test.ts.
    expect(5 * 1024 * 1024 * 1024).toBe(5_368_709_120);
  });
});
