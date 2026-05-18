/**
 * Artifact lifecycle: register, mark uploaded, mark expired.
 *
 * Artifacts are tied to a successful build. They have a TTL after upload;
 * the artifact-expiry job sweeps expired ones daily.
 */
import {
  ARTIFACT_TTL_MS,
  Artifact,
  ArtifactStatus,
  BuildStatus,
  Store,
} from "../models.js";

export class ArtifactTransitionError extends Error {}
export class ArtifactNotFoundError extends Error {}

export function registerArtifact(
  store: Store,
  args: {
    artifactId: string;
    buildId: string;
    name: string;
    sizeBytes: number;
  },
): Artifact {
  const build = store.builds.get(args.buildId);
  if (build === undefined) {
    throw new ArtifactNotFoundError(`unknown build ${args.buildId}`);
  }
  if (build.status !== BuildStatus.SUCCESS) {
    throw new ArtifactTransitionError(
      `cannot register artifact for build in ${build.status}; required ${BuildStatus.SUCCESS}`,
    );
  }
  if (args.sizeBytes <= 0) {
    throw new ArtifactTransitionError("sizeBytes must be positive");
  }
  const artifact: Artifact = {
    artifactId: args.artifactId,
    buildId: args.buildId,
    name: args.name,
    sizeBytes: args.sizeBytes,
    status: ArtifactStatus.PENDING,
    uploadedAt: null,
    expiresAt: null,
    storageKey: null,
  };
  store.artifacts.set(artifact.artifactId, artifact);
  return artifact;
}

export function markArtifactUploaded(
  store: Store,
  artifactId: string,
  storageKey: string,
): Artifact {
  const artifact = requireArtifact(store, artifactId);
  if (artifact.status !== ArtifactStatus.PENDING) {
    throw new ArtifactTransitionError(
      `cannot mark uploaded from ${artifact.status}`,
    );
  }
  const now = new Date();
  artifact.status = ArtifactStatus.UPLOADED;
  artifact.uploadedAt = now;
  artifact.expiresAt = new Date(now.getTime() + ARTIFACT_TTL_MS);
  artifact.storageKey = storageKey;
  return artifact;
}

export function markArtifactExpired(store: Store, artifactId: string): Artifact {
  const artifact = requireArtifact(store, artifactId);
  if (artifact.status !== ArtifactStatus.UPLOADED) {
    throw new ArtifactTransitionError(
      `cannot mark expired from ${artifact.status}`,
    );
  }
  artifact.status = ArtifactStatus.EXPIRED;
  return artifact;
}

function requireArtifact(store: Store, artifactId: string): Artifact {
  const artifact = store.artifacts.get(artifactId);
  if (artifact === undefined) {
    throw new ArtifactNotFoundError(`unknown artifact ${artifactId}`);
  }
  return artifact;
}
