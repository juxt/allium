// State-machine and rule tests generated from spec.allium.
//
// Obligations covered:
//   rule-success.CreateTodo
//   rule-failure.CreateTodo.1  (TITLE_REQUIRED — empty / whitespace)
//   rule-failure.CreateTodo.2  (DUE_IN_PAST)
//   rule-success.CompleteTodo
//   rule-failure.CompleteTodo.1 (NOT_PENDING × 3: done, archived, expired)
//   rule-success.ReviveTodo
//   rule-failure.ReviveTodo.3  (REVIVE_WINDOW_PASSED)
//   transition-edge.Todo.pending.done  (full pending → done lifecycle)
//   transition-edge.Todo.pending.expired + expired.pending
//     (expireOverdue sweep + reviveTodo, fake clock)

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createTodo,
  completeTodo,
  archiveTodo,
  reviveTodo,
  expireOverdue,
  RuleViolation,
} from '../service.js';
import { REVIVE_GRACE_MS } from '../models.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function freshState() {
  return { todos: new Map() };
}

function assertViolation(fn, code) {
  assert.throws(fn, (err) => {
    assert.ok(err instanceof RuleViolation, `expected RuleViolation but got ${err?.constructor?.name}`);
    assert.equal(err.code, code);
    return true;
  });
}

// Injects a pre-built expired todo without going through createTodo rules.
function seedExpiredTodo(state, { expiredAt }) {
  const id = state.todos.size + 1;
  state.todos.set(id, {
    id,
    title: 'seed todo',
    ownerId: 'u1',
    status: 'expired',
    dueAt: null,
    createdAt: expiredAt - 86_400_000,
    completedAt: null,
    archivedAt: null,
    expiredAt,
  });
  return state.todos.get(id);
}

// ─── CreateTodo ───────────────────────────────────────────────────────────────

describe('createTodo', () => {
  test('happy path: creates a pending todo with all required fields', () => {
    const state = freshState();
    const before = Date.now();
    const todo = createTodo(state, { title: 'Buy milk', ownerId: 'u1' });
    const after = Date.now();

    assert.equal(todo.title, 'Buy milk');
    assert.equal(todo.status, 'pending');
    assert.equal(todo.ownerId, 'u1');
    assert.equal(todo.dueAt, null);
    assert.ok(todo.createdAt >= before && todo.createdAt <= after, 'createdAt within test window');
    assert.equal(todo.completedAt, null);
    assert.equal(todo.archivedAt, null);
    assert.equal(todo.expiredAt, null);
    assert.equal(state.todos.size, 1);
    assert.equal(state.todos.get(todo.id), todo);
  });

  test('TITLE_REQUIRED: empty string title', () => {
    assertViolation(
      () => createTodo(freshState(), { title: '', ownerId: 'u1' }),
      'TITLE_REQUIRED',
    );
  });

  test('TITLE_REQUIRED: whitespace-only title', () => {
    assertViolation(
      () => createTodo(freshState(), { title: '   ', ownerId: 'u1' }),
      'TITLE_REQUIRED',
    );
  });

  test('DUE_IN_PAST: due_at before now is rejected', () => {
    assertViolation(
      () => createTodo(freshState(), { title: 'Late task', dueAt: Date.now() - 5000, ownerId: 'u1' }),
      'DUE_IN_PAST',
    );
  });

  test('null due_at is accepted', () => {
    const todo = createTodo(freshState(), { title: 'No deadline', dueAt: null, ownerId: 'u1' });
    assert.equal(todo.dueAt, null);
    assert.equal(todo.status, 'pending');
  });

  test('future due_at is accepted', () => {
    const todo = createTodo(freshState(), {
      title: 'Future task',
      dueAt: Date.now() + 86_400_000,
      ownerId: 'u1',
    });
    assert.equal(todo.status, 'pending');
    assert.ok(todo.dueAt > Date.now());
  });
});

// ─── CompleteTodo ─────────────────────────────────────────────────────────────

describe('completeTodo', () => {
  test('happy path: pending → done, completedAt is stamped', () => {
    const state = freshState();
    const todo = createTodo(state, { title: 'Task', ownerId: 'u1' });
    assert.equal(todo.status, 'pending');

    const before = Date.now();
    const result = completeTodo(state, todo.id);
    const after = Date.now();

    assert.equal(result.status, 'done');
    assert.ok(result.completedAt >= before && result.completedAt <= after, 'completedAt within test window');
  });

  test('NOT_PENDING: cannot complete a todo already in done', () => {
    const state = freshState();
    const todo = createTodo(state, { title: 'Task', ownerId: 'u1' });
    completeTodo(state, todo.id);
    assertViolation(() => completeTodo(state, todo.id), 'NOT_PENDING');
  });

  test('NOT_PENDING: cannot complete an archived todo', () => {
    const state = freshState();
    const todo = createTodo(state, { title: 'Task', ownerId: 'u1' });
    archiveTodo(state, todo.id);
    assertViolation(() => completeTodo(state, todo.id), 'NOT_PENDING');
  });

  test('NOT_PENDING: cannot complete an expired todo', () => {
    const state = freshState();
    const id = 1;
    state.todos.set(id, {
      id,
      title: 'Expired task',
      ownerId: 'u1',
      status: 'expired',
      dueAt: null,
      createdAt: Date.now() - 10_000,
      completedAt: null,
      archivedAt: null,
      expiredAt: Date.now() - 1000,
    });
    assertViolation(() => completeTodo(state, id), 'NOT_PENDING');
  });
});

// ─── ReviveTodo ───────────────────────────────────────────────────────────────

describe('reviveTodo', () => {
  test('happy path: revives an expired todo within the grace window', (t) => {
    // Freeze time so the grace-window arithmetic is deterministic.
    const NOW = 1_700_000_000_000; // 2023-11-14 — arbitrary but stable
    t.mock.timers.enable({ apis: ['Date'], now: NOW });

    const state = freshState();
    const todo = seedExpiredTodo(state, { expiredAt: NOW - 60_000 }); // expired 1 minute ago

    const result = reviveTodo(state, todo.id);

    assert.equal(result.status, 'pending');
    assert.equal(result.expiredAt, null);
  });

  test('REVIVE_WINDOW_PASSED: fails when expired more than the grace period ago', (t) => {
    const NOW = 1_700_000_000_000;
    t.mock.timers.enable({ apis: ['Date'], now: NOW });

    const state = freshState();
    seedExpiredTodo(state, {
      expiredAt: NOW - REVIVE_GRACE_MS - 1, // 1 ms past the 7-day window
    });

    assertViolation(() => reviveTodo(state, 1), 'REVIVE_WINDOW_PASSED');
  });

  test('revive at the exact grace-window boundary is allowed', (t) => {
    // Boundary: Date.now() - expiredAt === REVIVE_GRACE_MS is NOT > REVIVE_GRACE_MS
    const NOW = 1_700_000_000_000;
    t.mock.timers.enable({ apis: ['Date'], now: NOW });

    const state = freshState();
    const todo = seedExpiredTodo(state, { expiredAt: NOW - REVIVE_GRACE_MS });

    const result = reviveTodo(state, todo.id);
    assert.equal(result.status, 'pending');
  });
});

// ─── Full pending → done lifecycle ───────────────────────────────────────────

describe('lifecycle: pending → done', () => {
  test('create → complete: done is terminal', () => {
    const state = freshState();

    const todo = createTodo(state, { title: 'Write tests', ownerId: 'u1' });
    assert.equal(todo.status, 'pending');

    const done = completeTodo(state, todo.id);
    assert.equal(done.status, 'done');
    assert.ok(done.completedAt != null);

    // done is terminal — any further transition must be rejected
    assertViolation(() => completeTodo(state, todo.id), 'NOT_PENDING');
    assertViolation(() => archiveTodo(state, todo.id), 'ALREADY_TERMINAL');
  });

  test('pending → expired → pending → done via expireOverdue + reviveTodo', (t) => {
    // Uses fake clock so the sweep and revive stay deterministic.
    const START = 1_700_000_000_000;
    t.mock.timers.enable({ apis: ['Date'], now: START });

    const state = freshState();

    // 1. Create with a due date 1 second from now
    const todo = createTodo(state, {
      title: 'Expiry path',
      dueAt: START + 1000,
      ownerId: 'u1',
    });
    assert.equal(todo.status, 'pending');

    // 2. Advance past the due date and run the overdue sweep
    t.mock.timers.tick(2000); // now = START + 2000
    expireOverdue(state);
    const expired = state.todos.get(todo.id);
    assert.equal(expired.status, 'expired');
    assert.ok(expired.expiredAt != null);

    // 3. Revive within the 7-day grace window (only 2 s have elapsed)
    const revived = reviveTodo(state, todo.id);
    assert.equal(revived.status, 'pending');
    assert.equal(revived.expiredAt, null);

    // 4. Complete from the revived pending state → done
    const done = completeTodo(state, todo.id);
    assert.equal(done.status, 'done');
    assert.ok(done.completedAt != null);
  });
});
