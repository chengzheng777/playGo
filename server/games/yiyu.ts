import type {
  Player,
  YiyuAction,
  YiyuEvent,
  YiyuMode,
  YiyuPhase,
  YiyuResult,
  YiyuTeamId,
  YiyuView,
} from "../../shared/protocol";
import { WORDS } from "./words";

const MODES: readonly YiyuMode[] = ["talk", "act", "lip", "rush"];
const TEAM_NAME: Record<YiyuTeamId, string> = { A: "青队", B: "橙队" };

interface Member {
  id: string;
  name: string;
  team: YiyuTeamId;
  connected: boolean;
}

interface Team {
  score: number;
  cursor: number;
  members: Member[];
}

interface TurnState {
  teamId: YiyuTeamId;
  describerId: string;
  describerName: string;
  mode: YiyuMode;
  word: string;
  deadline: number;
  guesses: { playerId: string; name: string; text: string; ok: boolean }[];
  result?: YiyuResult;
  winnerName?: string;
}

export interface YiyuOptions {
  targetScore: number;
  roundSeconds: number;
}

function normalize(text: string): string {
  return text.replace(/[\s，。！？、,.!?：:；;“”"'（）()]/g, "").toLowerCase();
}

/**
 * 一愚惊人 · 服务端权威规则。
 *
 * 分队：按座位奇偶自动分成青队 / 橙队。
 * 回合：两队交替，每队轮流派一人当描述者；描述者看到词，队友在现实里喊答案。
 * 模式：语言 / 动作 / 唇语 / 抢答，每回合随机。
 * 抢答：全场都能提交答案，谁先答对，分算谁的队。
 *
 * 所有方法都接收 now，方便测试里注入时间。
 */
export class YiyuGame {
  readonly gameId = "yiyu" as const;
  phase: YiyuPhase = "turn";
  round = 0;
  winnerTeam?: YiyuTeamId;
  lastEvent: YiyuEvent | null = null;

  private readonly targetScore: number;
  private readonly roundMs: number;
  private readonly teams: Record<YiyuTeamId, Team> = {
    A: { score: 0, cursor: 0, members: [] },
    B: { score: 0, cursor: 0, members: [] },
  };
  private readonly used = new Set<string>();

  private turn: TurnState | null = null;
  private currentTeam: YiyuTeamId = "B";
  private revealUntil = 0;
  private eventSeq = 0;
  private lastMode: YiyuMode | null = null;

  constructor(players: Player[], options: YiyuOptions, now: number) {
    this.targetScore = options.targetScore;
    this.roundMs = options.roundSeconds * 1000;

    [...players]
      .sort((a, b) => a.seat - b.seat)
      .forEach((player, index) => {
        const team: YiyuTeamId = index % 2 === 0 ? "A" : "B";
        this.teams[team].members.push({
          id: player.id,
          name: player.name,
          team,
          connected: player.connected,
        });
      });

    this.startTurn(now);
  }

  setConnected(playerId: string, connected: boolean): void {
    const member = this.findMember(playerId);
    if (member) member.connected = connected;
  }

  action(playerId: string, action: YiyuAction, now: number): boolean {
    const turn = this.turn;
    if (this.phase !== "turn" || !turn) return false;

    if (action.type === "correct" || action.type === "skip") {
      if (playerId !== turn.describerId) return false;
      this.resolve(action.type, now);
      return true;
    }

    if (action.type === "guess") {
      if (turn.mode !== "rush") return false;
      if (playerId === turn.describerId) return false;
      const member = this.findMember(playerId);
      if (!member) return false;

      const text = action.text.trim().slice(0, 24);
      if (!text) return false;

      const ok = normalize(text) === normalize(turn.word);
      turn.guesses.push({ playerId, name: member.name, text, ok });
      if (turn.guesses.length > 8) turn.guesses.splice(0, turn.guesses.length - 8);

      if (ok) this.resolve("correct", now, playerId);
      return true;
    }

    return false;
  }

  tick(now: number): boolean {
    if (this.phase === "turn" && this.turn && now >= this.turn.deadline) {
      this.resolve("timeout", now);
      return true;
    }
    if (this.phase === "reveal" && now >= this.revealUntil) {
      this.startTurn(now);
      return true;
    }
    return false;
  }

  viewFor(playerId: string): YiyuView {
    const turn = this.turn;
    const isDescriber = turn?.describerId === playerId;
    const reveal = this.phase !== "turn";

    return {
      gameId: "yiyu",
      phase: this.phase,
      round: this.round,
      targetScore: this.targetScore,
      roundSeconds: this.roundMs / 1000,
      teams: (["A", "B"] as const).map((id) => ({
        id,
        name: TEAM_NAME[id],
        score: this.teams[id].score,
        members: this.teams[id].members.map((member) => ({
          id: member.id,
          name: member.name,
          connected: member.connected,
        })),
      })),
      turn: turn
        ? {
            teamId: turn.teamId,
            describerId: turn.describerId,
            describerName: turn.describerName,
            mode: turn.mode,
            deadline: turn.deadline,
            word: isDescriber || reveal ? turn.word : undefined,
            guesses: turn.guesses.map((guess) => ({ ...guess })),
            result: turn.result,
            winnerName: turn.winnerName,
          }
        : null,
      winnerTeam: this.winnerTeam,
      lastEvent: this.lastEvent,
    };
  }

  private startTurn(now: number): void {
    this.round += 1;

    let teamId: YiyuTeamId = this.currentTeam === "A" ? "B" : "A";
    let describer = this.pickDescriber(teamId);
    if (!describer) {
      teamId = teamId === "A" ? "B" : "A";
      describer = this.pickDescriber(teamId);
    }
    if (!describer) {
      this.phase = "ended";
      this.emit("win", "没有可出场的玩家");
      return;
    }

    this.currentTeam = teamId;
    const word = this.pickWord();

    this.turn = {
      teamId,
      describerId: describer.id,
      describerName: describer.name,
      mode: this.pickMode(),
      word,
      deadline: now + this.roundMs,
      guesses: [],
    };
    this.phase = "turn";
    this.emit("turn", `${TEAM_NAME[teamId]} · ${describer.name} 来比划`);
  }

  private pickDescriber(teamId: YiyuTeamId): Member | null {
    const team = this.teams[teamId];
    const count = team.members.length;
    if (count === 0) return null;

    for (let offset = 0; offset < count; offset++) {
      const index = (team.cursor + offset) % count;
      const member = team.members[index];
      if (member.connected) {
        team.cursor = (index + 1) % count;
        return member;
      }
    }
    return null;
  }

  private pickMode(): YiyuMode {
    const pool = MODES.filter((mode) => mode !== this.lastMode);
    const mode = pool[Math.floor(Math.random() * pool.length)];
    this.lastMode = mode;
    return mode;
  }

  private pickWord(): string {
    if (this.used.size >= WORDS.length) this.used.clear();
    const pool = WORDS.filter((word) => !this.used.has(word));
    const word = pool[Math.floor(Math.random() * pool.length)];
    this.used.add(word);
    return word;
  }

  private resolve(result: YiyuResult, now: number, winnerId?: string): void {
    const turn = this.turn;
    if (!turn) return;

    let scoredTeam = turn.teamId;
    if (winnerId) {
      const winner = this.findMember(winnerId);
      if (winner) scoredTeam = winner.team;
      turn.winnerName = winner?.name;
    }

    if (result === "correct") this.teams[scoredTeam].score += 1;
    turn.result = result;

    if (result === "correct" && this.teams[scoredTeam].score >= this.targetScore) {
      this.winnerTeam = scoredTeam;
      this.phase = "ended";
      this.emit("win", `${TEAM_NAME[scoredTeam]} 先到 ${this.targetScore} 分，拿下这一局`);
      return;
    }

    this.phase = "reveal";
    this.revealUntil = now + (result === "correct" ? 1900 : 2300);

    if (result === "correct") {
      const who = turn.winnerName ? `${turn.winnerName} 抢答` : turn.describerName;
      this.emit("correct", `${who} 答对了，${TEAM_NAME[scoredTeam]} +1`);
    } else if (result === "skip") {
      this.emit("skip", "跳过了这个词");
    } else {
      this.emit("timeout", "时间到，换下一队");
    }
  }

  private findMember(playerId: string): Member | undefined {
    return (
      this.teams.A.members.find((member) => member.id === playerId) ??
      this.teams.B.members.find((member) => member.id === playerId)
    );
  }

  private emit(kind: YiyuEvent["kind"], text: string): void {
    this.eventSeq += 1;
    this.lastEvent = { id: this.eventSeq, kind, text };
  }
}
