/**
 * Same assumed rates as estimator-demo: no official TypeSafe price is published,
 * and the rates sit high on purpose so the cap trips before real spend does.
 * $15 / 1M input tokens, $60 / 1M output tokens.
 */
export class SpendPolicy {
  private constructor() {}

  static readonly inputUsdPerMillion = 15;
  static readonly outputUsdPerMillion = 60;
  static readonly defaultBudgetUsd = 2;
  static readonly defaultIpCallsPerHour = 30;

  static estimatedUsd(inputTokens: number, outputTokens: number): number {
    const input = Math.max(0, SpendPolicy.finite(inputTokens)) * SpendPolicy.inputUsdPerMillion / 1_000_000;
    const output = Math.max(0, SpendPolicy.finite(outputTokens)) * SpendPolicy.outputUsdPerMillion / 1_000_000;
    return SpendPolicy.round6(input + output);
  }

  static utcDay(now = Date.now()): string {
    return new Date(now).toISOString().slice(0, 10);
  }

  static utcHour(now = Date.now()): string {
    return new Date(now).toISOString().slice(0, 13);
  }

  /** Blank uses the default. A negative or non-numeric value is unusable (fail closed). */
  static budgetUsd(raw: string | undefined): number | null {
    if (raw === undefined || raw.trim() === "") return SpendPolicy.defaultBudgetUsd;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0) return null;
    return value;
  }

  /** `0` turns the per-IP limit off. A non-numeric value is unusable (fail closed). */
  static ipLimit(raw: string | undefined): number | null {
    if (raw === undefined || raw.trim() === "") return SpendPolicy.defaultIpCallsPerHour;
    const value = Number(raw);
    if (!Number.isFinite(value)) return null;
    if (value <= 0) return 0;
    return Math.floor(value);
  }

  static clientIp(header: string | undefined): string {
    const cleaned = (header ?? "").trim().replace(/[^a-zA-Z0-9.:]/g, "").slice(0, 64);
    return cleaned || "unknown";
  }

  static round6(value: number): number {
    return Math.round(value * 1_000_000) / 1_000_000;
  }

  private static finite(value: number): number {
    return Number.isFinite(value) ? value : 0;
  }
}
