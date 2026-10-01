import { useState } from "react";
import type { CultConfig, CultResult, Dimension } from "../api";
import { Bar, CountUp, delay, History, Intro, PromptBar, RunStatus, SectionHead, Ticks } from "../components/ui";
import { useConfig, useReady, useRun, useTween } from "../hooks";

const NAMES: Record<string, string> = {
  devotion: "Identity",
  jargon: "Insider language",
  rituals: "Rituals",
  leader: "Revered leader",
  exit_cost: "Cost of leaving",
  evangelism: "Recruiting",
};
const name = (id: string) => NAMES[id] ?? id;
const ZONE_TONES = ["yes", "yes", "mid", "no", "no"] as const;
const tone = (v: number) => (v < 0.4 ? "yes" : v < 0.65 ? "mid" : "no");

type Weights = Record<string, number>;

/** Weighted mean of each dimension's score, normalized by its own max level. */
function composite(dims: readonly Dimension[], w: Weights): number {
  let num = 0, den = 0;
  for (const d of dims) {
    const wt = w[d.id] ?? 0;
    num += wt * (d.score / d.max_level);
    den += wt;
  }
  return den ? num / den : 0;
}
const tierOf = (tiers: CultConfig["tiers"], v: number) => (tiers.find((t) => v < t.max) ?? tiers.at(-1)!).label;

export function Cult() {
  const config = useConfig<CultConfig>("/cult/config");
  const [state, run] = useRun<CultResult>("/cult/score", "group");
  const [history, setHistory] = useState<CultResult[]>([]);
  const [current, setCurrent] = useState<CultResult>();

  const score = async (group: string) => {
    const r = await run(group);
    if (!r || !config) return;
    setHistory((h) =>
      [r, ...h.filter((x) => x.group.toLowerCase() !== r.group.toLowerCase())].sort(
        (a, b) => composite(b.dimensions, config.weights) - composite(a.dimensions, config.weights),
      ),
    );
    setCurrent(r);
  };

  return (
    <div className="page">
      <Intro
        eyebrow="Score · graded judgments on ordered levels"
        title={<>How much of a <em>cult</em> is it?</>}
        lede="Yes/no can't capture this one. Jev places each group on six ordered scales and returns a probability for every level, not just one answer. Code weighs them into a single index, and you can re-weigh it live."
      />
      <PromptBar
        placeholder="Type a group: Crossfit, Swifties, your office…"
        maxLength={80}
        action="Measure"
        examples={config?.examples}
        busy={state.status === "loading"}
        onSubmit={score}
      />
      <div id="stage">
        <RunStatus state={state} pending={(g) => `Asking Jev seven scale questions about “${g}”…`} />
        {state.status === "idle" && current && config && <Result key={current.group} r={current} config={config} />}
      </div>
      {config && (
        <History
          title="Leaderboard"
          note={`${history.length} groups · most cult-like first`}
          items={history}
          onPick={setCurrent}
          row={(r) => {
            const v = composite(r.dimensions, config.weights);
            return {
              key: r.group,
              name: <span>{r.group}</span>,
              tag: <span className={`tag ${tone(v)}`}>{tierOf(config.tiers, v).toUpperCase()}</span>,
              value: (v * 100).toFixed(0),
            };
          }}
        />
      )}
    </div>
  );
}

function Result({ r, config }: { r: CultResult; config: CultConfig }) {
  const ready = useReady();
  // Re-weighing recomputes from the stored scores. Jev isn't called again.
  const [weights, setWeights] = useState<Weights>(config.weights);
  const v = composite(r.dimensions, weights);
  const holistic = r.overall.score / r.overall.max_level;
  const note = r.overall.levels[Math.round(r.overall.score)]?.description;
  const totalWeight = Object.values(weights).reduce((a, b) => a + b, 0);

  return (
    <>
      <div className="panel reveal">
        <div className="verdict-top">
          <div>
            <div className="eyebrow">Verdict · weighted composite</div>
            <div className="food">{r.group}</div>
            <div className={`label ${tone(v)}`}>{tierOf(config.tiers, v)}</div>
          </div>
          <div className="big-score">
            <div className="eyebrow">Cult index</div>
            <div className="n">
              <span><CountUp to={v * 100} ms={500} format={(x) => x.toFixed(0)} /></span>
              <span style={{ color: "var(--ink-3)", fontSize: 24 }}> /100</span>
            </div>
            <div className="meta mono">{r.latency_ms} ms · 1 request · 7 Scores</div>
          </div>
        </div>
        <div className="track">
          {config.tiers.map((t, i) => (
            <div key={t.label} className={`zone ${ZONE_TONES[i] ?? "mid"}`} style={{ flex: 1, animationDelay: `${i * 100}ms` }} />
          ))}
          <div className="marker" data-v={(v * 100).toFixed(0)} style={{ left: ready ? `${v * 100}%` : 0 }} />
          <div className="ghost" title="Jev's holistic answer" style={{ left: ready ? `${holistic * 100}%` : 0 }} />
        </div>
        <div className="track-labels mono">{config.tiers.map((t) => <span key={t.label}>{t.label}</span>)}</div>
        <div className="meta" style={{ marginTop: 24 }}>
          Jev's own holistic answer: “{note}” ({(holistic * 100).toFixed(0)}).
        </div>
      </div>

      <SectionHead title="Six dimensions" note="6 Score judgments · 0 → max level" wait={0.15} />
      <div className="radar-grid reveal" style={delay(0.2)}>
        <div className="panel radar-wrap"><Radar dims={r.dimensions} /></div>
        <div className="panel">
          <div className="eyebrow" style={{ marginBottom: 6 }}>Your weights</div>
          <p className="meta" style={{ margin: "0 0 20px" }}>
            Drag to re-weigh. The composite recomputes instantly from the stored scores; Jev isn't called again.
          </p>
          {r.dimensions.map((d) => (
            <label key={d.id} className="wt">
              <span>{name(d.id)}</span>
              <input
                type="range" min={0} max={2} step={0.1}
                value={weights[d.id] ?? 0}
                onChange={(e) => setWeights((w) => ({ ...w, [d.id]: +e.target.value }))}
              />
              <b className="mono">{(weights[d.id] ?? 0).toFixed(1)}</b>
            </label>
          ))}
        </div>
      </div>

      <div className="signals" style={{ marginTop: 12 }}>
        {r.dimensions.map((d, i) => <DimensionCard key={d.id} d={d} i={i} />)}
      </div>

      <SectionHead title="How the composite is built" note="Policy lives in cult.py" wait={0.6} />
      <div className="panel reveal formula" style={delay(0.65)}>
        {r.dimensions.map((d) => (
          <div key={d.id}>
            {name(d.id).padEnd(16).replaceAll(" ", " ")} <span>{(d.score / d.max_level).toFixed(2)}</span> × w{" "}
            <span>{(weights[d.id] ?? 0).toFixed(1)}</span>
          </div>
        ))}
        <br />
        index = Σ(score × w) ÷ Σ(w) = <span>{v.toFixed(2)}</span> &nbsp;(Σw = {totalWeight.toFixed(1)})<br />
        each Score is normalized by (levels − 1) before weighting, so 3-step and 5-step scales combine fairly.
      </div>
    </>
  );
}

function DimensionCard({ d, i }: { d: Dimension; i: number }) {
  const top = d.levels.reduce((a, b) => (b.probability > a.probability ? b : a)).level;
  return (
    <div className="sig reveal" style={delay(0.25 + i * 0.08)}>
      <div className="sig-top">
        <span className="eyebrow">{name(d.id)}</span>
        <span className="p"><CountUp to={d.score} /></span>
      </div>
      <div className="q"><Ticks text={d.instructions} /></div>
      <div className="levels">
        {d.levels.map((l, j) => (
          <div key={l.level} className={`lv ${l.level === top ? "top" : ""}`}>
            <div className="lv-head">
              <span className="mono">{l.level}</span>
              <span className="lv-desc">{l.description}</span>
              <b className="mono">{(l.probability * 100).toFixed(0)}%</b>
            </div>
            <Bar value={l.probability} wait={250 + j * 50} />
          </div>
        ))}
      </div>
      <div className="meta mono" style={{ marginTop: 14 }}>
        score {d.score.toFixed(2)} / {d.max_level} · confidence {d.confidence.toFixed(2)}
      </div>
    </div>
  );
}

const R = 120, C = 170;
const point = (i: number, n: number, v: number): [number, number] => {
  const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
  return [C + Math.cos(a) * R * v, C + Math.sin(a) * R * v];
};

function Radar({ dims }: { dims: readonly Dimension[] }) {
  const n = dims.length;
  const grow = useTween(1, 1300);
  const ring = (v: number) => dims.map((_, i) => point(i, n, v).join(",")).join(" ");
  const pts = dims.map((d, i) => point(i, n, (d.score / d.max_level) * grow));

  return (
    <svg viewBox="0 0 340 340" className="radar" role="img" aria-label="Radar chart of the six dimension scores">
      {[0.25, 0.5, 0.75, 1].map((v) => <polygon key={v} points={ring(v)} fill="none" stroke="var(--line)" />)}
      {dims.map((d, i) => {
        const [x, y] = point(i, n, 1);
        const [lx, ly] = point(i, n, 1.2);
        const anchor = lx < C - 8 ? "end" : lx > C + 8 ? "start" : "middle";
        return (
          <g key={d.id}>
            <line x1={C} y1={C} x2={x} y2={y} stroke="var(--line)" />
            <text x={lx} y={ly + 4} textAnchor={anchor} fill="var(--ink-2)" fontSize={11} fontFamily="Inter">{name(d.id)}</text>
          </g>
        );
      })}
      <polygon
        points={pts.map((p) => p.join(",")).join(" ")}
        fill="var(--ink)" fillOpacity={0.12} stroke="var(--ink)" strokeWidth={1.5} strokeLinejoin="round"
      />
      {pts.map(([x, y], i) => <circle key={i} cx={x} cy={y} r={4} fill="var(--bg)" stroke="var(--ink)" strokeWidth={1.5} />)}
    </svg>
  );
}
