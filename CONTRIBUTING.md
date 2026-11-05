# 贡献指南

## 项目结构

```
server/    本地服务：HTTP、静态资源、WebSocket、房间与游戏规则
shared/    前后端共享的协议类型、游戏目录、头像工具
src/       浏览器端（React）
specs/     规格（SDD）：先写清行为与验收，再写实现
docs/      设计、协议、打包等技术文档
scripts/   规则与协议冒烟测试
```

## 开发流程（SDD）

1. **写规格**：新增功能先建 `specs/NNN-name.md`（复制 `specs/TEMPLATE.md`）。
2. **改协议**：涉及消息/接口时同步 `docs/PROTOCOL.md`，类型放 `shared/protocol.ts`。
3. **写实现**：服务端规则放 `server/games/`，客户端视图放 `src/views/`。
4. **补测试**：纯规则写进 `scripts/engine-smoke.ts`；协议流程写进 `scripts/smoke.mjs`。
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
| `pnpm engine`    | 规则引擎测试                      |
| `pnpm smoke`     | 协议冒烟（需服务在跑）            |
| `pnpm verify`    | typecheck + lint + engine + build |

## 提交规范

使用 Conventional Commits：

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

## 分支与版本

- 当前为 trunk-based：直接在 `main` 小步提交。
- 版本遵循 SemVer；用户可见变更升 minor，修复升 patch。
