/** Worker bindings. Secrets stay out of wrangler.jsonc; local values live in `.dev.vars`. */
export interface Env {
  /** Worker secret. Same name the Python app read from the environment. */
  TYPESAFE_API_KEY?: string;
  /**
   * Local only. `"true"` returns canned Jev answers and does not call the network.
   * Never set this on the deployed Worker.
   */
  JEV_MOCK?: string;
}
