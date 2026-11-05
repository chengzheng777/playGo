import type { CSSProperties } from "react";
import { GAME_CATALOG } from "../../shared/games";
import { ChatPanel } from "../components/ChatPanel";
import { PlayerList } from "../components/PlayerList";
import { QrCard } from "../components/QrCard";
import { store, useAppState } from "../store";

const CONN_LABEL: Record<string, string> = {
  idle: "未连接",
  connecting: "连接中",
  open: "已连接",
  reconnecting: "重连中",
  closed: "已断开",
};

export function LobbyView() {
  const state = useAppState();
  const { room, you } = state;

  if (!room || !you) {
    return (
      <div className="loading">
        <div className="spinner" />
        <p>正在进入房间…</p>
      </div>
    );
  }

  const isHost = room.hostId === you.id;
  const players = [...room.players].sort((a, b) => a.seat - b.seat);
  const connected = players.filter((player) => player.connected);
  const needReady = connected.filter(
    (player) => player.id !== room.hostId && !player.ready,
  ).length;
  const selected = state.gameId;
  const canStart = Boolean(selected) && connected.length >= 2 && needReady === 0;
  const startLabel = !selected
    ? "先选一个游戏"
    : connected.length < 2
      ? "至少需要 2 名玩家"
      : needReady > 0
        ? `还差 ${needReady} 人准备`
        : "开始游戏";

  return (
    <div className="lobby">
      <header className="topbar">
        <div className="room-code">
          <span>房间</span>
          <b>{room.code}</b>
        </div>
        <div className={`status status-${state.conn}`}>
          <i />
          {CONN_LABEL[state.conn] ?? state.conn}
        </div>
        <button className="btn btn-ghost btn-mini" onClick={() => store.leave()}>
          离开
        </button>
      </header>

      <main className={isHost ? "layout layout-host" : "layout layout-player"}>
        <div className="col">
          {isHost && <QrCard code={room.code} />}

          <section className="panel games-panel">
            <div className="panel-head">
              <h2>游戏大厅</h2>
              <span className="count">{isHost ? "选一个开始" : "等房主挑"}</span>
            </div>

            <div className="game-grid">
              {GAME_CATALOG.map((meta) => {
                const isSelected = selected === meta.id;
                return (
                  <button
                    key={meta.id}
                    type="button"
                    className={[
                      "game-card",
                      isSelected ? "selected" : "",
                      meta.available ? "" : "locked",
                      isHost ? "" : "viewer",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    style={{ "--game-accent": meta.accent } as CSSProperties}
                    disabled={!meta.available || !isHost}
                    onClick={() => store.selectGame(meta.id)}
                  >
                    <span className="game-emoji">{meta.emoji}</span>
                    <span className="game-name">{meta.name}</span>
                    <span className="game-tagline">{meta.tagline}</span>
                    <span className="game-meta">
                      {meta.available ? meta.players : "即将上线"}
                    </span>
                    {isSelected && <span className="game-check">✓</span>}
                  </button>
                );
              })}
            </div>

            {!isHost && (
              <p className="game-hint">只有房主能选游戏，你可以先点下面的「准备」。</p>
            )}

            {selected === "yiyu" && (
              <p className="game-rule">
                按座位自动分成青队 / 橙队。描述者看词，队友在现实里喊答案；60 秒一回合，先到 8 分获胜。抢答回合全场都能输入答案。
              </p>
            )}
          </section>

          <PlayerList players={players} youId={you.id} hostId={room.hostId} />
        </div>

        <div className="col">
          <ChatPanel />
        </div>
      </main>

      <footer className="actionbar">
        {isHost ? (
          <div className="host-actions">
            <button
              className="btn btn-primary btn-block"
              disabled={!canStart}
              onClick={() => store.startGame()}
            >
              {startLabel}
            </button>
            <span className="ready-summary">
              {connected.length < 2
                ? "让朋友扫码加入，2 人以上才能开始"
                : needReady > 0
                  ? "等大家点准备"
                  : "都准备好了"}
            </span>
          </div>
        ) : (
          <div className="player-actions">
            <button
              className={`btn ${you.ready ? "btn-muted" : "btn-primary"} btn-block`}
              onClick={() => store.toggleReady()}
            >
              {you.ready ? "取消准备" : "准备"}
            </button>
            <span className="ready-summary">
              {selected === "yiyu" ? "房主选了「一愚惊人」" : "等房主选游戏"}
            </span>
          </div>
        )}
      </footer>
    </div>
  );
}
