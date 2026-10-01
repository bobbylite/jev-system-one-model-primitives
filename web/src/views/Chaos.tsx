import { useState } from "react";
import type { ChaosConfig, ChaosResult } from "../api";
import { Bar, CountUp, delay, History, Intro, PromptBar, RunStatus, SectionHead, Ticks } from "../components/ui";
import { useConfig, useRun } from "../hooks";

type Level = "P1" | "P2" | "P3";

function priorityOf(r: ChaosResult, c: ChaosConfig) {
  const u = r.urgency / r.urgency_max;
  const v = c.urgency_weight * u + c.anger_weight * r.angry;
  const [p1, p2] = c.priority_cuts;
  const level: Level = v >= p1 ? "P1" : v >= p2 ? "P2" : "P3";
  return { u, v, level };
}
const queueLabel = (c: ChaosConfig, id: string) => c.queues.find((q) => q.id === id)?.label ?? id;

export function Chaos() {
  const config = useConfig<ChaosConfig>("/chaos/config");
  const [state, run] = useRun<ChaosResult>("/chaos/route", "message");
  const [history, setHistory] = useState<ChaosResult[]>([]);
  const [current, setCurrent] = useState<ChaosResult>();

  const route = async (message: string) => {
    const r = await run(message);
    if (!r) return;
    setHistory((h) => [r, ...h.filter((x) => x.message !== r.message)]);
    setCurrent(r);
  };

  return (
    <div className="page">
      <Intro
        eyebrow="Choice · pick one from a defined set"
        title={<>Route the <em>chaos.</em></>}
        lede="Paste an unhinged customer message. One Choice picks the support queue and returns a probability for every queue. A Noul and a Score ask about anger and urgency in the same request, and code sets the priority."
      />
      <PromptBar
        placeholder="Describe your problem… (my toaster is haunted)"
        maxLength={1000}
        action="Route it"
        examples={config?.examples}
        clip={44}
        busy={state.status === "loading"}
        onSubmit={route}
      />
      <div id="stage">
        <RunStatus state={state} pending={() => "Routing: one Choice, one Noul, one Score, in parallel…"} />
        {state.status === "idle" && current && config && <Ticket key={current.message} r={current} c={config} />}
      </div>
      {config && (
        <History
          title="Inbox"
          note={`${history.length} routed · click to revisit`}
          items={history}
          onPick={setCurrent}
          row={(r) => {
            const auto = r.confidence >= config.confidence_at;
            return {
              key: r.message,
              name: <span className="clip">{r.message}</span>,
              tag: <span className={`tag ${auto ? "yes" : "mid"}`}>{auto ? queueLabel(config, r.choice).toUpperCase() : "HUMAN TRIAGE"}</span>,
              value: priorityOf(r, config).level,
            };
          }}
        />
      )}
    </div>
  );
}

function Ticket({ r, c }: { r: ChaosResult; c: ChaosConfig }) {
  // The decision depends on this slider only. No new inference.
  const [threshold, setThreshold] = useState(c.confidence_at);
  const auto = r.confidence >= threshold;
  const p = priorityOf(r, c);
  const ptone = p.level === "P1" ? "no" : p.level === "P2" ? "mid" : "yes";
  const lean = queueLabel(c, r.choice);

  return (
    <>
      <div className="panel reveal">
        <div className="verdict-top">
          <div style={{ flex: 1, minWidth: 260 }}>
            <div className="eyebrow">Ticket</div>
            <div className="quote">“{r.message}”</div>
            <div className="eyebrow" style={{ marginTop: 28 }}>Routed to</div>
            <div className={`label ${auto ? "yes" : "mid"}`}>{auto ? lean : "Human triage"}</div>
            <div className="meta" style={{ marginTop: 10 }}>
              {auto
                ? `Confidence ${r.confidence.toFixed(2)} ≥ ${threshold.toFixed(2)}: routed automatically.`
                : `Confidence ${r.confidence.toFixed(2)} < ${threshold.toFixed(2)}: Jev leaned “${lean}”, but a human should look first.`}
            </div>
          </div>
          <div className="big-score">
            <div className="eyebrow">Priority</div>
            <div className={`n tag ${ptone}`} style={{ fontSize: 56, letterSpacing: "-.04em" }}>{p.level}</div>
            <div className="meta mono">{r.latency_ms} ms · 1 request · 3 questions</div>
          </div>
        </div>
        <div className="thr">
          <div className="eyebrow" style={{ margin: "32px 0 12px" }}>
            Auto-route threshold <span className="mono" style={{ color: "var(--ink)", marginLeft: 8 }}>{threshold.toFixed(2)}</span>
          </div>
          <input type="range" min={0} max={1} step={0.01} value={threshold} onChange={(e) => setThreshold(+e.target.value)} />
          <div className="meta">Drag it. The decision flips instantly because confidence is already in hand. Jev isn't called again.</div>
        </div>
      </div>

      <SectionHead
        title="The race"
        wait={0.15}
        note={<>Choice · confidence <span className="mono" style={{ color: "var(--ink)" }}><CountUp to={r.confidence} ms={1100} /></span></>}
      />
      <div className="panel reveal" style={delay(0.2)}>
        <div className="race">
          {r.options.map((o, i) => (
            <div key={o.id} className={`opt ${auto && o.id === r.choice ? "won" : ""}`} style={{ transitionDelay: `${i * 40}ms` }}>
              <div className="opt-head">
                <span className="opt-name">{o.label}</span>
                <b className="mono"><CountUp to={o.probability * 100} ms={1100} format={(v) => `${v.toFixed(0)}%`} /></b>
              </div>
              <Bar value={o.probability} wait={200 + i * 60} />
              <div className="opt-desc">{o.description}</div>
            </div>
          ))}
        </div>
      </div>

      <SectionHead title="Fan-out" note="Same request · independent questions" wait={0.3} />
      <div className="signals">
        <div className="sig reveal" style={delay(0.35)}>
          <div className="sig-top">
            <span className="eyebrow">Noul · angry</span>
            <span className="p"><CountUp to={r.angry} ms={1100} /></span>
          </div>
          <div className="q"><Ticks text={c.questions["angry"] ?? ""} /></div>
          <Bar value={r.angry} wait={200} />
        </div>
        <div className="sig reveal" style={delay(0.43)}>
          <div className="sig-top">
            <span className="eyebrow">Score · urgency</span>
            <span className="p"><CountUp to={r.urgency} ms={1100} /></span>
          </div>
          <div className="q"><Ticks text={c.questions["urgency"] ?? ""} /></div>
          <Bar value={r.urgency / r.urgency_max} wait={260} />
          <div className="crit">
            <div className="t"><b>0</b>{c.urgency_legend[0]}</div>
            <div className="f"><b>{r.urgency_max}</b>{c.urgency_legend[r.urgency_max]}</div>
          </div>
        </div>
      </div>
      <div className="panel reveal formula" style={{ ...delay(0.5), marginTop: 12 }}>
        urgency = <span>{r.urgency.toFixed(2)}</span> ÷ {r.urgency_max} = <span>{p.u.toFixed(2)}</span><br />
        priority = {c.urgency_weight} × <span>{p.u.toFixed(2)}</span> + {c.anger_weight} × <span>{r.angry.toFixed(2)}</span> = <span>{p.v.toFixed(2)}</span><br />
        ≥ {c.priority_cuts[0]} → P1 · ≥ {c.priority_cuts[1]} → P2 · otherwise P3
      </div>
    </>
  );
}
