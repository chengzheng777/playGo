import { defaultAvatar } from "../../shared/avatars";
import { ProfileEditor } from "../components/ProfileEditor";
import { store, useAppState } from "../store";

export function OnboardingView() {
  const state = useAppState();

  return (
    <div className="home home-hall onboarding">
      <header className="brand">
        <div className="brand-mark">
          play<span>Go</span>
        </div>
        <p className="brand-sub">先给自己建个用户，之后就不用再填了</p>
      </header>

      <section className="panel">
        <ProfileEditor
          initial={{
            name: state.nickname || "",
            avatar: defaultAvatar(state.nickname || "玩"),
          }}
          submitLabel="创建用户"
          onSave={(profile) => store.saveProfile(profile)}
        />
      </section>

      <footer className="foot">用户资料只保存在这台设备上</footer>
    </div>
  );
}
