/**
 * StorageService contract tests.
 *
 * Obligations covered:
 *   - contract-signature.StorageService.deleteArtifactBlob
 *   - contract-signature.StorageService.uploadArtifactBlob
 *   - config-default.storage_max_bytes (5 GiB cap enforced by uploadArtifactBlob)
 *
 * Precondition @invariants checked:
 *   - bucket != null  (delete)
 *   - key != null     (delete)
 *   - req.bucket != null
 *   - req.sizeBytes <= storage_max_bytes
 *   - req.sizeBytes > 0
 *
 * Implementation bridge:
 *   StorageService.uploadArtifactBlob → uploadArtifactBlob (src/integrations/storage.ts:25)
 *   StorageService.deleteArtifactBlob → deleteArtifactBlob (src/integrations/storage.ts:44)
 */
import { describe, expect, it } from "@jest/globals";
import {
  StorageError,
  deleteArtifactBlob,
  uploadArtifactBlob,
} from "../src/integrations/storage.js";

const STORAGE_MAX_BYTES = 5_368_709_120; // 5 GiB, matches spec config.storage_max_bytes

describe("contract StorageService.uploadArtifactBlob", () => {
  it("returns an UploadResponse echoing the request plus a storageKey and uploadedAt", () => {
    const req = {
      bucket: "artifacts",
      key: "build-1/bundle.tar.gz",
      sizeBytes: 1024,
      contentType: "application/gzip",
    };
    const before = Date.now();
    const res = uploadArtifactBlob(req);
    expect(res.request).toEqual(req);
    expect(typeof res.storageKey).toBe("string");
    expect(res.storageKey).toBe("artifacts/build-1/bundle.tar.gz");
    expect(res.uploadedAt).toBeInstanceOf(Date);
    expect(res.uploadedAt.getTime()).toBeGreaterThanOrEqual(before);
  });

  it("rejects sizeBytes <= 0 (Precondition: req.sizeBytes > 0)", () => {
    expect(() =>
      uploadArtifactBlob({
        bucket: "b",
        key: "k",
        sizeBytes: 0,
        contentType: "x",
      }),
    ).toThrow(StorageError);
    expect(() =>
      uploadArtifactBlob({
        bucket: "b",
        key: "k",
        sizeBytes: -1,
        contentType: "x",
      }),
    ).toThrow(StorageError);
  });

  it("rejects sizeBytes > storage_max_bytes (Precondition: req.sizeBytes <= config.storage_max_bytes)", () => {
    expect(() =>
      uploadArtifactBlob({
        bucket: "b",
        key: "k",
        sizeBytes: STORAGE_MAX_BYTES + 1,
        contentType: "x",
      }),
    ).toThrow(StorageError);
  });

  it("accepts sizeBytes exactly at the cap", () => {
    const res = uploadArtifactBlob({
      bucket: "b",
      key: "k",
      sizeBytes: STORAGE_MAX_BYTES,
      contentType: "x",
    });
    expect(res.request.sizeBytes).toBe(STORAGE_MAX_BYTES);
  });

  it("rejects empty bucket (Precondition: req.bucket != null)", () => {
    expect(() =>
      uploadArtifactBlob({
        bucket: "",
        key: "k",
        sizeBytes: 1,
        contentType: "x",
      }),
    ).toThrow(StorageError);
  });
});

describe("contract StorageService.deleteArtifactBlob", () => {
  it("returns undefined for a valid bucket+key (Boolean per spec; impl is fire-and-forget)", () => {
    // Spec signature returns Boolean. Implementation returns void.
    // TODO[bridge ambiguous]: signature mismatch (impl: void, spec: Boolean).
    // The behavioural shape (success vs. error) is testable; the Boolean
    // result-type cannot be asserted without changing the implementation.
    expect(() => deleteArtifactBlob("bucket", "key")).not.toThrow();
  });

  it("rejects empty bucket (Precondition: bucket != null)", () => {
    expect(() => deleteArtifactBlob("", "key")).toThrow(StorageError);
  });

  it("rejects empty key (Precondition: key != null)", () => {
    expect(() => deleteArtifactBlob("bucket", "")).toThrow(StorageError);
  });
});
