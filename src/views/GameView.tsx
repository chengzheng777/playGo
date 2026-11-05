import type { FormEvent } from "react";
import { useEffect, useRef, useState } from "react";
import type { Player, Room, YiyuMode, YiyuTeam, YiyuView } from "../../shared/protocol";
import { AvatarBadge } from "../components/Avatar";
import { Confetti } from "../components/Confetti";
import { TimerRing } from "../components/TimerRing";
import { haptics } from "../lib/haptics";
import { isMuted, setMuted, sfx } from "../lib/sound";
import { store, useAppState } from "../store";

const MODE_INFO: Record<
  YiyuMode,
  { label: string; icon: string; hint: string; watch: string }
> = {
  talk: {
    label: "语言",
    icon: "💬",
    hint: "只能用嘴说，不能提到词里的任何一个字",
    watch: "只能用嘴说，听到就喊出来",
  },
  act: {
    label: "动作",
    icon: "🎭",
    hint: "只能比划，一个字都不能说",
    watch: "只能比划，看动作猜",
  },
  lip: {
    label: "唇语",
    icon: "👄",
    hint: "只做口型，不要发出声音",
    watch: "只看嘴型，不许出声",
  },
  rush: {
    label: "抢答",
    icon: "⚡",
    hint: "你来描述，全场都能抢答",
    watch: "全场抢答，用手机输入答案",
  },
};

const CONN_LABEL: Record<string, string> = {
  idle: "未连接",
  connecting: "连接中",
  open: "已连接",
  reconnecting: "重连中",
  closed: "已断开",
};

interface GameRoomProps {
  room: Room;
  you: Player;
  game: YiyuView;
  conn: string;
  serverOffset: number;
}

export function GameView() {
  const state = useAppState();
  if (!state.room || !state.you || !state.game) return null;
  return (
    <GameRoom
      room={state.room}
      you={state.you}
      game={state.game}
      conn={state.conn}
      serverOffset={state.serverOffset}
    />
  );
}

function GameRoom({ room, you, game, conn, serverOffset }: GameRoomProps) {
  const [now, setNow] = useState(() => Date.now() + serverOffset);
  const [guess, setGuess] = useState("");
  const [burst, setBurst] = useState(0);
  const [rain, setRain] = useState(false);
  const [flashKey, setFlashKey] = useState(0);
  const [muted, setMutedState] = useState(isMuted());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now() + serverOffset), 150);
    return () => window.clearInterval(timer);
  }, [serverOffset]);

  const turn = game.turn;
  const phase = game.phase;
  const isHost = room.hostId === you.id;
  const isScreen = isHost;
  const isDescriber = !!turn && turn.describerId === you.id;
  const canScore = isScreen || isDescriber;
  const remaining = turn ? Math.max(0, turn.deadline - now) : 0;
  const total = game.roundSeconds * 1000;
  const critical = phase === "turn" && remaining <= 10_000;

  // 最后 5 秒：每秒一次轻震动 + 滴答声
  const lastTick = useRef<number | null>(null);
  useEffect(() => {
    if (phase !== "turn") {
      lastTick.current = null;
      return;
    }
    const second = Math.ceil(remaining / 1000);
    if (second <= 5 && second > 0 && lastTick.current !== second) {
      lastTick.current = second;
      sfx.tick();
      haptics.tick();
    }
  }, [remaining, phase]);

  // 关键事件：答对 / 超时 / 换回合 / 获胜
  const seenEvent = useRef<number | null>(null);
  useEffect(() => {
    const event = game.lastEvent;
    if (!event) return;
    if (seenEvent.current === event.id) return;
    const firstEvent = seenEvent.current === null;
    seenEvent.current = event.id;
    if (firstEvent) return;

    if (event.kind === "correct") {
      sfx.correct();
      haptics.correct();
      setBurst((value) => value + 1);
      setFlashKey((value) => value + 1);
    } else if (event.kind === "timeout" || event.kind === "skip") {
      sfx.timeout();
      haptics.timeout();
    } else if (event.kind === "turn") {
      sfx.turn();
      haptics.turn();
    } else if (event.kind === "win") {
      sfx.win();
      haptics.win();
      setRain(true);
    }
  }, [game.lastEvent]);

  useEffect(() => {
    if (game.phase !== "ended") setRain(false);
  }, [game.phase]);

  function submitGuess(event: FormEvent) {
    event.preventDefault();
    const text = guess.trim();
    if (!text) return;
    store.gameAction({ type: "guess", text });
    setGuess("");
  }

  function confirmLeave() {
    if (window.confirm("离开房间？这一局就结束了。")) store.leave();
  }

  function confirmBack() {
    if (window.confirm("结束本局，回到大厅？")) store.backToLobby();
  }

  function toggleMute() {
    const next = !muted;
    setMuted(next);
    setMutedState(next);
  }

  if (phase === "ended") {
    const winner = game.teams.find((team) => team.id === game.winnerTeam);
    return (
      <div className="game ended-game" data-team={game.winnerTeam ?? "A"}>
        <Confetti burst={burst} rain={rain} />
        <div className="winner-card">
          <div className="winner-emoji">🏆</div>
          <h2>{winner ? `${winner.name} 获胜` : "本局结束"}</h2>
          <p className="winner-score">
            {game.teams[0].score} <span>:</span> {game.teams[1].score}
          </p>
          {isHost ? (
            <div className="winner-actions">
              <button
                className="btn btn-primary btn-block"
                onClick={() => {
                  setRain(false);
                  store.startGame();
                }}
              >
                再来一局
              </button>
              <button
                className="btn btn-ghost btn-block"
                onClick={() => {
                  setRain(false);
                  store.backToLobby();
                }}
              >
                返回大厅
              </button>
            </div>
          ) : (
            <p className="wait-host">等房主开下一局</p>
          )}
        </div>
      </div>
    );
  }

  const activeTeam = game.teams.find((team) => team.id === turn?.teamId);

  return (
    <div
      className={`game${isScreen ? " screen-mode" : " phone-mode"}`}
      data-team={turn?.teamId ?? "A"}
    >
      <Confetti burst={burst} rain={rain} />
      {flashKey > 0 && <div key={flashKey} className="flash" />}
      {critical && <div className="vignette on" />}

      <header className="game-bar">
        <span className="room-pill">房间 {room.code}</span>
        {isScreen && <span className="screen-pill">大屏</span>}
        <span className={`status status-${conn}`}>
          <i />
          {CONN_LABEL[conn] ?? conn}
        </span>
        <div className="game-bar-actions">
          <button className="btn btn-ghost btn-mini" onClick={toggleMute} aria-label="声音开关">
            {muted ? "🔇" : "🔊"}
          </button>
          {isHost && (
            <button className="btn btn-ghost btn-mini" onClick={confirmBack}>
              结束
            </button>
          )}
          <button className="btn btn-ghost btn-mini" onClick={confirmLeave}>
            离开
          </button>
        </div>
      </header>

      <div className="scoreboard">
        {game.teams.map((team) => (
          <TeamCard
            key={team.id}
            team={team}
            target={game.targetScore}
            active={team.id === turn?.teamId}
            describerId={turn?.describerId}
            youId={you.id}
          />
        ))}
      </div>

      <main className="arena-wrap">
        {phase === "turn" && turn ? (
          isScreen ? (
            <ScreenTurn
              game={game}
              turn={turn}
              teamName={activeTeam?.name ?? ""}
              remaining={remaining}
              total={total}
              critical={critical}
            />
          ) : (
            <PhoneTurn
              game={game}
              turn={turn}
              teamName={activeTeam?.name ?? ""}
              remaining={remaining}
              total={total}
              critical={critical}
              isDescriber={isDescriber}
              canScore={canScore}
              guess={guess}
              setGuess={setGuess}
              submitGuess={submitGuess}
            />
          )
        ) : (
          <section className={`arena reveal result-${turn?.result ?? "timeout"}`}>
            <div className="result-banner">
              {turn?.result === "correct" ? "答对了！" : turn?.result === "skip" ? "跳过" : "时间到"}
              {turn?.result === "correct" && <span className="result-sub">+1</span>}
            </div>
            <div className="word-card revealed" key={turn?.deadline}>
              <span className="word-label">答案</span>
              <span className="word">{turn?.word}</span>
            </div>
            <p className="next-hint">下一回合马上开始…</p>
          </section>
        )}
      </main>
    </div>
  );
}

function ScreenTurn({
  game,
  turn,
  teamName,
  remaining,
  total,
  critical,
}: {
  game: YiyuView;
  turn: NonNullable<YiyuView["turn"]>;
  teamName: string;
  remaining: number;
  total: number;
  critical: boolean;
}) {
  return (
    <section className="arena screen-arena">
      <div className="turn-head">
        <span className="mode-chip" data-mode={turn.mode}>
          <b>{MODE_INFO[turn.mode].icon}</b>
          {MODE_INFO[turn.mode].label}
        </span>
        <span className="turn-team">
          {teamName}回合 · {turn.describerName} 描述
        </span>
      </div>

      <div className="word-card" key={turn.deadline}>
        <span className="word-label">请描述这个词</span>
        <span className="word">{turn.word}</span>
        <span className="word-hint">{MODE_INFO[turn.mode].hint}</span>
      </div>

      <TimerRing remaining={remaining} total={total} critical={critical} />

      <div className="turn-actions">
        <button
          className="btn btn-primary btn-big"
          onClick={() => store.gameAction({ type: "correct" })}
        >
          猜对了 +1
        </button>
        <button className="btn btn-ghost" onClick={() => store.gameAction({ type: "skip" })}>
          跳过
        </button>
      </div>

      {game.round > 0 && <p className="screen-foot">第 {game.round} 轮 · 先到 {game.targetScore} 分</p>}
    </section>
  );
}

function PhoneTurn({
  game,
  turn,
  teamName,
  remaining,
  total,
  critical,
  isDescriber,
  canScore,
  guess,
  setGuess,
  submitGuess,
}: {
  game: YiyuView;
  turn: NonNullable<YiyuView["turn"]>;
  teamName: string;
  remaining: number;
  total: number;
  critical: boolean;
  isDescriber: boolean;
  canScore: boolean;
  guess: string;
  setGuess: (value: string) => void;
  submitGuess: (event: FormEvent) => void;
}) {
  const info = MODE_INFO[turn.mode];

  return (
    <section className="arena phone-arena">
      <div className="turn-head">
        <span className="mode-chip" data-mode={turn.mode}>
          <b>{info.icon}</b>
          {info.label}
        </span>
        <span className="turn-team">{teamName}回合</span>
      </div>

      <div className={`phone-card${isDescriber ? " is-describer" : ""}`}>
        <span className="phone-emoji">{isDescriber ? "👀" : "🙈"}</span>
        <h2>{isDescriber ? "看电脑屏幕" : "把背转向电脑"}</h2>
        <p className="phone-sub">
          {isDescriber ? "你是描述者" : "别偷看，用耳朵和脑子"}
        </p>
        <p className="phone-hint">
          {isDescriber ? info.hint : `${turn.describerName} 正在用「${info.label}」描述`}
        </p>
      </div>

      <TimerRing remaining={remaining} total={total} critical={critical} />

      {canScore && (
        <div className="turn-actions">
          <button
            className="btn btn-primary btn-big"
            onClick={() => store.gameAction({ type: "correct" })}
          >
            猜对了 +1
          </button>
          <button className="btn btn-ghost" onClick={() => store.gameAction({ type: "skip" })}>
            跳过
          </button>
        </div>
      )}

      {!isDescriber && turn.mode === "rush" && (
        <form className="guess-form" onSubmit={submitGuess}>
          <input
            className="input"
            value={guess}
            maxLength={24}
            placeholder="输入答案，先到先得"
            onChange={(event) => setGuess(event.target.value)}
          />
          <button className="btn btn-primary" type="submit" disabled={!guess.trim()}>
            抢答
          </button>
        </form>
      )}

      {turn.guesses.length > 0 && (
        <ul className="guess-feed">
          {turn.guesses
            .slice()
            .reverse()
            .map((item, index) => (
              <li key={`${item.playerId}-${index}`} className={item.ok ? "ok" : ""}>
                <b>{item.name}</b>
                {item.text}
              </li>
            ))}
        </ul>
      )}

      <p className="screen-foot">先到 {game.targetScore} 分</p>
    </section>
  );
}

function TeamCard({
  team,
  target,
  active,
  describerId,
  youId,
}: {
  team: YiyuTeam;
  target: number;
  active: boolean;
  describerId?: string;
  youId: string;
}) {
  const percent = Math.min(100, (team.score / target) * 100);

  return (
    <div className={`team-card team-${team.id}${active ? " active" : ""}`}>
      <div className="team-top">
        <span className="team-name">{team.name}</span>
        <span className="team-score" key={`${team.id}-${team.score}`}>
          {team.score}
        </span>
      </div>
      <div className="team-progress">
        <i style={{ width: `${percent}%` }} />
      </div>
      <div className="team-members">
        {team.members.map((member) => (
          <span
            key={member.id}
            className={[
              "member",
              member.id === describerId ? "describer" : "",
              member.id === youId ? "me" : "",
              member.connected ? "" : "offline",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            <AvatarBadge avatar={member.avatar} size={16} />
            {member.name}
          </span>
        ))}
      </div>
    </div>
  );
}
