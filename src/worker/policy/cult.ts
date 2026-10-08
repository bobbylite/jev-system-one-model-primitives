import { Answers } from "../jev/answers";
import type { JevAnswer, ScoreQuestion } from "../jev/types";

const group = "`group`";

/**
 * How much of a cult is it? Six Scores plus one holistic Score.
 * Weights, tiers, and wording match the former `cult.py`.
 * The composite is the weighted mean the Cult tab already applies.
 */
export class Cult {
  private constructor() {}

  static readonly examples = [
    "CrossFit",
    "Apple fans",
    "A book club",
    "Trader Joe's loyalists",
    "Peloton",
    "Star Trek conventions",
    "A sourdough baking club",
    "A startup with a 'family' culture",
    "Disney adults",
    "A Tuesday pub quiz team",
  ] as const;

  static readonly defaultWeights: Record<string, number> = {
    devotion: 1.0,
    jargon: 0.6,
    rituals: 0.8,
    leader: 1.2,
    exit_cost: 1.4,
    evangelism: 0.8,
  };

  /** Upper bound of the composite (0..1) is exclusive, matching `v < tier.max`. */
  static readonly tiers = [
    { max: 0.2, label: "Ordinary hobby" },
    { max: 0.4, label: "Enthusiastic community" },
    { max: 0.6, label: "Tight-knit tribe" },
    { max: 0.8, label: "Cult-adjacent" },
    { max: 1.01, label: "Full cult" },
  ] as const;

  static readonly questions: Record<string, ScoreQuestion> = {
    devotion: {
      type: "score",
      instructions: `How central is ${group} to its members' identity?`,
      criteria: [
        "A casual pastime; members drop in and out and have other identities",
        "A real interest members enjoy and talk about, but it is one part of their life",
        "Members introduce themselves by it and plan their weeks around it",
        "It is the core of who members are; their friends, schedule, and spending revolve around it",
      ],
    },
    jargon: {
      type: "score",
      instructions: `How much private insider language, slang, or in-jokes does ${group} use?`,
      criteria: [
        "Everyday vocabulary; an outsider follows along easily",
        "Some specialist terms that outsiders can pick up quickly",
        "A dense vocabulary of acronyms and slang that confuses newcomers",
        "A distinct private language, with renamed ordinary things and words that mark who belongs",
      ],
    },
    rituals: {
      type: "score",
      instructions: `How many rituals, uniforms, or initiation rites does ${group} have?`,
      criteria: [
        "None; people just show up",
        "A few light traditions, such as a team cheer or a signature drink",
        "Regular rituals, a recognizable look, and a clear way new members are welcomed in",
        "Elaborate ceremonies, uniforms or symbols, and formal initiation steps that members take seriously",
      ],
    },
    leader: {
      type: "score",
      instructions: `How much does ${group} revolve around revered founder or leader figures?`,
      criteria: [
        "No particular leader; the group is run by committee or by nobody",
        "Respected organizers or well-known figures, but members freely disagree with them",
        "A famous founder or leader whose sayings are often quoted and rarely questioned",
        "A charismatic leader treated as uniquely wise or special; criticizing them is taboo",
      ],
    },
    exit_cost: {
      type: "score",
      instructions: `How socially or financially costly is it to leave ${group}?`,
      criteria: [
        "None; people leave and nobody notices",
        "Mild awkwardness; a few friends might ask where you went",
        "Real costs: lost friendships, sunk fees, or teasing from former friends",
        "Leaving means being shunned, losing your community, or giving up money or status you cannot get back",
      ],
    },
    evangelism: {
      type: "score",
      instructions: `How hard do members of ${group} push outsiders to join?`,
      criteria: [
        "Not at all; members rarely mention it",
        "Members happily answer questions if asked",
        "Members regularly try to bring friends and recommend it unprompted",
        "Relentless recruiting; members treat non-members as people who need saving",
      ],
    },
    overall: {
      type: "score",
      instructions: `Taken as a whole, how much does ${group} behave like a cult?`,
      criteria: [
        "Ordinary hobby or interest group",
        "Enthusiastic community",
        "Tight-knit tribe with strong identity",
        "Cult-adjacent; many hallmarks of a cult",
        "A full cult",
      ],
    },
  };

  static readonly dimensions = Object.keys(Cult.questions).filter((id) => id !== "overall");

  static composite(
    dimensions: readonly { id: string; score: number; max_level: number }[],
    weights: Record<string, number>,
  ): number {
    let numerator = 0;
    let denominator = 0;
    for (const dimension of dimensions) {
      const weight = weights[dimension.id] ?? 0;
      numerator += weight * (dimension.score / dimension.max_level);
      denominator += weight;
    }
    return denominator ? numerator / denominator : 0;
  }

  static tier(value: number, tiers: readonly { max: number; label: string }[] = Cult.tiers): string {
    const found = tiers.find((entry) => value < entry.max) ?? tiers[tiers.length - 1];
    return found?.label ?? "";
  }

  static config() {
    return {
      examples: [...Cult.examples],
      weights: Cult.defaultWeights,
      tiers: Cult.tiers.map((entry) => ({ max: entry.max, label: entry.label })),
      dimensions: Cult.dimensions.map((id) => ({ id, instructions: Cult.questions[id]?.instructions ?? "" })),
    };
  }

  static result(group: string, answers: Record<string, JevAnswer>, latencyMs: number) {
    const dimensions = Cult.dimensions.map((id) => Cult.dimension(id, answers));
    return { group, dimensions, overall: Cult.dimension("overall", answers), latency_ms: latencyMs };
  }

  private static requireLevelKeys(probabilities: Record<string, number>): void {
    for (const key of Object.keys(probabilities)) {
      if (!/^\d+$/.test(key)) throw new Error(`Bad score level key ${key}`);
    }
  }

  private static dimension(id: string, answers: Record<string, JevAnswer>) {
    const question = Cult.questions[id];
    if (!question) throw new Error(`Unknown cult question ${id}`);
    const answer = Answers.score(answers, id);
    Cult.requireLevelKeys(answer.probabilities);
    const levels = question.criteria.map((description, level) => ({
      level,
      description: String(description),
      probability: Answers.levelProbability(answer.probabilities, level),
    }));
    return {
      id,
      instructions: question.instructions,
      score: answer.score,
      max_level: question.criteria.length - 1,
      confidence: answer.confidence,
      levels,
    };
  }
}
