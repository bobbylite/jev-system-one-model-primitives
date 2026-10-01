import { useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import { useReady, useTween, type RunState } from "../hooks";

export const pct = (v: number) => `${(v * 100).toFixed(0)}%`;

/** Animated delay helper for the staggered `.reveal` entrance. */
export const delay = (s: number): CSSProperties => ({ animationDelay: `${s}s` });

/** Renders `backticked` spans as <code>. */
export function Ticks({ text }: { text: string }) {
  return text.split(/`([^`]+)`/).map((part, i) => (i % 2 ? <code key={i}>{part}</code> : part));
}

export function CountUp({ to, ms = 1200, format = (v) => v.toFixed(2) }: {
  to: number;
  ms?: number;
  format?: (v: number) => string;
}) {
  return <>{format(useTween(to, ms))}</>;
}

/** A bar whose fill transitions in after mount. `value` is 0..1. */
export function Bar({ value, wait = 0, color }: { value: number; wait?: number; color?: string }) {
  const ready = useReady();
  return (
    <div className="bar">
      <i style={{ width: ready ? pct(value) : 0, transitionDelay: `${wait}ms`, ...(color ? { background: color } : {}) }} />
    </div>
  );
}

export function SectionHead({ title, note, wait = 0 }: { title: string; note: ReactNode; wait?: number }) {
  return (
    <div className="section-head reveal" style={delay(wait)}>
      <h2>{title}</h2>
      <span className="eyebrow">{note}</span>
    </div>
  );
}

export function Intro({ eyebrow, title, lede }: { eyebrow: string; title: ReactNode; lede: string }) {
  return (
    <>
      <div className="eyebrow">{eyebrow}</div>
      <h1>{title}</h1>
      <p className="lede">{lede}</p>
    </>
  );
}

/** Text box + submit + clickable examples. */
export function PromptBar({ placeholder, maxLength, action, examples, busy, onSubmit, clip }: {
  placeholder: string;
  maxLength: number;
  action: string;
  examples: readonly string[] | undefined;
  busy: boolean;
  onSubmit: (text: string) => void;
  clip?: number;
}) {
  const [text, setText] = useState("");
  const submit = (e: FormEvent) => (e.preventDefault(), onSubmit(text));
  return (
    <>
      <form onSubmit={submit} autoComplete="off">
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder} maxLength={maxLength} autoFocus />
        <button className="go" disabled={busy}>{action}</button>
      </form>
      <div className="chips">
        {examples?.map((ex) => (
          <button key={ex} type="button" className="chip" title={ex} onClick={() => (setText(ex), onSubmit(ex))}>
            {clip && ex.length > clip ? `${ex.slice(0, clip - 2)}…` : ex}
          </button>
        ))}
      </div>
    </>
  );
}

/** Loading skeleton / error box for a Jev request. */
export function RunStatus({ state, pending }: { state: RunState; pending: (input: string) => string }) {
  if (state.status === "loading")
    return (
      <>
        <div className="skel" />
        <div className="status">{pending(state.input)}</div>
      </>
    );
  if (state.status === "error") return <div className="error reveal">{state.message}</div>;
  return null;
}

/** Clickable list of past results. Shown once there are at least two. */
export function History<T>({ title, note, items, row, onPick }: {
  title: string;
  note: string;
  items: readonly T[];
  row: (item: T) => { key: string; name: ReactNode; tag: ReactNode; value: ReactNode };
  onPick: (item: T) => void;
}) {
  if (items.length < 2) return null;
  return (
    <>
      <div className="section-head">
        <h2>{title}</h2>
        <span className="eyebrow">{note}</span>
      </div>
      <div className="history">
        {items.map((item) => {
          const { key, name, tag, value } = row(item);
          return (
            <div
              key={key}
              className="h-row"
              role="button"
              tabIndex={0}
              onClick={() => (onPick(item), scrollTo({ top: 300, behavior: "smooth" }))}
              onKeyDown={(e) => e.key === "Enter" && (onPick(item), scrollTo({ top: 300, behavior: "smooth" }))}
            >
              {name}
              {tag}
              <span className="mono" style={{ textAlign: "right" }}>{value}</span>
            </div>
          );
        })}
      </div>
    </>
  );
}
