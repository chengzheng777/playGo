import type { Player } from "../../shared/protocol";
import { AvatarBadge } from "./Avatar";

export function PlayerList({
  players,
  youId,
  hostId,
}: {
  players: Player[];
  youId: string;
  hostId: string;
}) {
  return (
    <section className="panel players-panel">
      <div className="panel-head">
        <h2>玩家</h2>
        <span className="count">{players.filter((p) => p.connected).length} 人在线</span>
      </div>

      <ul className="players">
        {players.map((player) => (
          <li key={player.id} className={`player${player.connected ? "" : " offline"}`}>
            <AvatarBadge avatar={player.avatar} size={32} />
            <span className="pname">
              {player.name}
              {player.id === youId && <span className="me">你</span>}
            </span>
            <span className="tags">
              {player.id === hostId && <span className="tag tag-host">大屏</span>}
              {player.ready && player.id !== hostId && (
                <span className="tag tag-ready">已准备</span>
              )}
              {!player.connected && <span className="tag tag-off">掉线</span>}
            </span>
          </li>
        ))}
      </ul>

      {players.length === 1 && (
        <p className="empty-hint">把二维码给朋友扫，人就来了。</p>
      )}
    </section>
  );
}
