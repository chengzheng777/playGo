import { getGameMeta } from "../../shared/games";
import type { Profile } from "../store";
import { AvatarBadge } from "./Avatar";

export function JoinRoomHud({
  code,
  gameId,
  hostName,
  seated,
  playable,
  profile,
  onBack,
  onEditProfile,
}: {
  code: string;
  gameId: string | null;
  hostName: string;
  seated: number;
  playable: number;
  profile: Profile;
  onBack: () => void;
  onEditProfile: () => void;
}) {
  const game = gameId ? getGameMeta(gameId) : undefined;

  return (
    <header className="join-hud">
      <button className="join-icon-btn" onClick={onBack} aria-label="返回大厅" type="button">
        ←
      </button>

      <div className="join-hud-room">
        <div className="join-hud-code">
          <span>房间</span>
          <b>{code}</b>
        </div>
        <div className="join-hud-meta">
          <span className="join-hud-game">
            {game?.emoji ?? "🎲"} {game?.name ?? "还没选游戏"}
          </span>
          <span className="join-hud-host">房主 {hostName}</span>
        </div>
      </div>

      <div className="join-hud-seats">
        <b>{seated}</b>
        <span>/{playable}</span>
      </div>

      <button
        className="join-hud-profile"
        onClick={onEditProfile}
        aria-label="修改名字和头像"
        type="button"
      >
        <AvatarBadge avatar={profile.avatar} size={28} />
        <span>{profile.name}</span>
      </button>
    </header>
  );
}
