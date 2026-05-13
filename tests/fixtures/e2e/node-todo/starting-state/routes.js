// HTTP route handlers. Each route maps a request to a service function
// and translates RuleViolation errors into HTTP status codes.
//
// Routes:
//   POST   /todos              create
//   GET    /todos/:id          read
//   POST   /todos/:id/complete complete
//   POST   /todos/:id/archive  archive
//   POST   /todos/:id/revive   revive (only from expired, within grace)
//   POST   /todos/expire       sweep overdue (admin/cron)

import {
  createTodo,
  completeTodo,
  archiveTodo,
  reviveTodo,
  expireOverdue,
  RuleViolation,
} from "./service.js";

const STATUS_BY_CODE = {
  TITLE_REQUIRED: 400,
  DUE_IN_PAST: 400,
  NOT_FOUND: 404,
  NOT_PENDING: 409,
  ALREADY_TERMINAL: 409,
  NOT_EXPIRED: 409,
  REVIVE_WINDOW_PASSED: 410,
};

function send(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function asRule(handler) {
  return async (req, res, ...args) => {
    try {
      const result = await handler(req, res, ...args);
      if (result !== undefined) send(res, 200, result);
    } catch (e) {
      if (e instanceof RuleViolation) {
        send(res, STATUS_BY_CODE[e.code] ?? 422, { code: e.code, message: e.message });
      } else {
        send(res, 500, { code: "INTERNAL", message: String(e) });
      }
    }
  };
}

export function buildRoutes(state) {
  return {
    "POST /todos": asRule(async (req) => {
      const body = await readJson(req);
      return createTodo(state, body);
    }),

    "GET /todos/:id": asRule(async (_req, _res, params) => {
      const todo = state.todos.get(Number(params.id));
      if (!todo) throw new RuleViolation("NOT_FOUND", "todo not found");
      return todo;
    }),

    "POST /todos/:id/complete": asRule(async (_req, _res, params) =>
      completeTodo(state, Number(params.id))
    ),

    "POST /todos/:id/archive": asRule(async (_req, _res, params) =>
      archiveTodo(state, Number(params.id))
    ),

    "POST /todos/:id/revive": asRule(async (_req, _res, params) =>
      reviveTodo(state, Number(params.id))
    ),

    "POST /todos/expire": asRule(async () => ({
      expired: expireOverdue(state).map((t) => t.id),
    })),
  };
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf-8") || "{}");
}
