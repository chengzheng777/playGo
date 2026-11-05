import type { FormEvent } from "react";
import { useEffect, useRef, useState } from "react";
import { store, useAppState } from "../store";

export function ChatPanel() {
  const state = useAppState();
  const [text, setText] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = listRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, []);

  function submit(event: FormEvent) {
    event.preventDefault();
    const value = text.trim();
    if (!value) return;
    store.sendChat(value);
    setText("");
  }

  return (
    <section className="panel chat-panel">
      <div className="panel-head">
        <h2>聊天</h2>
      </div>

      <div className="chat-list" ref={listRef}>
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

      <form className="chat-form" onSubmit={submit}>
        <input
          className="input"
          value={text}
          maxLength={200}
          placeholder="发条消息…"
          onChange={(event) => setText(event.target.value)}
        />
        <button className="btn btn-primary" type="submit" disabled={!text.trim()}>
          发送
        </button>
      </form>
    </section>
  );
}
