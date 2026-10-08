import type { Env } from "../src/worker/env";

/** In-test stand-in for the SpendLedger binding. */
export class ScriptedSpend {
  gateBody: unknown = { allowed: true, spentUsd: 0 };
  gateStatus = 200;
  gateError: Error | null = null;
  recordStatus = 200;
  recordError: Error | null = null;
  recordedUsd: number | undefined;
  released = false;

  binding(): NonNullable<Env["SPEND"]> {
    const self = this;
    return {
      idFromName: () => "global",
      get: () => ({
        fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
          const request = new Request(input, init);
          const path = new URL(request.url).pathname;
          if (path.endsWith("/gate")) {
            if (self.gateError) throw self.gateError;
            return Response.json(self.gateBody, { status: self.gateStatus });
          }
          if (path.endsWith("/record")) {
            if (self.recordError) throw self.recordError;
            const body = await request.json() as { usd?: number };
            self.recordedUsd = body.usd;
            return Response.json({ spentUsd: body.usd ?? 0 }, { status: self.recordStatus });
          }
          if (path.endsWith("/release")) {
            self.released = true;
            return Response.json({ ok: true });
          }
          return new Response("no", { status: 404 });
        },
      }),
    } as unknown as NonNullable<Env["SPEND"]>;
  }
}
