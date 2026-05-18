/**
 * Inbound GitHub push-event webhook.
 *
 * Each push from a watched repo enqueues a build on the matching pipeline
 * (best-effort: silently no-op if no pipeline watches this repo/branch).
 */
import {
  GithubPushEvent,
  PipelineStatus,
  Store,
} from "./models.js";
import { enqueueBuild } from "./services/builds.js";

export interface ReceiveGithubPushArgs {
  eventId: string;
  repoFullName: string;
  branch: string;
  commitSha: string;
  pushedBy: string;
}

export function receiveGithubPushEvent(
  store: Store,
  args: ReceiveGithubPushArgs,
): { eventId: string; enqueuedBuildIds: string[] } {
  const event: GithubPushEvent = {
    eventId: args.eventId,
    repoFullName: args.repoFullName,
    branch: args.branch,
    commitSha: args.commitSha,
    pushedBy: args.pushedBy,
    receivedAt: new Date(),
  };
  store.pushEvents.set(event.eventId, event);

  const enqueued: string[] = [];
  for (const pipeline of store.pipelines.values()) {
    if (pipeline.status !== PipelineStatus.ACTIVE) continue;
    if (!pipeline.repoUrl.endsWith(args.repoFullName)) continue;
    if (pipeline.defaultBranch !== args.branch) continue;
    const buildId = `${pipeline.pipelineId}-${args.commitSha.slice(0, 7)}`;
    enqueueBuild(store, {
      buildId,
      pipelineId: pipeline.pipelineId,
      commitSha: args.commitSha,
      triggeredBy: args.pushedBy,
    });
    enqueued.push(buildId);
  }
  return { eventId: event.eventId, enqueuedBuildIds: enqueued };
}
