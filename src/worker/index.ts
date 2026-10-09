import { Hono } from "hono";
import type { Env } from "./env";
import { ErrorBody } from "./http";
import { ApiRoutes } from "./routes/api";

export { SpendLedger } from "./spend/ledger";

const app = new Hono<{ Bindings: Env }>();

app.use("*", async (c, next) => {
  await next();
  c.header("x-content-type-options", "nosniff");
  c.header("referrer-policy", "same-origin");
});

/**
 * Issue #2 drops PingOne session middleware on this router, in front of
 * every `/api` route. See estimator-demo `src/worker/routes/ai.ts`.
 */
export const api = new Hono<{ Bindings: Env }>();
ApiRoutes.mount(api);
api.notFound((c) => c.json({ detail: "Not found" }, 404));
api.onError((err) => ErrorBody.from(err));

app.route("/api", api);
app.notFound((c) => c.json({ detail: "Not found" }, 404));
app.onError((err) => ErrorBody.from(err));

export default app;
