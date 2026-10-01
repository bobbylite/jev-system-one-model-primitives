import { lazy, Suspense, useLayoutEffect, useRef, useState, type ComponentType } from "react";
import { useHashTab } from "./hooks";
import { Chaos } from "./views/Chaos";
import { Cult } from "./views/Cult";
import { Sandwich } from "./views/Sandwich";

// tldraw is large, so it only downloads the first time the whiteboard is opened.
const Whiteboard = lazy(() => import("./Whiteboard"));

const TABS = [
  { id: "sandwich", label: "Sandwich", primitive: "NOUL", View: Sandwich },
  { id: "cult", label: "Cult", primitive: "SCORE", View: Cult },
  { id: "chaos", label: "Chaos", primitive: "CHOICE", View: Chaos },
] as const satisfies readonly { id: string; label: string; primitive: string; View: ComponentType }[];

type TabId = (typeof TABS)[number]["id"];
const IDS = TABS.map((t) => t.id) as readonly TabId[];

export function App() {
  const [tab, setTab] = useHashTab(IDS);
  const [visited, setVisited] = useState<ReadonlySet<TabId>>(() => new Set([tab]));
  const [boardOpen, setBoardOpen] = useState(false);

  if (!visited.has(tab)) setVisited(new Set([...visited, tab]));

  return (
    <div className="wrap">
      <header>
        <div className="brand"><span className="dot" />Jev · Lab</div>
        <div className="header-right">
          <Tabs active={tab} onPick={setTab} />
          <button className="icon-btn" onClick={() => setBoardOpen(true)} aria-label="Open whiteboard" title="Whiteboard">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <rect x="3" y="4" width="18" height="12" rx="2" />
              <path d="M7 12l3-3 2 2 4-4" />
              <path d="M8 20l2-4M16 20l-2-4" />
            </svg>
          </button>
        </div>
      </header>

      <main>
        {/* Keep visited tabs mounted so results and history survive tab switches. */}
        {TABS.map(({ id, View }) => visited.has(id) && (
          <section key={id} hidden={id !== tab}><View /></section>
        ))}
      </main>

      <footer>
        <span>Jev answers. Code decides.</span>
        <span><a href="https://docs.typesafe.ai/introduction" target="_blank" rel="noopener">docs.typesafe.ai</a></span>
      </footer>

      {boardOpen && (
        <Suspense fallback={<div className="wb-loading">Loading whiteboard…</div>}>
          <Whiteboard onClose={() => setBoardOpen(false)} />
        </Suspense>
      )}
    </div>
  );
}

function Tabs({ active, onPick }: { active: TabId; onPick: (t: TabId) => void }) {
  const nav = useRef<HTMLElement>(null);
  const [pill, setPill] = useState({ left: 0, width: 0 });

  // Re-measure whenever a button resizes (e.g. when the web fonts swap in).
  useLayoutEffect(() => {
    const el = nav.current;
    if (!el) return;
    const measure = () => {
      const on = el.querySelector<HTMLElement>("button.on");
      if (on) setPill({ left: on.offsetLeft, width: on.offsetWidth });
    };
    measure();
    const ro = new ResizeObserver(measure);
    el.querySelectorAll("button").forEach((b) => ro.observe(b));
    return () => ro.disconnect();
  }, [active]);

  return (
    <nav className="tabs" ref={nav}>
      <span className="slider" style={pill} />
      {TABS.map((t) => (
        <button key={t.id} className={t.id === active ? "on" : ""} onClick={() => onPick(t.id)}>
          {t.label}<small>{t.primitive}</small>
        </button>
      ))}
    </nav>
  );
}
