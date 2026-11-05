import type { CSSProperties } from "react";
import { useState } from "react";
import { GAME_CATALOG, getGameMeta } from "../../shared/games";
import { store, useAppState } from "../store";

export function HomeView() {
  const state = useAppState();
  const [name, setName] = useState(state.nickname);
  const [code, setCode] = useState("");
  const [gameId, setGameId] = useState("yiyu");

  const nameReady = name.trim().length > 0;
  const selectedMeta = getGameMeta(gameId);
  const canCreate = nameReady && selectedMeta?.available === true && !state.busy;
  const canAct = nameReady && !state.busy;

  return (
    <div className="home home-hall">
      <header className="brand">
        <div className="brand-mark">
          play<span>Go</span>
        </div>
        <p className="brand-sub">一台电脑开房，手机扫码入局</p>
      </header>

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

        <p className="game-hint">选中一个游戏，创建房间后就能拉人。</p>
      </section>

      <section className="panel">
        <label className="label" htmlFor="player-name">
          你的名字
        </label>
        <input
          id="player-name"
          className="input"
          value={name}
          maxLength={16}
          placeholder="比如：小明"
          autoComplete="nickname"
          onChange={(event) => setName(event.target.value)}
        />

        <button
          className="btn btn-primary"
          disabled={!canCreate}
          onClick={() => store.createRoom(name, gameId)}
        >
          {state.busy ? "创建中…" : `创建「${selectedMeta?.name ?? "房间"}」`}
        </button>
        <p className="hint">房主电脑会当大屏，手机玩家扫码加入后分队。</p>
      </section>

      <section className="panel">
        <label className="label" htmlFor="room-code">
          加入别人的房间
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
            disabled={!canAct || code.length !== 4}
            onClick={() => store.joinRoom(code, name)}
          >
            加入
          </button>
        </div>
      </section>

      <footer className="foot">局域网直连 · 不需要联网</footer>
    </div>
  );
}
