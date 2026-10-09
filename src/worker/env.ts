/** Worker bindings. Secrets stay out of wrangler.jsonc; local values live in `.dev.vars`. */
export interface Env {
  /** Worker secret. Unset on purpose until PingOne login exists. */
  TYPESAFE_API_KEY?: string;
  /**
   * Local only. `"true"` returns canned Jev answers under wrangler dev.
   * Ignored when the request carries edge `cf-ray` / `cf`, so a production
   * var or secret of the same name cannot turn the mock on.
   */
  JEV_MOCK?: string;
  /** Plain var. Shared estimated Jev spend for a UTC day, in dollars. Default 2. */
  JEV_DAILY_BUDGET_USD?: string;
  /** Plain var. Jev POSTs per IP per UTC hour. `0` disables. Default 30. */
  JEV_IP_CALLS_PER_HOUR?: string;
  /** SQLite Durable Object. Missing binding fails closed. */
  SPEND?: DurableObjectNamespace;
}
