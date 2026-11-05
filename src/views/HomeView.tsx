import { useState } from "react";
import { store, useAppState } from "../store";

export function HomeView() {
  const state = useAppState();
  const [name, setName] = useState(state.nickname);
  const [code, setCode] = useState("");

  const nameReady = name.trim().length > 0;
  const canAct = nameReady && !state.busy;

  return (
    <div className="home">
      <header className="brand">
        <div className="brand-mark">
          play<span>Go</span>
        </div>
        <p className="brand-sub">一台电脑开房，手机扫码入局</p>
      </header>

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
          disabled={!canAct}
          onClick={() => store.createRoom(name)}
        >
          {state.busy ? "创建中…" : "创建房间"}
        </button>
        <p className="hint">创建后会显示二维码，手机用相机扫一扫就能进来。</p>
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
