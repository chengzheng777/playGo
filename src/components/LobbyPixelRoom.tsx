import type { ReactNode } from "react";
import { lazy, Suspense, useMemo, useRef, useState } from "react";
import type { Player, Room, RoomPreview, RoomSeatView } from "../../shared/protocol";
import { useMediaQuery } from "../lib/useMediaQuery";
import type { LobbyRoomSceneHandle } from "../scene/LobbyRoomScene";
import { Joystick } from "./Joystick";

const LobbyRoomScene = lazy(() =>
  import("../scene/LobbyRoomScene").then((module) => ({ default: module.LobbyRoomScene })),
);

/**
 * 大厅里的像素候场房：和入座场景共用同一套 three.js 房间与像素渲染，
 * 准备的人坐椅子，没准备的人站在旁边；准备后仍能起来走动。
 */
export function LobbyPixelRoom({
  room,
  you,
  gameId,
  overlay,
}: {
  room: Room;
  you: Player;
  gameId: string | null;
  overlay?: ReactNode;
}) {
  const sceneRef = useRef<LobbyRoomSceneHandle>(null);
  const coarse = useMediaQuery("(pointer: coarse)");
  const [failed, setFailed] = useState(false);

  const preview = useMemo<RoomPreview>(() => {
    const seats: (RoomSeatView | null)[] = new Array(room.maxPlayers).fill(null);
    for (const player of room.players) {
      if (player.role === "spectator") continue;
      if (player.seat < 0 || player.seat >= seats.length) continue;
      seats[player.seat] = {
        seat: player.seat,
        role: player.role,
        name: player.name,
        avatar: player.avatar,
        connected: player.connected,
        id: player.id,
        ready: player.ready,
        x: player.x,
        z: player.z,
        facing: player.facing,
      };
    }
    const host = room.players.find((player) => player.id === room.hostId);
    const hostSeat = host && host.seat >= 0 && host.seat < room.maxPlayers ? host.seat : -1;
    return {
      code: room.code,
      phase: room.phase,
      maxPlayers: room.maxPlayers,
      hostPlays: room.hostPlays,
      hostSeat,
      host: {
        name: host?.name ?? "房主",
        avatar: host?.avatar ?? you.avatar,
      },
      gameId,
      seats,
    };
  }, [room, gameId, you.avatar]);

  return (
    <section className="panel lobby-room">
      <div className="lobby-room-head">
        <div>
          <h2>候场</h2>
          <span className="count">房间 {room.code}</span>
        </div>
        <span className="lobby-room-tip">准备后也能起来走</span>
      </div>

      <div className="lobby-room-stage">
        {failed ? (
          <div className="lobby-room-failed">
            <b>这台设备暂时画不了像素房</b>
            <span>浏览器没有可用的 WebGL；准备和开局不受影响。</span>
          </div>
        ) : (
          <Suspense
            fallback={
              <div className="lobby-room-loading">
                <div className="pixel-loader" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </div>
                <span>正在搭房间…</span>
              </div>
            }
          >
            <LobbyRoomScene
              ref={sceneRef}
              preview={preview}
              you={you}
              onUnavailable={() => setFailed(true)}
            />
          </Suspense>
        )}
        {overlay}
        {coarse && !failed && (
          <Joystick className="compact" onChange={(x, y) => sceneRef.current?.setJoystick(x, y)} />
        )}
      </div>

      <p className="lobby-room-foot">
        点地面 / WASD 移动。准备后仍可以站起在桌边走动，位置会同步给房间里的人。
      </p>
    </section>
  );
}
