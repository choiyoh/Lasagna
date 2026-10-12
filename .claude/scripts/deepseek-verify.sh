#!/usr/bin/env bash
# DeepSeek 작업 결과 검증: 워크트리에서 타입 검사·lint·단위 테스트를 돌리고 결과를 상태 파일에 기록한다.
# (코드 검토는 이 스크립트 전에 메인 설계자가 `git diff`로 먼저 한다. 여기서는 DeepSeek이 쓴 코드를 실행하게 되므로
#  샌드박스(워크트리·임시 폴더 밖 쓰기 금지, 비밀 폴더 읽기 금지, 환경 변수 비움) 안에서 돌린다.)
#
# 사용법: deepseek-verify.sh <작업ID> [--e2e]
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/deepseek-common.sh"
[[ $# -ge 1 ]] || ds_die "사용법: deepseek-verify.sh <작업ID> [--e2e]" $DS_EXIT_USAGE
ID="$1"; shift
E2E=0; [[ "${1:-}" == "--e2e" ]] && E2E=1
STATE="$DS_RUNS_DIR/state/$ID.json"
[[ -f "$STATE" ]] || ds_die "작업 상태가 없습니다: $ID" $DS_EXIT_USAGE
WT="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["worktree"])' "$STATE")"
[[ -d "$WT" ]] || ds_die "워크트리가 없습니다: $WT" $DS_EXIT_USAGE
python3 -c 'import json,sys; sys.exit(0 if json.load(open(sys.argv[1]))["guard_ok"] else 1)' "$STATE" || ds_die "가드를 통과하지 못한 작업은 검증하지 않습니다(deepseek-discard.sh 로 정리하세요)" $DS_EXIT_GUARD

export DS_TMPDIR="$(mktemp -d /private/tmp/ds-tmp.XXXXXX)"
trap 'rm -rf "$DS_TMPDIR"' EXIT
PROFILE="$DS_TMPDIR/verify.sb"
ds_write_sandbox_profile "$PROFILE" "$WT" "$DS_TMPDIR" "$(git -C "$WT" rev-parse --absolute-git-dir)"
LOG="$DS_RUNS_DIR/verify-$ID.log"; : > "$LOG"

# 개발 중에는 보호 경로를 읽기 전용으로 잠가 두었지만, 테스트 도구(vitest 등)는 패키지 폴더에 임시 파일을 쓴다.
# 가드는 이미 통과했으므로 잠금을 풀고, 대신 검증 뒤 작업 트리가 깨끗한지(= 검증이 소스를 바꾸지 않았는지) 확인한다.
chmod -R u+w "$WT"
CLEAN_BEFORE="$(git -C "$WT" status --porcelain --untracked-files=all | wc -l | tr -d ' ')"
[[ "$CLEAN_BEFORE" == "0" ]] || ds_die "검증 전에 작업 트리가 깨끗하지 않습니다(커밋되지 않은 변경 ${CLEAN_BEFORE}건)" $DS_EXIT_GUARD

run() {
  local label="$1"; shift
  echo "▶ $label: $*" | tee -a "$LOG" >&2
  set +e
  (cd "$WT" && env -i HOME="$HOME" PATH="$(ds_safe_path)" LANG="${LANG:-en_US.UTF-8}" TERM=dumb TMPDIR="$DS_TMPDIR" CI=1 \
     sandbox-exec -f "$PROFILE" "$@" < /dev/null) >> "$LOG" 2>&1
  local rc=$?
  set -e
  echo "  → $([[ $rc -eq 0 ]] && echo 통과 || echo "실패(exit $rc)")" | tee -a "$LOG" >&2
  return $rc
}

OK=1
run 타입검사 pnpm typecheck || OK=0
run lint pnpm lint || OK=0
run 단위테스트 pnpm test || OK=0
if [[ $E2E -eq 1 ]]; then run E2E pnpm --filter @nopsidian/desktop e2e || OK=0; fi

HEAD_NOW="$(git -C "$WT" rev-parse HEAD)"
DIRTY_AFTER="$(git -C "$WT" status --porcelain --untracked-files=all | wc -l | tr -d ' ')"
if [[ "$DIRTY_AFTER" != "0" ]]; then
  echo "✖ 검증 도중 소스 파일이 바뀌었습니다(테스트가 파일을 생성/수정함):" | tee -a "$LOG" >&2
  git -C "$WT" status --porcelain --untracked-files=all | tee -a "$LOG" >&2
  OK=0
fi
python3 - "$STATE" "$OK" "$HEAD_NOW" <<'PY'
import json, sys
path, ok, head = sys.argv[1:4]
s = json.load(open(path))
s["verify_ok"] = ok == "1"
s["verified_head"] = head if ok == "1" else None
json.dump(s, open(path, "w"), ensure_ascii=False, indent=2)
PY
if [[ $OK -eq 1 ]]; then echo "✔ 검증 통과 (커밋 ${HEAD_NOW:0:8}) — 로그: $LOG"; else echo "✖ 검증 실패 — 로그: $LOG"; tail -30 "$LOG"; exit 1; fi
