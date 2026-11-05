import { useState } from "react";
import { AvatarBadge } from "../components/Avatar";
import { store, useAppState } from "../store";

export function JoinView() {
  const state = useAppState();
  const profile = state.profile;
  const [code, setCode] = useState(state.joinCode);

  if (!profile) return null;

  const canJoin = code.length === 4 && !state.busy;

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

        <div className="join-user">
          <AvatarBadge avatar={profile.avatar} size={34} />
          <span className="join-user-name">{profile.name}</span>
          <span className="count">用这个身份加入</span>
        </div>

        <button
          className="btn btn-primary"
          disabled={!canJoin}
          onClick={() => store.joinRoom(code, profile.name)}
        >
          {state.busy ? "进入中…" : "进入房间"}
        </button>
        <p className="hint">头像和名字会一起带进房间，进去后还能改。</p>
      </section>

      <button className="link" onClick={() => store.leave()}>
        返回大厅
      </button>
    </div>
  );
}
