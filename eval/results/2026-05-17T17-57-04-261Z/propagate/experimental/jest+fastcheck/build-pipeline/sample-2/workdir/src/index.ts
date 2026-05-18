/**
 * Application entrypoint.
 *
 * Exposes a Store and a small router-style API for the build-pipeline app.
 * Not intended to run as a server; only readable so the distill skill
 * sees a coherent codebase.
 */
import { Store } from "./models.js";

export interface Route<TBody = unknown, TResponse = unknown> {
  method: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
  handler: (body: TBody) => TResponse;
}

export class Router {
  routes: Route[] = [];

  register<TBody, TResponse>(
    method: Route["method"],
    path: string,
    handler: (body: TBody) => TResponse,
  ): void {
    this.routes.push({ method, path, handler: handler as Route["handler"] });
  }
}

export const store = new Store();
export const router = new Router();

// Side-effect imports register routes on the router.
import "./routes.js";
