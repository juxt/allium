/**
 * Config default tests.
 *
 * Covers obligations:
 *   - config-default.artifact_ttl       (7 days)
 *   - config-default.queued_timeout     (30 minutes)
 *   - config-default.storage_max_bytes  (5_368_709_120 bytes = 5 GiB)
 *   - config-default.stuck_after        (1 hour)
 *
 * The spec gives configs as Durations / Integers. The implementation
 * holds the equivalent values as module-level constants (ms for the
 * durations; bytes for storage_max_bytes which is private to
 * integrations/storage.ts, so we re-derive it here for the assertion).
 */
import {
  ARTIFACT_TTL_MS,
  QUEUED_TIMEOUT_MS,
  STUCK_AFTER_MS,
} from "../src/models.js";
import { StorageError, uploadArtifactBlob } from "../src/integrations/storage.js";

describe("config_defaults", () => {
  test("artifact_ttl defaults to 7 days", () => {
    expect(ARTIFACT_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });

  test("queued_timeout defaults to 30 minutes", () => {
    expect(QUEUED_TIMEOUT_MS).toBe(30 * 60 * 1000);
  });

  test("stuck_after defaults to 1 hour", () => {
    expect(STUCK_AFTER_MS).toBe(60 * 60 * 1000);
  });

  test("storage_max_bytes defaults to 5 GiB (5_368_709_120 bytes)", () => {
    // STORAGE_MAX_BYTES is module-private in integrations/storage.ts. Probe it
    // via the public uploadArtifactBlob entrypoint: a request exactly at the
    // cap must succeed; one byte over must throw StorageError. The boundary
    // value uniquely pins down the cap.
    const expectedCap = 5_368_709_120;
    expect(() =>
      uploadArtifactBlob({
        bucket: "b", key: "k", sizeBytes: expectedCap, contentType: "x",
      }),
    ).not.toThrow();
    expect(() =>
      uploadArtifactBlob({
        bucket: "b", key: "k", sizeBytes: expectedCap + 1, contentType: "x",
      }),
    ).toThrow(StorageError);
  });
});
