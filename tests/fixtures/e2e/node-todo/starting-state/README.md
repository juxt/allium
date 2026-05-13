# node-todo fixture

Small Node.js todo backend used as the input to Tier 4 end-to-end evals (`distill` → `tend` → `propagate`). Plain ES modules, no `package.json`, no build step, no dependencies beyond Node's stdlib.

## Domain

A todo lifecycle:

```
pending ──complete──▶ done       (terminal)
pending ──archive───▶ archived   (terminal)
pending ──expire────▶ expired ──revive (within grace window)──▶ pending
```

`done` and `archived` are terminal. `expired` is recoverable for `REVIVE_GRACE_MS` (7 days), after which the revive endpoint returns 410 Gone.

## Layout

| File | Purpose |
| --- | --- |
| `models.js` | Entity shape + status constants |
| `service.js` | Business rules: createTodo / completeTodo / archiveTodo / reviveTodo / expireOverdue. Throws `RuleViolation` on invariant breach |
| `routes.js` | HTTP route handlers; maps `RuleViolation.code` to HTTP status |
| `server.js` | `node:http` listener, parameterised routing |

## Why these particular shapes

The fixture is intentionally rich in spec-relevant features: a status enum with a non-trivial graph (terminal states, a recoverable terminal-ish state with a time window), validation rules that produce distinct error codes, a sweep operation (`expireOverdue`) that mutates many entities at once, and HTTP surfaces with both URL params and body payloads. Distill should pick up entities, surfaces, rules and a config value (`REVIVE_GRACE_MS`).

## Not included intentionally

- No persistence layer (in-memory `Map`). Distill should not invent a Database entity.
- No auth middleware. Distill should not infer user-management rules from `ownerId` alone.
- No tests. Propagate generates these.
