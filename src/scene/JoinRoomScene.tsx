import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import type { RoomPreview, RoomSeatView } from "../../shared/protocol";
import type { Profile } from "../store";
import { createRoomWorld, type RoomWorld } from "./world";

export interface JoinRoomSceneHandle {
  sit: (seat?: number) => void;
  standUp: () => void;
  setJoystick: (x: number, y: number) => void;
}

interface JoinRoomSceneProps {
  preview: RoomPreview;
  profile: Profile;
  disabled: boolean;
  onNearSeat: (seat: number | null) => void;
  onSitRequest: (seat: number) => void;
  onSeatSelect: (seat: RoomSeatView) => void;
  onUnavailable: () => void;
}

export const JoinRoomScene = forwardRef<JoinRoomSceneHandle, JoinRoomSceneProps>(
  function JoinRoomScene(props, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const worldRef = useRef<RoomWorld | null>(null);
    const latest = useRef(props);
    latest.current = props;

    useEffect(() => {
      const container = containerRef.current;
      if (!container) return;

      const canvas = document.createElement("canvas");
      canvas.className = "scene-canvas";
      canvas.setAttribute("aria-label", "像素房间：走到空椅子旁坐下");
      container.appendChild(canvas);

      const labelCanvas = document.createElement("canvas");
      labelCanvas.className = "scene-label-canvas";
      labelCanvas.setAttribute("aria-hidden", "true");
      container.appendChild(labelCanvas);

      let world: RoomWorld;
      try {
        world = createRoomWorld(
          canvas,
          labelCanvas,
          latest.current.preview,
          latest.current.profile,
          {
            onNearSeat: (seat) => latest.current.onNearSeat(seat),
            onSitRequest: (seat) => latest.current.onSitRequest(seat),
            onSeatSelect: (seat) => latest.current.onSeatSelect(seat),
            onUnavailable: () => latest.current.onUnavailable(),
          },
        );
      } catch (error) {
        console.error("[join-scene] WebGL 初始化失败", error);
        canvas.remove();
        labelCanvas.remove();
        latest.current.onUnavailable();
        return;
      }
      worldRef.current = world;
      world.setDisabled(latest.current.disabled);

      const observer = new ResizeObserver(() => world.resize());
      observer.observe(container);
      const onVisibility = () => {
        if (document.visibilityState === "visible") world.resize();
      };
      document.addEventListener("visibilitychange", onVisibility);

      return () => {
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
    }, [props.preview]);

    useEffect(() => {
      worldRef.current?.setProfile(props.profile);
    }, [props.profile]);

    useEffect(() => {
      worldRef.current?.setDisabled(props.disabled);
    }, [props.disabled]);

    useImperativeHandle(
      ref,
      () => ({
        sit: (seat?: number) => worldRef.current?.sit(seat),
        standUp: () => worldRef.current?.standUp(),
        setJoystick: (x: number, y: number) => worldRef.current?.setJoystick(x, y),
      }),
      [],
    );

    return <div ref={containerRef} className="scene-canvas-wrap" />;
  },
);
