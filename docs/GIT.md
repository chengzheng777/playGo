# Git 分支与提交规范

> 目标：`main` 始终保持可发布；每个改动都经过测试和 review；历史保持线性、可读。

## 1. 分支模型

采用 trunk-based development：

- `main` 是唯一长期分支，受保护；
- 所有改动从最新 `main` 拉短期分支，合并后删除；
- 不建长期 `develop` / `release` 分支；
- 发布用 annotated tag，不靠分支。

### 分支命名

格式：

```text
<type>/<short-description>
```

| 前缀        | 用途      | 示例                         |
| ----------- | --------- | ---------------------------- |
| `feat/`     | 新功能    | `feat/draw-clear-button`     |
| `fix/`      | 修复      | `fix/draw-second-round-sync` |
| `docs/`     | 文档      | `docs/git-workflow`          |
| `refactor/` | 重构      | `refactor/room-manager`      |
| `perf/`     | 性能      | `perf/ws-broadcast`          |
| `test/`     | 测试      | `test/draw-reconnect`        |
| `build/`    | 构建/依赖 | `build/electron-45`          |
| `ci/`       | CI/工作流 | `ci/dependabot-groups`       |
| `chore/`    | 杂项      | `chore/release-v0.3.0`       |

约定：

- 全小写，用 `-` 分隔，不用中文、空格、下划线；
- 长度尽量 ≤ 50 字符；
- 一个分支只做一件事，不要混入无关改动；
- `dependabot/*` 由机器人创建，属于例外。

### 标准流程

```bash
git switch main
git pull --ff-only
git switch -c feat/your-change

# 开发、测试
pnpm verify

git add <files>
git commit -m "feat(scope): 说明"

git push -u origin HEAD
```

然后在 GitHub 开 PR：

```text
base: main
compare: feat/your-change
title: feat(scope): 说明
```

合并前把分支 rebase 到最新 `main`，不要反向把 `main` merge 进功能分支：

```bash
git fetch origin
git rebase origin/main
git push --force-with-lease
```

合并后删除远端和本地分支：

```bash
git switch main
git pull --ff-only
git branch -d feat/your-change
git push origin --delete feat/your-change
```

## 2. 提交规范

使用 [Conventional Commits](https://www.conventionalcommits.org/)：

```text
<type>(<scope>): <subject>

<body>

<footer>
```

### type

| type       | 用途                       |
| ---------- | -------------------------- |
| `feat`     | 用户可见的新功能           |
| `fix`      | 用户可见的修复             |
| `docs`     | 仅文档                     |
| `style`    | 格式、空白、分号，不改逻辑 |
| `refactor` | 不改变行为的重构           |
| `perf`     | 性能优化                   |
| `test`     | 测试代码                   |
| `build`    | 构建、依赖、打包           |
| `ci`       | CI / GitHub Actions        |
| `chore`    | 杂项、版本发布             |
| `revert`   | 回滚                       |

### scope

可选，用英文小写，建议使用模块名：

```text
server  src  electron  draw  uno  yiyu  color  deps  ci  docs
```

### subject

- 用祈使句，直接说“做什么”，不要“我改了”；
- 中文或英文都可以，但同一仓库尽量统一；
- 不超过 72 个字符；
- 结尾不加句号；
- 不要写 `update`、`fix bug`、`changes` 这种无信息量的标题。

### 示例

```text
feat(draw): 增加清空画布按钮
fix(draw): 修复第二轮大屏不同步
fix(electron): 避免 ready 前读取 userData
docs(git): 增加分支与提交规范
refactor(server): 拆分房间广播逻辑
chore(deps): 升级开发依赖
ci: 增加 PR 标题检查
```

### body 和 footer

- body 写“为什么”，不要重复 diff；
- 破坏性变更用 footer：

```text
BREAKING CHANGE: 房间消息 v1 不再兼容，需要客户端同步升级
```

- 关联 issue：

```text
Closes #123
```

### 粒度

- 一个提交只做一件事；
- 格式化/重命名单独提交；
- 不要提交 `WIP`、调试日志、生成物；
- 合并使用 **Squash merge**，所以最终进入 `main` 的是 PR 标题，PR 标题也必须符合 Conventional Commits。

## 3. PR 规范

- 一个 PR 只对应一个目标；
- PR 标题必须符合 Conventional Commits（CI 会检查）；
- 描述里写：改了什么、为什么、怎么验证、风险/回滚；
- 关联 spec：`specs/NNN-*.md`；
- 涉及协议的 PR 必须跑 `pnpm smoke`；
- 涉及 UI 的 PR 尽量跑 `pnpm e2e`；
- 有协作者时至少 1 人 review；单人仓库可 0 人，但仍需 PR + CI；所有对话解决后才能合并；
- 只允许 **Squash merge**，合并后删除分支；
- 不要用 merge commit，不要 force push `main`。

## 4. `main` 分支保护

GitHub 的仓库设置不在代码里，需要在网页或 API 配置。推荐：

```text
Settings → Branches → Add branch protection rule
```

规则：

- Branch name pattern：`main`
- ✅ Require a pull request before merging
  - Required approvals：**单人仓库填 `0`，有协作者后改成 `1`**
  - ✅ Dismiss stale pull request approvals when new commits are pushed
  - ✅ Require conversation resolution before merging
- ✅ Require status checks to pass before merging
  - 选择 `verify`
  - 选择 `lint-pr-title`
  - ✅ Require branches to be up to date before merging
- ✅ Require linear history
- ✅ Do not allow bypassing the above settings
- ✅ Restrict who can push to matching branches（只保留管理员/机器人）
- ❌ Allow force pushes
- ❌ Allow deletions
- 合并方式只保留 **Squash merging**，开启 **Allow auto-merge**

如果使用 Rulesets：

```text
Settings → Rules → New branch ruleset
Target: main
```

效果一样：必须 PR、必须过 CI、必须 review、禁止直接 push/force push/删除。

> 开启 `Do not allow bypassing` 后，管理员也不能直接 push `main`。紧急情况应临时调整规则或走 `fix/` 分支，不要长期关闭保护。
>
> 如果仓库只有你一个人，Required approvals 设为 `0`：仍然必须走 PR/CI，但不会被“不能自己 approve 自己”卡住。等有第二个协作者后再改成 `1`。

### 用 gh 一次性配置

如果本机装了 `gh` 并已 `gh auth login`，可以运行：

```bash
bash scripts/setup-branch-protection.sh
```

脚本会设置 `main` 保护、只允许 squash、开启 auto-merge。运行前确认：

- `verify` 和 `lint-pr-title` 这两个 check 已经至少跑过一次；
- 你有仓库 admin 权限；
- 你接受管理员也不能直接 push。

## 5. 版本与发布

- 版本遵循 SemVer：`MAJOR.MINOR.PATCH`；
- 用户可见变更升 minor，修复升 patch，破坏性变更升 major；
- 发布用 annotated tag：

```bash
git tag -a v0.3.0 -m "v0.3.0"
git push origin v0.3.0
```

- 同步更新 `CHANGELOG.md`；
- 发布走 Release workflow，不直接在 `main` 上改版本号后硬推。

## 6. 机器人 PR

Dependabot 分支形如 `dependabot/npm_and_yarn/...`，是分支命名规范的例外。

- PR 标题由 Dependabot 生成，必须保持 `chore(deps): ...` / `chore(ci): ...`；
- patch/minor 由 auto-merge 在 CI 通过后合并；
- major 默认在 `.github/dependabot.yml` 里 ignore，需要时手动升级并单独开 PR；
- 过期的 Dependabot PR 直接关闭，避免占着 Open 列表。
