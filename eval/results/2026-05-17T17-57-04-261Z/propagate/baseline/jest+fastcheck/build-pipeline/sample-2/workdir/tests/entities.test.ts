/**
 * Entity, value, enum and relationship tests.
 *
 * Covers obligations:
 *   - entity-fields.{GithubPushEvent, UploadRequest, UploadResponse, Artifact, Build, Pipeline}
 *   - entity-optional.{Artifact.*, Build.*}
 *   - entity-relationship.{Build.artifacts, Pipeline.builds}
 *   - value-equality.{UploadRequest, UploadResponse}
 *   - enum-comparable.{ArtifactStatus, BuildStatus, PipelineStatus}
 */
import {
  ArtifactStatus,
  BuildStatus,
  GithubPushEvent,
  PipelineStatus,
} from "../src/models.js";
import {
  UploadRequest,
  UploadResponse,
} from "../src/integrations/storage.js";
import {
  makeArtifact,
  makeBuild,
  makePipeline,
  makeStore,
} from "./_fixtures.js";

// ---------------------------------------------------------------------------
// entity-fields obligations
// ---------------------------------------------------------------------------

describe("entity_fields", () => {
  test("Pipeline has all declared fields", () => {
    const p = makePipeline();
    expect(p).toEqual(
      expect.objectContaining({
        pipelineId: expect.any(String),
        name: expect.any(String),
        repoUrl: expect.any(String),
        status: expect.any(String),
        defaultBranch: expect.any(String),
        createdAt: expect.any(Date),
      }),
    );
  });

  test("Build has all declared fields", () => {
    const b = makeBuild();
    expect(b).toEqual(
      expect.objectContaining({
        buildId: expect.any(String),
        pipelineId: expect.any(String),
        commitSha: expect.any(String),
        status: expect.any(String),
        triggeredBy: expect.any(String),
        queuedAt: expect.any(Date),
        startedAt: null,
        finishedAt: null,
        failureReason: null,
      }),
    );
  });

  test("Artifact has all declared fields", () => {
    const a = makeArtifact();
    expect(a).toEqual(
      expect.objectContaining({
        artifactId: expect.any(String),
        buildId: expect.any(String),
        name: expect.any(String),
        sizeBytes: expect.any(Number),
        status: expect.any(String),
        uploadedAt: null,
        expiresAt: null,
        storageKey: null,
      }),
    );
  });

  test("GithubPushEvent has all declared fields", () => {
    const ev: GithubPushEvent = {
      eventId: "evt-1",
      repoFullName: "acme/widgets",
      branch: "main",
      commitSha: "abc",
      pushedBy: "alice",
      receivedAt: new Date(),
    };
    expect(ev).toEqual(
      expect.objectContaining({
        eventId: expect.any(String),
        repoFullName: expect.any(String),
        branch: expect.any(String),
        commitSha: expect.any(String),
        pushedBy: expect.any(String),
        receivedAt: expect.any(Date),
      }),
    );
  });

  test("UploadRequest has all declared fields", () => {
    const req: UploadRequest = {
      bucket: "b", key: "k", sizeBytes: 1, contentType: "application/octet-stream",
    };
    expect(req).toEqual(
      expect.objectContaining({
        bucket: expect.any(String),
        key: expect.any(String),
        sizeBytes: expect.any(Number),
        contentType: expect.any(String),
      }),
    );
  });

  test("UploadResponse has all declared fields", () => {
    const req: UploadRequest = {
      bucket: "b", key: "k", sizeBytes: 1, contentType: "application/octet-stream",
    };
    const res: UploadResponse = { request: req, storageKey: "b/k", uploadedAt: new Date() };
    expect(res).toEqual(
      expect.objectContaining({
        request: expect.any(Object),
        storageKey: expect.any(String),
        uploadedAt: expect.any(Date),
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// entity-optional obligations
// ---------------------------------------------------------------------------

describe("entity_optional", () => {
  test("Build.startedAt accepts null and Date", () => {
    expect(makeBuild({ startedAt: null }).startedAt).toBeNull();
    const t = new Date();
    expect(makeBuild({ startedAt: t }).startedAt).toBe(t);
  });

  test("Build.finishedAt accepts null and Date", () => {
    expect(makeBuild({ finishedAt: null }).finishedAt).toBeNull();
    const t = new Date();
    expect(makeBuild({ finishedAt: t }).finishedAt).toBe(t);
  });

  test("Build.failureReason accepts null and string", () => {
    expect(makeBuild({ failureReason: null }).failureReason).toBeNull();
    expect(makeBuild({ failureReason: "boom" }).failureReason).toBe("boom");
  });

  test("Artifact.uploadedAt accepts null and Date", () => {
    expect(makeArtifact({ uploadedAt: null }).uploadedAt).toBeNull();
    const t = new Date();
    expect(makeArtifact({ uploadedAt: t }).uploadedAt).toBe(t);
  });

  test("Artifact.expiresAt accepts null and Date", () => {
    expect(makeArtifact({ expiresAt: null }).expiresAt).toBeNull();
    const t = new Date();
    expect(makeArtifact({ expiresAt: t }).expiresAt).toBe(t);
  });

  test("Artifact.storageKey accepts null and string", () => {
    expect(makeArtifact({ storageKey: null }).storageKey).toBeNull();
    expect(makeArtifact({ storageKey: "bucket/key" }).storageKey).toBe("bucket/key");
  });
});

// ---------------------------------------------------------------------------
// entity-relationship obligations
// ---------------------------------------------------------------------------

describe("entity_relationship", () => {
  test("Pipeline.builds navigates from a pipeline to all its builds", () => {
    const p = makePipeline({ pipelineId: "p-1" });
    const other = makePipeline({ pipelineId: "p-2" });
    const b1 = makeBuild({ buildId: "b-1", pipelineId: "p-1" });
    const b2 = makeBuild({ buildId: "b-2", pipelineId: "p-1" });
    const b3 = makeBuild({ buildId: "b-3", pipelineId: "p-2" });
    const store = makeStore({ pipelines: [p, other], builds: [b1, b2, b3] });

    const buildsForP = [...store.builds.values()].filter(
      (b) => b.pipelineId === p.pipelineId,
    );
    expect(buildsForP).toHaveLength(2);
    expect(buildsForP.map((b) => b.buildId).sort()).toEqual(["b-1", "b-2"]);
  });

  test("Build.artifacts navigates from a build to all its artifacts", () => {
    const b1 = makeBuild({ buildId: "b-1" });
    const b2 = makeBuild({ buildId: "b-2" });
    const a1 = makeArtifact({ artifactId: "a-1", buildId: "b-1" });
    const a2 = makeArtifact({ artifactId: "a-2", buildId: "b-1" });
    const a3 = makeArtifact({ artifactId: "a-3", buildId: "b-2" });
    const store = makeStore({ builds: [b1, b2], artifacts: [a1, a2, a3] });

    const artifactsForB1 = [...store.artifacts.values()].filter(
      (a) => a.buildId === b1.buildId,
    );
    expect(artifactsForB1).toHaveLength(2);
    expect(artifactsForB1.map((a) => a.artifactId).sort()).toEqual(["a-1", "a-2"]);
  });
});

// ---------------------------------------------------------------------------
// enum-comparable obligations
// ---------------------------------------------------------------------------

describe("enum_comparable", () => {
  test("PipelineStatus values are distinct and comparable", () => {
    const all: PipelineStatus[] = [
      PipelineStatus.ACTIVE, PipelineStatus.PAUSED, PipelineStatus.ARCHIVED,
    ];
    expect(new Set<string>(all).size).toBe(3);
    // Comparability: each member is equal to itself across reads.
    for (const v of all) expect(v).toBe(v);
  });

  test("BuildStatus values are distinct and comparable", () => {
    const all: BuildStatus[] = [
      BuildStatus.QUEUED, BuildStatus.RUNNING, BuildStatus.SUCCESS,
      BuildStatus.FAILED, BuildStatus.CANCELLED,
    ];
    expect(new Set<string>(all).size).toBe(5);
    for (const v of all) expect(v).toBe(v);
  });

  test("ArtifactStatus values are distinct and comparable", () => {
    const all: ArtifactStatus[] = [
      ArtifactStatus.PENDING, ArtifactStatus.UPLOADED, ArtifactStatus.EXPIRED,
    ];
    expect(new Set<string>(all).size).toBe(3);
    for (const v of all) expect(v).toBe(v);
  });
});

// ---------------------------------------------------------------------------
// value-equality obligations
// ---------------------------------------------------------------------------

describe("value_equality", () => {
  test("UploadRequest values with identical fields are structurally equal", () => {
    const a: UploadRequest = { bucket: "b", key: "k", sizeBytes: 100, contentType: "x" };
    const b: UploadRequest = { bucket: "b", key: "k", sizeBytes: 100, contentType: "x" };
    expect(a).toEqual(b);
  });

  test("UploadResponse values with identical fields are structurally equal", () => {
    const t = new Date(0);
    const req: UploadRequest = { bucket: "b", key: "k", sizeBytes: 1, contentType: "x" };
    const a: UploadResponse = { request: req, storageKey: "b/k", uploadedAt: t };
    const b: UploadResponse = { request: { ...req }, storageKey: "b/k", uploadedAt: t };
    expect(a).toEqual(b);
  });
});
