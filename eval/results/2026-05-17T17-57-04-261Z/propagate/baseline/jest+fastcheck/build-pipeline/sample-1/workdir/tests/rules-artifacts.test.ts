/**
 * Artifact-lifecycle rule tests.
 *
 * Obligations covered:
 *   - rule-success.{RegisterArtifact, MarkArtifactUploaded, MarkArtifactExpired}
 *   - rule-failure.{RegisterArtifact.1, RegisterArtifact.2, MarkArtifactUploaded.1, MarkArtifactExpired.1}
 *   - rule-entity-creation.RegisterArtifact.1
 *
 * Implementation bridge:
 *   spec rule               → service function
 *   RegisterArtifact        → registerArtifact     (src/services/artifacts.ts:18)
 *   MarkArtifactUploaded    → markArtifactUploaded (src/services/artifacts.ts:53)
 *   MarkArtifactExpired     → markArtifactExpired  (src/services/artifacts.ts:72)
 */
import { describe, expect, it } from "@jest/globals";
import {
  ARTIFACT_TTL_MS,
  ArtifactStatus,
  BuildStatus,
  Store,
} from "../src/models.js";
import {
  ArtifactTransitionError,
  markArtifactExpired,
  markArtifactUploaded,
  registerArtifact,
} from "../src/services/artifacts.js";
import {
  makeArtifact,
  makeBuild,
  makePipeline,
  storeWithArtifact,
} from "./helpers.js";

describe("rule RegisterArtifact", () => {
  it("succeeds when build.status = success and sizeBytes > 0 (rule-success + entity-creation)", () => {
    const store = new Store();
    const pipeline = makePipeline();
    store.pipelines.set(pipeline.pipelineId, pipeline);
    const build = makeBuild({ status: BuildStatus.SUCCESS });
    store.builds.set(build.buildId, build);

    const artifact = registerArtifact(store, {
      artifactId: "a-new",
      buildId: build.buildId,
      name: "dist.zip",
      sizeBytes: 4096,
    });
    expect(artifact.status).toBe(ArtifactStatus.PENDING);
    expect(artifact.artifactId).toBe("a-new");
    expect(artifact.buildId).toBe(build.buildId);
    expect(artifact.name).toBe("dist.zip");
    expect(artifact.sizeBytes).toBe(4096);
    expect(artifact.expiresAt).toBeNull();
    expect(artifact.uploadedAt).toBeNull();
    expect(artifact.storageKey).toBeNull();
    expect(store.artifacts.get("a-new")).toBe(artifact);
  });

  it.each<BuildStatus>([
    BuildStatus.QUEUED,
    BuildStatus.RUNNING,
    BuildStatus.FAILED,
    BuildStatus.CANCELLED,
  ])("is rejected when build.status = %s (rule-failure.1: build.status != success)", (status: BuildStatus) => {
    const store = new Store();
    const build = makeBuild({ status });
    store.builds.set(build.buildId, build);
    expect(() =>
      registerArtifact(store, {
        artifactId: "a-x",
        buildId: build.buildId,
        name: "x",
        sizeBytes: 1,
      }),
    ).toThrow(ArtifactTransitionError);
    expect(store.artifacts.has("a-x")).toBe(false);
  });

  it.each<number>([0, -1, -1024])(
    "is rejected when sizeBytes = %s (rule-failure.2: sizeBytes > 0)",
    (size: number) => {
      const store = new Store();
      const build = makeBuild({ status: BuildStatus.SUCCESS });
      store.builds.set(build.buildId, build);
      expect(() =>
        registerArtifact(store, {
          artifactId: "a-bad",
          buildId: build.buildId,
          name: "x",
          sizeBytes: size,
        }),
      ).toThrow(ArtifactTransitionError);
      expect(store.artifacts.has("a-bad")).toBe(false);
    },
  );
});

describe("rule MarkArtifactUploaded", () => {
  it("succeeds when artifact.status = pending (rule-success)", () => {
    const { store, artifact } = storeWithArtifact({ status: ArtifactStatus.PENDING });
    const before = Date.now();
    const result = markArtifactUploaded(store, artifact.artifactId, "bucket/key-1");
    expect(result.status).toBe(ArtifactStatus.UPLOADED);
    expect(result.storageKey).toBe("bucket/key-1");
    expect(result.uploadedAt).not.toBeNull();
    expect(result.expiresAt).not.toBeNull();
    expect(result.uploadedAt!.getTime()).toBeGreaterThanOrEqual(before);
    // expiresAt = uploadedAt + artifact_ttl
    const delta = result.expiresAt!.getTime() - result.uploadedAt!.getTime();
    expect(delta).toBe(ARTIFACT_TTL_MS);
  });

  it.each<ArtifactStatus>([ArtifactStatus.UPLOADED, ArtifactStatus.EXPIRED])(
    "is rejected when artifact.status = %s (rule-failure)",
    (status: ArtifactStatus) => {
      const { store, artifact } = storeWithArtifact({ status });
      expect(() => markArtifactUploaded(store, artifact.artifactId, "k")).toThrow(
        ArtifactTransitionError,
      );
    },
  );
});

describe("rule MarkArtifactExpired", () => {
  it("succeeds when artifact.status = uploaded (rule-success)", () => {
    const { store, artifact } = storeWithArtifact({
      status: ArtifactStatus.UPLOADED,
      uploadedAt: new Date(),
      expiresAt: new Date(Date.now() - 1000),
    });
    const result = markArtifactExpired(store, artifact.artifactId);
    expect(result.status).toBe(ArtifactStatus.EXPIRED);
  });

  it.each<ArtifactStatus>([ArtifactStatus.PENDING, ArtifactStatus.EXPIRED])(
    "is rejected when artifact.status = %s (rule-failure)",
    (status: ArtifactStatus) => {
      const { store, artifact } = storeWithArtifact({ status });
      expect(() => markArtifactExpired(store, artifact.artifactId)).toThrow(
        ArtifactTransitionError,
      );
    },
  );
});

describe("artifact transition graph", () => {
  it("pending → uploaded → expired (full lifecycle)", () => {
    const { store, artifact } = storeWithArtifact({ status: ArtifactStatus.PENDING });
    expect(artifact.status).toBe(ArtifactStatus.PENDING);

    const uploaded = markArtifactUploaded(store, artifact.artifactId, "bucket/k");
    expect(uploaded.status).toBe(ArtifactStatus.UPLOADED);

    // Force expiry forward by rewriting expiresAt to past — markArtifactExpired
    // does not check the time; it only checks the status.
    const expired = markArtifactExpired(store, artifact.artifactId);
    expect(expired.status).toBe(ArtifactStatus.EXPIRED);
  });

  it("EXPIRED is a terminal state (no outbound transitions)", () => {
    const { store, artifact } = storeWithArtifact({
      status: ArtifactStatus.EXPIRED,
      uploadedAt: new Date(),
      expiresAt: new Date(),
      storageKey: "bucket/k",
    });
    expect(() => markArtifactUploaded(store, artifact.artifactId, "x")).toThrow(
      ArtifactTransitionError,
    );
    expect(() => markArtifactExpired(store, artifact.artifactId)).toThrow(
      ArtifactTransitionError,
    );
  });

  it("artifact created against a successful build initialises in PENDING with null storage fields", () => {
    const store = new Store();
    const build = makeBuild({ status: BuildStatus.SUCCESS });
    store.builds.set(build.buildId, build);

    const a = registerArtifact(store, {
      artifactId: "a",
      buildId: build.buildId,
      name: "n",
      sizeBytes: 1,
    });
    expect(a.status).toBe(ArtifactStatus.PENDING);
    expect(a.uploadedAt).toBeNull();
    expect(a.expiresAt).toBeNull();
    expect(a.storageKey).toBeNull();
  });
});

describe("state-dependent field tests", () => {
  it("PENDING artifact has null uploadedAt, expiresAt, storageKey", () => {
    const a = makeArtifact({ status: ArtifactStatus.PENDING });
    expect(a.uploadedAt).toBeNull();
    expect(a.expiresAt).toBeNull();
    expect(a.storageKey).toBeNull();
  });

  it("UPLOADED artifact (after MarkArtifactUploaded) has all three populated", () => {
    const { store, artifact } = storeWithArtifact({ status: ArtifactStatus.PENDING });
    const result = markArtifactUploaded(store, artifact.artifactId, "bucket/k");
    expect(result.uploadedAt).not.toBeNull();
    expect(result.expiresAt).not.toBeNull();
    expect(result.storageKey).not.toBeNull();
  });
});
