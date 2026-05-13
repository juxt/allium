// Minimal HTTP server. Wires routes from routes.js to a node:http
// listener. No express dependency — keeps the fixture build-free.

import { createServer } from "http";
import { buildRoutes } from "./routes.js";

const PORT = Number(process.env.PORT ?? 3000);

const state = {
  todos: new Map(),
  nextId: 1,
};

const routes = buildRoutes(state);

const server = createServer((req, res) => {
  const route = `${req.method} ${req.url.split("?")[0]}`;

  // Try exact-match first.
  if (routes[route]) {
    return routes[route](req, res, {});
  }

  // Then parameterised routes.
  for (const [pattern, handler] of Object.entries(routes)) {
    const match = matchRoute(pattern, route);
    if (match) return handler(req, res, match);
  }

  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ code: "ROUTE_NOT_FOUND", message: route }));
});

function matchRoute(pattern, actual) {
  const [pMethod, pPath] = pattern.split(" ");
  const [aMethod, aPath] = actual.split(" ");
  if (pMethod !== aMethod) return null;

  const pParts = pPath.split("/");
  const aParts = aPath.split("/");
  if (pParts.length !== aParts.length) return null;

  const params = {};
  for (let i = 0; i < pParts.length; i++) {
    if (pParts[i].startsWith(":")) {
      params[pParts[i].slice(1)] = aParts[i];
    } else if (pParts[i] !== aParts[i]) {
      return null;
    }
  }
  return params;
}

server.listen(PORT, () => {
  console.log(`todo backend listening on :${PORT}`);
});
