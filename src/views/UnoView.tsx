import { useState } from "react";
import type { UnoCard, UnoColor } from "../../shared/protocol";
import { AvatarBadge } from "../components/Avatar";
import { store, useAppState } from "../store";

const COLORS: UnoColor[] = ["red", "yellow", "green", "blue"];
const COLOR_NAME: Record<UnoColor, string> = {
  red: "红",
  yellow: "黄",
  green: "绿",
  blue: "蓝",
};
const CONN_LABEL: Record<string, string> = {
  idle: "未连接",
  connecting: "连接中",
  open: "已连接",
  reconnecting: "重连中",
  closed: "已断开",
};

function cardLabel(card: UnoCard): string {
  if (card.kind === "number") return String(card.value ?? "");
  if (card.kind === "skip") return "⊘";
  if (card.kind === "reverse") return "⇄";
  if (card.kind === "draw2") return "+2";
  if (card.kind === "wild") return "★";
  return "+4";
}

function CardFace({ card, big = false }: { card: UnoCard; big?: boolean }) {
  return (
    <span className={`uno-card uno-${card.color}${big ? " big" : ""}`}>
      <span>{cardLabel(card)}</span>
    </span>
  );
}

export function UnoGameView() {
  const state = useAppState();
  const room = state.room;
  const you = state.you;
  const uno = state.uno;
  const [colorFor, setColorFor] = useState<string | null>(null);

  if (!room || !you || !uno) return null;

  const isHost = room.hostId === you.id;
  const isTurn = uno.turnPlayerId === you.id;
  const turnPlayer = uno.players.find((player) => player.id === uno.turnPlayerId);
  const winner = uno.players.find((player) => player.id === uno.winnerId);

  function play(card: UnoCard) {
    if (!uno) return;
    if (!uno.playableIds.includes(card.id)) return;
    if (card.kind === "wild" || card.kind === "wild4") {
      setColorFor(card.id);
      return;
    }
    store.gameAction({ type: "play", cardId: card.id });
  }

  return (
    <div className="uno" data-color={uno.currentColor}>
      <header className="game-bar">
        <span className="room-pill">房间 {room.code}</span>
        <span className="uno-color-pill" data-color={uno.currentColor}>
          {COLOR_NAME[uno.currentColor]}
        </span>
        <span className={`status status-${state.conn}`}>
          <i />
          {CONN_LABEL[state.conn] ?? state.conn}
        </span>
        <div className="game-bar-actions">
          {isHost && (
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

      <main className="uno-main">
        <div className="uno-headline">
          <span className={isTurn ? "uno-yours" : ""}>
            {uno.phase === "ended"
              ? "本局结束"
              : isTurn
                ? "轮到你出牌"
                : `轮到 ${turnPlayer?.name ?? ""}`}
          </span>
          <span className="uno-dir">{uno.direction === 1 ? "顺时针" : "逆时针"}</span>
        </div>

        <div className="uno-table">
          <div className="uno-pile">
            <CardFace card={uno.discardTop} big />
            <span className="uno-pile-label">弃牌堆</span>
          </div>
          <div className="uno-pile">
            <div className="uno-card-back">
              <span>UNO</span>
            </div>
            <span className="uno-pile-label">牌堆 {uno.drawCount}</span>
          </div>
        </div>

        <div className="uno-players">
          {uno.players.map((player) => (
            <div
              key={player.id}
              className={[
                "uno-player",
                player.id === uno.turnPlayerId ? "active" : "",
                player.id === you.id ? "me" : "",
                player.connected ? "" : "offline",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              <AvatarBadge avatar={player.avatar} size={26} />
              <span className="uno-player-name">{player.name}</span>
              <span className="uno-count">{player.handCount}</span>
            </div>
          ))}
        </div>

        {uno.lastEvent && <p className="uno-log">{uno.lastEvent.text}</p>}

        {uno.phase === "ended" ? (
          <section className="uno-ended">
            <div className="uno-trophy">🏆</div>
            <h2>{winner ? `${winner.name} 获胜` : "本局结束"}</h2>
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
          </section>
        ) : isHost ? (
          <p className="uno-hint">大屏观战 · 玩家在手机上出牌</p>
        ) : (
          <>
            <div className="uno-hand">
              {uno.hand.map((card) => {
                const playable = isTurn && uno.playableIds.includes(card.id);
                return (
                  <button
                    key={card.id}
                    type="button"
                    className={`uno-card-slot${playable ? " playable" : ""}`}
                    disabled={!playable}
                    onClick={() => play(card)}
                  >
                    <CardFace card={card} />
                  </button>
                );
              })}
            </div>

            <div className="uno-actions">
              <button
                className="btn"
                disabled={!isTurn || uno.mustDraw}
                onClick={() => store.gameAction({ type: "draw" })}
              >
                摸一张
              </button>
              {uno.mustDraw && (
                <button
                  className="btn btn-primary"
                  onClick={() => store.gameAction({ type: "pass" })}
                >
                  不出
                </button>
              )}
            </div>
          </>
        )}
      </main>

      {colorFor && (
        <div className="modal-mask" onClick={() => setColorFor(null)}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <h3>选个颜色</h3>
              <button className="btn btn-ghost btn-mini" onClick={() => setColorFor(null)}>
                关闭
              </button>
            </div>
            <div className="uno-colors">
              {COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  className={`uno-color-dot uno-${color}`}
                  onClick={() => {
                    store.gameAction({ type: "play", cardId: colorFor, color });
                    setColorFor(null);
                  }}
                >
                  {COLOR_NAME[color]}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
