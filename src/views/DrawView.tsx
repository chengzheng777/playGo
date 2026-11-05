import type { PointerEvent as ReactPointerEvent } from "react";
import { useEffect, useRef, useState } from "react";
import type { DrawPoint, DrawStroke } from "../../shared/protocol";
import { AvatarBadge } from "../components/Avatar";
import { type DrawEvent, store, useAppState } from "../store";

const W = 1000;
const H = 750;
const COLORS = [
  "#111827",
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
];
const WIDTHS = [5, 10, 18];
const CONN_LABEL: Record<string, string> = {
  idle: "未连接",
  connecting: "连接中",
  open: "已连接",
  reconnecting: "重连中",
  closed: "已断开",
};

function drawPolyline(
  ctx: CanvasRenderingContext2D,
  points: DrawPoint[],
  color: string,
  width: number,
  connectFrom?: DrawPoint,
) {
  if (points.length === 0) return;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  const first = connectFrom ?? points[0];
  ctx.moveTo(first.x * W, first.y * H);
  for (const point of points) {
    ctx.lineTo(point.x * W, point.y * H);
  }
  ctx.stroke();
}

function clearBoard(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);
}

function HostCanvas({ strokes, event }: { strokes: DrawStroke[]; event: DrawEvent | null }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const lastSeq = useRef(0);
  const lastPoint = useRef(new Map<string, DrawPoint>());

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!ctx) return;
    clearBoard(ctx);
    for (const stroke of strokes) {
      drawPolyline(ctx, stroke.points, stroke.color, stroke.width);
      const last = stroke.points[stroke.points.length - 1];
      if (last) lastPoint.current.set(stroke.id, last);
    }
  }, [strokes]);

  useEffect(() => {
    if (!event || event.seq <= lastSeq.current) return;
    lastSeq.current = event.seq;
    const ctx = ref.current?.getContext("2d");
    if (!ctx) return;

    if (event.kind === "clear") {
      clearBoard(ctx);
      lastPoint.current.clear();
      return;
    }

    const from = event.start ? undefined : lastPoint.current.get(event.strokeId);
    drawPolyline(ctx, event.points, event.color, event.width, from);
    const last = event.points[event.points.length - 1];
    if (last) lastPoint.current.set(event.strokeId, last);
  }, [event]);

  return <canvas ref={ref} width={W} height={H} className="draw-canvas" />;
}

function DrawPad({
  disabled,
  color,
  width,
  onStroke,
}: {
  disabled: boolean;
  color: string;
  width: number;
  onStroke: (strokeId: string, points: DrawPoint[], start: boolean) => void;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const strokeId = useRef("");
  const buffer = useRef<DrawPoint[]>([]);
  const first = useRef(true);
  const onStrokeRef = useRef(onStroke);

  useEffect(() => {
    onStrokeRef.current = onStroke;
  }, [onStroke]);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (ctx) clearBoard(ctx);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!drawing.current || buffer.current.length === 0) return;
      const points = buffer.current;
      buffer.current = [];
      onStrokeRef.current(strokeId.current, points, first.current);
      first.current = false;
    }, 60);
    return () => window.clearInterval(timer);
  }, []);

  function pointOf(event: ReactPointerEvent<HTMLCanvasElement>): DrawPoint {
    const canvas = ref.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
    };
  }

  function start(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (disabled) return;
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    canvas.setPointerCapture(event.pointerId);
    drawing.current = true;
    strokeId.current = `s${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
    first.current = true;
    buffer.current = [pointOf(event)];
  }

  function move(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const point = pointOf(event);
    buffer.current.push(point);

    const ctx = ref.current?.getContext("2d");
    if (!ctx) return;
    const previous = buffer.current[buffer.current.length - 2];
    drawPolyline(ctx, [point], color, width, previous);
  }

  function end() {
    if (!drawing.current) return;
    drawing.current = false;
    if (buffer.current.length > 0) {
      onStroke(strokeId.current, buffer.current, first.current);
      buffer.current = [];
    }
  }

  return (
    <canvas
      ref={ref}
      width={W}
      height={H}
      className="draw-canvas draw-pad"
      onPointerDown={start}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      onPointerLeave={end}
    />
  );
}

export function DrawGameView() {
  const state = useAppState();
  const room = state.room;
  const you = state.you;
  const game = state.draw;

  const [now, setNow] = useState(() => Date.now() + state.serverOffset);
  const [guess, setGuess] = useState("");
  const [color, setColor] = useState(COLORS[0]);
  const [width, setWidth] = useState(WIDTHS[1]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now() + state.serverOffset), 200);
    return () => window.clearInterval(timer);
  }, [state.serverOffset]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: 只在换轮时清空输入
  useEffect(() => {
    setGuess("");
  }, [game?.round]);

  if (!room || !you || !game) return null;

  const isHost = room.hostId === you.id;
  const isDrawer = game.drawerId === you.id;
  const remaining = Math.max(0, game.deadline - now);
  const seconds = Math.ceil(remaining / 1000);
  const scores = [...game.scores].sort((a, b) => b.score - a.score);

  function sendStroke(strokeId: string, points: DrawPoint[], start: boolean) {
    store.gameAction({ type: "stroke", strokeId, points, color, width, start });
  }

  function submitGuess() {
    const text = guess.trim();
    if (!text) return;
    store.gameAction({ type: "guess", text });
    setGuess("");
  }

  return (
    <div className="draw-game">
      <header className="game-bar">
        <span className="room-pill">房间 {room.code}</span>
        <span className="draw-round">
          第 {game.round} / {game.totalRounds} 轮
        </span>
        <span className={`status status-${state.conn}`}>
          <i />
          {CONN_LABEL[state.conn] ?? state.conn}
        </span>
        <div className="game-bar-actions">
          {isHost && game.phase !== "ended" && (
            <button
              className="btn btn-ghost btn-mini"
              onClick={() => {
                if (window.confirm("结束本局，回到大厅？")) store.backToLobby();
              }}
            >
              结束
            </button>
          )}
          <button
            className="btn btn-ghost btn-mini"
            onClick={() => {
              if (window.confirm("离开房间？")) store.leave();
            }}
          >
            离开
          </button>
        </div>
      </header>

      <main className="draw-main">
        <div className="draw-head">
          <div className="draw-who">
            <span className="draw-label">{game.phase === "ended" ? "本局结束" : "正在画"}</span>
            <b>{game.drawerName || "—"}</b>
          </div>
          {game.phase === "draw" && (
            <div className={`draw-timer${seconds <= 10 ? " urgent" : ""}`}>{seconds}s</div>
          )}
          {game.phase === "reveal" && game.result && (
            <div className="draw-answer">
              答案：<b>{game.result.word}</b>
              {game.result.guesserName && <span> · {game.result.guesserName} 猜对</span>}
            </div>
          )}
        </div>

        <div className="draw-stage">
          {isHost ? (
            <HostCanvas strokes={game.strokes} event={state.drawEvent} />
          ) : isDrawer ? (
            <DrawPad
              disabled={game.phase !== "draw"}
              color={color}
              width={width}
              onStroke={sendStroke}
            />
          ) : (
            <div className="draw-waiting">
              <span className="draw-waiting-emoji">👀</span>
              <p>{game.drawerName} 正在画，猜猜看</p>
            </div>
          )}
        </div>

        {!isHost && isDrawer && game.phase === "draw" && (
          <>
            <div className="draw-word">你要画：{game.word}</div>
            <div className="draw-tools">
              <div className="draw-swatches">
                {COLORS.map((value) => (
                  <button
                    key={value}
                    type="button"
                    className={`draw-swatch${color === value ? " on" : ""}`}
                    style={{ background: value }}
                    aria-label={value}
                    onClick={() => setColor(value)}
                  />
                ))}
              </div>
              <div className="draw-widths">
                {WIDTHS.map((value) => (
                  <button
                    key={value}
                    type="button"
                    className={`draw-width${width === value ? " on" : ""}`}
                    onClick={() => setWidth(value)}
                  >
                    <i style={{ width: value, height: value }} />
                  </button>
                ))}
                <button
                  type="button"
                  className="btn btn-ghost btn-mini"
                  onClick={() => store.gameAction({ type: "clear" })}
                >
                  清空
                </button>
              </div>
            </div>
          </>
        )}

        {!isHost && !isDrawer && game.phase === "draw" && (
          <form
            className="draw-guess"
            onSubmit={(event) => {
              event.preventDefault();
              submitGuess();
            }}
          >
            <input
              className="input"
              value={guess}
              maxLength={24}
              placeholder="输入你猜的词"
              onChange={(event) => setGuess(event.target.value)}
            />
            <button className="btn btn-primary" type="submit" disabled={!guess.trim()}>
              猜
            </button>
          </form>
        )}

        <div className="draw-scores">
          {scores.map((player, index) => (
            <div
              key={player.id}
              className={[
                "draw-player",
                player.id === game.drawerId ? "drawer" : "",
                player.id === you.id ? "me" : "",
                player.connected ? "" : "offline",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              <span className="draw-rank">{index + 1}</span>
              <AvatarBadge avatar={player.avatar} size={24} />
              <span className="draw-name">{player.name}</span>
              <b>{player.score}</b>
            </div>
          ))}
        </div>

        {game.phase === "ended" && (
          <div className="draw-ended">
            <p>🏆 {scores[0]?.name ?? "本局结束"} 获胜</p>
            {isHost ? (
              <div className="winner-actions">
                <button className="btn btn-primary btn-block" onClick={() => store.startGame()}>
                  再来一局
                </button>
                <button className="btn btn-ghost btn-block" onClick={() => store.backToLobby()}>
                  返回大厅
                </button>
              </div>
            ) : (
              <p className="wait-host">等房主开下一局</p>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
