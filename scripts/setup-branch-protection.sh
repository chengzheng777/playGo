#!/usr/bin/env bash
# 一次性配置 GitHub main 分支保护 + 只允许 squash merge。
# 前提：已安装 gh 并执行过 gh auth login，且有仓库 admin 权限。
set -euo pipefail

REPO="${1:-$(gh repo view --json nameWithOwner -q .nameWithOwner)}"
echo "配置仓库：$REPO"

gh api --method PUT "repos/$REPO/branches/main/protection" --input - <<'JSON'
{
  "required_status_checks": {
    "strict": true,
    "contexts": ["verify", "lint-pr-title"]
  },
  "enforce_admins": true,
  "required_pull_request_reviews": {
    "dismiss_stale_reviews": true,
    "require_code_owner_reviews": false,
    "required_approving_review_count": 0,
    "require_last_push_approval": false
  },
  "restrictions": null,
  "required_linear_history": true,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "required_conversation_resolution": true,
  "required_signatures": false
}
JSON

gh api --method PATCH "repos/$REPO" --input - <<'JSON'
{
  "allow_squash_merge": true,
  "allow_merge_commit": false,
  "allow_rebase_merge": false,
  "allow_auto_merge": true,
  "delete_branch_on_merge": true
}
JSON

echo "完成：main 已要求 PR + CI，只允许 squash merge。"
echo "当前 required approvals = 0，适合单人仓库；有协作者后可改 docs/GIT.md 里的说明或 GitHub 设置。"
