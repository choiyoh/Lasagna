#!/usr/bin/env bash
# DeepSeek 작업 워크트리·브랜치·상태를 정리한다(병합 후 또는 폐기할 때).
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/deepseek-common.sh"
[[ $# -eq 1 ]] || ds_die "사용법: deepseek-discard.sh <작업ID>" $DS_EXIT_USAGE
ID="$1"; [[ "$ID" =~ ^[a-z0-9][a-z0-9-]{0,40}$ ]] || ds_die "잘못된 작업ID" $DS_EXIT_USAGE
WT="$DS_WORKTREE_ROOT/$ID"; BRANCH="ds/$ID"
if [[ -d "$WT" ]]; then
  chmod -R u+w "$WT" 2>/dev/null || true     # 보호 경로 쓰기 잠금 해제
  git -C "$DS_REPO_ROOT" worktree remove --force "$WT"
fi
git -C "$DS_REPO_ROOT" worktree prune
git -C "$DS_REPO_ROOT" show-ref --verify --quiet "refs/heads/$BRANCH" && git -C "$DS_REPO_ROOT" branch -D "$BRANCH" >/dev/null
rm -f "$DS_RUNS_DIR/state/$ID.json" "$DS_RUNS_DIR/verify-$ID.log"
rmdir "$DS_WORKTREE_ROOT" 2>/dev/null || true
echo "✔ ds/$ID 정리 완료"
