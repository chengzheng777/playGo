import type { ChangeEvent, CSSProperties } from "react";
import { useEffect, useState } from "react";
import { analyzePhoto, rgbText, type PhotoAnalysis } from "../lib/photo";
import { store, useAppState } from "../store";
import { AvatarBadge } from "../components/Avatar";

const CONN_LABEL: Record<string, string> = {
  idle: "未连接",
  connecting: "连接中",
  open: "已连接",
  reconnecting: "重连中",
  closed: "已断开",
};

function formatPoints(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export function ColorGameView() {
  const state = useAppState();
  const room = state.room;
  const you = state.you;
  const game = state.color;

  const [now, setNow] = useState(() => Date.now() + state.serverOffset);
  const [local, setLocal] = useState<PhotoAnalysis | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now() + state.serverOffset), 200);
    return () => window.clearInterval(timer);
  }, [state.serverOffset]);

  useEffect(() => {
    setLocal(null);
    setError(null);
  }, [game?.round]);

  if (!room || !you || !game) return null;

  const isHost = room.hostId === you.id;
  const me = game.players.find((player) => player.id === you.id);
  const target = game.target;
  const remaining = Math.max(0, game.deadline - now);
  const seconds = Math.ceil(remaining / 1000);
  const submitted = game.players.filter((player) => player.submitted).length;
  const leaderboard = [...game.players].sort((a, b) => b.score - a.score);
  const myResult = game.results.find((result) => result.playerId === you.id);
  const canShoot = game.phase === "shoot" && !me?.submitted && !busy;

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !game || game.phase !== "shoot") return;
    setBusy(true);
    setError(null);
    try {
      const analysis = await analyzePhoto(file);
      setLocal(analysis);
      store.gameAction({ type: "shoot", rgb: analysis.rgb, photo: analysis.photo });
    } catch {
      setError("这张照片没处理成功，再试一张");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className={`color-game${isHost ? " is-screen" : ""}`}
      style={{ "--target": target.hex } as CSSProperties}
    >
      <header className="game-bar">
        <span className="room-pill">房间 {room.code}</span>
        <span className="color-pill" style={{ background: target.hex }}>
          {target.name}
        </span>
        <span className={`status status-${state.conn}`}>
          <i />
          {CONN_LABEL[state.conn] ?? state.conn}
        </span>
        <div className="game-bar-actions">
          {isHost && game.phase !== "ended" && (
            <button
              className="btn btn-ghost btn-mini"
              onClick={() => {
                if (window.confirm("结束本局，回到大厅？")) store.backToLobby();
              }}
            >
              结束
            </button>
          )}
          <button
            className="btn btn-ghost btn-mini"
            onClick={() => {
              if (window.confirm("离开房间？")) store.leave();
            }}
          >
            离开
          </button>
        </div>
      </header>

      <main className="color-main">
        <div className="color-target">
          <div className="color-swatch" />
          <div className="color-target-info">
            <span className="color-round">
              第 {game.round} / {game.totalRounds} 轮
            </span>
            <h1>{target.name}</h1>
            <span className="color-hex">{target.hex.toUpperCase()}</span>
          </div>
          {game.phase === "shoot" && (
            <div className={`color-timer${seconds <= 10 ? " urgent" : ""}`}>
              <span>{seconds}</span>
              <small>秒</small>
            </div>
          )}
        </div>

        {game.lastEvent && <p className="color-event">{game.lastEvent.text}</p>}

        {game.phase === "shoot" && (
          <>
            <div className="color-players">
              {game.players.map((player) => (
                <div
                  key={player.id}
                  className={`color-player${player.submitted ? " done" : ""}${
                    player.connected ? "" : " offline"
                  }`}
                >
                  <AvatarBadge avatar={player.avatar} size={24} />
                  <span>{player.name}</span>
                  <b>{player.submitted ? "✓" : "…"}</b>
                </div>
              ))}
            </div>

            <div className="color-progress">
              已拍 {submitted} / {game.players.filter((player) => player.connected).length}
            </div>

            {!isHost && (
              <div className="color-shot">
                {me?.submitted ? (
                  <div className="color-preview">
                    {local ? (
                      <img src={local.photo} alt="你拍的照片" />
                    ) : (
                      <div className="color-preview-empty">已提交</div>
                    )}
                    <div className="color-preview-meta">
                      <span className="color-mini-swatch" style={{ background: rgbText(local?.rgb ?? { r: 0, g: 0, b: 0 }) }} />
                      <span>{local ? rgbText(local.rgb) : "等待揭晓"}</span>
                    </div>
                    <p className="color-hint">等其他人拍完，马上揭晓</p>
                  </div>
                ) : (
                  <>
                    <label className={`btn btn-primary btn-block color-shutter${busy ? " busy" : ""}`}>
                      {busy ? "处理中…" : "拍一张"}
                      <input
                        type="file"
                        accept="image/*"
                        capture="environment"
                        hidden
                        disabled={!canShoot}
                        onChange={onFile}
                      />
                    </label>
                    <p className="color-hint">用系统相机拍，取画面中心区域的颜色</p>
                  </>
                )}
                {error && <p className="color-error">{error}</p>}
              </div>
            )}

            {isHost && <p className="color-hint">大屏观战 · 玩家用手机拍照</p>}
          </>
        )}

        {game.phase !== "shoot" && (
          <>
            {isHost ? (
              <div className="color-gallery">
                {game.results.map((result, index) => (
                  <figure
                    key={result.playerId}
                    className={`polaroid${index === 0 ? " best" : ""}`}
                  >
                    {result.photo ? (
                      <img src={result.photo} alt={`${result.name} 的照片`} />
                    ) : (
                      <div className="polaroid-empty" />
                    )}
                    <figcaption>
                      <div className="polaroid-top">
                        <b>{result.name}</b>
                        {index === 0 && <span className="polaroid-crown">🏆</span>}
                      </div>
                      <div className="polaroid-bottom">
                        <span
                          className="color-mini-swatch"
                          style={{ background: rgbText(result.rgb) }}
                        />
                        <span>差 {result.distance}</span>
                        <span className="polaroid-points">+{formatPoints(result.points)}</span>
                      </div>
                    </figcaption>
                  </figure>
                ))}
                {game.results.length === 0 && <p className="color-hint">这一轮没有人提交</p>}
              </div>
            ) : (
              <div className="color-myresult">
                {myResult ? (
                  <>
                    <div className="color-result-head">
                      你的颜色
                      <span className="color-mini-swatch" style={{ background: rgbText(myResult.rgb) }} />
                      {rgbText(myResult.rgb)}
                    </div>
                    <div className="color-result-line">
                      <span>色差 {myResult.distance}</span>
                      <b>+{formatPoints(myResult.points)} 分</b>
                    </div>
                  </>
                ) : (
                  <p className="color-hint">这一轮你没有提交</p>
                )}
              </div>
            )}

            <div className="color-board">
              <div className="color-board-head">
                <span>积分榜</span>
                <span>{game.phase === "ended" ? "最终结果" : "本轮之后"}</span>
              </div>
              {leaderboard.map((player, index) => (
                <div key={player.id} className="color-row">
                  <span className="color-rank">{index + 1}</span>
                  <AvatarBadge avatar={player.avatar} size={26} />
                  <span className="color-row-name">{player.name}</span>
                  <b className="color-score">{formatPoints(player.score)}</b>
                </div>
              ))}
            </div>
          </>
        )}

        {game.phase === "ended" && (
          <div className="color-ended">
            <p className="color-winner">
              🏆 {leaderboard[0]?.name ?? "本局结束"} 获胜
            </p>
            {isHost ? (
              <div className="winner-actions">
                <button className="btn btn-primary btn-block" onClick={() => store.startGame()}>
                  再来一局
                </button>
                <button className="btn btn-ghost btn-block" onClick={() => store.backToLobby()}>
                  返回大厅
                </button>
              </div>
            ) : (
              <p className="wait-host">等房主开下一局</p>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
