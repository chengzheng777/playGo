import { useState } from "react";
import { store, useAppState } from "../store";

export function JoinView() {
  const state = useAppState();
  const [name, setName] = useState(state.nickname);
  const [code, setCode] = useState(state.joinCode);
  const canJoin = name.trim().length > 0 && code.length === 4 && !state.busy;

  return (
    <div className="home join">
      <header className="brand">
        <div className="brand-mark">
          play<span>Go</span>
        </div>
        <p className="brand-sub">有人开了个房间，等你入座</p>
      </header>

      <section className="panel">
        <div className="join-room">
          <span className="label">房间码</span>
          {state.joinCode ? (
            <div className="join-code">{state.joinCode}</div>
          ) : (
            <input
              className="input code-input"
              value={code}
              maxLength={4}
              placeholder="房间码"
              autoCapitalize="characters"
              onChange={(event) =>
                setCode(event.target.value.toUpperCase().replace(/[^0-9A-Z]/g, ""))
              }
            />
          )}
        </div>

        <label className="label" htmlFor="join-name">
          你的名字
        </label>
        <input
          id="join-name"
          className="input"
          value={name}
          maxLength={16}
          placeholder="比如：小明"
          autoComplete="nickname"
          onChange={(event) => setName(event.target.value)}
        />

        <button
          className="btn btn-primary"
          disabled={!canJoin}
          onClick={() => store.joinRoom(code, name)}
        >
          {state.busy ? "进入中…" : "进入房间"}
        </button>
        <p className="hint">名字会显示在房间里，重名的话换一个。</p>
      </section>

      <button className="link" onClick={() => store.leave()}>
        我自己开一个房间
      </button>
    </div>
  );
}
