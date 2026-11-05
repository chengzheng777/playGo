# playGo 通信协议 v0.1（M0）

> 传输：WebSocket 文本帧，JSON，UTF-8。
> 地址：`ws://<host>:<port>/ws`（与页面同源，避免混合内容）。
> 服务端权威：客户端只发「意图」，状态由服务端计算后广播。
>
> 实现状态：M0 已落地，对应 `server/hub.ts` 与 `server/rooms.ts`。

---

## 1. 信封

所有消息共用一层信封，`type` 决定 `data` 的结构：

```jsonc
{
  "v": 1,
  "type": "room.join",
  "id": "c-8f3a",        // 可选：客户端消息 ID，服务端用 ack 回应
  "ts": 1762345678901,   // 客户端发送时间（毫秒），仅用于诊断
  "data": { }
}
```

- 未知 `type` 一律忽略，不报错（便于灰度）。
- 单帧上限 64 KB。超过即断开。
- 频率限制：每连接 30 条/秒，聊天 1 条/秒；超限回 `RATE_LIMITED`，连续 3 次断开。

---

## 2. 消息一览

| type | 方向 | data | 说明 |
| --- | --- | --- | --- |
| `welcome` | S→C | `{clientId, protocol, serverTime}` | 连接建立后立即下发 |
| `room.create` | C→S | `{name, role}` | 创建房间 |
| `room.created` | S→C | `{room, token}` | 仅创建者收到；`token` 用于重连 |
| `room.join` | C→S | `{code, name, role, token?}` | 加入；带 `token` 即重连 |
| `room.state` | S→C | `{room, you, version, token}` | 全量状态，任何变更后广播 |
| `room.left` | S→C | `{playerId, reason}` | 玩家离开 |
| `player.ready` | C→S | `{ready}` | 准备/取消 |
| `chat.send` | C→S | `{text}` | 文本 ≤ 200 字 |
| `chat.message` | S→C | `{from, name, text, ts}` | |
| `game.start` | C→S | `{}` | 仅房主 |
| `game.state` | S→C | `{view, seq}` | 游戏层数据，按角色裁剪 |
| `game.action` | C→S | `{action, seq}` | 玩家操作 |
| `state.resync` | C→S | `{since}` | 版本跳跃时请求全量 |
| `ping` / `pong` | C→S / S→C | `{t}` / `{t, serverTime}` | 心跳，5 秒一次 |
| `ack` | S→C | `{id}` | 确认收到某条客户端消息 |
| `error` | S→C | `{code, message, fatal}` | `fatal=true` 表示随后断开 |

---

## 3. 数据结构

```ts
type Role = "screen" | "player" | "spectator";
type Phase = "lobby" | "playing" | "ended";

interface Player {
  id: string;          // 服务端分配，稳定
  name: string;        // 1–16 字
  role: Role;
  seat: number;        // 0 起，加入顺序
  ready: boolean;
  connected: boolean;
  joinedAt: number;
  latencyMs?: number;  // 由心跳估算
}

interface Room {
  code: string;        // 4 位，去除易混字符
  hostId: string;
  phase: Phase;
  players: Player[];
  createdAt: number;
  maxPlayers: number;  // 默认 8
}

interface RoomState {
  room: Room;
  you: Player;         // 当前连接对应的玩家
  version: number;     // 单调递增，每次变更 +1
  token: string;       // 本连接的重连凭证（每个玩家一份，只发给本人）
}
```

房间码字母表：`23456789ABCDEFGHJKLMNPQRSTUVWXYZ`（去掉了 `0 O 1 I`），4 位 ≈ 92 万种，局域网足够。

---

## 4. 连接与重连

```
连接 WS
  └─ 收 welcome {clientId}
       ├─ 新房：room.create / room.join
       └─ 重连：room.join {code, token}
            └─ 匹配 token → 复用 Player.id，connected=true
                 └─ 收 room.state（含当前 version）
```

- `token`：32 字节随机 hex，客户端存 `localStorage`，按房间码分键。
- 断线后服务端保留座位 **90 秒**（`connected=false`），超时移除并广播。
- 客户端重连策略：1s / 2s / 4s / 8s / 15s 上限，最多 10 次；成功后立刻 `ping` 校准延迟。
- `version` 跳跃（收到 > 本地 + 1）：说明丢帧，发 `state.resync` 取全量。M0 本来就是全量，可先用「每次覆盖」简化。

---

## 5. 错误码

| code | 含义 | fatal |
| --- | --- | --- |
| `PROTOCOL_ERROR` | 帧格式错误 / 超长 | ✅ |
| `ROOM_NOT_FOUND` | 房间码不存在或已结束 | ❌ |
| `ROOM_FULL` | 人数已达上限 | ❌ |
| `NAME_TAKEN` | 昵称重复 | ❌ |
| `BAD_TOKEN` | 重连 token 无效 | ❌ |
| `NOT_HOST` | 非房主执行房主操作 | ❌ |
| `BAD_PHASE` | 当前阶段不允许该操作 | ❌ |
| `RATE_LIMITED` | 频率超限 | ❌ |
| `INTERNAL` | 服务端异常 | ✅ |

---

## 6. 示例

创建房间：

```json
{ "v": 1, "type": "room.create", "id": "c-1", "data": { "name": "Alice", "role": "screen" } }
```

```json
{
  "v": 1,
  "type": "room.created",
  "data": {
    "token": "9f2c...",
    "room": { "code": "7K2M", "hostId": "p-1", "phase": "lobby", "players": [ /* ... */ ] }
  }
}
```

手机加入：

```json
{ "v": 1, "type": "room.join", "id": "c-2", "data": { "code": "7K2M", "name": "小明", "role": "player" } }
```

```json
{
  "v": 1,
  "type": "room.state",
  "data": {
    "version": 3,
    "you": { "id": "p-2", "name": "小明", "role": "player", "seat": 1, "ready": false, "connected": true },
    "room": { "code": "7K2M", "hostId": "p-1", "phase": "lobby", "players": [ /* 2 人 */ ] }
  }
}
```

---

## 7. M0 不实现（预留）

- 二进制帧 / 增量补丁（`state.delta`）
- 房间列表与发现（本机多房间）
- 观战与角色切换
- 游戏层动作校验与回滚
- 鉴权（局域网内仅靠房间码 + token）
