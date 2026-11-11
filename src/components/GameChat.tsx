import type { FormEvent } from "react";
import { useEffect, useRef, useState } from "react";
import { MAX_CHAT_LEN } from "../../shared/protocol";
import { store, useAppState } from "../store";

/**
 * 对局中的公屏聊天：默认收成右侧小标签，点开展开半透明侧栏。
 * 与大厅聊天共用同一份消息历史。
 */
export function GameChat() {
  const state = useAppState();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [seen, setSeen] = useState(() => state.chat.length);
  const listRef = useRef<HTMLDivElement>(null);

  const unread = Math.max(0, state.chat.length - seen);

  useEffect(() => {
    if (open) setSeen(state.chat.length);
  }, [open, state.chat.length]);

  useEffect(() => {
    if (!open || state.chat.length === 0) return;
    const node = listRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [open, state.chat]);

  function submit(event: FormEvent) {
    event.preventDefault();
    const value = text.trim();
    if (!value) return;
    store.sendChat(value);
    setText("");
  }

  if (!state.you) return null;

  return (
    <>
      <button
        type="button"
        className={`game-chat-toggle${open ? " open" : ""}`}
        aria-expanded={open}
        aria-label={open ? "收起聊天" : "打开聊天"}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="game-chat-icon">💬</span>
        <span className="game-chat-label">聊天</span>
        {!open && unread > 0 && (
          <span className="game-chat-badge">{unread > 99 ? "99+" : unread}</span>
        )}
      </button>

      <aside className={`game-chat${open ? " open" : ""}`} aria-label="公屏聊天">
        <div className="game-chat-head">
          <h3>公屏聊天</h3>
          <button
            type="button"
            className="game-chat-close"
            aria-label="收起聊天"
            onClick={() => setOpen(false)}
          >
            ×
          </button>
        </div>

        <div className="game-chat-list" ref={listRef}>
          {state.chat.length === 0 && <p className="chat-empty">说点什么，试试通不通。</p>}
          {state.chat.map((message) => {
            const mine = message.from === state.you?.id;
            return (
              <div key={message.id} className={`msg${mine ? " mine" : ""}`}>
                <span className="msg-name">{mine ? "你" : message.name}</span>
                <span className="msg-text">{message.text}</span>
              </div>
            );
          })}
        </div>

        <form className="chat-form game-chat-form" onSubmit={submit}>
          <input
            className="input"
            value={text}
            maxLength={MAX_CHAT_LEN}
            placeholder="发条消息…"
            onChange={(event) => setText(event.target.value)}
          />
          <button className="btn btn-primary" type="submit" disabled={!text.trim()}>
            发送
          </button>
        </form>
      </aside>
    </>
  );
}
