import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, api } from "./api";
import { notifyBlocked, notifyReauth } from "./auth/signals";

/** Fetch a config endpoint once. */
export function useConfig<T>(path: string): T | undefined {
  const [config, setConfig] = useState<T>();
  useEffect(() => {
    const ctl = new AbortController();
    api<T>(path, undefined, ctl.signal).then(setConfig, () => {});
    return () => ctl.abort();
  }, [path]);
  return config;
}

export type RunState =
  | { status: "idle" }
  | { status: "loading"; input: string }
  | { status: "error"; message: string };

/**
 * POST `{ [field]: input }` to a Jev endpoint. Latest call wins: starting a new
 * one aborts the previous. Resolves to the result, or undefined on failure.
 */
export function useRun<R>(path: string, field: string) {
  const [state, setState] = useState<RunState>({ status: "idle" });
  const ctl = useRef<AbortController | null>(null);

  const run = useCallback(
    async (raw: string): Promise<R | undefined> => {
      const input = raw.trim();
      if (!input) return undefined;
      ctl.current?.abort();
      const mine = (ctl.current = new AbortController());
      setState({ status: "loading", input });
      try {
        const result = await api<R>(path, { [field]: input }, mine.signal);
        setState({ status: "idle" });
        return result;
      } catch (e) {
        if (e instanceof ApiError && (e.status === 401 || e.kind === "reauth_required")) {
          notifyReauth();
          return undefined;
        }
        if (e instanceof ApiError && e.kind === "pilot_required") {
          notifyBlocked();
          return undefined;
        }
        if (!mine.signal.aborted) setState({ status: "error", message: e instanceof Error ? e.message : String(e) });
        return undefined;
      }
    },
    [path, field],
  );

  return [state, run] as const;
}

/** False on the first paint, true after two frames, so CSS transitions have a start state. */
export function useReady(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let b = 0;
    const a = requestAnimationFrame(() => (b = requestAnimationFrame(() => setReady(true))));
    return () => (cancelAnimationFrame(a), cancelAnimationFrame(b));
  }, []);
  return ready;
}

/** Ease-out-quart tween toward `to`, starting from wherever the last tween ended. */
export function useTween(to: number, ms: number): number {
  const [value, setValue] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    const t0 = performance.now();
    const start = from.current;
    let raf = 0;
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / ms);
      from.current = start + (to - start) * (1 - (1 - k) ** 4);
      setValue(from.current);
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to, ms]);
  return value;
}

/** Persist a tab-scoped value in the URL hash. */
export function useHashTab<T extends string>(tabs: readonly T[]): readonly [T, (t: T) => void] {
  const read = useCallback((): T => {
    const h = location.hash.slice(1);
    return tabs.find((t) => t === h) ?? tabs[0]!;
  }, [tabs]);
  const [tab, setTab] = useState<T>(read);
  useEffect(() => {
    const on = () => setTab(read());
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, [read]);
  return [tab, (t) => (location.hash = t)] as const;
}
