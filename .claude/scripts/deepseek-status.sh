#!/usr/bin/env bash
# 진행 중인 DeepSeek 작업(워크트리) 목록과 상태.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/deepseek-common.sh"
shopt -s nullglob
found=0
for f in "$DS_RUNS_DIR"/state/*.json; do
  found=1
  python3 - "$f" <<'PY'
import json, sys
s = json.load(open(sys.argv[1]))
v = "검증 통과" if s.get("verify_ok") else ("검증 실패" if s.get("verify_ok") is False else "미검증")
print(f'- {s["id"]}: {s["status"]} · {v} · 브랜치 {s["branch"]} · {s["worktree"]}')
PY
done
[[ $found -eq 1 ]] || echo "진행 중인 DeepSeek 작업이 없습니다."
