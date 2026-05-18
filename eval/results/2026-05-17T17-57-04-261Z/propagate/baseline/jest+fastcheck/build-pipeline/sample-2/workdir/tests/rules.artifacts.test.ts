/**
 * Artifact lifecycle rule tests.
 *
 * Covers obligations:
 *   - rule-success.{RegisterArtifact, MarkArtifactUploaded, MarkArtifactExpired}
 *   - rule-failure.{RegisterArtifact.1, RegisterArtifact.2,
 *                   MarkArtifactUploaded.1, MarkArtifactExpired.1}
 *   - rule-entity-creation.RegisterArtifact.1
 *
 * Bridge: services/artifacts.ts. MarkArtifactUploaded references config.artifact_ttl,
 * which the implementation hard-codes as ARTIFACT_TTL_MS.
 */
import { jest } from "@jest/globals";
import {
  ARTIFACT_TTL_MS,
  ArtifactStatus,
  BuildStatus,
} from "../src/models.js";
import {
  ArtifactNotFoundError,
  ArtifactTransitionError,
  markArtifactExpired,
  markArtifactUploaded,
  registerArtifact,
} from "../src/services/artifacts.js";
import { makeArtifact, makeBuild, makeStore } from "./_fixtures.js";

// ---------------------------------------------------------------------------
// RegisterArtifact
// ---------------------------------------------------------------------------

describe("rule.RegisterArtifact", () => {
  test("success: creates a PENDING artifact tied to a successful build", () => {
    const b = makeBuild({ status: BuildStatus.SUCCESS });
    const store = makeStore({ builds: [b] });

    const art = registerArtifact(store, {
      artifactId: "art-1",
      buildId: b.buildId,
      name: "out.zip",
      sizeBytes: 4096,
    });

    // rule_entity_creation: Artifact.created(...) fields
    expect(art).toEqual({
      artifactId: "art-1",
      buildId: b.buildId,
      name: "out.zip",
      sizeBytes: 4096,
      status: ArtifactStatus.PENDING,
      uploadedAt: null,
      expiresAt: null,
      storageKey: null,
    });
    expect(store.artifacts.get("art-1")).toBe(art);
  });

  test.each([
    BuildStatus.QUEUED,
    BuildStatus.RUNNING,
    BuildStatus.FAILED,
    BuildStatus.CANCELLED,
  ])("failure: rejected when build.status = %s (requires success)", (status) => {
    const b = makeBuild({ status });
    const store = makeStore({ builds: [b] });
    expect(() =>
      registerArtifact(store, {
        artifactId: "art-1",
        buildId: b.buildId,
        name: "out.zip",
        sizeBytes: 1,
      }),
    ).toThrow(ArtifactTransitionError);
    expect(store.artifacts.size).toBe(0);
  });

  test.each([0, -1, -42])(
    "failure: rejected when sizeBytes <= 0 (got %s)",
    (sizeBytes) => {
      const b = makeBuild({ status: BuildStatus.SUCCESS });
      const store = makeStore({ builds: [b] });
      expect(() =>
        registerArtifact(store, {
          artifactId: "art-1",
          buildId: b.buildId,
          name: "out.zip",
          sizeBytes,
        }),
      ).toThrow(ArtifactTransitionError);
    },
  );

  test("failure: throws when build does not exist", () => {
    const store = makeStore();
    expect(() =>
      registerArtifact(store, {
        artifactId: "art-1",
        buildId: "missing",
        name: "out.zip",
        sizeBytes: 1,
      }),
    ).toThrow(ArtifactNotFoundError);
  });
});

// ---------------------------------------------------------------------------
// MarkArtifactUploaded
// ---------------------------------------------------------------------------

describe("rule.MarkArtifactUploaded", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  test("success: sets status=UPLOADED, uploadedAt=now, expiresAt=now+ttl, storageKey", () => {
    const frozen = new Date("2026-04-01T12:00:00Z");
    jest.setSystemTime(frozen);

    const art = makeArtifact({ status: ArtifactStatus.PENDING });
    const store = makeStore({ artifacts: [art] });

    const out = markArtifactUploaded(store, art.artifactId, "bucket/key-1");

    expect(out.status).toBe(ArtifactStatus.UPLOADED);
    expect(out.uploadedAt!.getTime()).toBe(frozen.getTime());
    expect(out.expiresAt!.getTime()).toBe(frozen.getTime() + ARTIFACT_TTL_MS);
    expect(out.storageKey).toBe("bucket/key-1");
  });

  test.each([ArtifactStatus.UPLOADED, ArtifactStatus.EXPIRED])(
    "failure: rejected when status = %s (requires pending)",
    (status) => {
      const art = makeArtifact({ status });
      const store = makeStore({ artifacts: [art] });
      expect(() => markArtifactUploaded(store, art.artifactId, "k"))
        .toThrow(ArtifactTransitionError);
    },
  );

  test("failure: throws when artifact does not exist", () => {
    const store = makeStore();
    expect(() => markArtifactUploaded(store, "missing", "k"))
      .toThrow(ArtifactNotFoundError);
  });
});

// ---------------------------------------------------------------------------
// MarkArtifactExpired
// ---------------------------------------------------------------------------

describe("rule.MarkArtifactExpired", () => {
  test("success: transitions uploaded artifact to expired", () => {
    const art = makeArtifact({
      status: ArtifactStatus.UPLOADED,
      uploadedAt: new Date("2026-01-01T00:00:00Z"),
      expiresAt: new Date("2026-01-08T00:00:00Z"),
      storageKey: "b/k",
    });
    const store = makeStore({ artifacts: [art] });

    const out = markArtifactExpired(store, art.artifactId);
    expect(out.status).toBe(ArtifactStatus.EXPIRED);
  });

  test.each([ArtifactStatus.PENDING, ArtifactStatus.EXPIRED])(
    "failure: rejected when status = %s (requires uploaded)",
    (status) => {
      const art = makeArtifact({ status });
      const store = makeStore({ artifacts: [art] });
      expect(() => markArtifactExpired(store, art.artifactId))
        .toThrow(ArtifactTransitionError);
    },
  );
});
