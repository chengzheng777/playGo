import type { Player, UnoAction, UnoCard, UnoColor, UnoView } from "../../shared/protocol";

const COLORS: UnoColor[] = ["red", "yellow", "green", "blue"];

function buildDeck(): UnoCard[] {
  const cards: UnoCard[] = [];
  let seq = 0;
  const make = (color: UnoCard["color"], kind: UnoCard["kind"], value?: number): UnoCard => ({
    id: `c${++seq}`,
    color,
    kind,
    value,
  });

  for (const color of COLORS) {
    cards.push(make(color, "number", 0));
    for (let value = 1; value <= 9; value++) {
      cards.push(make(color, "number", value));
      cards.push(make(color, "number", value));
    }
    for (const kind of ["skip", "reverse", "draw2"] as const) {
      cards.push(make(color, kind));
      cards.push(make(color, kind));
    }
  }

  for (let i = 0; i < 4; i++) {
    cards.push(make("wild", "wild"));
    cards.push(make("wild", "wild4"));
  }

  return cards;
}

function shuffle<T>(input: T[]): T[] {
  const list = [...input];
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

interface UnoPlayerState {
  id: string;
  name: string;
  avatar: Player["avatar"];
  connected: boolean;
  hand: UnoCard[];
}

export class UnoGame {
  readonly gameId = "uno" as const;
  phase: "turn" | "ended" = "turn";
  winnerId?: string;

  private readonly players: UnoPlayerState[] = [];
  private turn = 0;
  private direction: 1 | -1 = 1;
  private drawPile: UnoCard[] = [];
  private discard: UnoCard[] = [];
  private currentColor: UnoColor = "red";
  private mustDraw = false;
  private drawnCardId: string | null = null;
  private eventSeq = 0;
  private lastEvent: { id: number; text: string } | null = null;

  constructor(players: Player[], now: number) {
    [...players]
      .sort((a, b) => a.seat - b.seat)
      .forEach((player) => {
        this.players.push({
          id: player.id,
          name: player.name,
          avatar: { ...player.avatar },
          connected: player.connected,
          hand: [],
        });
      });

    this.drawPile = shuffle(buildDeck());

    for (let round = 0; round < 7; round++) {
      for (const player of this.players) {
        const card = this.drawPile.pop();
        if (card) player.hand.push(card);
      }
    }

    // 开局第一张必须是数字牌，规则简单一点
    let first = this.drawPile.pop();
    while (first && first.kind !== "number") {
      this.drawPile.unshift(first);
      first = this.drawPile.pop();
    }
    this.discard = [first ?? { id: "c0", color: "red", kind: "number", value: 0 }];
    this.currentColor =
      this.discard[0].color === "wild" ? "red" : (this.discard[0].color as UnoColor);

    void now;
    this.emit(`开局：${this.players[this.turn]?.name ?? ""} 先手`);
  }

  setConnected(playerId: string, connected: boolean): void {
    const player = this.players.find((item) => item.id === playerId);
    if (player) player.connected = connected;
  }

  action(playerId: string, action: UnoAction, now: number): boolean {
    if (this.phase !== "turn") return false;
    const player = this.players[this.turn];
    if (!player || player.id !== playerId) return false;

    if (action.type === "play") {
      const index = player.hand.findIndex((card) => card.id === action.cardId);
      if (index === -1) return false;
      const card = player.hand[index];
      if (this.mustDraw && card.id !== this.drawnCardId) return false;
      if (!this.playable(card)) return false;
      if ((card.kind === "wild" || card.kind === "wild4") && !action.color) return false;

      player.hand.splice(index, 1);
      this.discard.push(card);
      this.currentColor =
        card.color === "wild" ? (action.color ?? this.currentColor) : card.color;

      this.mustDraw = false;
      this.drawnCardId = null;

      if (player.hand.length === 0) {
        this.phase = "ended";
        this.winnerId = player.id;
        this.emit(`${player.name} 打完手牌，获胜！`);
        return true;
      }

      this.emit(`${player.name} 打出 ${this.cardLabel(card)}`);
      this.applyEffect(card);
      void now;
      return true;
    }

    if (action.type === "draw") {
      if (this.mustDraw) return false;
      const card = this.takeCard();
      player.hand.push(card);
      if (this.playable(card)) {
        this.mustDraw = true;
        this.drawnCardId = card.id;
        this.emit(`${player.name} 摸了一张，可以出`);
      } else {
        this.emit(`${player.name} 摸了一张，过`);
        this.advance(1);
        this.emitNextTurn();
      }
      return true;
    }

    if (action.type === "pass") {
      if (!this.mustDraw) return false;
      this.mustDraw = false;
      this.drawnCardId = null;
      this.emit(`${player.name} 选择不出`);
      this.advance(1);
      this.emitNextTurn();
      return true;
    }

    return false;
  }

  viewFor(playerId: string): UnoView {
    const me = this.players.find((player) => player.id === playerId);
    const isTurn = this.players[this.turn]?.id === playerId;
    const playableIds =
      me && isTurn && this.phase === "turn"
        ? me.hand
            .filter(
              (card) =>
                (!this.mustDraw || card.id === this.drawnCardId) && this.playable(card),
            )
            .map((card) => card.id)
        : [];

    return {
      gameId: "uno",
      phase: this.phase,
      players: this.players.map((player) => ({
        id: player.id,
        name: player.name,
        avatar: { ...player.avatar },
        handCount: player.hand.length,
        connected: player.connected,
      })),
      turnPlayerId: this.players[this.turn]?.id ?? "",
      direction: this.direction,
      currentColor: this.currentColor,
      discardTop: { ...this.discard[this.discard.length - 1] },
      drawCount: this.drawPile.length,
      hand: me?.hand.map((card) => ({ ...card })) ?? [],
      playableIds,
      mustDraw: isTurn && this.mustDraw,
      winnerId: this.winnerId,
      lastEvent: this.lastEvent,
    };
  }

  private playable(card: UnoCard): boolean {
    if (card.kind === "wild" || card.kind === "wild4") return true;
    const top = this.discard[this.discard.length - 1];
    if (!top) return true;
    if (card.color === this.currentColor) return true;
    if (card.kind === "number" && top.kind === "number" && card.value === top.value) {
      return true;
    }
    if (card.kind !== "number" && card.kind === top.kind) return true;
    return false;
  }

  private applyEffect(card: UnoCard): void {
    switch (card.kind) {
      case "skip":
        this.advance(2);
        break;
      case "reverse":
        this.direction = this.direction === 1 ? -1 : 1;
        this.advance(this.players.length === 2 ? 2 : 1);
        break;
      case "draw2":
        this.giveNext(2);
        this.advance(2);
        break;
      case "wild4":
        this.giveNext(4);
        this.advance(2);
        break;
      default:
        this.advance(1);
    }
    this.emitNextTurn();
  }

  private giveNext(count: number): void {
    const nextIndex = (this.turn + this.direction + this.players.length) % this.players.length;
    const target = this.players[nextIndex];
    if (!target) return;
    for (let i = 0; i < count; i++) target.hand.push(this.takeCard());
    this.emit(`${target.name} 摸 ${count} 张`);
  }

  private advance(steps: number): void {
    const total = this.players.length;
    this.turn = (this.turn + this.direction * steps + total * 4) % total;
  }

  private takeCard(): UnoCard {
    if (this.drawPile.length === 0) {
      const top = this.discard.pop();
      this.drawPile = shuffle(this.discard);
      this.discard = top ? [top] : [];
      if (this.drawPile.length === 0) this.drawPile = shuffle(buildDeck());
    }
    return this.drawPile.pop() as UnoCard;
  }

  private emitNextTurn(): void {
    const player = this.players[this.turn];
    if (player) this.emit(`轮到 ${player.name}`);
  }

  private emit(text: string): void {
    this.eventSeq += 1;
    this.lastEvent = { id: this.eventSeq, text };
  }

  private cardLabel(card: UnoCard): string {
    if (card.kind === "number") return `${card.value}`;
    if (card.kind === "skip") return "跳过";
    if (card.kind === "reverse") return "反转";
    if (card.kind === "draw2") return "+2";
    if (card.kind === "wild") return "变色";
    return "+4 变色";
  }
}
