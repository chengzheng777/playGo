# AGENTS.md

> 所有 AI 编码工具先读本文件。它是入口，不替代 [CONTRIBUTING.md](CONTRIBUTING.md)、[specs/README.md](specs/README.md) 和 [docs/PROTOCOL.md](docs/PROTOCOL.md)。

## 必读

1. [CONTRIBUTING.md](CONTRIBUTING.md)：开发流程、命令、提交规范、完成定义。
2. [specs/README.md](specs/README.md)：SDD 规格写法；新功能先看 [specs/TEMPLATE.md](specs/TEMPLATE.md)。
3. 改协议/消息时读 [docs/PROTOCOL.md](docs/PROTOCOL.md)。
4. 改部署/打包时读 [docs/PACKAGING.md](docs/PACKAGING.md)、[docs/REMOTE.md](docs/REMOTE.md)。

## SDD 工作流

1. **先规格**：新建或修改 `specs/NNN-name.md`，写清背景、可观察行为、边界和可测验收项；规格不清楚先问，不要猜。
2. **再协议**：涉及消息/接口时，同步 `shared/protocol.ts` 和 `docs/PROTOCOL.md`。
3. **写实现**：游戏规则放 `server/games/`，客户端视图放 `src/views/`；不要先写实现再补规格。
4. **补测试**：纯规则写 `tests/*.test.ts`（Vitest）；协议/流程补 `scripts/smoke.mjs`；UI 流程补 `e2e/run.mjs`。
5. **过检查**：`pnpm verify`；涉及协议再跑 `pnpm smoke`（需要本地服务）；改 UI 尽量跑 `pnpm e2e`。
6. **更新记录**：用户可见变更写 `CHANGELOG.md`；spec 的验收项同步勾选。

## 工程约束

- TypeScript 严格模式；不要用 `any` 绕过类型，必要时写窄类型。
- 服务端权威：房间、计分、倒计时、出牌/猜词校验都在服务端；客户端只发意图、做展示。
- 所有外部输入用 zod 校验；不要信任浏览器传来的字段。
- 视图按人裁剪：词、手牌、照片等私密信息只发给该看的人。
- 状态默认全量广播；人数少，简单优先，不要过早引入增量协议或缓存层。
- 不要新增生产依赖，除非用户明确同意；能复用现有依赖就复用。
- 不要手改生成物：`dist/`、`release/`、`coverage/`、`node_modules/`、`electron/app/`、`electron/main.build.cjs`、`.cache/`。
- 不要提交密钥、`.env`、证书、面板/SSH 凭据。

## 常用命令

```bash
pnpm dev         # 开发服务，默认 8787
pnpm build       # 前端构建
pnpm typecheck   # TS 检查
pnpm lint        # Biome
pnpm test        # Vitest 单元测试
pnpm smoke       # 协议冒烟（需服务已启动）
pnpm e2e         # 真浏览器 E2E（需服务与 Chrome）
pnpm verify      # typecheck + lint + test + build
```

## Git

- 使用 Conventional Commits：`feat:`、`fix:`、`refactor:`、`docs:`、`test:`、`chore:`。
- 一个提交只做一件事；格式化/生成物单独处理。
- 多贡献者场景走分支 + PR；不要直接把未验证的改动推到 `main`。
- 推送前确认工作区只包含本次相关文件。

## 完成定义

- [ ] `pnpm verify` 通过
- [ ] 涉及协议时 `pnpm smoke` 通过
- [ ] 新行为有 spec 与测试映射
- [ ] `docs/PROTOCOL.md` / `CHANGELOG.md` 已同步
- [ ] 没有提交生成物、临时文件或密钥

## Code Review Rules

- 先检查是否有对应 spec；没有 spec 的新行为直接指出。
- 检查游戏规则是否被写到了客户端。
- 检查私密信息是否可能被广播给所有人。
- 检查输入是否经过 zod/边界校验，是否信任了客户端字段。
- 检查测试是否覆盖 spec 的验收项，而不只是“能跑”。
- 格式和 lint 交给 CI，不要在 review 里反复纠结。
