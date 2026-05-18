/**
 * Contract tests for the StorageService.
 *
 * Spec obligations covered:
 *   - contract-signature.StorageService.uploadArtifactBlob
 *   - contract-signature.StorageService.deleteArtifactBlob
 *   - StorageService @invariant Preconditions:
 *       bucket != null, key != null, req.bucket != null,
 *       req.sizeBytes <= config.storage_max_bytes, req.sizeBytes > 0
 *
 * Implementation bridge: src/integrations/storage.ts. The spec's contract
 * `uploadArtifactBlob(req: UploadRequest) -> UploadResponse` maps directly to
 * the exported function with the same name; the preconditions map to
 * `StorageError` throws.
 */
import { describe, expect, test } from '@jest/globals';
import {
  StorageError,
  UploadRequest,
  deleteArtifactBlob,
  uploadArtifactBlob,
} from '../src/integrations/storage.js';

const STORAGE_MAX_BYTES = 5 * 1024 * 1024 * 1024; // matches the constant in storage.ts

function validRequest(overrides: Partial<UploadRequest> = {}): UploadRequest {
  return {
    bucket: 'artifacts',
    key: 'builds/b-1/dist.tgz',
    sizeBytes: 1024,
    contentType: 'application/gzip',
    ...overrides,
  };
}

describe('contract_signature: uploadArtifactBlob has the declared shape', () => {
  test('returns an UploadResponse with request, storageKey, uploadedAt', () => {
    const req = validRequest();
    const res = uploadArtifactBlob(req);
    expect(res.request).toBe(req);
    expect(typeof res.storageKey).toBe('string');
    expect(res.uploadedAt).toBeInstanceOf(Date);
  });

  test('storageKey is derived from bucket and key', () => {
    const res = uploadArtifactBlob(validRequest({ bucket: 'b', key: 'k' }));
    expect(res.storageKey).toBe('b/k');
  });
});

describe('StorageService @invariant Precondition: req.sizeBytes > 0', () => {
  test.each([0, -1, -1024])('uploadArtifactBlob rejects sizeBytes %d', (sizeBytes: number) => {
    expect(() => uploadArtifactBlob(validRequest({ sizeBytes }))).toThrow(StorageError);
  });
});

describe('StorageService @invariant Precondition: req.sizeBytes <= config.storage_max_bytes', () => {
  test('exactly at the cap is accepted', () => {
    const res = uploadArtifactBlob(validRequest({ sizeBytes: STORAGE_MAX_BYTES }));
    expect(res.storageKey).toBeDefined();
  });

  test('one byte over the cap is rejected', () => {
    expect(() => uploadArtifactBlob(validRequest({ sizeBytes: STORAGE_MAX_BYTES + 1 }))).toThrow(
      StorageError,
    );
  });
});

describe('StorageService @invariant Precondition: req.bucket != null', () => {
  test('empty bucket is rejected', () => {
    expect(() => uploadArtifactBlob(validRequest({ bucket: '' }))).toThrow(StorageError);
  });
});

describe('contract_signature: deleteArtifactBlob accepts bucket+key strings', () => {
  test('runs to completion on valid inputs', () => {
    expect(() => deleteArtifactBlob('artifacts', 'builds/b-1/dist.tgz')).not.toThrow();
  });
});

describe('StorageService @invariant Preconditions on deleteArtifactBlob: bucket != null, key != null', () => {
  test('empty bucket is rejected', () => {
    expect(() => deleteArtifactBlob('', 'k')).toThrow(StorageError);
  });

  test('empty key is rejected', () => {
    expect(() => deleteArtifactBlob('b', '')).toThrow(StorageError);
  });
});
