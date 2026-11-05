import { Toast } from "./components/Toast";
import { store, useAppState } from "./store";
import { ColorGameView } from "./views/ColorView";
import { DrawGameView } from "./views/DrawView";
import { GameView } from "./views/GameView";
import { HomeView } from "./views/HomeView";
import { JoinView } from "./views/JoinView";
import { LobbyView } from "./views/LobbyView";
import { OnboardingView } from "./views/OnboardingView";
import { UnoGameView } from "./views/UnoView";

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
          {state.view === "lobby" &&
            (state.game ? (
              <GameView />
            ) : state.uno ? (
              <UnoGameView />
            ) : state.color ? (
              <ColorGameView />
            ) : state.draw ? (
              <DrawGameView />
            ) : (
              <LobbyView />
            ))}
        </>
      )}
      {state.error && <Toast key={state.error} text={state.error} onDone={store.clearError} />}
    </div>
  );
}
