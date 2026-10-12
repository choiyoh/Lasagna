#!/usr/bin/env bash
# 실행이 끝난 DeepSeek 작업의 마무리: 가드 검사 → (통과하면) WIP 커밋 → 상태 파일 → 보고서.
# deepseek-dev.sh 가 끝에서 부르며, 가드 규칙을 고친 뒤 이미 끝난 실행을 다시 판정할 때 직접 부를 수도 있다.
#
# 사용법: deepseek-finalize.sh <실행 기록 폴더>
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/deepseek-common.sh"
RUN_DIR="${1:?사용법: deepseek-finalize.sh <실행 기록 폴더>}"
[[ -f "$RUN_DIR/run.json" && -f "$RUN_DIR/summary.json" ]] || ds_die "실행 기록이 올바르지 않습니다: $RUN_DIR" $DS_EXIT_USAGE
rj() { python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))[sys.argv[2]])' "$RUN_DIR/run.json" "$1"; }
ID="$(rj id)"; ALLOW="$(rj allow)"; BASE_COMMIT="$(rj base)"; OMP_RC="$(rj omp_rc)"; DURATION="$(rj duration)"; WT="$(cd "$(rj worktree)" && pwd -P)"; BRANCH="$(rj branch)"   # 샌드박스 규칙은 정규화된 경로만 일치시킨다
STATE_DIR="$DS_RUNS_DIR/state"; mkdir -p "$STATE_DIR"

# ── 가드 ──
VIOLATIONS=""
HEAD_NOW="$(git -C "$WT" rev-parse HEAD)"
if [[ "$HEAD_NOW" != "$BASE_COMMIT" ]]; then
  # 이미 마무리된 작업을 다시 판정하는 경우: 마지막 커밋이 우리가 만든 WIP 커밋(작성자 deepseek-omp)이면 정상
  if [[ "$(git -C "$WT" log -1 --format=%ae)" == "deepseek-omp@localhost" && "$(git -C "$WT" rev-parse HEAD~1)" == "$BASE_COMMIT" ]]; then
    git -C "$WT" reset -q --soft "$BASE_COMMIT"; git -C "$WT" reset -q   # WIP 커밋을 풀어 다시 판정한다
  else
    VIOLATIONS+=$'- DeepSeek이 직접 커밋을 만들었습니다(HEAD 변경)\n'
  fi
fi
CHANGED="$(git -C "$WT" status --porcelain --untracked-files=all | sed -E 's/^.. //; s/^"(.*)"$/\1/' | sed -E 's/.* -> //' | sort -u)"
PROTECTED="$(ds_protected_globs)"
ALLOW_GLOBS="$(echo "$ALLOW" | tr ',' '\n' | sed 's/^ *//; s/ *$//' | sed '/^$/d')"
while IFS= read -r f; do
  [[ -z "$f" ]] && continue
  if ds_path_matches "$f" "$PROTECTED"; then VIOLATIONS+="- 보호 경로 변경: $f"$'\n'
  elif [[ -n "$ALLOW_GLOBS" ]] && ! ds_path_matches "$f" "$ALLOW_GLOBS"; then VIOLATIONS+="- 허용 밖 변경: $f"$'\n'; fi
  # 격리 누수: 워크트리에서 바뀐 파일이 메인 작업 폴더에 같은 내용으로 나타나면 안 된다.
  # (메인 저장소 전체의 변화는 비교하지 않는다: 그 사이 Claude가 메인에서 작업하거나 다른 작업이 병렬로 돌 수 있다. 쓰기 자체는 샌드박스가 OS 수준에서 막는다.)
  if [[ -f "$WT/$f" && -f "$DS_REPO_ROOT/$f" ]] && cmp -s "$WT/$f" "$DS_REPO_ROOT/$f" && ! git -C "$DS_REPO_ROOT" diff --quiet HEAD -- "$f" 2>/dev/null; then
    # 메인에도 같은 내용이 있고 HEAD와는 다르다 → 새어 나갔거나 Claude가 같은 변경을 직접 했다. 구분할 수 없으니 거부하고 사람이 판단한다.
    VIOLATIONS+="- 변경 내용이 메인 작업 폴더에도 있음(누수 의심): $f"$'\n'
  fi
done <<< "$CHANGED"
NCHANGED="$(echo "$CHANGED" | sed '/^$/d' | wc -l | tr -d ' ')"

STATUS="성공"; RC=0
if [[ -n "$VIOLATIONS" ]]; then STATUS="거부됨(REJECTED) — 격리/범위 위반"; RC=$DS_EXIT_GUARD
elif [[ $OMP_RC -ne 0 ]]; then STATUS="실패 — omp 종료 코드 $OMP_RC"; RC=$DS_EXIT_OMP_FAILED
elif ! python3 -c 'import json,sys; sys.exit(0 if json.load(open(sys.argv[1]))["model_ok"] else 1)' "$RUN_DIR/summary.json"; then STATUS="실패 — 지정한 모델이 아닌 곳에서 응답"; RC=$DS_EXIT_MODEL_MISMATCH
elif python3 -c 'import json,sys; s=json.load(open(sys.argv[1])); sys.exit(0 if (s["stop_reason"] in ("error","aborted","length") or s["errors"]) else 1)' "$RUN_DIR/summary.json"; then STATUS="실패 — 모델 호출 오류/중단"; RC=$DS_EXIT_OMP_FAILED
elif [[ "$NCHANGED" == "0" ]]; then STATUS="변경 없음"; RC=0
fi

# 가드를 통과한 변경만 WIP 커밋으로 남긴다(커밋은 샌드박스 밖에서, 메인 설계자 쪽 신원이 아닌 별도 작성자로)
COMMIT=""
if [[ $RC -eq 0 && "$NCHANGED" != "0" ]]; then
  git -C "$WT" add -A
  git -C "$WT" -c user.name="DeepSeek V4.1 Flash (OMP)" -c user.email="deepseek-omp@localhost" \
    commit -q -m "ds($ID): WIP — DeepSeek 작업 결과(검토 전)" -m "model: $DS_MODEL"$'\n'"run: $RUN_DIR"
  COMMIT="$(git -C "$WT" rev-parse --short HEAD)"
fi

# 상태 파일: accept 가 검증·가드 결과를 확인한다
python3 - "$STATE_DIR/$ID.json" "$ID" "$BRANCH" "$WT" "$BASE_COMMIT" "$STATUS" "$RC" "$RUN_DIR" "$COMMIT" <<'PY'
import json, sys, time
path, id_, branch, wt, base, status, rc, run, commit = sys.argv[1:10]
json.dump({"id": id_, "branch": branch, "worktree": wt, "base": base, "status": status, "rc": int(rc),
           "run_dir": run, "commit": commit or None, "guard_ok": int(rc) == 0, "verified_head": None,
           "created": time.strftime("%Y-%m-%dT%H:%M:%S")}, open(path, "w"), ensure_ascii=False, indent=2)
PY

EXTRA="- 소요: ${DURATION}초 · 변경 파일 ${NCHANGED}개 · 워크트리: $WT (브랜치 $BRANCH${COMMIT:+, 커밋 $COMMIT})"
if [[ -n "$VIOLATIONS" ]]; then EXTRA+=$'\n- 가드 위반:\n'"$(echo "$VIOLATIONS" | sed 's/^/  /')"; fi
if [[ -n "$COMMIT" ]]; then
  EXTRA+=$'\n- 변경 통계:\n'"$(git -C "$WT" diff --stat "$BASE_COMMIT" HEAD | sed 's/^/  /')"
  EXTRA+=$'\n- 다음 단계: 메인 설계자(Claude)가 `git diff '"$BASE_COMMIT"'..'"$BRANCH"'` 를 검토 → `.claude/scripts/deepseek-verify.sh '"$ID"'` → `.claude/scripts/deepseek-accept.sh '"$ID"'` (또는 deepseek-discard.sh)'
fi
ds_print_report "$RUN_DIR" "$STATUS" "$RUN_DIR/summary.json" "$EXTRA"
[[ $RC -eq 0 ]] || echo -e "\n※ 실패/거부되었습니다. 다른 모델로 대체하거나 다시 시도하지 않았습니다. 워크트리는 점검용으로 남겨 두었습니다: $WT (stderr: $RUN_DIR/stderr.log)" >&2
exit $RC
