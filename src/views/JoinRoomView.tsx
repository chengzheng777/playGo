import { lazy, Suspense, useEffect, useRef, useState } from "react";
import type { RoomSeatView } from "../../shared/protocol";
import { AvatarBadge } from "../components/Avatar";
import { JoinRoomHud } from "../components/JoinRoomHud";
import { Joystick } from "../components/Joystick";
import { ProfileEditor } from "../components/ProfileEditor";
import { SeatMapLite } from "../components/SeatMapLite";
import { type RoomPreviewState, useRoomPreview } from "../lib/room-preview";
import { useMediaQuery } from "../lib/useMediaQuery";
import type { JoinRoomSceneHandle } from "../scene/JoinRoomScene";
import { buildChairSpots, chairSeatIndices, emptyChairs } from "../scene/layout";
import { store, useAppState } from "../store";

const JoinRoomScene = lazy(() =>
  import("../scene/JoinRoomScene").then((module) => ({ default: module.JoinRoomScene })),
);

type RenderMode = "scene" | "lite";

function initialMode(): RenderMode {
  return new URLSearchParams(location.search).get("renderer") === "lite" ? "lite" : "scene";
}

function PreviewStatus({
  state,
  onRetry,
  onBack,
}: {
  state: RoomPreviewState;
  onRetry: () => void;
  onBack: () => void;
}) {
  if (state.status === "loading") {
    return (
      <div className="join-preview-state">
        <div className="pixel-loader" aria-hidden="true">
          <i />
          <i />
          <i />
        </div>
        <p>正在推门…</p>
      </div>
    );
  }

  const missing = state.status === "missing";
  const message =
    state.status === "error" ? state.message : "让房主重新开一间，或者检查一下房间码。";
  return (
    <div className="join-preview-state">
      <p className="join-preview-title">{missing ? "房间不存在或已结束" : "连不上本地服务"}</p>
      <p className="join-preview-sub">{message}</p>
      <div className="join-preview-actions">
        {state.status === "error" && (
          <button className="btn btn-primary btn-mini" onClick={onRetry} type="button">
            重试
          </button>
        )}
        <button className="btn btn-ghost btn-mini" onClick={onBack} type="button">
          返回大厅
        </button>
      </div>
    </div>
  );
}

export function JoinRoomView() {
  const app = useAppState();
  const profile = app.profile;
  const code = app.joinCode;
  const { state: previewState, refresh } = useRoomPreview(code);

  const [mode, setMode] = useState<RenderMode>(initialMode);
  const [nearSeat, setNearSeat] = useState<number | null>(null);
  const [sitting, setSitting] = useState(false);
  const [avatarOpen, setAvatarOpen] = useState(false);
  const [seatInfo, setSeatInfo] = useState<RoomSeatView | null>(null);
  const sceneRef = useRef<JoinRoomSceneHandle>(null);
  const coarsePointer = useMediaQuery("(pointer: coarse)");

  useEffect(() => {
    if (!sitting) return;
    if (!app.error) return;
    setSitting(false);
    sceneRef.current?.standUp();
  }, [app.error, sitting]);

  if (!profile) return null;

  const preview = previewState.status === "ready" ? previewState.preview : null;
  const spots = preview ? buildChairSpots(preview.seats) : [];
  const playable = preview ? chairSeatIndices(preview.seats).length : 0;
  const seated = preview ? preview.seats.filter((seat) => seat?.role === "player").length : 0;
  const emptyCount = emptyChairs(spots).length;
  const inLobby = preview?.phase === "lobby";
  const canSit = Boolean(preview) && inLobby && emptyCount > 0;
  const disabled = Boolean(preview) && !canSit;
  const busy = sitting || app.busy;

  function joinAt(seat: number): void {
    if (!profile || !canSit || busy) return;
    setSitting(true);
    setNearSeat(null);
    store.joinRoom(code, profile.name, { seat, ready: true });
  }

  function requestSit(): void {
    if (nearSeat === null || !canSit || busy) return;
    setSitting(true);
    sceneRef.current?.sit(nearSeat);
  }

  function handleSceneSit(seat: number): void {
    if (!profile || !canSit || app.busy) return;
    setSitting(true);
    store.joinRoom(code, profile.name, { seat, ready: true });
  }

  const status = !preview
    ? "正在读取房间…"
    : sitting
      ? "正在入座…"
      : !inLobby
        ? "这局已经开始了"
        : emptyCount === 0
          ? "座位都坐满了"
          : mode === "scene"
            ? nearSeat !== null
              ? "按「坐下」加入房间"
              : "走到空椅子旁"
            : "点一把空椅子";

  return (
    <div className="join-scene-page">
      <div className="join-stage">
        {preview && mode === "scene" && (
          <Suspense
            fallback={
              <div className="join-preview-state">
                <div className="pixel-loader" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </div>
                <p>正在摆桌子…</p>
              </div>
            }
          >
            <JoinRoomScene
              ref={sceneRef}
              preview={preview}
              profile={profile}
              disabled={disabled}
              onNearSeat={setNearSeat}
              onSitRequest={handleSceneSit}
              onSeatSelect={setSeatInfo}
              onUnavailable={() => {
                setMode("lite");
                setSitting(false);
              }}
            />
          </Suspense>
        )}

        {preview && mode === "lite" && (
          <SeatMapLite
            preview={preview}
            busy={busy}
            disabled={disabled}
            onSit={joinAt}
            onSelect={setSeatInfo}
          />
        )}

        {!preview && (
          <PreviewStatus state={previewState} onRetry={refresh} onBack={() => store.leave()} />
        )}

        <JoinRoomHud
          code={code}
          gameId={preview?.gameId ?? null}
          hostName={preview?.host.name ?? "…"}
          seated={seated}
          playable={playable}
          profile={profile}
          onBack={() => store.leave()}
          onEditProfile={() => setAvatarOpen(true)}
        />

        {preview && !inLobby && (
          <div className="join-banner">
            <b>游戏进行中</b>
            <span>房间回到大厅后就能入座</span>
          </div>
        )}
        {preview && inLobby && emptyCount === 0 && (
          <div className="join-banner">
            <b>人都到齐了</b>
            <span>等有人离开再试试</span>
          </div>
        )}

        {preview && mode === "scene" && coarsePointer && (
          <Joystick onChange={(x, y) => sceneRef.current?.setJoystick(x, y)} />
        )}
        {preview && mode === "scene" && !coarsePointer && (
          <div className="join-key-hint">WASD / 方向键移动 · E 坐下</div>
        )}
      </div>

      <footer className="join-dock">
        <div className="join-dock-info">
          <span className="join-dock-status">{status}</span>
          <span className="join-dock-sub">
            {preview ? `${seated}/${playable} 人已坐 · 坐下就算加入并准备` : "先看看谁在房间里"}
          </span>
        </div>

        {preview && mode === "scene" && canSit && (
          <button
            className={`btn btn-primary join-sit-btn${nearSeat !== null ? " ready" : ""}`}
            type="button"
            disabled={nearSeat === null || busy}
            onClick={requestSit}
          >
            {sitting ? "入座中…" : nearSeat !== null ? "坐下加入" : "先走到椅子旁"}
          </button>
        )}

        {preview && mode === "lite" && canSit && (
          <span className="join-dock-lite-hint">点空位坐下</span>
        )}
      </footer>

      {avatarOpen && (
        <div className="modal-mask" onClick={() => setAvatarOpen(false)}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <h3>入座身份</h3>
              <button className="btn btn-ghost btn-mini" onClick={() => setAvatarOpen(false)}>
                关闭
              </button>
            </div>
            <ProfileEditor
              initial={{ name: profile.name, avatar: profile.avatar }}
              onCancel={() => setAvatarOpen(false)}
              onSave={(next) => {
                store.saveProfile(next);
                setAvatarOpen(false);
              }}
            />
          </div>
        </div>
      )}

      {seatInfo && (
        <div className="modal-mask" onClick={() => setSeatInfo(null)}>
          <div className="modal seat-info-modal" onClick={(event) => event.stopPropagation()}>
            <div className="seat-info-head">
              <AvatarBadge avatar={seatInfo.avatar} size={54} />
              <div>
                <b>{seatInfo.name}</b>
                <span>{seatInfo.connected ? "已坐下" : "掉线中"}</span>
              </div>
            </div>
            <p className="hint">坐在 {seatInfo.seat + 1} 号位</p>
            <button className="btn btn-ghost btn-block" onClick={() => setSeatInfo(null)}>
              关闭
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
