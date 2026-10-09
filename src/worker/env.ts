/** Worker bindings. Secrets stay out of wrangler.jsonc; local values live in `.dev.vars`. */
export interface Env {
  /** Worker secret. Never sent to the browser. */
  TYPESAFE_API_KEY?: string;
  /**
   * Local only. `"true"` returns canned Jev answers under wrangler dev.
   * Ignored when the request carries an edge `cf-ray`, so a production
   * var or secret of the same name cannot turn the mock on.
   */
  JEV_MOCK?: string;
  /** Plain var. Shared estimated Jev spend for a UTC day, in dollars. Default 2. */
  JEV_DAILY_BUDGET_USD?: string;
  /** Plain var. Jev POSTs per IP per UTC hour. `0` disables. Default 30. */
  JEV_IP_CALLS_PER_HOUR?: string;
  /** SQLite Durable Object. Missing binding fails closed. */
  SPEND?: DurableObjectNamespace;
  /** Login flows and sessions. Also holds the per-user Jev counters. */
  SESSIONS?: KVNamespace;
  /**
   * `"true"` uses the in-process PingOne stand-in.
   * Ignored on the edge the same way `JEV_MOCK` is.
   */
  PINGONE_MOCK?: string;
  PINGONE_ENV_ID?: string;
  PINGONE_AUTH_HOST?: string;
  PINGONE_CLIENT_ID?: string;
  /** Worker secret. Never commit or log this. */
  PINGONE_CLIENT_SECRET?: string;
  /** Sent on authorize and on the token request, or omitted when blank. */
  PINGONE_REDIRECT_URI?: string;
  PINGONE_SCOPES?: string;
  /** Plain Worker vars, not secrets. `"true"` limits Jev calls to the pilot group. */
  AI_PILOT_GATE_ENABLED?: string;
  AI_PILOT_GROUP?: string;
  AI_PILOT_GROUPS_CLAIM?: string;
  AI_USER_CALLS_PER_HOUR?: string;
  AI_USER_TOKENS_PER_DAY?: string;
  /** Read by the ported pilot helper. The live cap is `JEV_DAILY_BUDGET_USD` on the Durable Object. */
  AI_DAILY_BUDGET_USD?: string;
}
