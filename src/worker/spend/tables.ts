import { SpendPolicy } from "./policy";

export interface StatementResult {
  toArray(): readonly Record<string, unknown>[];
}

/** The slice of Durable Object SQL this ledger uses. */
export interface StatementRunner {
  exec(query: string, ...bindings: readonly (string | number | null)[]): StatementResult;
}

export type GateReason = "cap" | "busy" | "rate";

export interface GateResult {
  allowed: boolean;
  reason?: GateReason;
  spentUsd: number;
}

/**
 * One global UTC-day ledger.
 * A call under the cap reserves the rest of the budget first, so a second
 * in-flight request cannot pass, and a lost write leaves the day closed.
 */
export class SpendTables {
  private constructor() {}

  static ensure(sql: StatementRunner): void {
    sql.exec(`CREATE TABLE IF NOT EXISTS daily (
      day TEXT PRIMARY KEY,
      usd REAL NOT NULL,
      baseline REAL
    )`);
    sql.exec(`CREATE TABLE IF NOT EXISTS ip_hour (
      ip TEXT NOT NULL,
      hour TEXT NOT NULL,
      hits INTEGER NOT NULL,
      PRIMARY KEY (ip, hour)
    )`);
  }

  static gate(sql: StatementRunner, input: {
    budgetUsd: number;
    ipLimit: number;
    ip: string;
    now: number;
  }): GateResult {
    const day = SpendPolicy.utcDay(input.now);
    const hour = SpendPolicy.utcHour(input.now);
    sql.exec("DELETE FROM daily WHERE day < ?", day);
    sql.exec("DELETE FROM ip_hour WHERE hour < ?", hour);

    const row = SpendTables.one(sql, "SELECT usd, baseline FROM daily WHERE day = ?", day);
    const spent = row ? SpendTables.number(row, "usd") : 0;
    const baseline = row ? SpendTables.nullable(row, "baseline") : null;
    if (spent >= input.budgetUsd) {
      return { allowed: false, reason: baseline === null ? "cap" : "busy", spentUsd: spent };
    }
    if (input.ipLimit > 0) {
      const hits = SpendTables.hits(sql, input.ip, hour);
      if (hits >= input.ipLimit) return { allowed: false, reason: "rate", spentUsd: spent };
      SpendTables.writeHits(sql, input.ip, hour, hits + 1);
    }
    sql.exec(
      `INSERT INTO daily (day, usd, baseline) VALUES (?, ?, ?)
       ON CONFLICT(day) DO UPDATE SET usd = excluded.usd, baseline = excluded.baseline`,
      day,
      input.budgetUsd,
      spent,
    );
    return { allowed: true, spentUsd: spent };
  }

  static record(sql: StatementRunner, usd: number, now: number): number {
    const day = SpendPolicy.utcDay(now);
    const row = SpendTables.one(sql, "SELECT usd, baseline FROM daily WHERE day = ?", day);
    if (!row) throw new Error("no reservation");
    const baseline = SpendTables.nullable(row, "baseline");
    if (baseline === null) throw new Error("no reservation");
    const next = SpendPolicy.round6(baseline + Math.max(0, SpendPolicy.round6(usd)));
    sql.exec(
      `INSERT INTO daily (day, usd, baseline) VALUES (?, ?, NULL)
       ON CONFLICT(day) DO UPDATE SET usd = excluded.usd, baseline = NULL`,
      day,
      next,
    );
    return next;
  }

  static release(sql: StatementRunner, now: number): void {
    const day = SpendPolicy.utcDay(now);
    const row = SpendTables.one(sql, "SELECT usd, baseline FROM daily WHERE day = ?", day);
    if (!row) return;
    const baseline = SpendTables.nullable(row, "baseline");
    if (baseline === null) return;
    sql.exec(
      `INSERT INTO daily (day, usd, baseline) VALUES (?, ?, NULL)
       ON CONFLICT(day) DO UPDATE SET usd = excluded.usd, baseline = NULL`,
      day,
      baseline,
    );
  }

  private static hits(sql: StatementRunner, ip: string, hour: string): number {
    const row = SpendTables.one(sql, "SELECT hits FROM ip_hour WHERE ip = ? AND hour = ?", ip, hour);
    return row ? SpendTables.number(row, "hits") : 0;
  }

  private static writeHits(sql: StatementRunner, ip: string, hour: string, hits: number): void {
    sql.exec(
      `INSERT INTO ip_hour (ip, hour, hits) VALUES (?, ?, ?)
       ON CONFLICT(ip, hour) DO UPDATE SET hits = excluded.hits`,
      ip,
      hour,
      hits,
    );
  }

  private static one(sql: StatementRunner, query: string, ...bindings: (string | number | null)[]): Record<string, unknown> | undefined {
    return sql.exec(query, ...bindings).toArray()[0];
  }

  private static number(row: Record<string, unknown>, key: string): number {
    const value = row[key];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new Error(`bad ${key}`);
    return value;
  }

  private static nullable(row: Record<string, unknown>, key: string): number | null {
    const value = row[key];
    if (value === null || value === undefined) return null;
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new Error(`bad ${key}`);
    return value;
  }
}
