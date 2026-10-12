#!/usr/bin/env bash
# 읽기 전용 분석: DeepSeek V4.1 Flash(OMP)에게 코드를 읽고 분석·리뷰·조사하게 한다.
#
# 사용법:  deepseek-analyze.sh <작업설명.md | -> [--cwd <디렉터리>]
#   - 파일을 읽을 수는 있어도 수정·명령 실행은 못 한다(도구 허용 목록 + OS 샌드박스 + 실행 전후 git 상태 비교).
#   - 실패해도 다른 모델로 바꾸거나 다시 시도하지 않는다. 종료 코드는 deepseek-common.sh 참고.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/deepseek-common.sh"

[[ $# -ge 1 ]] || ds_die "사용법: deepseek-analyze.sh <작업설명.md | -> [--cwd <디렉터리>]" $DS_EXIT_USAGE
TASK_ARG="$1"; shift
CWD="$DS_REPO_ROOT"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --cwd) CWD="$(cd "$2" && pwd)"; shift 2 ;;
    *) ds_die "알 수 없는 옵션: $1" $DS_EXIT_USAGE ;;
  esac
done
ds_need omp; ds_need python3; ds_need git

RUN_DIR="$(ds_new_run_dir analyze)"
export DS_TMPDIR="$(mktemp -d /private/tmp/ds-tmp.XXXXXX)"
trap 'rm -rf "$DS_TMPDIR"' EXIT

ds_resolve_task "$TASK_ARG" "$RUN_DIR/task.md"
{
  cat <<'PREFACE'
# 실행 모드: 읽기 전용 분석
- 이 실행에서는 **어떤 파일도 만들거나 고칠 수 없고 명령도 실행할 수 없습니다.** 코드를 읽고(read/grep/glob) 분석 결과만 답하세요.
- 근거는 `파일경로:줄번호`로 인용하세요. 확인하지 못한 것은 추측이라고 표시하세요.
- 코드를 바꿔야 한다면 변경안을 말로/코드 블록으로 제안만 하세요(적용은 메인 설계자가 합니다).

# 작업
PREFACE
  cat "$RUN_DIR/task.md"
} > "$RUN_DIR/prompt.md"

# 실행 전 저장소 상태(읽기 전용 보장 검증용)
snapshot() { (cd "$DS_REPO_ROOT" && { git status --porcelain=v1 -z; git diff HEAD | shasum; git rev-parse HEAD; } | shasum | cut -d' ' -f1); }
BEFORE="$(snapshot)"

# 쓰기가 허용되는 곳이 임시 폴더와 OMP 상태 폴더뿐인 샌드박스
EMPTY_WT="$(mktemp -d /private/tmp/ds-empty.XXXXXX)"
export DS_SANDBOX_PROFILE="$RUN_DIR/sandbox.sb"
ds_write_sandbox_profile "$DS_SANDBOX_PROFILE" "$EMPTY_WT" "$DS_TMPDIR"

ds_build_omp_args
START=$(date +%s)
set +e
ds_run_omp "$CWD" "${DS_OMP_ARGS[@]}" \
  --config "$DS_CLAUDE_DIR/omp/readonly.yml" \
  --tools read,grep,glob \
  "@$RUN_DIR/prompt.md" > "$RUN_DIR/events.jsonl" 2> "$RUN_DIR/stderr.log"
OMP_RC=$?
set -e
rmdir "$EMPTY_WT" 2>/dev/null || true
DURATION=$(( $(date +%s) - START ))

ds_summarize_events "$RUN_DIR/events.jsonl" "$DS_MODEL" > "$RUN_DIR/summary.json"
AFTER="$(snapshot)"
STATUS="성공"; RC=0
if [[ "$BEFORE" != "$AFTER" ]]; then STATUS="실패 — 읽기 전용인데 저장소가 변경됨"; RC=$DS_EXIT_GUARD
elif [[ $OMP_RC -ne 0 ]]; then STATUS="실패 — omp 종료 코드 $OMP_RC"; RC=$DS_EXIT_OMP_FAILED
elif ! python3 -c 'import json,sys; sys.exit(0 if json.load(open(sys.argv[1]))["model_ok"] else 1)' "$RUN_DIR/summary.json"; then STATUS="실패 — 지정한 모델이 아닌 곳에서 응답"; RC=$DS_EXIT_MODEL_MISMATCH
elif python3 -c 'import json,sys; s=json.load(open(sys.argv[1])); sys.exit(0 if (s["stop_reason"] in ("error","aborted","length") or s["errors"]) else 1)' "$RUN_DIR/summary.json"; then STATUS="실패 — 모델 호출 오류/중단"; RC=$DS_EXIT_OMP_FAILED
elif ! python3 -c 'import json,sys; sys.exit(0 if json.load(open(sys.argv[1]))["final_text"].strip() else 1)' "$RUN_DIR/summary.json"; then STATUS="실패 — 최종 응답이 비어 있음"; RC=$DS_EXIT_EMPTY
fi

ds_print_report "$RUN_DIR" "$STATUS" "$RUN_DIR/summary.json" "- 소요: ${DURATION}초 · 저장소 변경 없음 확인: $([[ "$BEFORE" == "$AFTER" ]] && echo 예 || echo 아니오)"
[[ $RC -eq 0 ]] || echo -e "\n※ 실패했습니다. 다른 모델로 대체하거나 다시 시도하지 않았습니다. 사용자/메인 설계자의 판단이 필요합니다. (stderr: $RUN_DIR/stderr.log)" >&2
exit $RC
