#!/usr/bin/env bash
# 코드 작성: DeepSeek V4.1 Flash(OMP)가 **격리된 git 워크트리**에서 독립적인 개발 작업을 수행한다.
#
# 사용법:  deepseek-dev.sh <작업ID> <작업설명.md | -> [--allow "glob,glob"] [--base <ref>] [--no-install]
#   작업ID   영문 소문자·숫자·하이픈 (브랜치 ds/<작업ID>, 워크트리 ../<저장소>-ds-worktrees/<작업ID>)
#   --allow  수정해도 되는 경로 glob(쉼표 구분). 지정하면 그 밖의 변경은 거부된다.
#
# 격리 (겹겹이):
#   1) 별도 워크트리·브랜치 — 메인 작업 폴더는 건드리지 않는다
#   2) 보호 경로(에디터 코어 등)는 워크트리에서 쓰기 권한을 제거한다
#   3) macOS 샌드박스: 워크트리·임시 폴더 밖에는 쓸 수 없고, 비밀 폴더(~/.ssh, ~/.claude 등)는 읽을 수 없다. 환경 변수도 비운다
#   4) 작업 후 가드(deepseek-finalize.sh): 보호 경로/허용 밖 변경, 변경 내용이 메인 저장소로 새어 나감, DeepSeek이 만든 커밋이 있으면 거부(REJECTED)
# 결과는 커밋하지 않고 두지 않는다: 가드를 통과해야만 `ds(<ID>)` WIP 커밋으로 남긴다. 병합은 Claude가 검토·검증한 뒤 deepseek-accept.sh 로 한다.
# 실패해도 다른 모델로 바꾸거나 다시 시도하지 않는다.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/deepseek-common.sh"

[[ $# -ge 2 ]] || ds_die "사용법: deepseek-dev.sh <작업ID> <작업설명.md | -> [--allow \"glob,glob\"] [--base <ref>] [--no-install]" $DS_EXIT_USAGE
ID="$1"; TASK_ARG="$2"; shift 2
[[ "$ID" =~ ^[a-z0-9][a-z0-9-]{0,40}$ ]] || ds_die "작업ID는 영문 소문자·숫자·하이픈만 쓸 수 있습니다: $ID" $DS_EXIT_USAGE
ALLOW=""; BASE="HEAD"; DO_INSTALL=1
while [[ $# -gt 0 ]]; do
  case "$1" in
    --allow) ALLOW="$2"; shift 2 ;;
    --base) BASE="$2"; shift 2 ;;
    --no-install) DO_INSTALL=0; shift ;;
    *) ds_die "알 수 없는 옵션: $1" $DS_EXIT_USAGE ;;
  esac
done
ds_need omp; ds_need python3; ds_need git; ds_need sandbox-exec

BRANCH="ds/$ID"
WT="$DS_WORKTREE_ROOT/$ID"
git -C "$DS_REPO_ROOT" show-ref --verify --quiet "refs/heads/$BRANCH" && ds_die "브랜치가 이미 있습니다: $BRANCH (deepseek-discard.sh $ID 로 정리하세요)" $DS_EXIT_USAGE
[[ -e "$WT" ]] && ds_die "워크트리 경로가 이미 있습니다: $WT" $DS_EXIT_USAGE

RUN_DIR="$(ds_new_run_dir dev "$ID")"
STATE_DIR="$DS_RUNS_DIR/state"; mkdir -p "$STATE_DIR"
export DS_TMPDIR="$(mktemp -d /private/tmp/ds-tmp.XXXXXX)"
trap 'rm -rf "$DS_TMPDIR"' EXIT
ds_resolve_task "$TASK_ARG" "$RUN_DIR/task.md"

# 메인 저장소가 더러우면 알려 준다(워크트리는 커밋된 HEAD에서만 시작한다)
DIRTY="$(git -C "$DS_REPO_ROOT" status --porcelain | wc -l | tr -d ' ')"
[[ "$DIRTY" == "0" ]] || ds_info "메인 저장소에 커밋되지 않은 변경 ${DIRTY}건이 있습니다. 워크트리에는 포함되지 않습니다(필요하면 먼저 커밋하세요)."

ds_info "워크트리 생성: $WT ($BRANCH ← $BASE)"
git -C "$DS_REPO_ROOT" worktree add -q -b "$BRANCH" "$WT" "$BASE"
BASE_COMMIT="$(git -C "$WT" rev-parse HEAD)"

if [[ $DO_INSTALL -eq 1 ]]; then
  ds_info "의존성 설치(잠금 파일 고정, 설치 스크립트·네이티브 빌드 생략)…"
  (cd "$WT" && pnpm install --frozen-lockfile --prefer-offline --ignore-scripts >"$RUN_DIR/install.log" 2>&1) \
    || ds_die "pnpm install 실패 — $RUN_DIR/install.log" 1
fi

# ── 보호 경로 쓰기 잠금 ──
python3 - "$WT" "$DS_PROTECTED_FILE" <<'PY'
import os, re, subprocess, sys, stat
wt, pfile = sys.argv[1:3]
globs = [re.sub(r"\s*#.*$", "", l).strip() for l in open(pfile, encoding="utf-8")]
globs = [g for g in globs if g]
def rx(g):
    out, i = "", 0
    while i < len(g):
        if g[i:i+3] == "**/": out += "(?:.*/)?"; i += 3
        elif g[i:i+2] == "**": out += ".*"; i += 2
        elif g[i] == "*": out += "[^/]*"; i += 1
        elif g[i] == "?": out += "[^/]"; i += 1
        else: out += re.escape(g[i]); i += 1
    return re.compile("^" + out + "$")
rxs = [rx(g) for g in globs]
files = subprocess.check_output(["git", "-C", wt, "ls-files"], text=True).splitlines()
locked = dirs = 0
def lock(path):
    m = os.stat(path).st_mode
    os.chmod(path, m & ~(stat.S_IWUSR | stat.S_IWGRP | stat.S_IWOTH))
for f in files:
    if any(r.match(f) for r in rxs):
        lock(os.path.join(wt, f)); locked += 1
# `dir/**` 형태는 폴더도 잠가서 새 파일 생성을 막는다
for g in globs:
    if g.endswith("/**"):
        base = os.path.join(wt, g[:-3])
        for root, ds, _ in os.walk(base):
            for d in [root] + [os.path.join(root, x) for x in ds]:
                if os.path.isdir(d): lock(d)
        dirs += 1
print(f"잠금: 파일 {locked}개, 보호 폴더 {dirs}개", file=sys.stderr)
PY

# ── 샌드박스 프로필 ──
WT_GITDIR="$(git -C "$WT" rev-parse --absolute-git-dir)"
export DS_SANDBOX_PROFILE="$RUN_DIR/sandbox.sb"
ds_write_sandbox_profile "$DS_SANDBOX_PROFILE" "$WT" "$DS_TMPDIR" "$WT_GITDIR"

# ── 프롬프트 ──
PROTECTED_LIST="$(ds_protected_globs | sed 's/^/  - /')"
{
  cat <<PREFACE
# 실행 모드: 코드 작성 (작업 ID: $ID)
- 작업 디렉터리 \`$WT\`는 이 작업 전용으로 격리된 git 워크트리입니다. 이 밖의 경로에는 쓸 수 없습니다.
- 허용 경로: ${ALLOW:-"(제한 없음 — 단, 아래 보호 경로 제외)"}
- 보호 경로(수정 불가, 읽기는 가능):
$PROTECTED_LIST
- 커밋·푸시·브랜치 조작은 하지 마세요. 작업이 끝나면 아래 형식으로 최종 보고만 하세요.

# 작업
PREFACE
  cat "$RUN_DIR/task.md"
} > "$RUN_DIR/prompt.md"

# ── 실행 ──
ds_build_omp_args
START=$(date +%s)
set +e
ds_run_omp "$WT" "${DS_OMP_ARGS[@]}" \
  --config "$DS_CLAUDE_DIR/omp/dev.yml" \
  --tools read,grep,glob,edit,write,bash,todo \
  "@$RUN_DIR/prompt.md" > "$RUN_DIR/events.jsonl" 2> "$RUN_DIR/stderr.log"
OMP_RC=$?
set -e
DURATION=$(( $(date +%s) - START ))
ds_summarize_events "$RUN_DIR/events.jsonl" "$DS_MODEL" > "$RUN_DIR/summary.json"

# ── 마무리(가드·커밋·보고) ──
python3 - "$RUN_DIR/run.json" "$ID" "$ALLOW" "$BASE_COMMIT" "$OMP_RC" "$DURATION" "$WT" "$BRANCH" <<'PY'
import json, sys
path, id_, allow, base, rc, dur, wt, branch = sys.argv[1:9]
json.dump({"id": id_, "allow": allow, "base": base, "omp_rc": int(rc), "duration": int(dur), "worktree": wt, "branch": branch}, open(path, "w"), ensure_ascii=False)
PY
exec "$(dirname "${BASH_SOURCE[0]}")/deepseek-finalize.sh" "$RUN_DIR"
