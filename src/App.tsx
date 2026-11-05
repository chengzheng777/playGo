import { Toast } from "./components/Toast";
import { store, useAppState } from "./store";
import { GameView } from "./views/GameView";
import { HomeView } from "./views/HomeView";
import { JoinView } from "./views/JoinView";
import { LobbyView } from "./views/LobbyView";
import { OnboardingView } from "./views/OnboardingView";

export function App() {
  const state = useAppState();

  return (
    <div className="app">
      {!state.profile ? (
        <OnboardingView />
      ) : (
        <>
          {state.view === "home" && <HomeView />}
          {state.view === "join" && <JoinView />}
          {state.view === "lobby" && (state.game ? <GameView /> : <LobbyView />)}
        </>
      )}
      {state.error && <Toast key={state.error} text={state.error} onDone={store.clearError} />}
    </div>
  );
}
