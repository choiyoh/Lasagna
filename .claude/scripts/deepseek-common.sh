#!/usr/bin/env bash
# DeepSeek(OMP) 보조 에이전트 공통 함수. 다른 deepseek-*.sh 가 source 한다.
#
# 설계 원칙
#  1) 모델은 항상 명시한다. 실패해도 다른 모델로 바꾸지 않는다(스크립트는 재시도도 하지 않는다).
#  2) 실행 결과가 정말 지정한 모델에서 나왔는지 JSON 이벤트에서 확인한다.
#  3) 코드 작성은 별도 git 워크트리 + macOS 샌드박스 안에서만 한다.

set -euo pipefail

DS_MODEL="${DEEPSEEK_MODEL:-commandcode/deepseek/deepseek-v4.1-flash}"
DS_THINKING="${DEEPSEEK_THINKING:-high}"
DS_MAX_TIME="${DEEPSEEK_MAX_TIME:-20m}"

DS_REPO_ROOT="$(git rev-parse --show-toplevel)"
DS_CLAUDE_DIR="$DS_REPO_ROOT/.claude"
DS_OMP_CFG_BASE="$DS_CLAUDE_DIR/omp/deepseek.base.yml"
DS_RULES_FILE="$DS_CLAUDE_DIR/omp/deepseek-rules.md"
DS_PROTECTED_FILE="$DS_CLAUDE_DIR/omp/protected-paths.txt"
DS_RUNS_DIR="$DS_REPO_ROOT/.scratch/deepseek-runs"
DS_WORKTREE_ROOT="$(dirname "$DS_REPO_ROOT")/$(basename "$DS_REPO_ROOT")-ds-worktrees"

# 종료 코드 (호출자가 실패 종류를 구분할 수 있게)
DS_EXIT_OMP_FAILED=10        # omp가 비정상 종료
DS_EXIT_MODEL_MISMATCH=11    # 응답이 지정한 모델이 아닌 곳에서 옴 → 결과 폐기
DS_EXIT_EMPTY=12             # 최종 응답이 비어 있음
DS_EXIT_GUARD=13             # 격리/보호 경로 위반
DS_EXIT_USAGE=64

ds_die() { echo "✖ $*" >&2; exit "${2:-1}"; }
ds_info() { echo "• $*" >&2; }

ds_need() { command -v "$1" >/dev/null 2>&1 || ds_die "필요한 명령이 없습니다: $1" 69; }

# 작업 설명 파일 경로를 정한다. `-`면 표준입력을 파일로 저장한다.
ds_resolve_task() {
  local arg="$1" out="$2"
  if [[ "$arg" == "-" ]]; then cat > "$out"; else
    [[ -f "$arg" ]] || ds_die "작업 설명 파일이 없습니다: $arg" $DS_EXIT_USAGE
    cp "$arg" "$out"
  fi
  [[ -s "$out" ]] || ds_die "작업 설명이 비어 있습니다" $DS_EXIT_USAGE
}

# 보호 경로 glob 목록(주석·빈 줄 제외)
ds_protected_globs() { sed -E 's/[[:space:]]*#.*$//; /^[[:space:]]*$/d' "$DS_PROTECTED_FILE"; }

# glob → 정규식 (** = 모든 하위, * = 한 구간)
ds_glob_to_regex() {
  python3 - "$1" <<'PY'
import re, sys
g = sys.argv[1]
out, i = "", 0
while i < len(g):
    c = g[i]
    if g[i:i+3] == "**/": out += "(?:.*/)?"; i += 3
    elif g[i:i+2] == "**": out += ".*"; i += 2
    elif c == "*": out += "[^/]*"; i += 1
    elif c == "?": out += "[^/]"; i += 1
    else: out += re.escape(c); i += 1
print("^" + out + "$")
PY
}

# 파일 경로가 glob 목록(줄바꿈 구분) 중 하나에 맞으면 0
ds_path_matches() {
  local path="$1" globs="$2" g re
  while IFS= read -r g; do
    [[ -z "$g" ]] && continue
    re="$(ds_glob_to_regex "$g")"
    if python3 -c 'import re,sys; sys.exit(0 if re.match(sys.argv[1], sys.argv[2]) else 1)' "$re" "$path"; then return 0; fi
  done <<< "$globs"
  return 1
}

# omp 이벤트(JSONL)를 분석해 요약 JSON을 만든다.
#   $1 events.jsonl  $2 기대 모델("provider/model")  → 표준출력: JSON
ds_summarize_events() {
  python3 - "$1" "$2" <<'PY'
import json, sys
path, expected = sys.argv[1], sys.argv[2]
final_text, models, tools, errors, stop = "", set(), {}, [], None
last_assistant_text = ""
with open(path, encoding="utf-8", errors="replace") as f:
    for line in f:
        line = line.strip()
        if not line.startswith("{"):
            continue
        try:
            ev = json.loads(line)
        except Exception:
            continue
        t = ev.get("type")
        if t == "message_end" and ev.get("message", {}).get("role") == "assistant":
            m = ev["message"]
            if m.get("provider") and m.get("model"):
                models.add(f'{m["provider"]}/{m["model"]}')
            stop = m.get("stopReason", stop)
            if m.get("errorMessage"):
                errors.append(m["errorMessage"])
            text = "".join(c.get("text", "") for c in m.get("content", []) if c.get("type") == "text")
            if text.strip():
                last_assistant_text = text
        elif t in ("tool_execution_start", "tool_call"):
            name = ev.get("toolName") or ev.get("name") or ev.get("tool", {}).get("name")
            if name:
                tools[name] = tools.get(name, 0) + 1
        elif t == "error":
            errors.append(str(ev.get("message") or ev))
print(json.dumps({
    "models": sorted(models),
    "model_ok": bool(models) and models == {expected},
    "tools": tools,
    "stop_reason": stop,
    "errors": errors,
    "final_text": last_assistant_text,
}, ensure_ascii=False))
PY
}

# 실행 폴더 하나를 만든다. 표준출력: 경로
ds_new_run_dir() {
  local kind="$1" id="${2:-run}" dir
  dir="$DS_RUNS_DIR/$(date +%Y%m%d-%H%M%S)-$kind-$id"
  mkdir -p "$dir"
  echo "$dir"
}

# 보고서 출력(Claude가 읽는 형식)
ds_print_report() {
  local run_dir="$1" status="$2" summary_json="$3" extra="${4:-}"
  python3 - "$run_dir" "$status" "$summary_json" "$extra" <<'PY'
import json, sys
run_dir, status, summary_path, extra = sys.argv[1:5]
s = json.load(open(summary_path))
print(f"## DeepSeek 실행 결과: {status}")
print(f"- 모델: {', '.join(s['models']) or '(응답 없음)'}  (지정 모델과 일치: {'예' if s['model_ok'] else '아니오'})")
print(f"- 종료 사유: {s['stop_reason']}")
print(f"- 사용한 도구: {', '.join(f'{k}×{v}' for k, v in s['tools'].items()) or '없음'}")
if s["errors"]:
    print("- 오류:")
    for e in s["errors"][:5]:
        print(f"  - {e[:300]}")
print(f"- 실행 기록: {run_dir}")
if extra:
    print(extra)
print("\n### 에이전트 최종 응답\n")
print(s["final_text"] or "(비어 있음)")
PY
}

# ── 샌드박스(macOS sandbox-exec) ──
# 쓰기: 워크트리·임시 폴더·OMP/Bun 상태 폴더만. 읽기 금지: 비밀 정보가 있는 홈 하위 폴더.
# 작성은 덮어쓰기 규칙의 "마지막 일치가 우선" 성질을 이용한다.
ds_write_sandbox_profile() {
  local out="$1" worktree="$2" tmp="$3" wt_gitdir="${4:-}"
  {
    echo '(version 1)'
    echo '(allow default)'
    echo "(deny file-write* (subpath \"$HOME\") (subpath \"$DS_REPO_ROOT\"))"
    echo "(allow file-write* (subpath \"$worktree\") (subpath \"$tmp\") (subpath \"$HOME/.omp\") (subpath \"$HOME/.bun\") (subpath \"$HOME/Library/Caches\") (subpath \"$HOME/Library/pnpm\") (subpath \"$HOME/.local/share/pnpm\") (subpath \"/private/tmp\") (subpath \"/private/var/folders\") (literal \"/dev/null\") (regex #\"^/dev/(tty|null|dtty|fd/)\"))"
    [[ -n "$wt_gitdir" ]] && echo "(allow file-write* (subpath \"$wt_gitdir\"))"
    local d
    for d in .ssh .aws .gnupg .claude .config/gh .netrc Library/Keychains Library/Application\ Support/Claude; do
      echo "(deny file-read* (subpath \"$HOME/$d\"))"
    done
  } > "$out"
}

# 에이전트에게 줄 PATH: 개발에 필요한 도구(node·pnpm·git·rg·omp)가 있는 폴더만 담는다.
ds_safe_path() {
  local dirs=("$HOME/.bun/bin") c d
  for c in node pnpm git rg python3; do
    d="$(command -v "$c" 2>/dev/null || true)"; [[ -n "$d" ]] && dirs+=("$(dirname "$d")")
  done
  dirs+=(/opt/homebrew/bin /usr/local/bin /usr/bin /bin)
  printf '%s\n' "${dirs[@]}" | awk '!seen[$0]++' | paste -sd: -
}

# 환경을 비운 채(비밀 환경 변수 제거) omp를 실행한다. 인자는 omp 인자.
#   환경 변수: DS_SANDBOX_PROFILE(없으면 샌드박스 없이), DS_TMPDIR
ds_run_omp() {
  local cwd="$1"; shift
  local tmp="${DS_TMPDIR:-$(mktemp -d /private/tmp/ds-tmp.XXXXXX)}"
  local runner=(env -i HOME="$HOME" PATH="$(ds_safe_path)" LANG="${LANG:-en_US.UTF-8}" TERM=dumb TMPDIR="$tmp" CI=1)
  if [[ -n "${DS_SANDBOX_PROFILE:-}" ]]; then
    runner+=(sandbox-exec -f "$DS_SANDBOX_PROFILE")
  fi
  # 표준입력을 닫아 둔다: 열린 파이프가 상속되면 omp가 EOF를 기다리며 멈춘다
  (cd "$cwd" && "${runner[@]}" omp -p "$@" < /dev/null)
}

# 공통 omp 인자를 전역 배열 DS_OMP_ARGS에 채운다(macOS 기본 bash 3.2 호환: mapfile 미사용).
#   모델은 항상 provider까지 명시하고, 세션·제목·확장·스킬·규칙 자동 로딩을 끈다(다른 모델 호출과 외부 컨텍스트 유입 차단).
ds_build_omp_args() {
  DS_OMP_ARGS=(
    --config "$DS_OMP_CFG_BASE"
    --model "$DS_MODEL"
    --thinking "$DS_THINKING"
    --no-session --no-title --no-extensions --no-skills --no-rules --no-lsp --no-pty
    --max-time "$DS_MAX_TIME"
    --append-system-prompt "$DS_RULES_FILE"
    --mode json
  )
}
