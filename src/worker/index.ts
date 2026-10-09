import { Hono } from "hono";
import { aiGateCovers } from "./ai/access";
import { authFailureBody } from "./auth/fault";
import { AuthFlowError, type SessionRecord } from "./auth/types";
import type { Env } from "./env";
import { ErrorBody } from "./http";
import { ApiRoutes } from "./routes/api";
import { authRoutes, enforcePilotMember, requireUser } from "./routes/auth";

export { SpendLedger } from "./spend/ledger";

type AppEnv = { Bindings: Env; Variables: { session?: SessionRecord } };

const app = new Hono<AppEnv>();

app.use("*", async (c, next) => {
  await next();
  c.header("x-content-type-options", "nosniff");
  c.header("referrer-policy", "same-origin");
  c.header("x-frame-options", "DENY");
});

/**
 * Session and pilot membership run on this router, in front of every Jev
 * call. Config reads stay open because `aiGateCovers` skips them.
 */
export const api = new Hono<AppEnv>();

api.use("*", async (c, next) => {
  if (aiGateCovers(new URL(c.req.url).pathname)) {
    const session = await requireUser(c);
    c.set("session", await enforcePilotMember(c.env, session, c.req.raw));
  }
  await next();
});

api.route("/auth", authRoutes);
ApiRoutes.mount(api);
api.notFound((c) => c.json({ detail: "Not found" }, 404));
api.onError((err) => fail(err));

app.route("/api", api);
app.notFound((c) => c.json({ detail: "Not found" }, 404));
app.onError((err) => fail(err));

function fail(err: unknown): Response {
  if (err instanceof AuthFlowError) {
    const body = authFailureBody(err);
    return Response.json({ detail: body.error, ...body }, { status: err.status });
  }
  return ErrorBody.from(err);
}

export default app;
