/**
 * State-transition tests.
 *
 * Walks every declared/derived transition through the implementation's
 * lifecycle functions and verifies it succeeds. Walks every illegal
 * transition and verifies it's rejected. State-dependent fields (per the
 * spec's when-clause semantics) are checked at each state.
 *
 * Build transition map (derived from the spec's rule preconditions):
 *   queued  -> running       via StartBuild
 *   queued  -> cancelled     via CancelBuild
 *   running -> success       via MarkBuildSuccess
 *   running -> failed        via MarkBuildFailed
 *   running -> cancelled     via CancelBuild
 *   success / failed / cancelled : terminal
 *
 * Artifact transition map:
 *   pending  -> uploaded     via MarkArtifactUploaded
 *   uploaded -> expired      via MarkArtifactExpired
 *   expired                  : terminal
 *
 * The reachability tests start from .created (Enqueue / RegisterArtifact) and
 * walk a complete lifecycle to a terminal state.
 */
import { describe, expect, test } from '@jest/globals';
import {
  ArtifactStatus,
  Build,
  BuildStatus,
  Store,
} from '../src/models.js';
import {
  BuildTransitionError,
  cancelBuild,
  markBuildFailed,
  markBuildSuccess,
  startBuild,
} from '../src/services/builds.js';
import {
  ArtifactTransitionError,
  markArtifactExpired,
  markArtifactUploaded,
} from '../src/services/artifacts.js';
import {
  forceArtifactStatus,
  forceBuildStatus,
  makePendingArtifact,
  makePipeline,
  makeQueuedBuild,
  makeUploadedArtifact,
} from './helpers.js';

type BuildAction = (store: Store, buildId: string) => Build;
type Edge = { from: BuildStatus; to: BuildStatus; action: BuildAction; name: string };

const buildEdges: Edge[] = [
  { from: BuildStatus.QUEUED, to: BuildStatus.RUNNING, action: (s, b) => startBuild(s, b), name: 'StartBuild' },
  { from: BuildStatus.QUEUED, to: BuildStatus.CANCELLED, action: (s, b) => cancelBuild(s, b), name: 'CancelBuild' },
  { from: BuildStatus.RUNNING, to: BuildStatus.SUCCESS, action: (s, b) => markBuildSuccess(s, b), name: 'MarkBuildSuccess' },
  { from: BuildStatus.RUNNING, to: BuildStatus.FAILED, action: (s, b) => markBuildFailed(s, b, 'r'), name: 'MarkBuildFailed' },
  { from: BuildStatus.RUNNING, to: BuildStatus.CANCELLED, action: (s, b) => cancelBuild(s, b), name: 'CancelBuild(running)' },
];

const buildTerminal: BuildStatus[] = [BuildStatus.SUCCESS, BuildStatus.FAILED, BuildStatus.CANCELLED];

describe('Build transitions: every declared edge is reachable via its witnessing rule', () => {
  test.each(buildEdges)('$name: $from -> $to', ({ from, to, action }: Edge) => {
    const store = new Store();
    makePipeline(store);
    const build = makeQueuedBuild(store);
    // Position the build in the source state by forcing if needed.
    if (from === BuildStatus.RUNNING) {
      // Walk the legal queued -> running edge first.
      startBuild(store, build.buildId);
    }
    expect(store.builds.get(build.buildId)!.status).toBe(from);
    const after = action(store, build.buildId);
    expect(after.status).toBe(to);
  });
});

describe('Build transitions: every illegal transition is rejected', () => {
  const allStatuses: BuildStatus[] = [
    BuildStatus.QUEUED,
    BuildStatus.RUNNING,
    BuildStatus.SUCCESS,
    BuildStatus.FAILED,
    BuildStatus.CANCELLED,
  ];
  // For each rule, the set of source-states it accepts. Anything else must throw.
  const ruleAcceptedSources: Array<{
    name: string;
    accept: BuildStatus[];
    action: BuildAction;
  }> = [
    { name: 'StartBuild',        accept: [BuildStatus.QUEUED],                       action: (s, b) => startBuild(s, b) },
    { name: 'MarkBuildSuccess',  accept: [BuildStatus.RUNNING],                      action: (s, b) => markBuildSuccess(s, b) },
    { name: 'MarkBuildFailed',   accept: [BuildStatus.RUNNING],                      action: (s, b) => markBuildFailed(s, b, 'r') },
    { name: 'CancelBuild',       accept: [BuildStatus.QUEUED, BuildStatus.RUNNING],  action: (s, b) => cancelBuild(s, b) },
  ];

  for (const { name, accept, action } of ruleAcceptedSources) {
    const illegal = allStatuses.filter((s) => !accept.includes(s));
    test.each(illegal)(`${name} from %s is rejected`, (status: BuildStatus) => {
      const store = new Store();
      makePipeline(store);
      const build = makeQueuedBuild(store);
      forceBuildStatus(build, status);
      expect(() => action(store, build.buildId)).toThrow(BuildTransitionError);
    });
  }
});

describe('Build transitions: terminal states have no outbound legal transitions', () => {
  test.each(buildTerminal)('%s has no outbound transitions', (terminal: BuildStatus) => {
    const store = new Store();
    makePipeline(store);
    const build = makeQueuedBuild(store);
    forceBuildStatus(build, terminal);

    expect(() => startBuild(store, build.buildId)).toThrow(BuildTransitionError);
    expect(() => markBuildSuccess(store, build.buildId)).toThrow(BuildTransitionError);
    expect(() => markBuildFailed(store, build.buildId, 'r')).toThrow(BuildTransitionError);
    expect(() => cancelBuild(store, build.buildId)).toThrow(BuildTransitionError);
  });
});

describe('Build reachability: every state is reachable from .created via the witnessing rules', () => {
  test('queued is the .created state', () => {
    const store = new Store();
    makePipeline(store);
    const build = makeQueuedBuild(store);
    expect(build.status).toBe(BuildStatus.QUEUED);
  });

  test('queued -> running', () => {
    const store = new Store();
    makePipeline(store);
    makeQueuedBuild(store);
    const r = startBuild(store, 'b-1');
    expect(r.status).toBe(BuildStatus.RUNNING);
  });

  test('queued -> running -> success', () => {
    const store = new Store();
    makePipeline(store);
    makeQueuedBuild(store);
    startBuild(store, 'b-1');
    const s = markBuildSuccess(store, 'b-1');
    expect(s.status).toBe(BuildStatus.SUCCESS);
  });

  test('queued -> running -> failed', () => {
    const store = new Store();
    makePipeline(store);
    makeQueuedBuild(store);
    startBuild(store, 'b-1');
    const f = markBuildFailed(store, 'b-1', 'oops');
    expect(f.status).toBe(BuildStatus.FAILED);
    expect(f.failureReason).toBe('oops');
  });

  test('queued -> cancelled', () => {
    const store = new Store();
    makePipeline(store);
    makeQueuedBuild(store);
    const c = cancelBuild(store, 'b-1');
    expect(c.status).toBe(BuildStatus.CANCELLED);
  });

  test('queued -> running -> cancelled', () => {
    const store = new Store();
    makePipeline(store);
    makeQueuedBuild(store);
    startBuild(store, 'b-1');
    const c = cancelBuild(store, 'b-1');
    expect(c.status).toBe(BuildStatus.CANCELLED);
  });
});

describe('Build state-dependent fields per the spec when-clauses', () => {
  test('startedAt is present iff status has been at least running (running/success/failed)', () => {
    const store = new Store();
    makePipeline(store);
    makeQueuedBuild(store);
    expect(store.builds.get('b-1')!.startedAt).toBeNull(); // queued
    startBuild(store, 'b-1');
    expect(store.builds.get('b-1')!.startedAt).toBeInstanceOf(Date); // running
    markBuildSuccess(store, 'b-1');
    expect(store.builds.get('b-1')!.startedAt).toBeInstanceOf(Date); // success preserves startedAt
  });

  test('finishedAt is present iff status is terminal (success/failed/cancelled)', () => {
    const cases: Array<{ name: string; act: (s: Store) => Build }> = [
      { name: 'success', act: (s) => { makeQueuedBuild(s); startBuild(s, 'b-1'); return markBuildSuccess(s, 'b-1'); } },
      { name: 'failed',  act: (s) => { makeQueuedBuild(s); startBuild(s, 'b-1'); return markBuildFailed(s, 'b-1', 'r'); } },
      { name: 'cancelled-from-queued', act: (s) => { makeQueuedBuild(s); return cancelBuild(s, 'b-1'); } },
      { name: 'cancelled-from-running', act: (s) => { makeQueuedBuild(s); startBuild(s, 'b-1'); return cancelBuild(s, 'b-1'); } },
    ];
    for (const c of cases) {
      const store = new Store();
      makePipeline(store);
      const build = c.act(store);
      expect(build.finishedAt).toBeInstanceOf(Date);
    }
  });

  test('failureReason is present iff status = failed (invariant FailedBuildsHaveReason)', () => {
    const store = new Store();
    makePipeline(store);
    makeQueuedBuild(store);
    startBuild(store, 'b-1');
    expect(store.builds.get('b-1')!.failureReason).toBeNull();
    markBuildFailed(store, 'b-1', 'compiler crashed');
    expect(store.builds.get('b-1')!.failureReason).toBe('compiler crashed');
  });
});

// ---------------------------------------------------------------------------
// Artifact transitions
// ---------------------------------------------------------------------------

describe('Artifact transitions: every declared edge is reachable via its witnessing rule', () => {
  test('pending -> uploaded (MarkArtifactUploaded)', () => {
    const store = new Store();
    makePipeline(store);
    makePendingArtifact(store);
    const a = markArtifactUploaded(store, 'a-1', 'k');
    expect(a.status).toBe(ArtifactStatus.UPLOADED);
  });

  test('uploaded -> expired (MarkArtifactExpired)', () => {
    const store = new Store();
    makePipeline(store);
    makeUploadedArtifact(store);
    const a = markArtifactExpired(store, 'a-1');
    expect(a.status).toBe(ArtifactStatus.EXPIRED);
  });
});

describe('Artifact transitions: every illegal transition is rejected', () => {
  test.each([ArtifactStatus.UPLOADED, ArtifactStatus.EXPIRED])(
    'MarkArtifactUploaded from %s is rejected',
    (status: ArtifactStatus) => {
      const store = new Store();
      makePipeline(store);
      const a = makePendingArtifact(store);
      forceArtifactStatus(a, status);
      expect(() => markArtifactUploaded(store, 'a-1', 'k')).toThrow(ArtifactTransitionError);
    },
  );

  test.each([ArtifactStatus.PENDING, ArtifactStatus.EXPIRED])(
    'MarkArtifactExpired from %s is rejected',
    (status: ArtifactStatus) => {
      const store = new Store();
      makePipeline(store);
      const a = makePendingArtifact(store);
      forceArtifactStatus(a, status);
      expect(() => markArtifactExpired(store, 'a-1')).toThrow(ArtifactTransitionError);
    },
  );
});

describe('Artifact terminal state: expired has no outbound legal transitions', () => {
  test('expired has no outbound transitions', () => {
    const store = new Store();
    makePipeline(store);
    const a = makePendingArtifact(store);
    forceArtifactStatus(a, ArtifactStatus.EXPIRED);
    expect(() => markArtifactUploaded(store, 'a-1', 'k')).toThrow(ArtifactTransitionError);
    expect(() => markArtifactExpired(store, 'a-1')).toThrow(ArtifactTransitionError);
  });
});

describe('Artifact reachability: pending -> uploaded -> expired', () => {
  test('full lifecycle reaches expired', () => {
    const store = new Store();
    makePipeline(store);
    makePendingArtifact(store);
    expect(store.artifacts.get('a-1')!.status).toBe(ArtifactStatus.PENDING);
    markArtifactUploaded(store, 'a-1', 'k');
    expect(store.artifacts.get('a-1')!.status).toBe(ArtifactStatus.UPLOADED);
    markArtifactExpired(store, 'a-1');
    expect(store.artifacts.get('a-1')!.status).toBe(ArtifactStatus.EXPIRED);
  });
});

describe('Artifact state-dependent fields per the spec when-clauses', () => {
  test('uploadedAt and expiresAt and storageKey present iff status >= uploaded', () => {
    const store = new Store();
    makePipeline(store);
    makePendingArtifact(store);
    const pending = store.artifacts.get('a-1')!;
    expect(pending.uploadedAt).toBeNull();
    expect(pending.expiresAt).toBeNull();
    expect(pending.storageKey).toBeNull();

    markArtifactUploaded(store, 'a-1', 'bucket/key');
    const uploaded = store.artifacts.get('a-1')!;
    expect(uploaded.uploadedAt).toBeInstanceOf(Date);
    expect(uploaded.expiresAt).toBeInstanceOf(Date);
    expect(uploaded.storageKey).toBe('bucket/key');

    markArtifactExpired(store, 'a-1');
    const expired = store.artifacts.get('a-1')!;
    // expired preserves uploadedAt / expiresAt / storageKey rather than nulling them.
    expect(expired.uploadedAt).toBeInstanceOf(Date);
    expect(expired.expiresAt).toBeInstanceOf(Date);
    expect(expired.storageKey).toBe('bucket/key');
  });
});
