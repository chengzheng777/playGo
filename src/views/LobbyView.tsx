import type { CSSProperties } from "react";
import { useEffect, useState } from "react";
import { GAME_CATALOG, getGameMeta } from "../../shared/games";
import { MAX_DRAW_WORD_LEN, MAX_DRAW_WORDS } from "../../shared/protocol";
import { AvatarBadge } from "../components/Avatar";
import { ChatPanel } from "../components/ChatPanel";
import { LobbyChatFloat } from "../components/LobbyChatFloat";
import { LobbyPixelRoom } from "../components/LobbyPixelRoom";
import { PlayerList } from "../components/PlayerList";
import { ProfileEditor } from "../components/ProfileEditor";
import { QrCard } from "../components/QrCard";
import { ScreenLinkCard } from "../components/ScreenLinkCard";
import { useMediaQuery } from "../lib/useMediaQuery";
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

type Drawer = "room";
type RoomFocus = "game" | "settings" | "players" | "invite";

/** 支持中英文逗号、顿号、分号、换行混排 */
function parseWordInput(text: string): string[] {
  return text
    .split(/[,，、;；\n\r]+/)
    .map((word) => word.trim())
    .filter(Boolean);
}

export function LobbyView() {
  const state = useAppState();
  const { room, you, settings, drawSettings } = state;
  const pc = useMediaQuery("(min-width: 920px)");
  const [drawer, setDrawer] = useState<Drawer | null>(null);
  const [chatOpen, setChatOpen] = useState(true);
  const [roomFocus, setRoomFocus] = useState<RoomFocus>("game");
  const [avatarOpen, setAvatarOpen] = useState(false);
  const [wordInput, setWordInput] = useState("");
  const [wordHint, setWordHint] = useState("");

  useEffect(() => {
    if (!pc) setDrawer(null);
  }, [pc]);

  useEffect(() => {
    if (!pc || drawer !== "room") return;
    const targets: Record<RoomFocus, string> = {
      game: ".layout-left .games-panel, .layout-left .current-game",
      settings: ".layout-left .host-mode-panel",
      players: ".layout-left .players-panel",
      invite: ".layout-left .qr-panel, .layout-left .screen-link-panel",
    };
    const target = document.querySelector(targets[roomFocus]);
    target?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [pc, drawer, roomFocus]);

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
  // 参赛者 = role player；房主参赛时也在这里，大屏不计入
  const participants = players.filter((player) => player.role === "player");
  const onlineParticipants = participants.filter((player) => player.connected);
  const readyCount = onlineParticipants.filter((player) => player.ready).length;
  const needReady = onlineParticipants.length - readyCount;
  const unreadyPlayers = participants.filter((player) => !player.ready);
  const selected = state.gameId;
  const canStart = Boolean(selected) && onlineParticipants.length >= 2 && needReady === 0;
  const customWords = drawSettings.customWords ?? [];
  const roomTitle: Record<RoomFocus, string> = {
    game: "游戏",
    settings: "房主设置",
    players: "玩家",
    invite: "邀请",
  };

  const startLabel = !selected
    ? "先选一个游戏"
    : onlineParticipants.length < 2
      ? room.hostPlays
        ? "至少需要 2 名参赛者（含房主）"
        : "至少需要 2 名玩家"
      : needReady > 0
        ? `还有 ${needReady} 人未加入`
        : "开始游戏";

  function openRoom(focus: RoomFocus) {
    setRoomFocus(focus);
    setDrawer("room");
  }

  function addWords() {
    const incoming = parseWordInput(wordInput);
    if (incoming.length === 0) return;

    const seen = new Set(customWords.map((word) => word.toLowerCase()));
    const next = [...customWords];
    let skipped = 0;
    for (const raw of incoming) {
      const word = raw.slice(0, MAX_DRAW_WORD_LEN);
      if (!word || seen.has(word.toLowerCase()) || next.length >= MAX_DRAW_WORDS) {
        skipped += 1;
        continue;
      }
      seen.add(word.toLowerCase());
      next.push(word);
    }

    if (next.length === customWords.length) {
      setWordHint("没有可添加的新词（重复或已达到上限）");
      return;
    }

    store.updateDrawSettings({ ...drawSettings, customWords: next });
    setWordInput("");
    setWordHint(
      skipped > 0
        ? `已加入 ${next.length - customWords.length} 个，跳过 ${skipped} 个重复或超限的词`
        : "",
    );
  }

  function removeWord(word: string) {
    store.updateDrawSettings({
      ...drawSettings,
      customWords: customWords.filter((item) => item !== word),
    });
    setWordHint("");
  }

  function clearWords() {
    if (!window.confirm("清空所有自定义词？内置词库不受影响。")) return;
    store.updateDrawSettings({ ...drawSettings, customWords: [] });
    setWordHint("");
  }

  return (
    <div className={`lobby${pc ? " lobby-pc-page" : ""}`}>
      <header className="topbar">
        <div className="room-code">
          <span>房间</span>
          <b>{room.code}</b>
        </div>
        <button className="avatar-btn" onClick={() => setAvatarOpen(true)} aria-label="换个头像">
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

      <main
        className={`layout ${isHost ? "layout-host" : "layout-player"}${
          pc ? " lobby-pc" : ""
        }${pc && drawer ? ` drawer-${drawer}` : ""}`}
      >
        {pc ? (
          <div className="lobby-hero">
            <LobbyPixelRoom
              room={room}
              you={you}
              gameId={state.gameId}
              overlay={
                pc && chatOpen ? <LobbyChatFloat onClose={() => setChatOpen(false)} /> : undefined
              }
            />
            <div className="lobby-hero-tools">
              <button type="button" className="lobby-tool" onClick={() => openRoom("game")}>
                🎮 游戏
              </button>
              <button type="button" className="lobby-tool" onClick={() => openRoom("players")}>
                👥 玩家 {players.length}
              </button>
              <button
                type="button"
                className={`lobby-tool${chatOpen ? " on" : ""}`}
                aria-pressed={chatOpen}
                onClick={() => setChatOpen(true)}
              >
                💬 聊天
              </button>
              {isHost && (
                <button type="button" className="lobby-tool" onClick={() => openRoom("settings")}>
                  ⚙️ 设置
                </button>
              )}
              {isHost && (
                <button type="button" className="lobby-tool" onClick={() => openRoom("invite")}>
                  🔗 邀请
                </button>
              )}
            </div>
          </div>
        ) : (
          <LobbyPixelRoom room={room} you={you} gameId={state.gameId} />
        )}

        <div className="col layout-left">
          <div className="lobby-drawer-head">
            <h3>{roomTitle[roomFocus]}</h3>
            <button
              type="button"
              className="btn btn-ghost btn-mini"
              onClick={() => setDrawer(null)}
            >
              关闭
            </button>
          </div>
          {isHost && (
            <section className="panel settings-panel host-mode-panel">
              <div className="panel-head">
                <h2>房主模式</h2>
                <span className="count">仅大厅可改</span>
              </div>
              <div className="setting-row">
                <span className="label">房主参赛</span>
                <div className="segmented">
                  <button
                    type="button"
                    className={!room.hostPlays ? "on" : ""}
                    onClick={() => store.setHostPlays(false)}
                  >
                    只做大屏
                  </button>
                  <button
                    type="button"
                    className={room.hostPlays ? "on" : ""}
                    onClick={() => store.setHostPlays(true)}
                  >
                    我也玩
                  </button>
                </div>
              </div>
              <p className="setting-hint">
                {room.hostPlays
                  ? "你已自动加入并准备。大屏不是必需的；需要时用下面的独立链接打开。"
                  : "你的页面就是大屏。想一起玩就切到「我也玩」，再另开一个大屏链接。"}
              </p>
            </section>
          )}

          {isHost && room.hostPlays && <ScreenLinkCard code={room.code} />}
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
              {selected === "uno" && (
                <p className="game-rule">
                  每人 7 张牌，按颜色或数字出牌，先出完手牌获胜。大屏观战，玩家在手机上点牌出。
                </p>
              )}
              {selected === "color" && (
                <p className="game-rule">
                  每轮随机一个颜色，玩家用手机拍一张照片，画面中心越接近目标色得分越高。共 3 轮。
                </p>
              )}
              {selected === "draw" && (
                <p className="game-rule">
                  轮流由一名玩家在手机上画，笔迹实时同步到大屏，其他人在手机上打字猜词。
                  按猜对顺序得 5 / 3 / 1 分，所有人猜对或时间到进入揭晓。
                </p>
              )}
            </section>
          ) : (
            <section className="panel current-game">
              <div className="panel-head">
                <h2>当前游戏</h2>
                <span className="count">{selected ? "房主已选" : "等待房主"}</span>
              </div>

              {selected ? (
                <>
                  <div className="cg-head">
                    <span className="cg-emoji">{getGameMeta(selected)?.emoji ?? "🎲"}</span>
                    <div>
                      <div className="cg-name">{getGameMeta(selected)?.name ?? selected}</div>
                      <div className="cg-tag">{getGameMeta(selected)?.tagline ?? ""}</div>
                    </div>
                  </div>

                  <p className="game-rule">
                    {selected === "uno"
                      ? "每人 7 张牌，按颜色或数字出牌，先出完手牌获胜；大屏只负责观战，玩家在手机上出牌。"
                      : selected === "color"
                        ? "每轮随机一个颜色，拍一张照片，画面中心越接近目标色得分越高。"
                        : selected === "draw"
                          ? "轮流画图，笔迹会同步到大屏，其他人打字猜。按猜对顺序得 5 / 3 / 1 分。"
                          : "房主电脑会播放词语，你和其他手机玩家分队猜词，记得背对屏幕。"}
                  </p>

                  <div className="cg-settings">
                    {selected === "yiyu" && (
                      <>
                        <span className="chip">目标 {settings.targetScore} 分</span>
                        <span className="chip">每回合 {settings.roundSeconds} 秒</span>
                      </>
                    )}
                    {selected === "draw" && (
                      <>
                        <span className="chip">每人 {drawSettings.roundsPerPlayer} 轮</span>
                        <span className="chip">每轮 {drawSettings.roundSeconds} 秒</span>
                        {customWords.length > 0 && (
                          <span className="chip">自定义词 {customWords.length}</span>
                        )}
                      </>
                    )}
                    {room.hostPlays && <span className="chip">房主参赛</span>}
                    <span className="chip">已加入 {readyCount} 人</span>
                  </div>

                  {selected === "draw" && customWords.length > 0 && (
                    <div className="word-chips read-only">
                      {customWords.map((word) => (
                        <span key={word} className="word-chip">
                          {word}
                        </span>
                      ))}
                    </div>
                  )}

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
                      onClick={() => store.updateSettings({ ...settings, roundSeconds: value })}
                    >
                      {value}s
                    </button>
                  ))}
                </div>
              </div>
            </section>
          )}

          {isHost && selected === "draw" && (
            <section className="panel settings-panel">
              <div className="panel-head">
                <h2>规则</h2>
                <span className="count">下一局生效</span>
              </div>

              <div className="setting-row">
                <span className="label">每人轮数</span>
                <div className="segmented">
                  {[1, 2, 3].map((value) => (
                    <button
                      key={value}
                      type="button"
                      className={drawSettings.roundsPerPlayer === value ? "on" : ""}
                      onClick={() =>
                        store.updateDrawSettings({ ...drawSettings, roundsPerPlayer: value })
                      }
                    >
                      {value} 轮
                    </button>
                  ))}
                </div>
              </div>

              <div className="setting-row">
                <span className="label">每轮时间</span>
                <div className="segmented">
                  {[60, 80, 100, 120].map((value) => (
                    <button
                      key={value}
                      type="button"
                      className={drawSettings.roundSeconds === value ? "on" : ""}
                      onClick={() =>
                        store.updateDrawSettings({ ...drawSettings, roundSeconds: value })
                      }
                    >
                      {value}s
                    </button>
                  ))}
                </div>
              </div>

              <div className="setting-block">
                <span className="label">自定义词库</span>
                <p className="setting-hint">
                  会和内置词库一起抽。可一次粘贴多个，用逗号、顿号或换行分隔；单个词最多{" "}
                  {MAX_DRAW_WORD_LEN} 字。
                </p>
                <textarea
                  className="word-batch"
                  rows={2}
                  value={wordInput}
                  placeholder="例如：打工人，早八，摸鱼"
                  onChange={(event) => {
                    setWordInput(event.target.value);
                    setWordHint("");
                  }}
                />
                <div className="word-add-row">
                  <span className="count">
                    已添加 {customWords.length}/{MAX_DRAW_WORDS}
                  </span>
                  <button
                    type="button"
                    className="btn btn-primary btn-mini"
                    disabled={parseWordInput(wordInput).length === 0}
                    onClick={addWords}
                  >
                    加入词库
                  </button>
                </div>
                {wordHint && <p className="setting-hint">{wordHint}</p>}
                {customWords.length > 0 && (
                  <div className="word-chips">
                    {customWords.map((word) => (
                      <span key={word} className="word-chip">
                        {word}
                        <button
                          type="button"
                          aria-label={`删除 ${word}`}
                          onClick={() => removeWord(word)}
                        >
                          ×
                        </button>
                      </span>
                    ))}
                    <button type="button" className="btn btn-ghost btn-mini" onClick={clearWords}>
                      清空
                    </button>
                  </div>
                )}
              </div>
            </section>
          )}

          <PlayerList
            players={players}
            youId={you.id}
            hostId={room.hostId}
            canKick={isHost}
            onKick={(playerId) => store.kickPlayer(playerId)}
          />
        </div>

        {!pc && (
          <div className="col layout-chat">
            <ChatPanel />
          </div>
        )}
      </main>

      {pc && drawer && (
        <button
          type="button"
          className="lobby-drawer-mask"
          aria-label="关闭房间面板"
          onClick={() => setDrawer(null)}
        />
      )}

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
            {unreadyPlayers.length > 0 && (
              <button
                className="btn btn-ghost btn-block kick-unready-btn"
                onClick={() => {
                  if (
                    !window.confirm(
                      `移出 ${unreadyPlayers.length} 名未准备的玩家？被移出的人需要重新扫码加入。`,
                    )
                  ) {
                    return;
                  }
                  store.kickUnready();
                }}
              >
                移出未准备玩家（{unreadyPlayers.length}）
              </button>
            )}
            <span className="ready-summary">
              {onlineParticipants.length < 2
                ? room.hostPlays
                  ? "房主已参赛，还需要至少 1 名玩家"
                  : "房主不参赛，至少 2 名手机玩家才能开始"
                : selected === "draw"
                  ? `已加入 ${readyCount}/${onlineParticipants.length} · 每人 ${drawSettings.roundsPerPlayer} 轮`
                  : `已加入 ${readyCount}/${onlineParticipants.length} · 目标 ${settings.targetScore} 分`}
            </span>
          </div>
        ) : pc && you.role === "player" ? (
          <div className="player-actions">
            {selected ? (
              <button
                className={`btn ${you.ready ? "btn-muted" : "btn-primary"} btn-block`}
                onClick={() => store.toggleReady()}
              >
                {you.ready ? "已加入 · 取消" : "加入游戏"}
              </button>
            ) : (
              <span className="ready-summary">等待房主选游戏</span>
            )}
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
