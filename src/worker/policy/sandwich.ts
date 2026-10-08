import { Answers } from "../jev/answers";
import type { JevAnswer, NoulQuestion } from "../jev/types";

export type SandwichLabel = "SANDWICH" | "NOT A SANDWICH" | "CONTESTED";

export interface SandwichExplanation {
  label: SandwichLabel;
  score: number;
  structural: number;
  pieces_factor: number;
}

/**
 * Is it a sandwich? Five Nouls, then a policy this class owns.
 * Numbers and wording match the former `sandwich.py`.
 */
export class Sandwich {
  private constructor() {}

  static readonly foods = [
    "BLT",
    "hot dog",
    "burrito",
    "pop-tart",
    "pizza",
    "open-faced tuna melt",
    "hamburger",
    "ice cream sandwich",
    "taco",
    "cheese sandwich",
  ] as const;

  static readonly structuralWeight = 0.6;
  static readonly nameWeight = 0.4;
  static readonly sandwichAt = 0.65;
  static readonly notSandwichAt = 0.35;

  static readonly questions: Record<string, NoulQuestion> = {
    bread: {
      type: "noul",
      instructions: "Does `food` contain bread (sliced bread, a bun, a roll, or similar baked bread) as its casing?",
      criteria: {
        true: "Made with sliced bread, a bun, roll, baguette, or similar bread",
        false: "No bread: tortilla, pastry, dough crust, cookie, or no wrapper at all",
      },
    },
    filling: {
      type: "noul",
      instructions: "Does `food` have a distinct filling placed between or on top of its bread or bread-like pieces?",
    },
    two_pieces: {
      type: "noul",
      instructions:
        "Is `food` built from two or more separate pieces of bread-like casing, rather than a single folded or rolled piece?",
    },
    handheld: {
      type: "noul",
      instructions: "Is `food` normally eaten by hand?",
    },
    sandwich_by_name: {
      type: "noul",
      instructions: "Would most people, at a casual lunch counter, simply call `food` a sandwich?",
    },
  };

  static explain(probabilities: Record<string, number>): SandwichExplanation {
    const pieces = Math.max(Sandwich.read(probabilities, "two_pieces"), 0.5);
    const structural =
      Sandwich.read(probabilities, "bread") *
      Sandwich.read(probabilities, "filling") *
      Sandwich.read(probabilities, "handheld") *
      pieces;
    const score = Sandwich.structuralWeight * structural + Sandwich.nameWeight * Sandwich.read(probabilities, "sandwich_by_name");
    let label: SandwichLabel;
    if (score >= Sandwich.sandwichAt) label = "SANDWICH";
    else if (score <= Sandwich.notSandwichAt) label = "NOT A SANDWICH";
    else label = "CONTESTED";
    return { label, score, structural, pieces_factor: pieces };
  }

  static verdict(probabilities: Record<string, number>): readonly [SandwichLabel, number] {
    const explained = Sandwich.explain(probabilities);
    return [explained.label, explained.score];
  }

  static probabilities(answers: Record<string, JevAnswer>): Record<string, number> {
    const out: Record<string, number> = {};
    for (const id of Object.keys(Sandwich.questions)) out[id] = Answers.noul(answers, id);
    return out;
  }

  static signals(probabilities: Record<string, number>) {
    return Object.keys(Sandwich.questions).map((id) => Sandwich.signal(id, Sandwich.read(probabilities, id)));
  }

  static config() {
    return {
      examples: [...Sandwich.foods],
      policy: {
        structural_weight: Sandwich.structuralWeight,
        name_weight: Sandwich.nameWeight,
        sandwich_at: Sandwich.sandwichAt,
        not_sandwich_at: Sandwich.notSandwichAt,
      },
      questions: Object.keys(Sandwich.questions).map((id) => {
        const signal = Sandwich.signal(id, 0);
        return {
          id: signal.id,
          instructions: signal.instructions,
          true_criterion: signal.true_criterion,
          false_criterion: signal.false_criterion,
        };
      }),
    };
  }

  private static signal(id: string, probability: number) {
    const question = Sandwich.questions[id];
    if (!question) throw new Error(`Unknown sandwich question ${id}`);
    return {
      id,
      instructions: question.instructions,
      true_criterion: question.criteria?.true ?? null,
      false_criterion: question.criteria?.false ?? null,
      probability,
    };
  }

  private static read(probabilities: Record<string, number>, id: string): number {
    const value = probabilities[id];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new Error(`Missing probability for ${id}`);
    }
    return value;
  }
}
