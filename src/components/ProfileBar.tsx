import { useAppState } from "../store";
import { AvatarBadge } from "./Avatar";

export function ProfileBar({ onEdit }: { onEdit: () => void }) {
  const state = useAppState();
  const profile = state.profile;
  if (!profile) return null;

  return (
    <button className="profile-bar" onClick={onEdit}>
      <AvatarBadge avatar={profile.avatar} size={34} />
      <span className="profile-name">{profile.name}</span>
      <span className="profile-edit">编辑</span>
    </button>
  );
}
