# GEMINI.md

本仓库的完整开发规范见 [AGENTS.md](AGENTS.md)，请先读它，再读 [CONTRIBUTING.md](CONTRIBUTING.md) 和 [specs/README.md](specs/README.md)。

## 关键约束

- 先写/更新 `specs/NNN-*.md`，再写实现；规格不清先问。
- 游戏规则只放服务端，客户端只做展示和发送意图；外部输入用 zod 校验。
- 私密信息（词、手牌、照片）按人裁剪，不广播给所有人。
- 测试：`tests/*.test.ts`；协议流程 `scripts/smoke.mjs`；UI 流程 `e2e/run.mjs`。
- 完成前 `pnpm verify`；涉及协议再 `pnpm smoke`；更新 `CHANGELOG.md`。
- 不要提交 `dist/`、`release/`、`node_modules/`、`.tmp/`、`.env` 或密钥。
