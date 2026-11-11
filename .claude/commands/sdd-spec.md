---
description: 创建或更新一份 SDD 规格
argument-hint: [功能名或规格编号]
---

先读 `specs/README.md` 和 `specs/TEMPLATE.md`，再判断是新建还是更新规格。

要求：

1. 先用一两句话复述要解决的行为；不清楚的地方先问我，不要猜。
2. 新建时使用下一个未占用的 `NNN-name.md` 编号；更新时保留原编号。
3. 写清背景、可观察行为、边界、接口变化、验收标准。
4. 验收项必须能映射到 `pnpm test`、`pnpm smoke` 或 `pnpm e2e`；不能自动化的标「手测」并写步骤。
5. 如果涉及协议，同时指出需要修改 `shared/protocol.ts` 和 `docs/PROTOCOL.md`。
6. 只改 spec 和必要文档，不要在这一步写实现代码。

最后告诉我：改了哪个 spec、有哪些待确认项、下一步建议。
