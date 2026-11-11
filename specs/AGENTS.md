# specs/AGENTS.md

写规格时遵循本目录 [README.md](README.md) 和 [TEMPLATE.md](TEMPLATE.md)。

- 规格只写**可观察行为**和边界，不写变量名、循环、组件结构等实现细节。
- 每条验收项必须能映射到 `pnpm test`、`pnpm smoke` 或 `pnpm e2e`；不能自动化的明确标注「手测」并写步骤。
- 新规格编号递增，不复用；不要删除已合并的规格，行为变化时直接更新。
- 头部标明 `draft` / `active` / `deprecated`。
- 改协议时同步 `docs/PROTOCOL.md`；用户可见变化同步 `CHANGELOG.md`。
- 规格不清楚时先问，不要把猜测写成验收标准。
