import { describe, expect, it } from "vitest";
import { Chaos } from "../src/worker/policy/chaos";
import { Cult } from "../src/worker/policy/cult";
import { Sandwich } from "../src/worker/policy/sandwich";

describe("question wording", () => {
  it("copies the sandwich Nouls", () => {
    expect(Sandwich.questions.bread).toEqual({
      type: "noul",
      instructions: "Does `food` contain bread (sliced bread, a bun, a roll, or similar baked bread) as its casing?",
      criteria: {
        true: "Made with sliced bread, a bun, roll, baguette, or similar bread",
        false: "No bread: tortilla, pastry, dough crust, cookie, or no wrapper at all",
      },
    });
    expect(Sandwich.questions.filling?.instructions).toBe(
      "Does `food` have a distinct filling placed between or on top of its bread or bread-like pieces?",
    );
    expect(Sandwich.questions.filling?.criteria).toBeUndefined();
    expect(Sandwich.questions.two_pieces?.instructions).toBe(
      "Is `food` built from two or more separate pieces of bread-like casing, rather than a single folded or rolled piece?",
    );
    expect(Sandwich.questions.handheld?.instructions).toBe("Is `food` normally eaten by hand?");
    expect(Sandwich.questions.sandwich_by_name?.instructions).toBe(
      "Would most people, at a casual lunch counter, simply call `food` a sandwich?",
    );
    expect(Object.keys(Sandwich.questions)).toEqual(["bread", "filling", "two_pieces", "handheld", "sandwich_by_name"]);
    expect(Sandwich.foods).toEqual([
      "BLT", "hot dog", "burrito", "pop-tart", "pizza", "open-faced tuna melt",
      "hamburger", "ice cream sandwich", "taco", "cheese sandwich",
    ]);
  });

  it("copies the cult Scores, including the holistic one", () => {
    expect(Cult.dimensions).toEqual(["devotion", "jargon", "rituals", "leader", "exit_cost", "evangelism"]);
    expect(Cult.questions.devotion?.instructions).toBe("How central is `group` to its members' identity?");
    expect(Cult.questions.devotion?.criteria).toEqual([
      "A casual pastime; members drop in and out and have other identities",
      "A real interest members enjoy and talk about, but it is one part of their life",
      "Members introduce themselves by it and plan their weeks around it",
      "It is the core of who members are; their friends, schedule, and spending revolve around it",
    ]);
    expect(Cult.questions.overall?.instructions).toBe("Taken as a whole, how much does `group` behave like a cult?");
    expect(Cult.questions.overall?.criteria).toHaveLength(5);
    expect(Cult.questions.exit_cost?.criteria?.[3]).toBe(
      "Leaving means being shunned, losing your community, or giving up money or status you cannot get back",
    );
    expect(Cult.examples[0]).toBe("CrossFit");
    expect(Cult.examples).toHaveLength(10);
  });

  it("copies the chaos queues and fan-out questions", () => {
    expect(Object.keys(Chaos.queues)).toEqual([
      "billing", "bug", "feature", "access", "safety", "exorcist", "venting", "triage",
    ]);
    expect(Chaos.queues.exorcist).toEqual([
      "Needs an exorcist",
      "Paranormal, supernatural, or cursed-device reports",
    ]);
    expect(Chaos.questions.queue?.instructions).toBe(
      "Which support queue should handle this `message`? Pick the queue for the main thing the customer needs done.",
    );
    expect(Chaos.questions.queue?.type).toBe("choice");
    if (Chaos.questions.queue?.type === "choice") {
      expect(Chaos.questions.queue.criteria.billing).toBe(
        "Charges, refunds, invoices, subscriptions, pricing disputes",
      );
    }
    expect(Chaos.questions.angry?.instructions).toBe("Is the customer of this `message` angry or hostile?");
    expect(Chaos.questions.urgency?.type === "score" ? Chaos.questions.urgency.criteria : []).toEqual([
      "No deadline or consequence; fine to answer whenever",
      "Annoying, but they can keep working in the meantime",
      "A stated deadline, money at stake, or blocked from something they need today",
      "Danger, a threat, or a security problem happening right now",
    ]);
    expect(Chaos.examples[0]).toBe("My smart toaster has started whispering my passwords at 3am.");
  });
});
