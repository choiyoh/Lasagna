#!/usr/bin/env bash
# DeepSeek(OMP) 연결 점검. 설치·모델 등록·인증·모델 고정·"다른 모델로 대체하지 않음"을 실제로 확인한다.
# 사용법: deepseek-doctor.sh [--quick]    (--quick: 실제 모델 호출 없이 정적 점검만)
set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/deepseek-common.sh"
set +e   # common.sh의 set -e를 끈다: 실패하는 호출의 결과를 직접 판정해야 한다
QUICK=0; [[ "${1:-}" == "--quick" ]] && QUICK=1
FAIL=0
ok()   { echo "  ✔ $*"; }
bad()  { echo "  ✖ $*"; FAIL=1; }

echo "[1] 설치"
command -v omp >/dev/null && ok "omp $(omp --version 2>&1 | head -1)" || bad "omp 없음"
command -v sandbox-exec >/dev/null && ok "sandbox-exec 사용 가능" || bad "sandbox-exec 없음(코드 작성 격리 불가)"
command -v python3 >/dev/null && ok "python3" || bad "python3 없음"

echo "[2] 모델 등록: $DS_MODEL"
PROVIDER="${DS_MODEL%%/*}"; MODEL_ID="${DS_MODEL#*/}"
if omp models "$PROVIDER" 2>/dev/null | grep -qF "$MODEL_ID"; then ok "provider=$PROVIDER 에 $MODEL_ID 등록됨"; else bad "omp models $PROVIDER 에서 $MODEL_ID 를 찾지 못함"; fi

echo "[3] 설정 파일"
[[ -f "$DS_OMP_CFG_BASE" ]] && ok "overlay: ${DS_OMP_CFG_BASE#$DS_REPO_ROOT/}" || bad "overlay 없음"
grep -q "modelFallback: false" "$DS_OMP_CFG_BASE" && ok "retry.modelFallback=false (모델 자동 대체 끔)" || bad "modelFallback이 꺼져 있지 않음"
grep -q "fallbackChains: {}" "$DS_OMP_CFG_BASE" && ok "retry.fallbackChains={} (대체 체인 없음)" || bad "fallbackChains가 비어 있지 않음"
GLOBAL_CFG="$HOME/.omp/agent/config.yml"
[[ -f "$GLOBAL_CFG" ]] && ok "기존 전역 OMP 설정은 수정하지 않음(덧씌우기만 사용): $(shasum "$GLOBAL_CFG" | cut -c1-8)"

if [[ $QUICK -eq 1 ]]; then echo; [[ $FAIL -eq 0 ]] && echo "정적 점검 통과" || echo "정적 점검 실패"; exit $FAIL; fi

echo "[4] 실제 호출(읽기 전용, 환경 비움 + 샌드박스)"
T="$(mktemp -d /private/tmp/ds-doctor.XXXXXX)"; trap 'rm -rf "$T"' EXIT
export DS_TMPDIR="$T"; export DS_SANDBOX_PROFILE="$T/s.sb"
ds_write_sandbox_profile "$DS_SANDBOX_PROFILE" "$T/none" "$T"
ds_build_omp_args
ds_run_omp "$DS_REPO_ROOT" "${DS_OMP_ARGS[@]}" --config "$DS_CLAUDE_DIR/omp/readonly.yml" --thinking low --tools read,grep,glob \
  "정확히 한 단어 PONG 만 답하세요." > "$T/ev.jsonl" 2> "$T/err.log"
RC=$?
SUM="$(ds_summarize_events "$T/ev.jsonl" "$DS_MODEL")"
echo "$SUM" > "$T/sum.json"
[[ $RC -eq 0 ]] && ok "omp 종료 코드 0" || bad "omp 종료 코드 $RC ($(head -c 200 "$T/err.log"))"
python3 -c 'import json,sys; s=json.load(open(sys.argv[1])); sys.exit(0 if s["model_ok"] else 1)' "$T/sum.json" && ok "응답 모델: $(python3 -c 'import json,sys; print(",".join(json.load(open(sys.argv[1]))["models"]))' "$T/sum.json") (지정과 일치)" || bad "응답 모델이 지정과 다름: $(python3 -c 'import json,sys; print(",".join(json.load(open(sys.argv[1]))["models"]))' "$T/sum.json")"
python3 -c 'import json,sys; sys.exit(0 if "PONG" in json.load(open(sys.argv[1]))["final_text"] else 1)' "$T/sum.json" && ok "응답 내용 확인(PONG)" || bad "예상한 응답이 아님: $(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["final_text"][:200].replace(chr(10)," "))' "$T/sum.json")"

echo "[5] 대체 금지 검증: 존재하지 않는 DeepSeek 모델을 지정하면 실패해야 하고, 다른 모델이 대신 답하면 안 된다"
BOGUS="commandcode/deepseek/does-not-exist-v9"
DS_MODEL="$BOGUS" ds_build_omp_args
ds_run_omp "$DS_REPO_ROOT" "${DS_OMP_ARGS[@]}" --config "$DS_CLAUDE_DIR/omp/readonly.yml" --thinking low --tools read \
  "정확히 한 단어 PONG 만 답하세요." > "$T/ev2.jsonl" 2> "$T/err2.log"
RC2=$?
SUM2="$(ds_summarize_events "$T/ev2.jsonl" "$BOGUS")"; echo "$SUM2" > "$T/sum2.json"
ANSWERED="$(python3 -c 'import json,sys; s=json.load(open(sys.argv[1])); print("yes" if (s["models"] or s["final_text"].strip()) else "no")' "$T/sum2.json")"
if [[ $RC2 -ne 0 && "$ANSWERED" == "no" ]]; then ok "실패로 끝났고 어떤 모델도 대신 응답하지 않음 (exit $RC2: $(head -c 120 "$T/err2.log" | tr '\n' ' '))"
else bad "존재하지 않는 모델 지정에도 응답이 나왔음(exit $RC2, models=$(python3 -c 'import json,sys; print(",".join(json.load(open(sys.argv[1]))["models"]))' "$T/sum2.json"))"; fi

echo; [[ $FAIL -eq 0 ]] && echo "✔ 모든 점검 통과" || echo "✖ 실패 항목이 있습니다"
exit $FAIL
