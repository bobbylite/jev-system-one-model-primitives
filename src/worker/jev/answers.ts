import type { ChoiceAnswer, JevAnswer, ScoreAnswer } from "./types";

/** Reads one typed answer. A bad payload becomes a 502 in the route. */
export class Answers {
  static noul(answers: Record<string, JevAnswer>, id: string): number {
    const answer = answers[id];
    if (!answer || answer.type !== "noul" || !Answers.finite(answer.noul)) {
      throw new Error(`Missing noul answer for ${id}`);
    }
    return answer.noul;
  }

  static choice(answers: Record<string, JevAnswer>, id: string): ChoiceAnswer {
    const answer = answers[id];
    if (!answer || answer.type !== "choice" || typeof answer.choice !== "string" || !Answers.finite(answer.confidence)) {
      throw new Error(`Missing choice answer for ${id}`);
    }
    if (!answer.probabilities || typeof answer.probabilities !== "object") {
      throw new Error(`Missing choice probabilities for ${id}`);
    }
    return answer;
  }

  static score(answers: Record<string, JevAnswer>, id: string): ScoreAnswer {
    const answer = answers[id];
    if (!answer || answer.type !== "score" || !Answers.finite(answer.score) || !Answers.finite(answer.confidence)) {
      throw new Error(`Missing score answer for ${id}`);
    }
    if (!answer.probabilities || typeof answer.probabilities !== "object") {
      throw new Error(`Missing score probabilities for ${id}`);
    }
    return answer;
  }

  /** JSON object keys arrive as strings. `int(k)` in the Python app rejects anything else. */
  static levelProbability(probabilities: Record<string, number>, level: number): number {
    const raw = probabilities[String(level)];
    if (raw === undefined) return 0;
    if (!Answers.finite(raw)) throw new Error(`Bad probability for level ${level}`);
    return raw;
  }

  static optionProbability(probabilities: Record<string, number>, id: string): number {
    const raw = probabilities[id];
    if (raw === undefined) return 0;
    if (!Answers.finite(raw)) throw new Error(`Bad probability for ${id}`);
    return raw;
  }

  private static finite(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value);
  }
}
