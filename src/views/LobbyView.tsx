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

  const isHost = you.role === "screen";
  const players = [...room.players].sort((a, b) => a.seat - b.seat);
  const readyCount = players.filter((p) => p.ready && p.role !== "screen").length;
  const playerCount = players.filter((p) => p.role !== "screen").length;

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
          <PlayerList players={players} youId={you.id} hostId={room.hostId} />
        </div>
        <div className="col">
          <ChatPanel />
        </div>
      </main>

      {isHost ? (
        <footer className="actionbar">
          <span className="ready-summary">
            {playerCount === 0
              ? "等待玩家加入…"
              : `${readyCount} / ${playerCount} 人已准备`}
          </span>
        </footer>
      ) : (
        <footer className="actionbar">
          <button
            className={`btn ${you.ready ? "btn-muted" : "btn-primary"} btn-block`}
            onClick={() => store.toggleReady()}
          >
            {you.ready ? "取消准备" : "准备"}
          </button>
        </footer>
      )}
    </div>
  );
}
