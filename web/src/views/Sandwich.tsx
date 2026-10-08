import { useState } from "react";
import type { SandwichConfig, SandwichLabel, SandwichVerdict } from "../api";
import { Bar, CountUp, delay, History, Intro, PromptBar, RunStatus, SectionHead, Ticks } from "../components/ui";
import { useConfig, useReady, useRun } from "../hooks";

const tone = (label: SandwichLabel) => ({ SANDWICH: "yes", "NOT A SANDWICH": "no", CONTESTED: "mid" })[label];
const headline = (label: SandwichLabel) =>
  ({ SANDWICH: "A sandwich.", "NOT A SANDWICH": "Not a sandwich.", CONTESTED: "Contested." })[label];

export function Sandwich() {
  const config = useConfig<SandwichConfig>("/config");
  const [state, run] = useRun<SandwichVerdict>("/classify", "food");
  const [history, setHistory] = useState<SandwichVerdict[]>([]);
  const [current, setCurrent] = useState<SandwichVerdict>();

  const classify = async (food: string) => {
    const r = await run(food);
    if (!r) return;
    setHistory((h) => [r, ...h.filter((x) => x.food.toLowerCase() !== r.food.toLowerCase())]);
    setCurrent(r);
  };

  return (
    <div className="page">
      <Intro
        eyebrow="Noul · a demonstration of typed judgments"
        title={<>Is it a <em>sandwich?</em></>}
        lede="Jev doesn't write an essay about it. It answers five narrow yes/no questions with probabilities, and plain code turns them into a verdict. Everything it used to decide is shown below."
      />
      <PromptBar
        placeholder="Type a food: gyro, calzone, sushi burrito…"
        maxLength={80}
        action="Classify"
        examples={config?.examples}
        busy={state.status === "loading"}
        onSubmit={classify}
      />
      <div id="stage">
        <RunStatus state={state} pending={(food) => `Asking Jev five questions about “${food}”…`} />
        {state.status === "idle" && current && config && <Verdict key={current.food} r={current} policy={config.policy} />}
      </div>
      <History
        title="Session"
        note={`${history.length} classified · click to revisit`}
        items={history}
        onPick={setCurrent}
        row={(r) => ({
          key: r.food,
          name: <span>{r.food}</span>,
          tag: <span className={`tag ${tone(r.label)}`}>{r.label}</span>,
          value: r.score.toFixed(2),
        })}
      />
    </div>
  );
}

function Verdict({ r, policy: P }: { r: SandwichVerdict; policy: SandwichConfig["policy"] }) {
  const ready = useReady();
  const sig = Object.fromEntries(r.signals.map((s) => [s.id, s.probability])) as Record<string, number>;
  const at = (id: string) => (sig[id] ?? 0).toFixed(2);
  const zones = [
    ["no", P.not_sandwich_at],
    ["mid", P.sandwich_at - P.not_sandwich_at],
    ["yes", 1 - P.sandwich_at],
  ] as const;

  return (
    <>
      <div className="panel reveal">
        <div className="verdict-top">
          <div>
            <div className="eyebrow">Verdict</div>
            <div className="food">{r.food}</div>
            <div className={`label ${tone(r.label)}`}>{headline(r.label)}</div>
          </div>
          <div className="big-score">
            <div className="eyebrow">Composite score</div>
            <div className="n"><CountUp to={r.score} ms={1400} /></div>
            <div className="meta mono">{r.latency_ms} ms · 1 request · 5 questions</div>
          </div>
        </div>
        <div className="track">
          {zones.map(([z, w], i) => (
            <div key={z} className={`zone ${z}`} style={{ flex: w, animationDelay: `${i * 120}ms` }} />
          ))}
          <div className="marker" data-v={r.score.toFixed(2)} style={{ left: ready ? `${r.score * 100}%` : 0 }} />
        </div>
        <div className="track-labels mono">
          <span>0 · not</span><span>{P.not_sandwich_at}</span><span>{P.sandwich_at}</span><span>1 · sandwich</span>
        </div>
      </div>

      <SectionHead title="What Jev said" note="5 Noul judgments · P(yes)" wait={0.15} />
      <div className="signals">
        {r.signals.map((s, i) => (
          <div key={s.id} className="sig reveal" style={delay(0.2 + i * 0.09)}>
            <div className="sig-top">
              <span className="eyebrow">{s.id}</span>
              <span className="p"><CountUp to={s.probability} /></span>
            </div>
            <div className="q"><Ticks text={s.instructions} /></div>
            <Bar value={s.probability} wait={250 + i * 70} />
            {s.true_criterion && (
              <div className="crit">
                <div className="t"><b>TRUE</b>{s.true_criterion}</div>
                <div className="f"><b>FALSE</b>{s.false_criterion}</div>
              </div>
            )}
          </div>
        ))}
      </div>

      <SectionHead title="How code decided" note="Policy lives in the Worker" wait={0.5} />
      <div className="panel math reveal" style={delay(0.55)}>
        <div className="row">
          <div className="name">Structural fit<small>bread × filling × handheld × pieces</small></div>
          <Bar value={r.structural} wait={500} /><div className="v">{r.structural.toFixed(2)}</div>
        </div>
        <div className="row">
          <div className="name">Pieces factor<small>max(two_pieces, 0.5)</small></div>
          <Bar value={r.pieces_factor} wait={570} /><div className="v">{r.pieces_factor.toFixed(2)}</div>
        </div>
        <div className="row">
          <div className="name">Common usage<small>sandwich_by_name</small></div>
          <Bar value={sig["sandwich_by_name"] ?? 0} wait={640} /><div className="v">{at("sandwich_by_name")}</div>
        </div>
        <div className="formula">
          structural = <span>{at("bread")}</span> × <span>{at("filling")}</span> × <span>{at("handheld")}</span> × <span>{r.pieces_factor.toFixed(2)}</span> = <span>{r.structural.toFixed(2)}</span><br />
          score = {P.structural_weight} × <span>{r.structural.toFixed(2)}</span> + {P.name_weight} × <span>{at("sandwich_by_name")}</span> = <span>{r.score.toFixed(2)}</span><br />
          ≥ {P.sandwich_at} → sandwich · ≤ {P.not_sandwich_at} → not · otherwise contested
        </div>
      </div>
    </>
  );
}
