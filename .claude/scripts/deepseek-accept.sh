#!/usr/bin/env bash
# 검토·검증을 마친 DeepSeek 작업을 현재 브랜치에 **스테이징 상태로** 합친다(커밋은 Claude가 직접 한다).
# 조건: ① 가드 통과 ② deepseek-verify.sh 통과 ③ 검증 이후 브랜치가 바뀌지 않음 ④ 보호 경로 변경 없음(다시 확인)
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/deepseek-common.sh"
[[ $# -eq 1 ]] || ds_die "사용법: deepseek-accept.sh <작업ID>" $DS_EXIT_USAGE
ID="$1"; STATE="$DS_RUNS_DIR/state/$ID.json"; BRANCH="ds/$ID"
[[ -f "$STATE" ]] || ds_die "작업 상태가 없습니다: $ID" $DS_EXIT_USAGE
jget() { python3 -c 'import json,sys; v=json.load(open(sys.argv[1])).get(sys.argv[2]); print("" if v is None else v)' "$STATE" "$1"; }

[[ "$(jget guard_ok)" == "True" ]] || ds_die "가드를 통과하지 못한 작업입니다" $DS_EXIT_GUARD
[[ "$(jget verify_ok)" == "True" ]] || ds_die "deepseek-verify.sh 를 먼저 통과해야 합니다" $DS_EXIT_GUARD
HEAD_NOW="$(git -C "$DS_REPO_ROOT" rev-parse "$BRANCH")"
[[ "$(jget verified_head)" == "$HEAD_NOW" ]] || ds_die "검증 이후 브랜치가 바뀌었습니다. 다시 검증하세요" $DS_EXIT_GUARD

BASE="$(jget base)"
PROTECTED="$(ds_protected_globs)"
BAD=""
while IFS= read -r f; do
  [[ -z "$f" ]] && continue
  if ds_path_matches "$f" "$PROTECTED"; then BAD+="  - $f"$'\n'; fi
done < <(git -C "$DS_REPO_ROOT" diff --name-only "$BASE" "$BRANCH")
[[ -z "$BAD" ]] || ds_die $'보호 경로 변경이 있어 병합할 수 없습니다:\n'"$BAD" $DS_EXIT_GUARD

git -C "$DS_REPO_ROOT" merge --squash "$BRANCH"
echo "✔ ds/$ID 변경을 스테이징했습니다. 검토 후 Claude가 직접 커밋하세요. 정리: .claude/scripts/deepseek-discard.sh $ID"
