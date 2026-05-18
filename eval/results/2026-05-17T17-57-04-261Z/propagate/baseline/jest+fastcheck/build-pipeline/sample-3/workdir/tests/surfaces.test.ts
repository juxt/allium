/**
 * Surface and webhook tests.
 *
 * Spec obligations covered:
 *   - surface-provides.Routes      (every rule listed in `provides` is reachable via the HTTP router)
 *   - surface-actor.Routes         (no actor is declared in the spec; we verify the routes don't expose
 *                                  internal entities, only the rule entry points)
 *   - surface-provides.Webhooks    (ReceiveGithubPushEvent is reachable at POST /webhooks/github-push)
 *   - surface-actor.Webhooks       (same: no actor declared)
 *   - rule_success.ReceiveGithubPushEvent for matching pipelines (data flow chain:
 *     webhook -> EnqueueBuild on every active pipeline whose repoUrl ends with repoFullName and
 *     whose defaultBranch matches branch)
 *
 * The Routes surface is implemented as the `Router` singleton in src/index.ts.
 * The spec maps each rule to a POST endpoint via the @guidance comment.
 */
import { describe, expect, test } from '@jest/globals';
import { router } from '../src/index.js';
import { BuildStatus, PipelineStatus, Store } from '../src/models.js';
import { receiveGithubPushEvent } from '../src/webhooks.js';
import { makePipeline } from './helpers.js';

const expectedRoutes: Array<[string, string, string]> = [
  ['POST', '/builds',                              'EnqueueBuild'],
  ['POST', '/builds/:buildId/start',               'StartBuild'],
  ['POST', '/builds/:buildId/success',             'MarkBuildSuccess'],
  ['POST', '/builds/:buildId/failed',              'MarkBuildFailed'],
  ['POST', '/builds/:buildId/cancel',              'CancelBuild'],
  ['POST', '/artifacts',                           'RegisterArtifact'],
  ['POST', '/artifacts/:artifactId/uploaded',      'MarkArtifactUploaded'],
  ['POST', '/webhooks/github-push',                'ReceiveGithubPushEvent'],
];

describe('surface_provides: Routes exposes every spec-declared rule entry point', () => {
  test.each(expectedRoutes)(
    '%s %s (rule %s) is registered on the router',
    (method: string, path: string, _rule: string) => {
      const match = router.routes.find((r) => r.method === method && r.path === path);
      expect(match).toBeDefined();
      expect(typeof match!.handler).toBe('function');
    },
  );

  test('every registered route is a POST (spec lists only ensures-bearing rules, no read operations)', () => {
    for (const route of router.routes) {
      expect(route.method).toBe('POST');
    }
  });
});

describe('surface_provides: Webhooks subsurface provides ReceiveGithubPushEvent', () => {
  test('POST /webhooks/github-push is registered', () => {
    const match = router.routes.find((r) => r.method === 'POST' && r.path === '/webhooks/github-push');
    expect(match).toBeDefined();
  });
});

describe('Webhook intake: receiveGithubPushEvent matches pipelines on (repoUrl endsWith, defaultBranch)', () => {
  test('enqueues exactly one build per matching active pipeline', () => {
    const store = new Store();
    makePipeline(store, {
      pipelineId: 'pl-match',
      repoUrl: 'git@github.com:acme/widgets.git', // does not end with repoFullName
      defaultBranch: 'main',
      status: PipelineStatus.ACTIVE,
    });
    makePipeline(store, {
      pipelineId: 'pl-also-match',
      repoUrl: 'https://github.com/acme/widgets', // ends with 'acme/widgets'
      defaultBranch: 'main',
      status: PipelineStatus.ACTIVE,
    });
    makePipeline(store, {
      pipelineId: 'pl-wrong-branch',
      repoUrl: 'https://github.com/acme/widgets',
      defaultBranch: 'release',
      status: PipelineStatus.ACTIVE,
    });
    makePipeline(store, {
      pipelineId: 'pl-paused',
      repoUrl: 'https://github.com/acme/widgets',
      defaultBranch: 'main',
      status: PipelineStatus.PAUSED, // not active -> skipped
    });
    const result = receiveGithubPushEvent(store, {
      eventId: 'evt-1',
      repoFullName: 'acme/widgets',
      branch: 'main',
      commitSha: 'deadbeef0000',
      pushedBy: 'octocat',
    });
    expect(result.enqueuedBuildIds.sort()).toEqual(['pl-also-match-deadbee']);
    const created = [...store.builds.values()];
    expect(created.length).toBe(1);
    expect(created[0].pipelineId).toBe('pl-also-match');
    expect(created[0].status).toBe(BuildStatus.QUEUED);
    expect(created[0].commitSha).toBe('deadbeef0000');
    expect(created[0].triggeredBy).toBe('octocat');
  });

  test('skips archived pipelines (only ACTIVE pipelines enqueue)', () => {
    const store = new Store();
    makePipeline(store, {
      pipelineId: 'pl-archived',
      repoUrl: 'github.com/acme/widgets',
      defaultBranch: 'main',
      status: PipelineStatus.ARCHIVED,
    });
    const result = receiveGithubPushEvent(store, {
      eventId: 'evt-1',
      repoFullName: 'acme/widgets',
      branch: 'main',
      commitSha: 'feedface',
      pushedBy: 'who',
    });
    expect(result.enqueuedBuildIds).toEqual([]);
    expect(store.builds.size).toBe(0);
  });

  test('stores the push event regardless of whether any pipeline matched', () => {
    const store = new Store();
    receiveGithubPushEvent(store, {
      eventId: 'evt-no-match',
      repoFullName: 'no/such',
      branch: 'main',
      commitSha: 'c',
      pushedBy: 'p',
    });
    expect(store.pushEvents.get('evt-no-match')).toBeDefined();
  });
});
