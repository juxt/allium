/**
 * Storage contract tests.
 *
 * Covers obligations:
 *   - contract-signature.StorageService.deleteArtifactBlob
 *   - contract-signature.StorageService.uploadArtifactBlob
 *
 * Spec preconditions on the contract (all from spec.allium 43..56):
 *   - bucket != null            (deleteArtifactBlob)
 *   - key != null               (deleteArtifactBlob)
 *   - req.bucket != null        (uploadArtifactBlob)
 *   - req.sizeBytes > 0
 *   - req.sizeBytes <= config.storage_max_bytes
 *
 * Bridge: src/integrations/storage.ts. The Allium contract types
 * (UploadRequest / UploadResponse) line up structurally with the
 * TS interfaces of the same name; this test pins the signatures
 * and the precondition enforcement.
 */
import fc from "fast-check";
import {
  StorageError,
  UploadRequest,
  UploadResponse,
  deleteArtifactBlob,
  uploadArtifactBlob,
} from "../src/integrations/storage.js";

const STORAGE_MAX_BYTES = 5_368_709_120;

describe("contract.StorageService.uploadArtifactBlob", () => {
  test("signature: (UploadRequest) -> UploadResponse with matching request, key, timestamp", () => {
    const req: UploadRequest = {
      bucket: "my-bucket",
      key: "path/to/blob",
      sizeBytes: 100,
      contentType: "application/octet-stream",
    };
    const res: UploadResponse = uploadArtifactBlob(req);
    expect(res.request).toEqual(req);
    expect(typeof res.storageKey).toBe("string");
    expect(res.storageKey.length).toBeGreaterThan(0);
    expect(res.uploadedAt).toBeInstanceOf(Date);
  });

  test("precondition: req.sizeBytes > 0", () => {
    for (const bad of [0, -1, -1024]) {
      expect(() =>
        uploadArtifactBlob({ bucket: "b", key: "k", sizeBytes: bad, contentType: "x" }),
      ).toThrow(StorageError);
    }
  });

  test("precondition: req.sizeBytes <= config.storage_max_bytes", () => {
    expect(() =>
      uploadArtifactBlob({
        bucket: "b", key: "k", sizeBytes: STORAGE_MAX_BYTES + 1, contentType: "x",
      }),
    ).toThrow(StorageError);
    expect(() =>
      uploadArtifactBlob({
        bucket: "b", key: "k", sizeBytes: STORAGE_MAX_BYTES, contentType: "x",
      }),
    ).not.toThrow();
  });

  test("precondition: req.bucket != null (empty string treated as missing)", () => {
    expect(() =>
      uploadArtifactBlob({ bucket: "", key: "k", sizeBytes: 1, contentType: "x" }),
    ).toThrow(StorageError);
  });

  test("PBT: any request inside the valid envelope returns a response echoing the request", () => {
    fc.assert(
      fc.property(
        fc.record({
          bucket: fc.string({ minLength: 1, maxLength: 64 }).filter((s) => s.length > 0),
          key: fc.string({ minLength: 1, maxLength: 128 }),
          sizeBytes: fc.integer({ min: 1, max: STORAGE_MAX_BYTES }),
          contentType: fc.constantFrom("application/octet-stream", "text/plain"),
        }),
        (req: UploadRequest) => {
          const res = uploadArtifactBlob(req);
          expect(res.request).toEqual(req);
          expect(res.storageKey.endsWith(req.key)).toBe(true);
          expect(res.uploadedAt).toBeInstanceOf(Date);
        },
      ),
    );
  });
});

describe("contract.StorageService.deleteArtifactBlob", () => {
  test("signature: (bucket, key) -> void on a valid call", () => {
    // The TS impl returns void; the contract returns Boolean. Treat the
    // absence of a thrown StorageError as the success indicator and pin
    // the divergence with a comment for the weed skill to pick up.
    expect(() => deleteArtifactBlob("b", "k")).not.toThrow();
  });

  test("precondition: bucket != null (empty bucket throws)", () => {
    expect(() => deleteArtifactBlob("", "k")).toThrow(StorageError);
  });

  test("precondition: key != null (empty key throws)", () => {
    expect(() => deleteArtifactBlob("b", "")).toThrow(StorageError);
  });
});
