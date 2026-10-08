import { describe, expect, it } from "vitest";
import { Chaos } from "../src/worker/policy/chaos";
import { Cult } from "../src/worker/policy/cult";
import { Sandwich } from "../src/worker/policy/sandwich";

/**
 * Golden numbers below were produced by the Python `explain()` function
 * (and the same arithmetic for the cult composite and chaos priority)
 * before those modules were removed. JavaScript uses the same IEEE doubles.
 */
describe("sandwich policy", () => {
  const cases: { probabilities: Record<string, number>; label: string; score: number; structural: number; pieces_factor: number }[] = [
    {
      probabilities: { bread: 1, filling: 1, two_pieces: 1, handheld: 1, sandwich_by_name: 0.125 },
      label: "SANDWICH",
      score: 0.65,
      structural: 1,
      pieces_factor: 1,
    },
    {
      probabilities: { bread: 1, filling: 1, two_pieces: 1, handheld: 1, sandwich_by_name: 0 },
      label: "CONTESTED",
      score: 0.6,
      structural: 1,
      pieces_factor: 1,
    },
    {
      probabilities: { bread: 0, filling: 0, two_pieces: 0, handheld: 0, sandwich_by_name: 0.875 },
      label: "CONTESTED",
      score: 0.35000000000000003,
      structural: 0,
      pieces_factor: 0.5,
    },
    {
      probabilities: { bread: 0, filling: 1, two_pieces: 0.2, handheld: 1, sandwich_by_name: 0 },
      label: "NOT A SANDWICH",
      score: 0,
      structural: 0,
      pieces_factor: 0.5,
    },
    {
      probabilities: { bread: 0.99, filling: 0.99, two_pieces: 0.99, handheld: 0.99, sandwich_by_name: 0.99 },
      label: "SANDWICH",
      score: 0.972357606,
      structural: 0.96059601,
      pieces_factor: 0.99,
    },
    {
      probabilities: { bread: 0.5, filling: 0.5, two_pieces: 0.5, handheld: 0.5, sandwich_by_name: 0.5 },
      label: "NOT A SANDWICH",
      score: 0.23750000000000002,
      structural: 0.0625,
      pieces_factor: 0.5,
    },
    {
      probabilities: { bread: 0.8, filling: 0.7, two_pieces: 0.2, handheld: 0.9, sandwich_by_name: 0.4 },
      label: "NOT A SANDWICH",
      score: 0.31120000000000003,
      structural: 0.252,
      pieces_factor: 0.5,
    },
    {
      probabilities: { bread: 1, filling: 1, two_pieces: 0.49, handheld: 1, sandwich_by_name: 0.125 },
      label: "NOT A SANDWICH",
      score: 0.35,
      structural: 0.5,
      pieces_factor: 0.5,
    },
  ];

  it.each(cases)("matches Python explain for $label @ $score", (row) => {
    expect(Sandwich.explain(row.probabilities)).toEqual({
      label: row.label,
      score: row.score,
      structural: row.structural,
      pieces_factor: row.pieces_factor,
    });
    expect(Sandwich.verdict(row.probabilities)).toEqual([row.label, row.score]);
  });

  it("keeps the published weights and cutoffs", () => {
    expect(Sandwich.structuralWeight).toBe(0.6);
    expect(Sandwich.nameWeight).toBe(0.4);
    expect(Sandwich.sandwichAt).toBe(0.65);
    expect(Sandwich.notSandwichAt).toBe(0.35);
  });
});

describe("cult policy", () => {
  const dims = [
    { id: "devotion", score: 3, max_level: 3 },
    { id: "jargon", score: 2, max_level: 3 },
    { id: "rituals", score: 1.5, max_level: 3 },
    { id: "leader", score: 2.4, max_level: 3 },
    { id: "exit_cost", score: 0, max_level: 3 },
    { id: "evangelism", score: 3, max_level: 3 },
  ];

  it("weights and tier bounds match cult.py", () => {
    expect(Cult.defaultWeights).toEqual({
      devotion: 1, jargon: 0.6, rituals: 0.8, leader: 1.2, exit_cost: 1.4, evangelism: 0.8,
    });
    expect(Cult.tiers.map((tier) => [tier.max, tier.label])).toEqual([
      [0.2, "Ordinary hobby"],
      [0.4, "Enthusiastic community"],
      [0.6, "Tight-knit tribe"],
      [0.8, "Cult-adjacent"],
      [1.01, "Full cult"],
    ]);
  });

  it("composite matches the weighted mean", () => {
    expect(Cult.composite(dims, Cult.defaultWeights)).toBe(0.6137931034482759);
    expect(Cult.tier(0.6137931034482759)).toBe("Cult-adjacent");
    expect(Cult.composite([], {})).toBe(0);
  });

  it("tier bounds are exclusive on the way the UI compares them", () => {
    expect(Cult.tier(0)).toBe("Ordinary hobby");
    expect(Cult.tier(0.199999)).toBe("Ordinary hobby");
    expect(Cult.tier(0.2)).toBe("Enthusiastic community");
    expect(Cult.tier(0.4)).toBe("Tight-knit tribe");
    expect(Cult.tier(0.6)).toBe("Cult-adjacent");
    expect(Cult.tier(0.8)).toBe("Full cult");
    expect(Cult.tier(1)).toBe("Full cult");
    expect(Cult.tier(1.01)).toBe("Full cult");
  });
});

describe("chaos policy", () => {
  it("keeps the published cutoff and blend", () => {
    expect(Chaos.confidenceAt).toBe(0.7);
    expect(Chaos.urgencyWeight).toBe(0.65);
    expect(Chaos.angerWeight).toBe(0.35);
    expect(Chaos.priorityCuts).toEqual([0.6, 0.3]);
  });

  it("priority cuts are inclusive, matching the Chaos tab", () => {
    expect(Chaos.priority(0, 3, 0)).toEqual({ u: 0, v: 0, level: "P3" });
    expect(Chaos.priority(3, 3, 1)).toEqual({ u: 1, v: 1, level: "P1" });
    expect(Chaos.priority(1.5, 3, 0.5)).toEqual({ u: 0.5, v: 0.5, level: "P2" });
    expect(Chaos.priority(0.6 / 0.65 * 3, 3, 0)).toEqual({ u: 0.923076923076923, v: 0.6, level: "P1" });
    expect(Chaos.priority(0, 3, 0.3 / 0.35).level).toBe("P2");
    expect(Chaos.priority(1, 3, 0)).toEqual({
      u: 0.3333333333333333,
      v: 0.21666666666666667,
      level: "P3",
    });
  });

  it("auto-routes at exactly 0.70 confidence", () => {
    expect(Chaos.autoRoute(0.699999)).toBe(false);
    expect(Chaos.autoRoute(0.7)).toBe(true);
    expect(Chaos.autoRoute(0.71)).toBe(true);
  });
});
