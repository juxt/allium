// Domain entities for the todo backend.
//
// Todos move through a small lifecycle:
//   pending -> done       (via completeTodo)
//   pending -> archived   (via archiveTodo)
//   pending -> expired    (via expireOverdue, when due_at < now)
//
// done and archived are terminal. Expired entries can be revived back
// into pending (via reviveTodo) within a grace window.

export const TODO_STATUS = ["pending", "done", "archived", "expired"];

export const TERMINAL_STATUSES = new Set(["done", "archived"]);

export const REVIVE_GRACE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export function newTodoId(state) {
  state.nextId ??= 1;
  return state.nextId++;
}

export function makeTodo({ id, title, dueAt = null, ownerId }) {
  return {
    id,
    title,
    ownerId,
    status: "pending",
    dueAt,
    createdAt: Date.now(),
    completedAt: null,
    archivedAt: null,
    expiredAt: null,
  };
}
