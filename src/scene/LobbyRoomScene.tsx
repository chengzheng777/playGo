import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import type { Player, RoomPreview } from "../../shared/protocol";
import { lobbyMotion } from "../lib/lobby-motion";
import { store } from "../store";
import { createRoomWorld, type RoomWorld } from "./world";

export interface LobbyRoomSceneHandle {
  setJoystick: (x: number, y: number) => void;
}

interface LobbyRoomSceneProps {
  preview: RoomPreview;
  you: Player;
  onUnavailable: () => void;
}

/**
 * 复用入座场景的 three.js 像素房间，只把模式切到 lobby：
 * 准备的人坐椅子、其他人站着，位置实时同步，名字走清晰覆盖层。
 */
export const LobbyRoomScene = forwardRef<LobbyRoomSceneHandle, LobbyRoomSceneProps>(
  function LobbyRoomScene(props, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const worldRef = useRef<RoomWorld | null>(null);
    const latest = useRef(props);
    latest.current = props;

    useEffect(() => {
      const container = containerRef.current;
      if (!container) return;

      const canvas = document.createElement("canvas");
      canvas.className = "lobby-room-canvas";
      canvas.setAttribute("aria-label", "大厅像素房：点地面或按 WASD 移动");
      const labelCanvas = document.createElement("canvas");
      labelCanvas.className = "lobby-room-label";
      container.append(canvas, labelCanvas);

      let world: RoomWorld;
      try {
        const { preview, you } = latest.current;
        world = createRoomWorld(
          canvas,
          labelCanvas,
          preview,
          { name: you.name, avatar: you.avatar },
          {
            onNearSeat: () => {},
            onSitRequest: () => {},
            onSeatSelect: () => {},
            onUnavailable: () => latest.current.onUnavailable(),
          },
          {
            mode: "lobby",
            lobby: {
              localId: you.id,
              onMove: (x, z, facing) => store.movePlayer(x, z, facing),
            },
          },
        );
      } catch (error) {
        console.error("[lobby-room] WebGL 初始化失败", error);
        canvas.remove();
        labelCanvas.remove();
        latest.current.onUnavailable();
        return;
      }
      worldRef.current = world;
      world.setLobbyMotion(lobbyMotion.values());

      const unsubscribe = lobbyMotion.subscribe(() => {
        worldRef.current?.setLobbyMotion(lobbyMotion.values());
      });
      const observer = new ResizeObserver(() => world.resize());
      observer.observe(container);
      const onVisibility = () => {
        if (document.visibilityState === "visible") world.resize();
      };
      document.addEventListener("visibilitychange", onVisibility);

      return () => {
        unsubscribe();
        observer.disconnect();
        document.removeEventListener("visibilitychange", onVisibility);
        world.dispose();
        canvas.remove();
        labelCanvas.remove();
        worldRef.current = null;
      };
    }, []);

    useEffect(() => {
      worldRef.current?.setPreview(props.preview);
      worldRef.current?.setLobbyMotion(lobbyMotion.values());
    }, [props.preview]);

    useEffect(() => {
      worldRef.current?.setProfile({ name: props.you.name, avatar: props.you.avatar });
    }, [props.you.name, props.you.avatar]);

    useImperativeHandle(
      ref,
      () => ({
        setJoystick: (x: number, y: number) => worldRef.current?.setJoystick(x, y),
      }),
      [],
    );

    return <div ref={containerRef} className="lobby-room-scene" />;
  },
);
