/**
 * Third-party artifact storage integration.
 *
 * Generic blob storage client (S3-shaped). The desk uploads artifact
 * binaries and gets back a stable storage key.
 */

export class StorageError extends Error {}

export interface UploadRequest {
  bucket: string;
  key: string;
  sizeBytes: number;
  contentType: string;
}

export interface UploadResponse {
  request: UploadRequest;
  storageKey: string;
  uploadedAt: Date;
}

const STORAGE_MAX_BYTES = 5 * 1024 * 1024 * 1024; // 5 GiB

export function uploadArtifactBlob(req: UploadRequest): UploadResponse {
  if (req.sizeBytes <= 0) {
    throw new StorageError("sizeBytes must be positive");
  }
  if (req.sizeBytes > STORAGE_MAX_BYTES) {
    throw new StorageError(
      `sizeBytes ${req.sizeBytes} exceeds upstream cap ${STORAGE_MAX_BYTES}`,
    );
  }
  if (!req.bucket) {
    throw new StorageError("bucket is required");
  }
  return {
    request: req,
    storageKey: `${req.bucket}/${req.key}`,
    uploadedAt: new Date(),
  };
}

export function deleteArtifactBlob(bucket: string, key: string): void {
  if (!bucket || !key) {
    throw new StorageError("bucket and key are required");
  }
  // Side-effect free in this fixture.
}
