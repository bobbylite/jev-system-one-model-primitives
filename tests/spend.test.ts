import { describe, expect, it } from "vitest";
import { SpendPolicy } from "../src/worker/spend/policy";
import { SpendTables, type StatementRunner } from "../src/worker/spend/tables";

const noon = Date.UTC(2026, 9, 8, 12, 0, 0);

async function open(): Promise<{ sql: StatementRunner; usd: (day?: string) => number | undefined; hits: (ip: string) => number }> {
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(":memory:");
  const sql: StatementRunner = {
    exec(query, ...bindings) {
      const statement = db.prepare(query);
      if (query.trim().toUpperCase().startsWith("SELECT")) {
        const rows = statement.all(...bindings);
        return { toArray: () => rows };
      }
      statement.run(...bindings);
      return { toArray: () => [] };
    },
  };
  SpendTables.ensure(sql);
  return {
    sql,
    usd: (day = "2026-10-08") => {
      const rows = db.prepare("SELECT usd FROM daily WHERE day = ?").all(day);
      const value = rows[0]?.usd;
      return typeof value === "number" ? value : undefined;
    },
    hits: (ip: string) => {
      const rows = db.prepare("SELECT hits FROM ip_hour WHERE ip = ? AND hour = ?").all(ip, "2026-10-08T12");
      const value = rows[0]?.hits;
      return typeof value === "number" ? value : 0;
    },
  };
}

describe("spend cost model", () => {
  it("matches the estimator-demo rates", () => {
    expect(SpendPolicy.estimatedUsd(0, 0)).toBe(0);
    expect(SpendPolicy.estimatedUsd(1_000_000, 0)).toBe(15);
    expect(SpendPolicy.estimatedUsd(0, 1_000_000)).toBe(60);
    expect(SpendPolicy.estimatedUsd(1_000_000, 1_000_000)).toBe(75);
    expect(SpendPolicy.estimatedUsd(1000, 500)).toBe(0.045);
    expect(SpendPolicy.estimatedUsd(-5, 10)).toBe(0.0006);
    expect(SpendPolicy.inputUsdPerMillion).toBe(15);
    expect(SpendPolicy.outputUsdPerMillion).toBe(60);
  });

  it("resets the day at midnight UTC", () => {
    expect(SpendPolicy.utcDay(Date.UTC(2026, 9, 8, 23, 59))).toBe("2026-10-08");
    expect(SpendPolicy.utcDay(Date.UTC(2026, 9, 9, 0, 0))).toBe("2026-10-09");
    expect(SpendPolicy.budgetUsd(undefined)).toBe(2);
    expect(SpendPolicy.budgetUsd("2")).toBe(2);
    expect(SpendPolicy.budgetUsd("nope")).toBeNull();
    expect(SpendPolicy.budgetUsd("-1")).toBeNull();
    expect(SpendPolicy.ipLimit(undefined)).toBe(30);
    expect(SpendPolicy.ipLimit("0")).toBe(0);
    expect(SpendPolicy.ipLimit("nope")).toBeNull();
  });
});

describe("sqlite ledger", () => {
  it("lets a call under the cap through, then stores the real cost", async () => {
    const ledger = await open();
    const gate = SpendTables.gate(ledger.sql, { budgetUsd: 2, ipLimit: 30, ip: "1.2.3.4", now: noon });
    expect(gate).toEqual({ allowed: true, spentUsd: 0 });
    expect(ledger.usd()).toBe(2);
    expect(SpendTables.record(ledger.sql, 0.045, noon)).toBe(0.045);
    expect(ledger.usd()).toBe(0.045);
  });

  it("refuses at and over the cap without reserving another call", async () => {
    const atCap = await open();
    atCap.sql.exec("INSERT INTO daily (day, usd, baseline) VALUES (?, ?, NULL)", "2026-10-08", 2);
    expect(SpendTables.gate(atCap.sql, { budgetUsd: 2, ipLimit: 30, ip: "1.2.3.4", now: noon })).toEqual({
      allowed: false,
      reason: "cap",
      spentUsd: 2,
    });
    expect(atCap.hits("1.2.3.4")).toBe(0);

    const over = await open();
    over.sql.exec("INSERT INTO daily (day, usd, baseline) VALUES (?, ?, NULL)", "2026-10-08", 2.01);
    expect(SpendTables.gate(over.sql, { budgetUsd: 2, ipLimit: 30, ip: "9.9.9.9", now: noon }).reason).toBe("cap");
  });

  it("holds the budget while a call is in flight, and releases it if the call fails", async () => {
    const ledger = await open();
    SpendTables.gate(ledger.sql, { budgetUsd: 2, ipLimit: 30, ip: "1.2.3.4", now: noon });
    const second = SpendTables.gate(ledger.sql, { budgetUsd: 2, ipLimit: 30, ip: "5.5.5.5", now: noon });
    expect(second.reason).toBe("busy");
    SpendTables.release(ledger.sql, noon);
    expect(ledger.usd()).toBe(0);
    const again = SpendTables.gate(ledger.sql, { budgetUsd: 2, ipLimit: 30, ip: "5.5.5.5", now: noon });
    expect(again.allowed).toBe(true);
  });

  it("rate-limits a second call from the same IP after the first is released", async () => {
    const ledger = await open();
    SpendTables.gate(ledger.sql, { budgetUsd: 2, ipLimit: 1, ip: "1.2.3.4", now: noon });
    SpendTables.release(ledger.sql, noon);
    const limited = SpendTables.gate(ledger.sql, { budgetUsd: 2, ipLimit: 1, ip: "1.2.3.4", now: noon });
    expect(limited).toMatchObject({ allowed: false, reason: "rate" });
    const other = SpendTables.gate(ledger.sql, { budgetUsd: 2, ipLimit: 1, ip: "8.8.8.8", now: noon });
    expect(other.allowed).toBe(true);
  });

  it("drops yesterday's row so midnight UTC starts at zero", async () => {
    const ledger = await open();
    ledger.sql.exec("INSERT INTO daily (day, usd, baseline) VALUES (?, ?, NULL)", "2026-10-07", 2);
    const gate = SpendTables.gate(ledger.sql, { budgetUsd: 2, ipLimit: 30, ip: "1.2.3.4", now: noon });
    expect(gate.allowed).toBe(true);
    expect(gate.spentUsd).toBe(0);
    expect(ledger.usd("2026-10-07")).toBeUndefined();
  });

  it("throws on a corrupt row so the caller can fail closed", async () => {
    const ledger = await open();
    ledger.sql.exec("INSERT INTO daily (day, usd, baseline) VALUES (?, ?, NULL)", "2026-10-08", -1);
    expect(() => SpendTables.gate(ledger.sql, { budgetUsd: 2, ipLimit: 30, ip: "1.2.3.4", now: noon })).toThrow(/bad usd/);
  });
});
