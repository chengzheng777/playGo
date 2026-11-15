import type { RoomPreview, RoomSeatView } from "../../shared/protocol";
import { buildChairSpots } from "../scene/layout";
import { AvatarBadge } from "./Avatar";

export function SeatMapLite({
  preview,
  busy,
  disabled,
  onSit,
  onSelect,
}: {
  preview: RoomPreview;
  busy: boolean;
  disabled: boolean;
  onSit: (seat: number) => void;
  onSelect: (seat: RoomSeatView) => void;
}) {
  const spots = buildChairSpots(preview.seats);
  const hostScreen = preview.seats[preview.hostSeat]?.role !== "player";

  return (
    <fieldset className="seat-map" aria-label="房间座位">
      <div className="seat-map-table">
        <span>橡木桌</span>
        <small>{preview.code}</small>
      </div>

      {hostScreen && (
        <div className="seat-map-tv">
          <span className="seat-map-tv-screen">playGo</span>
          <span className="seat-map-tv-name">{preview.host.name} · 大屏</span>
        </div>
      )}

      {spots.map((spot) => {
        const view = preview.seats[spot.seat];
        if (view && view.role === "player") {
          return (
            <button
              key={spot.seat}
              type="button"
              data-seat={spot.seat}
              className="seat-card occupied"
              style={{ left: `${50 + spot.x * 11.5}%`, top: `${50 + spot.z * 11.5}%` }}
              aria-label={`${spot.seat + 1} 号位 ${view.name}${view.connected ? "" : "，掉线"}`}
              onClick={() => onSelect(view)}
            >
              <AvatarBadge avatar={view.avatar} size={26} />
              <span className="seat-card-name">{view.name}</span>
              {!view.connected && <span className="seat-card-off">掉线</span>}
            </button>
          );
        }

        return (
          <button
            key={spot.seat}
            type="button"
            data-seat={spot.seat}
            className="seat-card empty"
            style={{ left: `${50 + spot.x * 11.5}%`, top: `${50 + spot.z * 11.5}%` }}
            aria-label={`${spot.seat + 1} 号空位，坐下加入房间`}
            disabled={busy || disabled}
            onClick={() => onSit(spot.seat)}
          >
            <span className="seat-card-plus">+</span>
            <span className="seat-card-name">空位</span>
          </button>
        );
      })}
    </fieldset>
  );
}
