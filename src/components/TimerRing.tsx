const RADIUS = 46;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function TimerRing({
  remaining,
  total,
  critical,
}: {
  remaining: number;
  total: number;
  critical: boolean;
}) {
  const ratio = total > 0 ? Math.max(0, Math.min(1, remaining / total)) : 0;
  const seconds = Math.ceil(remaining / 1000);

  return (
    <div className={`timer${critical ? " critical" : ""}`} role="timer" aria-live="off">
      <svg viewBox="0 0 120 120" width="132" height="132">
        <circle className="ring-track" cx="60" cy="60" r={RADIUS} />
        <circle
          className="ring-progress"
          cx="60"
          cy="60"
          r={RADIUS}
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={CIRCUMFERENCE * (1 - ratio)}
        />
      </svg>
      <span className="timer-num">{seconds}</span>
    </div>
  );
}
