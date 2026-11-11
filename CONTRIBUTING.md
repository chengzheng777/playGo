# 贡献指南

> 使用 AI 编码工具（Codex / Claude Code / Cursor / Copilot 等）时，先读 [AGENTS.md](AGENTS.md)；它不替代本文件。

## 项目结构

```
server/    本地服务：HTTP、静态资源、WebSocket、房间与游戏规则
shared/    前后端共享的协议类型、游戏目录、头像工具
src/       浏览器端（React）
specs/     规格（SDD）：先写清行为与验收，再写实现
docs/      设计、协议、打包等技术文档
scripts/   协议冒烟、打包与部署辅助脚本
tests/     Vitest 单元测试
e2e/       真浏览器端到端测试
```

## 开发流程（SDD）

1. **写规格**：新增功能先建 `specs/NNN-name.md`（复制 `specs/TEMPLATE.md`）。
2. **改协议**：涉及消息/接口时同步 `docs/PROTOCOL.md`，类型放 `shared/protocol.ts`。
3. **写实现**：服务端规则放 `server/games/`，客户端视图放 `src/views/`。
4. **补测试**：纯规则写进 `tests/*.test.ts`（Vitest）；协议流程写进 `scripts/smoke.mjs`；UI 流程写进 `e2e/run.mjs`。
5. **过检查**：`pnpm verify` + `pnpm smoke`（需要本地服务）。
6. **更新记录**：用户可见的变更写进 `CHANGELOG.md`。

规格里的验收项要能被测试覆盖；覆盖不了的标「手测」并写清步骤。

## 常用命令

| 命令             | 说明                              |
| ---------------- | --------------------------------- |
| `pnpm dev`       | 开发模式，8787                    |
| `pnpm build`     | 构建前端                          |
| `pnpm start`     | 生产模式（先 build）              |
| `pnpm typecheck` | TS 类型检查                       |
| `pnpm lint`      | Biome 检查（格式 + 规则）         |
| `pnpm lint:fix`  | 自动修复                          |
| `pnpm test`      | Vitest 单元测试                   |
| `pnpm coverage`  | 覆盖率报告                        |
| `pnpm smoke`     | 协议冒烟（需服务在跑）            |
| `pnpm e2e`       | 真浏览器端到端（需服务与 Chrome） |
| `pnpm verify`    | typecheck + lint + test + build   |

## 提交规范

使用 Conventional Commits，完整规则见 [docs/GIT.md](docs/GIT.md)：

```
feat: 拍颜色
feat(yiyu): 抢答模式支持输入答案
fix: 加入房间时丢失头像
refactor: 房间内只保留游戏切换
docs: 补充协议说明
test: 增加 UNO 摸牌用例
chore(release): v0.2.0
```

- 一个提交只做一件事；格式化单独提交。
- 提交信息写「为什么」，正文可列要点。
- PR 标题必须符合 Conventional Commits（squash merge 后就是 main 的提交标题）。
- 发布用 `chore(release): vX.Y.Z` 并打 annotated tag。

## 完成定义（DoD）

- [ ] `pnpm verify` 通过
- [ ] 涉及协议时 `pnpm smoke` 通过
- [ ] 新增行为有 spec 与测试映射
- [ ] `docs/PROTOCOL.md` 与 `CHANGELOG.md` 已同步
- [ ] 没有提交 `.tmp/`、`dist/`、`node_modules/`

## 代码约定

- TypeScript 严格模式；不用 `any` 绕过类型，必要时写窄类型。
- 服务端所有输入用 zod 校验；客户端不信任服务端以外的数据。
- 游戏规则只放服务端，客户端只做展示与意图发送。
- 视图按人裁剪：私密信息（词、手牌、照片）只发给该看的人。
- 状态默认全量广播；人数少，简单优先，避免过早做增量协议。

## 分支与保护

`main` 是受保护分支，**任何人都不能直接 push 或直接合并到 main**，包括维护者：

- 从最新 `main` 拉短期分支：`<type>/<short-description>`，例如 `feat/draw-clear-button`、`fix/draw-sync`；
- 所有改动通过 Pull Request 合并；
- PR 需要 CI 通过；有协作者时至少 1 人 review，单人仓库可把 required approvals 设为 0，但仍必须走 PR；
- 只允许 **Squash merge**，合并后删除分支；
- 禁止 force push / 删除 `main`；
- 紧急修复也走 PR，不要临时关闭保护。

完整分支命名、提交流程和 GitHub 保护配置见 [docs/GIT.md](docs/GIT.md)。

## 版本

- 版本遵循 SemVer：用户可见变更升 minor，修复升 patch，破坏性变更升 major；
- 发布用 annotated tag，并同步 `CHANGELOG.md`；
- Release 由 GitHub Actions 构建，不直接改 `main` 上的版本文件后硬推。
