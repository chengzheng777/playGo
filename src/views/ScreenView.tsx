import { getGameMeta } from "../../shared/games";
import { AvatarBadge } from "../components/Avatar";
import { PlayerList } from "../components/PlayerList";
import { store, useAppState } from "../store";

const CONN_LABEL: Record<string, string> = {
  idle: "未连接",
  connecting: "连接中",
  open: "已连接",
  reconnecting: "重连中",
  closed: "已断开",
};

/** /s/:code 连接中或失败时的等待页 */
export function ScreenWaitView() {
  const state = useAppState();
  return (
    <div className="screen-lobby">
      <header className="topbar">
        <div className="room-code">
          <span>大屏</span>
          <b>{state.joinCode || "—"}</b>
        </div>
        <div className={`status status-${state.conn}`}>
          <i />
          {CONN_LABEL[state.conn] ?? state.conn}
        </div>
      </header>
      <div className="loading">
        {state.error || state.conn === "closed" ? (
          <>
            <p>大屏连接失败</p>
            <p className="hint">{state.error ?? "刷新页面重试，或让房主重新发大屏链接。"}</p>
          </>
        ) : (
          <>
            <div className="spinner" />
            <p>正在连接大屏…</p>
          </>
        )}
      </div>
    </div>
  );
}

/** 大厅阶段的大屏：只展示等待状态和玩家列表，没有房主控制 */
export function ScreenLobbyView() {
  const state = useAppState();
  const room = state.room;
  const you = state.you;
  if (!room || !you) return <ScreenWaitView />;

  const players = [...room.players].sort((a, b) => a.seat - b.seat);
  const participants = players.filter((player) => player.role === "player");
  const meta = state.gameId ? getGameMeta(state.gameId) : undefined;

  return (
    <div className="screen-lobby">
      <header className="topbar">
        <div className="room-code">
          <span>房间</span>
          <b>{room.code}</b>
        </div>
        <span className="screen-pill">大屏</span>
        <div className={`status status-${state.conn}`}>
          <i />
          {CONN_LABEL[state.conn] ?? state.conn}
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-mini"
          onClick={() => {
            if (window.confirm("关闭大屏？")) store.leave();
          }}
        >
          关闭
        </button>
      </header>

      <main className="screen-lobby-main">
        <section className="panel screen-hero">
          <span className="screen-kicker">观战大屏</span>
          <h1>{meta ? `${meta.emoji} ${meta.name}` : "等待房主选游戏"}</h1>
          <p className="screen-hero-text">
            {state.gameId
              ? "房主开始后，这里会自动显示游戏画面；大屏不是必需的。"
              : "房主还没选游戏，先在这里等一会儿。"}
          </p>
          <div className="screen-hero-meta">
            <span className="chip">{participants.length} 名参赛者</span>
            <span className="chip">{room.hostPlays ? "房主已参赛" : "房主只做大屏"}</span>
          </div>
          <div className="screen-hero-people">
            {participants.slice(0, 8).map((player) => (
              <span key={player.id} className="screen-hero-person">
                <AvatarBadge avatar={player.avatar} size={22} />
                {player.name}
                {player.ready ? " ✓" : ""}
              </span>
            ))}
          </div>
        </section>

        <PlayerList players={players} youId={you.id} hostId={room.hostId} />
      </main>
    </div>
  );
}
