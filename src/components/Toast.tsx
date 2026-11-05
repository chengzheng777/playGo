import { useEffect } from "react";

export function Toast({ text, onDone }: { text: string; onDone: () => void }) {
  useEffect(() => {
    const timer = window.setTimeout(onDone, 4000);
    return () => window.clearTimeout(timer);
  }, [onDone]);

  return (
    <div className="toast" role="status" onClick={onDone}>
      {text}
    </div>
  );
}
