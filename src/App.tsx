import { Toast } from "./components/Toast";
import { store, useAppState } from "./store";
import { HomeView } from "./views/HomeView";
import { JoinView } from "./views/JoinView";
import { LobbyView } from "./views/LobbyView";

export function App() {
  const state = useAppState();

  return (
    <div className="app">
      {state.view === "home" && <HomeView />}
      {state.view === "join" && <JoinView />}
      {state.view === "lobby" && <LobbyView />}
      {state.error && <Toast key={state.error} text={state.error} onDone={store.clearError} />}
    </div>
  );
}
