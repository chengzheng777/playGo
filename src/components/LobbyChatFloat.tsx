import { ChatPanel } from "./ChatPanel";

/** PC 大厅左下角悬浮聊天；场景保持主界面，聊天只盖住一小块 */
export function LobbyChatFloat({ onClose }: { onClose: () => void }) {
  return (
    <section className="lobby-chat-float" aria-label="悬浮聊天">
      <div className="lobby-chat-float-head">
        <h3>聊天</h3>
        <button type="button" className="btn btn-ghost btn-mini" onClick={onClose}>
          收起
        </button>
      </div>
      <div className="lobby-chat-float-body">
        <ChatPanel />
      </div>
    </section>
  );
}
