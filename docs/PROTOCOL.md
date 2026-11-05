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
| `room.create` | C→S | `{name, role, gameId?}` | 创建房间，可带上大厅里选好的游戏 |
| `room.created` | S→C | `{room, token}` | 仅创建者收到；`token` 用于重连 |
| `room.join` | C→S | `{code, name, role, token?}` | 加入；带 `token` 即重连 |
| `room.state` | S→C | `{room, you, version, token, gameId, game, serverTime}` | 全量状态，任何变更后广播 |
| `room.left` | S→C | `{playerId, reason}` | 玩家离开 |
| `player.ready` | C→S | `{ready}` | 准备/取消 |
| `player.avatar` | C→S | `{avatar: {text, color}}` | 换头像，随后广播 |
| `chat.send` | C→S | `{text}` | 文本 ≤ 200 字 |
| `chat.message` | S→C | `{from, name, text, ts}` | |
| `game.select` | C→S | `{gameId}` | 仅房主，仅大厅阶段 |
| `game.settings` | C→S | `{settings}` | 仅房主、仅大厅；目标分 3–20，回合 15–180 秒 |
| `game.start` | C→S | `{}` | 仅房主；至少 2 名已准备的手机玩家 |
| `game.action` | C→S | `{action}` | 见第 7 节 |
| `game.back` | C→S | `{}` | 仅房主；结束本局回大厅 |
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
  avatar: Avatar;      // { text, color }，默认取名字首字
  role: Role;
  seat: number;        // 0 起，加入顺序
  ready: boolean;
  connected: boolean;
  joinedAt: number;
  latencyMs?: number;  // 由心跳估算
}

interface Avatar {
  text: string;        // 1–2 个字符或一个 emoji
  color: string;       // #rrggbb
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
  gameId: string | null;   // 房主选中的游戏
  settings: YiyuSettings;  // 房主配置的规则
  game: YiyuView | null;   // 当前游戏视图，按角色裁剪
  serverTime: number;      // 用于客户端校准倒计时
}

interface YiyuSettings {
  targetScore: number;     // 默认 8，允许 3–20
  roundSeconds: number;    // 默认 60，允许 15–180
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

## 7. 游戏：一愚惊人

### 7.1 视图

`room.state.data.game` 是按玩家裁剪过的 `YiyuView`：

```ts
interface YiyuView {
  gameId: "yiyu";
  phase: "turn" | "reveal" | "ended";
  round: number;
  targetScore: number;      // 8
  roundSeconds: number;     // 60
  teams: YiyuTeam[];
  turn: YiyuTurn | null;
  winnerTeam?: "A" | "B";
  lastEvent: YiyuEvent | null;   // 客户端据此触发动画/音效/震动
}

interface YiyuTurn {
  teamId: "A" | "B";
  describerId: string;
  describerName: string;
  mode: "talk" | "act" | "lip" | "rush";
  deadline: number;         // 服务端 epoch ms
  word?: string;            // 只发给大屏（房主），或 turn 结束后才有
  guesses: YiyuGuess[];     // 仅抢答模式
  result?: "correct" | "skip" | "timeout";
  winnerName?: string;
}

interface YiyuEvent {
  id: number;               // 单调递增，客户端去重
  kind: "turn" | "correct" | "skip" | "timeout" | "win";
  text: string;
}
```

裁剪规则：`word` 只发给大屏（房主）；只要进入 `reveal` / `ended`，所有人可见。
房主不参赛，`teams` 里只包含手机玩家。
倒计时不靠推送，客户端用 `room.state.serverTime` 校准本地时钟后自行渲染。

### 7.2 动作

```jsonc
{ "v": 1, "type": "game.action", "data": { "action": { "type": "correct" } } }
{ "v": 1, "type": "game.action", "data": { "action": { "type": "skip" } } }
{ "v": 1, "type": "game.action", "data": { "action": { "type": "guess", "text": "泡面" } } }
```

- `correct` / `skip`：当前回合的描述者**或大屏（房主）**能发；其他玩家发送会被静默忽略。
  大屏可以代为计分，这样描述者不必一边比划一边看手机。
- `guess`：只在 `mode === "rush"` 且是参赛的手机玩家、且不是描述者时有效；答案归一化后全等才算对，首答命中者所在队伍 +1。大屏不能抢答。

### 7.3 回合推进

服务端每 500 ms tick 一次：

1. `turn` 且超过 `deadline` → 记为 `timeout`，进入 `reveal`（约 2.3 秒）；
2. `reveal` 到时 → 切下一队、下一位描述者、随机模式与词，进入新的 `turn`；
3. 某队分数达到 `targetScore` → `ended`，广播 `winnerTeam`。

描述者掉线不会卡住回合：到点自动结算，下回合会跳过未连接的队员。

---

## 8. M0 不实现（预留）
- 二进制帧 / 增量补丁（`state.delta`）
- 房间列表与发现（本机多房间）
- 观战与角色切换
- 游戏层动作校验与回滚
- 鉴权（局域网内仅靠房间码 + token）

---

## 9. HTTP 接口（与 WebSocket 同源）

| 方法 | 路径 | 返回 | 说明 |
| --- | --- | --- | --- |
| GET | `/api/health` | `{ok, app, version, port, rooms, buildId}` | 健康检查；`buildId` 用于识别过期页面 |
| GET | `/api/networks` | `{port, urls: [{ip, iface, kind}]}` | 生成二维码可用的局域网地址 |
| GET | `/api/rooms` | `{rooms: RoomSummary[]}` | 大厅房间列表 |
| GET | `/api/qr?text=` | `image/svg+xml` | 生成二维码，只接受 http(s) 文本 |

`RoomSummary` 只含公开信息：房间码、房主名、游戏、人数、阶段，不含玩家 token。
`/api/rooms` 由客户端每 3 秒轮询一次，用来刷新大厅列表。
