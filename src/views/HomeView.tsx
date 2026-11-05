import type { CSSProperties } from "react";
import { useCallback, useEffect, useState } from "react";
import { GAME_CATALOG, getGameMeta } from "../../shared/games";
import type { RoomSummary } from "../../shared/protocol";
import { ProfileBar } from "../components/ProfileBar";
import { ProfileEditor } from "../components/ProfileEditor";
import { useMediaQuery } from "../lib/useMediaQuery";
import { store, useAppState } from "../store";

export function HomeView() {
  const state = useAppState();
  const profile = state.profile;
  const isMobile = useMediaQuery("(max-width: 1024px), (pointer: coarse)");

  const [rooms, setRooms] = useState<RoomSummary[] | null>(null);
  const [gameId, setGameId] = useState("yiyu");
  const [code, setCode] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);

  const loadRooms = useCallback(async () => {
    try {
      const response = await fetch("/api/rooms", { cache: "no-store" });
      const data = (await response.json()) as { rooms: RoomSummary[] };
      setRooms(data.rooms);
    } catch {
      /* 服务没起来时静默重试 */
    }
  }, []);

  useEffect(() => {
    void loadRooms();
    const timer = window.setInterval(loadRooms, 3000);
    return () => window.clearInterval(timer);
  }, [loadRooms]);

  if (!profile) return null;

  const profileName = profile.name;
  const selectedMeta = getGameMeta(gameId);
  const canCreate = selectedMeta?.available === true && !state.busy;

  function renderRooms() {
    return (
      <section className="panel rooms-panel">
        <div className="panel-head">
          <h2>房间列表</h2>
          <div className="head-actions">
            <span className="count">{rooms ? `${rooms.length} 个房间` : "读取中"}</span>
            <button
              className="btn btn-ghost btn-mini"
              onClick={loadRooms}
              aria-label="刷新房间列表"
            >
              ↻
            </button>
          </div>
        </div>

        {rooms && rooms.length === 0 && <p className="game-hint">还没有房间，创建一个吧。</p>}

        <ul className="room-list">
          {rooms?.map((room) => {
            const meta = room.gameId ? getGameMeta(room.gameId) : undefined;
            const full = room.players >= room.capacity;
            const playing = room.phase !== "lobby";
            return (
              <li key={room.code} className="room-row">
                <span className="room-emoji">{meta?.emoji ?? "🎲"}</span>
                <div className="room-info">
                  <div className="room-title">
                    <b>{room.code}</b>
                    <span className="room-game">{meta?.name ?? "未选游戏"}</span>
                  </div>
                  <div className="room-sub">
                    {room.hostName} 的房间 · {room.players}/{room.capacity} 人
                    {playing ? " · 游戏中" : ""}
                  </div>
                </div>
                <button
                  className="btn btn-mini"
                  disabled={full || playing || state.busy}
                  onClick={() => store.joinRoom(room.code, profileName)}
                >
                  {playing ? "游戏中" : full ? "已满" : "加入"}
                </button>
              </li>
            );
          })}
        </ul>
      </section>
    );
  }

  function renderCatalog() {
    return (
      <section className="panel hall-panel">
        <div className="panel-head">
          <h2>游戏大厅</h2>
          <span className="count">选一个开房</span>
        </div>

        <div className="game-grid">
          {GAME_CATALOG.map((meta) => {
            const isSelected = gameId === meta.id;
            return (
              <button
                key={meta.id}
                type="button"
                className={[
                  "game-card",
                  isSelected ? "selected" : "",
                  meta.available ? "" : "locked",
                ]
                  .filter(Boolean)
                  .join(" ")}
                style={{ "--game-accent": meta.accent } as CSSProperties}
                disabled={!meta.available}
                onClick={() => setGameId(meta.id)}
              >
                <span className="game-emoji">{meta.emoji}</span>
                <span className="game-name">{meta.name}</span>
                <span className="game-tagline">{meta.tagline}</span>
                <span className="game-meta">{meta.available ? meta.players : "即将上线"}</span>
                {isSelected && <span className="game-check">✓</span>}
              </button>
            );
          })}
        </div>
      </section>
    );
  }

  return (
    <div className={`home home-hall${isMobile ? " home-mobile" : ""}`}>
      <header className="brand">
        <div className="brand-mark">
          play<span>Go</span>
        </div>
        <p className="brand-sub">一台电脑开房，手机扫码入局</p>
      </header>

      <ProfileBar onEdit={() => setProfileOpen(true)} />

      {isMobile ? (
        <>
          {renderRooms()}

          <button className="btn btn-primary btn-block" onClick={() => setCreateOpen(true)}>
            创建房间
          </button>
          <button className="btn btn-ghost btn-block" onClick={() => setJoinOpen(true)}>
            用房间码加入
          </button>
        </>
      ) : (
        <>
          {renderCatalog()}

          <section className="panel">
            <div className="create-as">
              以 <b>{profileName}</b> 的身份开房
            </div>
            <button
              className="btn btn-primary"
              disabled={!canCreate}
              onClick={() => store.createRoom(profileName, gameId)}
            >
              {state.busy ? "创建中…" : `创建「${selectedMeta?.name ?? "房间"}」`}
            </button>
            <p className="hint">房主电脑会当大屏，手机玩家扫码加入后分队。</p>
          </section>

          {renderRooms()}

          <section className="panel">
            <label className="label" htmlFor="room-code">
              用房间码加入
            </label>
            <div className="row">
              <input
                id="room-code"
                className="input code-input"
                value={code}
                maxLength={4}
                placeholder="房间码"
                autoCapitalize="characters"
                autoComplete="off"
                onChange={(event) =>
                  setCode(event.target.value.toUpperCase().replace(/[^0-9A-Z]/g, ""))
                }
              />
              <button
                className="btn"
                disabled={code.length !== 4 || state.busy}
                onClick={() => store.joinRoom(code, profileName)}
              >
                加入
              </button>
            </div>
          </section>
        </>
      )}

      <footer className="foot">局域网直连 · 不需要联网</footer>

      {createOpen && (
        <div className="modal-mask" onClick={() => setCreateOpen(false)}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <h3>创建房间</h3>
              <button className="btn btn-ghost btn-mini" onClick={() => setCreateOpen(false)}>
                关闭
              </button>
            </div>

            <div className="game-pills">
              {GAME_CATALOG.filter((meta) => meta.available).map((meta) => (
                <button
                  key={meta.id}
                  type="button"
                  className={`game-pill${gameId === meta.id ? " on" : ""}`}
                  style={{ "--game-accent": meta.accent } as CSSProperties}
                  onClick={() => setGameId(meta.id)}
                >
                  <span className="game-pill-emoji">{meta.emoji}</span>
                  <span>{meta.name}</span>
                  {gameId === meta.id && <span className="game-pill-check">✓</span>}
                </button>
              ))}
            </div>

            <p className="hint">以 {profileName} 的身份开房，创建后把二维码给朋友扫。</p>

            <button
              className="btn btn-primary"
              disabled={!canCreate}
              onClick={() => {
                setCreateOpen(false);
                store.createRoom(profileName, gameId);
              }}
            >
              创建「{selectedMeta?.name ?? "房间"}」
            </button>
          </div>
        </div>
      )}

      {joinOpen && (
        <div className="modal-mask" onClick={() => setJoinOpen(false)}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <h3>加入房间</h3>
              <button className="btn btn-ghost btn-mini" onClick={() => setJoinOpen(false)}>
                关闭
              </button>
            </div>

            <input
              className="input code-input"
              value={code}
              maxLength={4}
              placeholder="4 位房间码"
              autoCapitalize="characters"
              autoComplete="off"
              onChange={(event) =>
                setCode(event.target.value.toUpperCase().replace(/[^0-9A-Z]/g, ""))
              }
            />

            <button
              className="btn btn-primary"
              disabled={code.length !== 4 || state.busy}
              onClick={() => {
                setJoinOpen(false);
                store.joinRoom(code, profileName);
              }}
            >
              加入
            </button>
          </div>
        </div>
      )}

      {profileOpen && (
        <div className="modal-mask" onClick={() => setProfileOpen(false)}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <h3>用户资料</h3>
              <button className="btn btn-ghost btn-mini" onClick={() => setProfileOpen(false)}>
                关闭
              </button>
            </div>
            <ProfileEditor
              initial={profile}
              onCancel={() => setProfileOpen(false)}
              onSave={(next) => {
                store.saveProfile(next);
                setProfileOpen(false);
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
