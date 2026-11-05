import type { CSSProperties } from "react";
import { useState } from "react";
import { GAME_CATALOG } from "../../shared/games";
import { AvatarBadge } from "../components/Avatar";
import { ProfileEditor } from "../components/ProfileEditor";
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

const SCORE_OPTIONS = [5, 8, 10, 12];
const TIME_OPTIONS = [30, 45, 60, 90];

export function LobbyView() {
  const state = useAppState();
  const { room, you, settings } = state;
  const [avatarOpen, setAvatarOpen] = useState(false);

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
  const participants = players.filter((player) => player.id !== room.hostId);
  const onlineParticipants = participants.filter((player) => player.connected);
  const readyCount = onlineParticipants.filter((player) => player.ready).length;
  const needReady = onlineParticipants.length - readyCount;
  const selected = state.gameId;
  const canStart = Boolean(selected) && onlineParticipants.length >= 2 && needReady === 0;

  const startLabel = !selected
    ? "先选一个游戏"
    : onlineParticipants.length < 2
      ? "至少需要 2 名玩家"
      : needReady > 0
        ? `还差 ${needReady} 人加入`
        : "开始游戏";

  return (
    <div className="lobby">
      <header className="topbar">
        <div className="room-code">
          <span>房间</span>
          <b>{room.code}</b>
        </div>
        <button
          className="avatar-btn"
          onClick={() => setAvatarOpen(true)}
          aria-label="换个头像"
        >
          <AvatarBadge avatar={you.avatar} size={30} />
        </button>
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

          {isHost ? (
            <section className="panel games-panel">
              <div className="panel-head">
                <h2>游戏</h2>
                <span className="count">开局前可换</span>
              </div>

              <div className="game-pills">
                {GAME_CATALOG.filter((meta) => meta.available).map((meta) => {
                  const isSelected = selected === meta.id;
                  return (
                    <button
                      key={meta.id}
                      type="button"
                      className={`game-pill${isSelected ? " on" : ""}`}
                      style={{ "--game-accent": meta.accent } as CSSProperties}
                      onClick={() => store.selectGame(meta.id)}
                    >
                      <span className="game-pill-emoji">{meta.emoji}</span>
                      <span>{meta.name}</span>
                      {isSelected && <span className="game-pill-check">✓</span>}
                    </button>
                  );
                })}
              </div>

              {selected === "yiyu" && (
                <p className="game-rule">
                  房主电脑是大屏，负责播放词语；手机玩家分成青队 / 橙队，背对屏幕猜词。
                  抢答回合全场都能用手机输入答案。
                </p>
              )}
            </section>
          ) : (
            <section className="panel current-game">
              <div className="panel-head">
                <h2>当前游戏</h2>
                <span className="count">{selected ? "房主已选" : "等待房主"}</span>
              </div>

              {selected === "yiyu" ? (
                <>
                  <div className="cg-head">
                    <span className="cg-emoji">🎭</span>
                    <div>
                      <div className="cg-name">一愚惊人</div>
                      <div className="cg-tag">一人比划，全队猜词</div>
                    </div>
                  </div>

                  <p className="game-rule">
                    房主电脑会播放词语，你和其他手机玩家分队猜词，记得背对屏幕。
                  </p>

                  <div className="cg-settings">
                    <span className="chip">目标 {settings.targetScore} 分</span>
                    <span className="chip">每回合 {settings.roundSeconds} 秒</span>
                    <span className="chip">已加入 {readyCount} 人</span>
                  </div>

                  <button
                    className={`btn ${you.ready ? "btn-muted" : "btn-primary"} btn-block`}
                    onClick={() => store.toggleReady()}
                  >
                    {you.ready ? "已加入 · 取消" : "加入游戏"}
                  </button>
                </>
              ) : (
                <p className="game-hint">房主还没选游戏，先在房间里等等。</p>
              )}
            </section>
          )}

          {isHost && selected === "yiyu" && (
            <section className="panel settings-panel">
              <div className="panel-head">
                <h2>规则</h2>
                <span className="count">下一局生效</span>
              </div>

              <div className="setting-row">
                <span className="label">目标分</span>
                <div className="segmented">
                  {SCORE_OPTIONS.map((value) => (
                    <button
                      key={value}
                      type="button"
                      className={settings.targetScore === value ? "on" : ""}
                      onClick={() => store.updateSettings({ ...settings, targetScore: value })}
                    >
                      {value}
                    </button>
                  ))}
                </div>
              </div>

              <div className="setting-row">
                <span className="label">每回合</span>
                <div className="segmented">
                  {TIME_OPTIONS.map((value) => (
                    <button
                      key={value}
                      type="button"
                      className={settings.roundSeconds === value ? "on" : ""}
                      onClick={() =>
                        store.updateSettings({ ...settings, roundSeconds: value })
                      }
                    >
                      {value}s
                    </button>
                  ))}
                </div>
              </div>
            </section>
          )}

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
              {onlineParticipants.length < 2
                ? "房主不参赛，至少 2 名手机玩家才能开始"
                : `已加入 ${readyCount}/${onlineParticipants.length} · 目标 ${settings.targetScore} 分`}
            </span>
          </div>
        ) : null}
      </footer>

      {avatarOpen && (
        <div className="modal-mask" onClick={() => setAvatarOpen(false)}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <h3>用户资料</h3>
              <button className="btn btn-ghost btn-mini" onClick={() => setAvatarOpen(false)}>
                关闭
              </button>
            </div>
            <ProfileEditor
              initial={{ name: you.name, avatar: you.avatar }}
              onCancel={() => setAvatarOpen(false)}
              onSave={(next) => {
                store.saveProfile(next);
                setAvatarOpen(false);
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
