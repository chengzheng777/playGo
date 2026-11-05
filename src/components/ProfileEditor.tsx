import { useState } from "react";
import { AVATAR_COLORS, AVATAR_EMOJIS } from "../../shared/avatars";
import type { Profile } from "../store";
import { AvatarBadge } from "./Avatar";

export function ProfileEditor({
  initial,
  submitLabel = "保存",
  onSave,
  onCancel,
}: {
  initial: Profile;
  submitLabel?: string;
  onSave: (profile: Profile) => void;
  onCancel?: () => void;
}) {
  const [name, setName] = useState(initial.name);
  const [text, setText] = useState(initial.avatar.text);
  const [color, setColor] = useState(initial.avatar.color);
  const valid = name.trim().length > 0;

  return (
    <div className="profile-editor">
      <div className="avatar-preview">
        <AvatarBadge avatar={{ text, color }} size={72} />
        <input
          className="input"
          value={name}
          maxLength={16}
          placeholder="你的名字"
          autoComplete="nickname"
          onChange={(event) => setName(event.target.value)}
        />
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
        {onCancel && (
          <button className="btn btn-ghost" onClick={onCancel}>
            取消
          </button>
        )}
        <button
          className="btn btn-primary"
          disabled={!valid}
          onClick={() => onSave({ name: name.trim(), avatar: { text, color } })}
        >
          {submitLabel}
        </button>
      </div>
    </div>
  );
}
