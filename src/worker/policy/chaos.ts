import { Answers } from "../jev/answers";
import type { ChoiceQuestion, JevAnswer, JevQuestion, NoulQuestion, ScoreQuestion } from "../jev/types";

export type PriorityLevel = "P1" | "P2" | "P3";

/**
 * Route the chaos. One Choice, one Noul, one Score.
 * Cutoffs and wording match the former `chaos.py`.
 * Priority is the blend the Chaos tab already applies.
 */
export class Chaos {
  private constructor() {}

  static readonly queues: Record<string, readonly [string, string]> = {
    billing: ["Billing", "Charges, refunds, invoices, subscriptions, pricing disputes"],
    bug: ["Bug report", "Something that is supposed to work and doesn't, or behaves wrongly"],
    feature: ["Feature request", "Asking for a capability that does not exist yet"],
    access: ["Account access", "Passwords, lockouts, login, MFA, or reset links that failed"],
    safety: ["Abuse & safety", "Threats, harassment, blackmail, or a security or privacy concern"],
    exorcist: ["Needs an exorcist", "Paranormal, supernatural, or cursed-device reports"],
    venting: ["Venting / love letter", "Pure emotion or praise; no action requested"],
    triage: ["Human triage", "None of the other queues clearly fits"],
  };

  static readonly confidenceAt = 0.7;
  static readonly urgencyWeight = 0.65;
  static readonly angerWeight = 0.35;
  static readonly priorityCuts = [0.6, 0.3] as const;

  static readonly examples = [
    "My smart toaster has started whispering my passwords at 3am.",
    "Charged me $14.99 for a premium plan I canceled, AND the app now plays Nickelback.",
    "Can you add a button that makes my boss disappear from the calendar?",
    "I love you guys. That's it. That's the message.",
    "My account is locked and the reset link was sent to my ex's email.",
    "A man in a gorilla suit keeps showing up on your checkout page.",
    "If this isn't fixed by Friday I'm posting a very angry review.",
  ] as const;

  static readonly questions: Record<string, JevQuestion> = {
    queue: {
      type: "choice",
      instructions:
        "Which support queue should handle this `message`? Pick the queue for the main thing the customer needs done.",
      criteria: Object.fromEntries(Object.entries(Chaos.queues).map(([id, entry]) => [id, entry[1]])),
    } satisfies ChoiceQuestion,
    angry: {
      type: "noul",
      instructions: "Is the customer of this `message` angry or hostile?",
    } satisfies NoulQuestion,
    urgency: {
      type: "score",
      instructions: "How urgent is it for the customer of this `message` to get help?",
      criteria: [
        "No deadline or consequence; fine to answer whenever",
        "Annoying, but they can keep working in the meantime",
        "A stated deadline, money at stake, or blocked from something they need today",
        "Danger, a threat, or a security problem happening right now",
      ],
    } satisfies ScoreQuestion,
  };

  static priority(
    urgency: number,
    urgencyMax: number,
    angry: number,
  ): { u: number; v: number; level: PriorityLevel } {
    const u = urgency / urgencyMax;
    const v = Chaos.urgencyWeight * u + Chaos.angerWeight * angry;
    const [p1, p2] = Chaos.priorityCuts;
    const level: PriorityLevel = v >= p1 ? "P1" : v >= p2 ? "P2" : "P3";
    return { u, v, level };
  }

  static autoRoute(confidence: number, threshold = Chaos.confidenceAt): boolean {
    return confidence >= threshold;
  }

  static config() {
    const urgency = Chaos.questions.urgency;
    const legend = urgency?.type === "score" ? urgency.criteria.map((criterion) => String(criterion)) : [];
    return {
      examples: [...Chaos.examples],
      confidence_at: Chaos.confidenceAt,
      urgency_weight: Chaos.urgencyWeight,
      anger_weight: Chaos.angerWeight,
      priority_cuts: [...Chaos.priorityCuts],
      urgency_legend: legend,
      queues: Object.entries(Chaos.queues).map(([id, [label, description]]) => ({ id, label, description })),
      questions: Object.fromEntries(Object.entries(Chaos.questions).map(([id, question]) => [id, question.instructions])),
    };
  }

  static result(message: string, answers: Record<string, JevAnswer>, latencyMs: number) {
    const choice = Answers.choice(answers, "queue");
    const urgencyQuestion = Chaos.questions.urgency;
    const urgencyMax = urgencyQuestion?.type === "score" ? urgencyQuestion.criteria.length - 1 : 0;
    const options = Object.entries(Chaos.queues).map(([id, [label, description]]) => ({
      id,
      label,
      description,
      probability: Answers.optionProbability(choice.probabilities, id),
    }));
    options.sort((left, right) => right.probability - left.probability);
    return {
      message,
      options,
      choice: choice.choice,
      confidence: choice.confidence,
      angry: Answers.noul(answers, "angry"),
      urgency: Answers.score(answers, "urgency").score,
      urgency_max: urgencyMax,
      latency_ms: latencyMs,
    };
  }
}
