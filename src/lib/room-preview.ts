import { useCallback, useEffect, useRef, useState } from "react";
import type { RoomPreview } from "../../shared/protocol";

export type RoomPreviewState =
  | { status: "loading" }
  | { status: "ready"; preview: RoomPreview }
  | { status: "missing" }
  | { status: "error"; message: string };

const POLL_MS = 2000;
const MAX_BACKOFF_MS = 30_000;

/**
 * 入座页的只读房态：每 2 秒轮询，页面隐藏时暂停，404 后停止。
 * 不写入 store.room，避免把预览误当成已入房。
 */
export function useRoomPreview(code: string): {
  state: RoomPreviewState;
  refresh: () => void;
} {
  const [state, setState] = useState<RoomPreviewState>({ status: "loading" });
  const loadRef = useRef<() => void>(() => {});

  useEffect(() => {
    let alive = true;
    let done = false;
    let timer: number | undefined;
    let controller: AbortController | null = null;
    let delay = POLL_MS;

    const stopTimer = () => {
      if (timer !== undefined) {
        window.clearTimeout(timer);
        timer = undefined;
      }
    };

    const schedule = () => {
      if (!alive || done) return;
      stopTimer();
      timer = window.setTimeout(() => {
        if (document.visibilityState === "visible") void load();
      }, delay);
    };

    const load = async (): Promise<void> => {
      controller?.abort();
      const current = new AbortController();
      controller = current;
      try {
        const response = await fetch(`/api/rooms/${encodeURIComponent(code)}`, {
          cache: "no-store",
          signal: current.signal,
        });
        if (!alive) return;
        if (response.status === 404) {
          done = true;
          stopTimer();
          setState({ status: "missing" });
          return;
        }
        if (response.status === 429) {
          delay = Math.min(MAX_BACKOFF_MS, delay * 2);
          return;
        }
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const preview = (await response.json()) as RoomPreview;
        if (!alive) return;
        delay = POLL_MS;
        setState({ status: "ready", preview });
      } catch (error) {
        if (!alive) return;
        if (error instanceof DOMException && error.name === "AbortError") return;
        setState((previous) =>
          previous.status === "ready"
            ? previous
            : { status: "error", message: "连不上本地服务，确认服务已启动" },
        );
      } finally {
        if (alive && current === controller && !done) schedule();
      }
    };

    loadRef.current = () => {
      delay = POLL_MS;
      void load();
    };

    setState({ status: "loading" });
    void load();

    const onVisibility = () => {
      if (done) return;
      if (document.visibilityState === "visible") {
        stopTimer();
        void load();
      } else {
        stopTimer();
        controller?.abort();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      alive = false;
      done = true;
      stopTimer();
      controller?.abort();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [code]);

  const refresh = useCallback(() => loadRef.current(), []);
  return { state, refresh };
}
