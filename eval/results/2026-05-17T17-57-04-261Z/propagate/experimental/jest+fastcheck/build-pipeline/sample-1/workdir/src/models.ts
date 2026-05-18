/**
 * Domain entities for the build-pipeline app.
 *
 * Three core entities plus one external entity (GithubPushEvent) arriving
 * via webhook. Status fields are TypeScript enums; derived getters live on
 * the entity classes.
 */

export enum PipelineStatus {
  ACTIVE = "active",
  PAUSED = "paused",
  ARCHIVED = "archived",
}

export enum BuildStatus {
  QUEUED = "queued",
  RUNNING = "running",
  SUCCESS = "success",
  FAILED = "failed",
  CANCELLED = "cancelled",
}

export enum ArtifactStatus {
  PENDING = "pending",
  UPLOADED = "uploaded",
  EXPIRED = "expired",
}

/** Duration in milliseconds after which an uploaded artifact expires. */
export const ARTIFACT_TTL_MS: number = 7 * 24 * 60 * 60 * 1000; // 7 days

/** A running build is "stuck" if it has been RUNNING for longer than this. */
export const STUCK_AFTER_MS: number = 60 * 60 * 1000; // 1 hour

/** Auto-cancel a queued build that hasn't started within this window. */
export const QUEUED_TIMEOUT_MS: number = 30 * 60 * 1000; // 30 minutes

export interface Pipeline {
  pipelineId: string;
  name: string;
  repoUrl: string;
  status: PipelineStatus;
  defaultBranch: string;
  createdAt: Date;
}

export interface Build {
  buildId: string;
  pipelineId: string;
  commitSha: string;
  status: BuildStatus;
  triggeredBy: string;          // e.g. github user login, or "schedule"
  queuedAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  failureReason: string | null;
}

export interface Artifact {
  artifactId: string;
  buildId: string;
  name: string;
  sizeBytes: number;
  status: ArtifactStatus;
  uploadedAt: Date | null;
  expiresAt: Date | null;
  storageKey: string | null;
}

/**
 * External entity: arrives via webhook from GitHub when a push happens.
 * The app does not own the lifecycle; it only receives, stores and decides
 * whether to enqueue a build.
 */
export interface GithubPushEvent {
  eventId: string;
  repoFullName: string;
  branch: string;
  commitSha: string;
  pushedBy: string;
  receivedAt: Date;
}

export class Store {
  pipelines = new Map<string, Pipeline>();
  builds = new Map<string, Build>();
  artifacts = new Map<string, Artifact>();
  pushEvents = new Map<string, GithubPushEvent>();
}

// Derived helpers — exposed as functions rather than as object methods to
// keep the interfaces above as plain data shapes. The distill skill should
// recognise these as derived properties of the corresponding entity.

export function buildDurationMs(build: Build): number | null {
  if (build.startedAt === null) return null;
  const end = build.finishedAt ?? new Date();
  return end.getTime() - build.startedAt.getTime();
}

export function buildIsStuck(build: Build): boolean {
  if (build.status !== BuildStatus.RUNNING) return false;
  if (build.startedAt === null) return false;
  return (Date.now() - build.startedAt.getTime()) > STUCK_AFTER_MS;
}

export function artifactIsExpired(artifact: Artifact): boolean {
  if (artifact.expiresAt === null) return false;
  return Date.now() > artifact.expiresAt.getTime();
}

export function pipelineActiveBuildCount(store: Store, pipelineId: string): number {
  let count = 0;
  for (const build of store.builds.values()) {
    if (build.pipelineId === pipelineId
      && (build.status === BuildStatus.QUEUED || build.status === BuildStatus.RUNNING)) {
      count++;
    }
  }
  return count;
}
