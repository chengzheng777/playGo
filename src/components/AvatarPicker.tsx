import { useState } from "react";
import { AVATAR_COLORS, AVATAR_EMOJIS, defaultAvatar } from "../../shared/avatars";
import type { Avatar } from "../../shared/protocol";
import { AvatarBadge } from "./Avatar";

export function AvatarPicker({
  name,
  current,
  onSave,
  onClose,
}: {
  name: string;
  current: Avatar;
  onSave: (avatar: Avatar) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState(current.text);
  const [color, setColor] = useState(current.color);

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <h3>换个头像</h3>
          <button className="btn btn-ghost btn-mini" onClick={onClose}>
            关闭
          </button>
        </div>

        <div className="avatar-preview">
          <AvatarBadge avatar={{ text, color }} size={76} />
          <span className="avatar-name">{name}</span>
        </div>

        <div className="emoji-grid">
          {AVATAR_EMOJIS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              className={`emoji${text === emoji ? " on" : ""}`}
              onClick={() => setText(emoji)}
            >
              {emoji}
            </button>
          ))}
        </div>

        <div className="color-row">
          {AVATAR_COLORS.map((value) => (
            <button
              key={value}
              type="button"
              className={`color-dot${color === value ? " on" : ""}`}
              style={{ background: value }}
              aria-label={value}
              onClick={() => setColor(value)}
            />
          ))}
        </div>

        <div className="modal-actions">
          <button
            className="btn btn-ghost"
            onClick={() => {
              const fallback = defaultAvatar(name);
              setText(fallback.text);
              setColor(fallback.color);
            }}
          >
            用名字首字
          </button>
          <button className="btn btn-primary" onClick={() => onSave({ text, color })}>
            保存
          </button>
        </div>
      </div>
    </div>
  );
}
