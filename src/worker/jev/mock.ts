import type { JevQuestion, SystemOneResult } from "./types";

/**
 * LOCAL MOCK of a Jev System One response. Not TypeSafe.
 *
 * Used only when the Worker var `JEV_MOCK` is `"true"` (see `.dev.vars`).
 * It never calls the network. Do not set `JEV_MOCK` on a deployed Worker.
 * Responses are labeled with `model: "local-mock"` and the `x-jev-source` header.
 */
export class LocalJevMock {
  static readonly source = "local-mock";

  static respond(state: unknown, questions: Record<string, JevQuestion>): SystemOneResult {
    const record = state && typeof state === "object" ? (state as Record<string, unknown>) : {};
    const subject = LocalJevMock.subject(record);
    const answers: SystemOneResult["answers"] = {};
    for (const [id, question] of Object.entries(questions)) {
      answers[id] = LocalJevMock.answer(id, question, subject);
    }
    return {
      model: LocalJevMock.source,
      answers,
      usage: { input_tokens: 0, output_tokens: 0 },
    };
  }

  private static subject(record: Record<string, unknown>): { kind: "food" | "group" | "message" | "other"; text: string } {
    if (typeof record.food === "string") return { kind: "food", text: record.food };
    if (typeof record.group === "string") return { kind: "group", text: record.group };
    if (typeof record.message === "string") return { kind: "message", text: record.message };
    return { kind: "other", text: "" };
  }

  private static answer(id: string, question: JevQuestion, subject: { kind: string; text: string }) {
    if (question.type === "noul") {
      return { type: "noul" as const, noul: LocalJevMock.noul(id, subject) };
    }
    if (question.type === "score") {
      return LocalJevMock.score(question.criteria, LocalJevMock.scoreValue(id, subject));
    }
    const winner = LocalJevMock.choiceId(id, subject, question.criteria);
    return LocalJevMock.choice(question.criteria, winner);
  }

  private static noul(id: string, subject: { kind: string; text: string }): number {
    if (subject.kind === "food") return LocalJevMock.foodNoul(id, subject.text);
    if (id === "angry") return LocalJevMock.anger(subject.text);
    return 0.42;
  }

  private static foodNoul(id: string, food: string): number {
    const profile = LocalJevMock.foods[food.trim().toLowerCase()];
    return profile?.[id] ?? LocalJevMock.foods.default?.[id] ?? 0.5;
  }

  /** Hand-tuned stand-ins so each built-in example lands on a different verdict. */
  private static readonly foods: Record<string, Record<string, number> | undefined> = {
    blt: { bread: 0.99, filling: 0.99, two_pieces: 0.97, handheld: 0.99, sandwich_by_name: 0.96 },
    "hot dog": { bread: 0.85, filling: 0.95, two_pieces: 0.25, handheld: 0.99, sandwich_by_name: 0.35 },
    burrito: { bread: 0.04, filling: 0.96, two_pieces: 0.08, handheld: 0.93, sandwich_by_name: 0.06 },
    "pop-tart": { bread: 0.08, filling: 0.7, two_pieces: 0.05, handheld: 0.95, sandwich_by_name: 0.04 },
    pizza: { bread: 0.05, filling: 0.7, two_pieces: 0.05, handheld: 0.85, sandwich_by_name: 0.08 },
    "open-faced tuna melt": { bread: 0.92, filling: 0.95, two_pieces: 0.12, handheld: 0.7, sandwich_by_name: 0.55 },
    hamburger: { bread: 0.97, filling: 0.98, two_pieces: 0.96, handheld: 0.95, sandwich_by_name: 0.72 },
    "ice cream sandwich": { bread: 0.22, filling: 0.9, two_pieces: 0.88, handheld: 0.96, sandwich_by_name: 0.93 },
    taco: { bread: 0.06, filling: 0.94, two_pieces: 0.1, handheld: 0.9, sandwich_by_name: 0.07 },
    "cheese sandwich": { bread: 0.99, filling: 0.97, two_pieces: 0.98, handheld: 0.97, sandwich_by_name: 0.99 },
    default: { bread: 0.55, filling: 0.6, two_pieces: 0.45, handheld: 0.7, sandwich_by_name: 0.4 },
  };

  private static scoreValue(id: string, subject: { kind: string; text: string }): number {
    if (subject.kind === "group") return LocalJevMock.groupScore(id, subject.text);
    if (id === "urgency") return LocalJevMock.urgency(subject.text);
    return 1;
  }

  private static groupScore(id: string, group: string): number {
    const profile = LocalJevMock.groups[group.trim().toLowerCase()];
    return profile?.[id] ?? 1.2;
  }

  private static readonly groups: Record<string, Record<string, number> | undefined> = {
    crossfit: { devotion: 2.7, jargon: 2.2, rituals: 2.8, leader: 1.4, exit_cost: 2.3, evangelism: 2.6, overall: 3.2 },
    "a book club": { devotion: 0.4, jargon: 0.3, rituals: 0.2, leader: 0.1, exit_cost: 0.1, evangelism: 0.2, overall: 0.3 },
  };

  private static choiceId(id: string, subject: { kind: string; text: string }, criteria: Record<string, string>): string {
    if (id === "queue") {
      const picked = LocalJevMock.queue(subject.text);
      if (picked in criteria) return picked;
    }
    return Object.keys(criteria)[0] ?? "triage";
  }

  private static queue(message: string): string {
    const text = message.toLowerCase();
    if (text.includes("toaster") || text.includes("whisper")) return "exorcist";
    if (text.includes("charged") || text.includes("invoice") || text.includes("$")) return "billing";
    if (text.includes("love you")) return "venting";
    if (text.includes("locked") || text.includes("password") || text.includes("reset")) return "access";
    if (text.includes("button") || text.includes("add a")) return "feature";
    if (text.includes("friday") || text.includes("doesn't") || text.includes("broken")) return "bug";
    return "triage";
  }

  private static anger(message: string): number {
    const text = message.toLowerCase();
    if (text.includes("angry") || text.includes("charged")) return 0.86;
    if (text.includes("love you")) return 0.04;
    if (text.includes("toaster")) return 0.42;
    return 0.33;
  }

  private static urgency(message: string): number {
    const text = message.toLowerCase();
    if (text.includes("friday") || text.includes("locked")) return 2.4;
    if (text.includes("toaster")) return 2.1;
    if (text.includes("love you")) return 0.2;
    return 1.1;
  }

  private static score(criteria: readonly string[], score: number) {
    const max = Math.max(0, criteria.length - 1);
    const clamped = Math.min(max, Math.max(0, score));
    const lower = Math.floor(clamped);
    const frac = clamped - lower;
    const probabilities: Record<string, number> = {};
    const legend: Record<string, string> = {};
    for (let i = 0; i < criteria.length; i++) {
      probabilities[String(i)] = 0;
      legend[String(i)] = criteria[i] ?? "";
    }
    if (lower >= max || frac === 0) {
      probabilities[String(Math.min(lower, max))] = 1;
    } else {
      probabilities[String(lower)] = 1 - frac;
      probabilities[String(lower + 1)] = frac;
    }
    return { type: "score" as const, score: clamped, legend, probabilities, confidence: 0.86 };
  }

  private static choice(criteria: Record<string, string>, choice: string) {
    const keys = Object.keys(criteria);
    const confidence = 0.91;
    const rest = keys.length > 1 ? (1 - confidence) / (keys.length - 1) : 0;
    const probabilities: Record<string, number> = {};
    for (const key of keys) probabilities[key] = key === choice ? confidence : rest;
    return { type: "choice" as const, choice, probabilities, confidence };
  }
}
