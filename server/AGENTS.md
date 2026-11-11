# server/AGENTS.md

本目录是服务端与游戏规则，必须保持服务端权威。

- 房间、计分、倒计时、出牌/猜词/拍照校验都在服务端完成；客户端传来的只是意图。
- 所有 WebSocket/HTTP 输入先用 zod 校验，再进入业务逻辑；不要信任客户端字段。
- 私密信息按玩家裁剪：词只发给该看的人、UNO 手牌只发给本人、照片只在大屏揭晓时展示。
- 游戏规则放 `server/games/`，不要在 `src/` 复制一份；客户端只读 `viewFor(playerId)` 的结果。
- 修改协议时同步 `shared/protocol.ts`、`docs/PROTOCOL.md` 和 `scripts/smoke.mjs`。
- 新增规则优先写进 `tests/*.test.ts`；不要只靠手测。
- 不要在没有说明的情况下新增生产依赖。
