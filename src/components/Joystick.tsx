import { useRef, useState } from "react";

export function Joystick({
  onChange,
  className = "",
}: {
  onChange: (x: number, y: number) => void;
  className?: string;
}) {
  const baseRef = useRef<HTMLFieldSetElement>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const active = useRef(false);
  const pointerId = useRef<number | null>(null);

  function update(event: React.PointerEvent<HTMLFieldSetElement>) {
    const base = baseRef.current;
    if (!base) return;
    const rect = base.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    let dx = event.clientX - centerX;
    let dy = event.clientY - centerY;
    const maxRadius = Math.max(10, rect.width / 2 - 24);
    const distance = Math.hypot(dx, dy);
    if (distance > maxRadius) {
      dx = (dx / distance) * maxRadius;
      dy = (dy / distance) * maxRadius;
    }
    setKnob({ x: dx, y: dy });
    // 屏幕向上 = 世界向前
    onChange(dx / maxRadius, -dy / maxRadius);
  }

  function release() {
    active.current = false;
    pointerId.current = null;
    setKnob({ x: 0, y: 0 });
    onChange(0, 0);
  }

  return (
    <fieldset
      ref={baseRef}
      className={`joystick${className ? ` ${className}` : ""}`}
      aria-label="移动摇杆"
      onPointerDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
        active.current = true;
        pointerId.current = event.pointerId;
        event.currentTarget.setPointerCapture(event.pointerId);
        update(event);
      }}
      onPointerMove={(event) => {
        if (!active.current || event.pointerId !== pointerId.current) return;
        event.preventDefault();
        update(event);
      }}
      onPointerUp={(event) => {
        if (event.pointerId !== pointerId.current) return;
        event.stopPropagation();
        release();
      }}
      onPointerCancel={release}
    >
      <span
        className="joystick-knob"
        style={{ transform: `translate(${knob.x}px, ${knob.y}px)` }}
      />
    </fieldset>
  );
}
