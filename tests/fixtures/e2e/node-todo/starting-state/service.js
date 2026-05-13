// Business rules for the todo backend.
//
// All state mutation goes through these functions. Each function takes
// the in-memory `state` (a Map keyed by todo id) and returns either the
// updated todo or throws an error describing the rule violation.

import {
  makeTodo,
  newTodoId,
  TERMINAL_STATUSES,
  REVIVE_GRACE_MS,
} from "./models.js";

export class RuleViolation extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export function createTodo(state, { title, dueAt, ownerId }) {
  if (!title || title.trim().length === 0) {
    throw new RuleViolation("TITLE_REQUIRED", "title is required");
  }
  if (dueAt && dueAt < Date.now()) {
    throw new RuleViolation("DUE_IN_PAST", "due date must be in the future");
  }
  const id = newTodoId(state);
  const todo = makeTodo({ id, title: title.trim(), dueAt, ownerId });
  state.todos.set(id, todo);
  return todo;
}

export function completeTodo(state, id) {
  const todo = state.todos.get(id);
  if (!todo) throw new RuleViolation("NOT_FOUND", "todo not found");
  if (todo.status !== "pending") {
    throw new RuleViolation("NOT_PENDING", `cannot complete from ${todo.status}`);
  }
  todo.status = "done";
  todo.completedAt = Date.now();
  return todo;
}

export function archiveTodo(state, id) {
  const todo = state.todos.get(id);
  if (!todo) throw new RuleViolation("NOT_FOUND", "todo not found");
  if (TERMINAL_STATUSES.has(todo.status)) {
    throw new RuleViolation("ALREADY_TERMINAL", `cannot archive from ${todo.status}`);
  }
  todo.status = "archived";
  todo.archivedAt = Date.now();
  return todo;
}

export function reviveTodo(state, id) {
  const todo = state.todos.get(id);
  if (!todo) throw new RuleViolation("NOT_FOUND", "todo not found");
  if (todo.status !== "expired") {
    throw new RuleViolation("NOT_EXPIRED", `cannot revive from ${todo.status}`);
  }
  if (Date.now() - todo.expiredAt > REVIVE_GRACE_MS) {
    throw new RuleViolation("REVIVE_WINDOW_PASSED", "revive grace window has passed");
  }
  todo.status = "pending";
  todo.expiredAt = null;
  return todo;
}

export function expireOverdue(state) {
  // Sweep: any pending todo with a due date in the past becomes expired.
  const expired = [];
  for (const todo of state.todos.values()) {
    if (todo.status !== "pending") continue;
    if (todo.dueAt && todo.dueAt <= Date.now()) {
      todo.status = "expired";
      todo.expiredAt = Date.now();
      expired.push(todo);
    }
  }
  return expired;
}
