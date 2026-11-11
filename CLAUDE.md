@AGENTS.md

# CLAUDE.md

本仓库以 `AGENTS.md` 为唯一规范源；上面的 `@AGENTS.md` 已导入通用规则。下面是 Claude Code 的补充。

## 工作方式

- 涉及新功能或行为变更时，先进入计划/规格阶段，不要直接改实现。
- 规格不清楚时先提问；不要把猜测写进 `specs/`。
- 改完先跑 `pnpm verify`；涉及协议再跑 `pnpm smoke`。
- 可用命令：`/sdd-spec` 创建或更新规格，`/verify` 跑完整检查。

## 注意

- 不要修改 `dist/`、`release/`、`electron/app/` 等生成物。
- 不要提交 `.env`、证书或服务器凭据。
- 需要部署时先读 `docs/REMOTE.md`，不要凭记忆改 Nginx/容器。
