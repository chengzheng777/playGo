import type { Avatar } from "../../shared/protocol";

export function AvatarBadge({
  avatar,
  size = 28,
  className = "",
}: {
  avatar: Avatar;
  size?: number;
  className?: string;
}) {
  return (
    <span
      className={`avatar${className ? ` ${className}` : ""}`}
      style={{
        width: size,
        height: size,
        color: avatar.color,
        background: `${avatar.color}22`,
        borderColor: `${avatar.color}66`,
        fontSize: Math.round(size * 0.44),
      }}
      aria-hidden="true"
    >
      {avatar.text}
    </span>
  );
}
