/**
 * Property-based invariant tests.
 *
 * Spec obligations covered:
 *   - invariant.FailedBuildsHaveReason  (for b in Builds: b.status = failed implies b.failureReason != null)
 *
 * Strategy: generate a random walk through the Build transition graph from
 * the .created state (queued). At each step apply one legal transition and
 * assert the invariant holds across the entire store. We additionally check
 * a per-transition shape invariant: every status terminal state has
 * finishedAt set, and running has startedAt set. The walk respects the spec
 * transitions, so we never need to force illegal states.
 *
 * Transitions used by the walker (from spec, derived from rule preconditions):
 *   queued  -> { running, cancelled }
 *   running -> { success, failed, cancelled }
 *   terminal: { success, failed, cancelled }
 */
import { describe, expect, test } from '@jest/globals';
import fc from 'fast-check';
import { Build, BuildStatus, Store } from '../src/models.js';
import {
  cancelBuild,
  markBuildFailed,
  markBuildSuccess,
  startBuild,
} from '../src/services/builds.js';
import { makePipeline, makeQueuedBuild } from './helpers.js';

const TERMINAL: BuildStatus[] = [BuildStatus.SUCCESS, BuildStatus.FAILED, BuildStatus.CANCELLED];

type Transition = 'start' | 'success' | 'failed' | 'cancel';

function legalTransitions(status: BuildStatus): Transition[] {
  switch (status) {
    case BuildStatus.QUEUED:  return ['start', 'cancel'];
    case BuildStatus.RUNNING: return ['success', 'failed', 'cancel'];
    default: return [];
  }
}

function applyTransition(store: Store, buildId: string, t: Transition, reason: string): Build {
  switch (t) {
    case 'start':   return startBuild(store, buildId);
    case 'success': return markBuildSuccess(store, buildId);
    case 'failed':  return markBuildFailed(store, buildId, reason);
    case 'cancel':  return cancelBuild(store, buildId);
  }
}

function checkInvariantFailedHaveReason(store: Store): void {
  for (const b of store.builds.values()) {
    if (b.status === BuildStatus.FAILED) {
      expect(b.failureReason).not.toBeNull();
      expect(typeof b.failureReason).toBe('string');
      expect(b.failureReason!.length).toBeGreaterThan(0);
    }
  }
}

describe('property: FailedBuildsHaveReason holds across every random legal walk', () => {
  test('random walk over a single build', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom<Transition>('start', 'success', 'failed', 'cancel'), {
          minLength: 1,
          maxLength: 20,
        }),
        fc.string({ minLength: 1, maxLength: 32 }),
        (transitionChoices: Transition[], reason: string) => {
          const store = new Store();
          makePipeline(store);
          makeQueuedBuild(store);
          checkInvariantFailedHaveReason(store);
          for (const choice of transitionChoices) {
            const current = store.builds.get('b-1')!.status;
            const legal = legalTransitions(current);
            if (legal.length === 0) break; // terminal
            // Map the arbitrary choice onto a legal one by index so the
            // generator stays useful even after the build reaches running.
            const t = legal[transitionChoices.indexOf(choice) % legal.length] ?? legal[0];
            applyTransition(store, 'b-1', t, reason);
            checkInvariantFailedHaveReason(store);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  test('parallel walk over multiple builds preserves the invariant', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.tuple(
            fc.integer({ min: 0, max: 3 }), // build index
            fc.constantFrom<Transition>('start', 'success', 'failed', 'cancel'),
          ),
          { minLength: 1, maxLength: 40 },
        ),
        fc.string({ minLength: 1, maxLength: 32 }),
        (steps: Array<[number, Transition]>, reason: string) => {
          const store = new Store();
          makePipeline(store);
          for (let i = 0; i < 4; i++) {
            makeQueuedBuild(store, 'pl-1', `b-${i}`);
          }
          checkInvariantFailedHaveReason(store);
          for (const [idx, choice] of steps) {
            const buildId = `b-${idx}`;
            const current = store.builds.get(buildId)!.status;
            const legal = legalTransitions(current);
            if (legal.length === 0) continue;
            const t = legal[(['start', 'success', 'failed', 'cancel'].indexOf(choice)) % legal.length] ?? legal[0];
            applyTransition(store, buildId, t, reason);
            checkInvariantFailedHaveReason(store);
          }
        },
      ),
      { numRuns: 80 },
    );
  });
});

describe('property: shape invariants on Build at every state reached by a legal walk', () => {
  test('terminal states always have finishedAt set; running has startedAt; queued has neither', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom<Transition>('start', 'success', 'failed', 'cancel'), {
          minLength: 1,
          maxLength: 20,
        }),
        (choices: Transition[]) => {
          const store = new Store();
          makePipeline(store);
          makeQueuedBuild(store);
          for (const c of choices) {
            const b = store.builds.get('b-1')!;
            const legal = legalTransitions(b.status);
            if (legal.length === 0) break;
            const t = legal[choices.indexOf(c) % legal.length] ?? legal[0];
            applyTransition(store, 'b-1', t, 'r');
            const after = store.builds.get('b-1')!;
            if (after.status === BuildStatus.QUEUED) {
              expect(after.startedAt).toBeNull();
              expect(after.finishedAt).toBeNull();
            }
            if (after.status === BuildStatus.RUNNING) {
              expect(after.startedAt).toBeInstanceOf(Date);
              expect(after.finishedAt).toBeNull();
            }
            if (TERMINAL.includes(after.status)) {
              expect(after.finishedAt).toBeInstanceOf(Date);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
