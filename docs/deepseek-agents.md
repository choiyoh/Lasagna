# DeepSeek 보조 개발 에이전트 (OMP 연결)

메인 Claude(Claude Code)가 설계·작업 분배·에디터 코어·검토·병합을 맡고, **DeepSeek V4.1 Flash**가 독립적인 개발 작업을 맡는다.
DeepSeek은 OMP(Oh My Pi 18.x)의 비대화형 모드(`omp -p`)로 호출한다.

## 구성 요소

| 경로 | 역할 |
|---|---|
| `.claude/agents/deepseek-analyst.md` | 서브에이전트: 읽기 전용 분석. `tools: Bash`, `model: haiku`(전달자일 뿐) |
| `.claude/agents/deepseek-dev.md` | 서브에이전트: 격리 워크트리에서 코드 작성 |
| `.claude/scripts/deepseek-analyze.sh` | 읽기 전용 실행(도구 `read,grep,glob`) |
| `.claude/scripts/deepseek-dev.sh` | 워크트리 생성 → 보호 경로 잠금 → 샌드박스 실행 → 가드 → WIP 커밋 |
| `.claude/scripts/deepseek-verify.sh` | 샌드박스 안에서 typecheck·lint·test(`--e2e` 선택) |
| `.claude/scripts/deepseek-accept.sh` / `-discard.sh` / `-status.sh` | 스테이징 병합 / 정리 / 목록 |
| `.claude/scripts/deepseek-doctor.sh` | 연결 점검(설치·모델·인증·모델 일치·대체 금지) |
| `.claude/omp/deepseek.base.yml` | OMP 덧씌우기 설정: 모델 역할 고정, 모델 대체 끔 |
| `.claude/omp/{readonly,dev}.yml` | 모드별 승인 정책 |
| `.claude/omp/protected-paths.txt` | DeepSeek이 못 건드리는 경로(에디터 코어 등) |
| `.claude/omp/deepseek-rules.md` | OMP 시스템 프롬프트에 덧붙이는 역할 규칙 |
| `.claude/settings.json` | 이 스크립트들에 대한 Bash 권한(accept·discard는 `ask`) |
| `CLAUDE.md` | 메인 Claude가 따를 위임 정책·표준 절차 |

기존 설정은 수정하지 않았다: `~/.omp/agent/config.yml`·`models.yml`은 그대로이고(`--config` 덧씌우기만 사용), `~/.claude/*`와 `.claude/settings.local.json`도 그대로다.

## 모델

- 명시 ID: `commandcode/deepseek/deepseek-v4.1-flash` (OMP 기본 역할과 같은 provider/모델, `omp models find deepseek`로 확인)
- 같은 모델이 openrouter·nvidia에도 있지만 provider까지 지정해서 **그쪽으로 새지 않는다**.
- 사고 수준은 `DEEPSEEK_THINKING`(기본 `high`), 제한 시간은 `DEEPSEEK_MAX_TIME`(기본 20m). 모델 자체를 바꾸는 `DEEPSEEK_MODEL`은 **사용자가 직접 지정할 때만** 쓴다.

## "다른 모델로 대체하지 않음"을 보장하는 방법
1. `--model`에 provider까지 포함한 전체 ID를 넘긴다(퍼지 매칭에 맡기지 않는다).
2. 덧씌우기 설정에서 `default·smol·slow·plan` 역할을 모두 같은 모델로 고정하고(제목 생성·하위 작업이 다른 모델을 쓰지 않게 함), `retry.modelFallback: false`, `retry.fallbackChains: {}`.
3. 스크립트는 재시도하지 않는다. 일시적 오류 재시도는 OMP 내부 같은 모델 재시도(`maxRetries: 2`)뿐이다.
4. 결과의 JSON 이벤트에서 응답한 모델을 읽어 지정과 다르면 결과를 버린다(종료 코드 11).
5. 서브에이전트 지침이 실패 시 재시도·대신 수행을 금지한다. `deepseek-doctor.sh`는 **존재하지 않는 모델을 지정하면 실패로 끝나고 어떤 모델도 대신 답하지 않는지**를 실제로 시험한다.

## 격리 모델 (코드 작성)
1. **git 워크트리**: `../nopsidian-ds-worktrees/<작업ID>`, 브랜치 `ds/<작업ID>`. 메인 작업 폴더는 건드리지 않는다.
2. **쓰기 잠금**: 보호 경로 파일·폴더의 쓰기 권한을 제거한다(`EACCES`).
3. **macOS 샌드박스(`sandbox-exec`)**: 워크트리·임시 폴더·`~/.omp` 등 상태/캐시 밖에는 쓸 수 없고, `~/.ssh`·`~/.aws`·`~/.gnupg`·`~/.claude`·`~/.config/gh`는 읽을 수 없다. 메인 저장소 폴더 쓰기도 막는다.
4. **환경 변수 비움**: `env -i` + 필요한 PATH만. 셸에 있던 API 키 등이 에이전트에 전달되지 않는다.
5. **작업 후 가드**: 보호 경로/`--allow` 밖 변경, 메인 저장소 상태 변화, DeepSeek이 만든 커밋이 있으면 `REJECTED`이고 WIP 커밋도 만들지 않는다. `accept`도 한 번 더 검사한다.
6. **병합 게이트**: `accept`는 `verify` 통과 + 검증 이후 브랜치 불변을 요구하고, `git merge --squash`로 **스테이징만** 한다. 커밋은 Claude가 한다.

### 남은 위험(알고 쓸 것)
- 네트워크는 열려 있다(모델 API 호출에 필요). 프롬프트 인젝션으로 작업 폴더 안의 내용을 외부로 보내는 것까지는 막지 못한다.
- OMP 자체 자격 증명(`~/.omp/agent`)은 OMP가 읽어야 해서 읽기가 허용된다.
- `sandbox-exec`는 Apple이 사용 중단(deprecated)으로 분류한 도구지만 현재 macOS에서 동작한다.
- 샌드박스는 검증(`verify`) 때도 적용하지만, `--e2e`(Electron 실행)는 샌드박스와 맞지 않을 수 있다.

## 사용 예

```bash
# 점검
.claude/scripts/deepseek-doctor.sh

# 읽기 전용 분석 (Claude가 작업 설명을 .scratch/deepseek-tasks/에 쓴 뒤 deepseek-analyst 서브에이전트로 호출하거나 직접)
.claude/scripts/deepseek-analyze.sh .scratch/deepseek-tasks/<이름>.md

# 코드 작성 → 검토 → 검증 → 병합
.claude/scripts/deepseek-dev.sh <작업ID> .scratch/deepseek-tasks/<이름>.md --allow "packages/core/src/foo.ts,packages/core/src/foo.test.ts"
git diff <base>..ds/<작업ID>                      # Claude가 먼저 읽는다
.claude/scripts/deepseek-verify.sh <작업ID>
.claude/scripts/deepseek-accept.sh <작업ID>       # 스테이징 → Claude가 커밋
.claude/scripts/deepseek-discard.sh <작업ID>      # 정리
```

실행 기록(이벤트 로그, 프롬프트, 요약, 샌드박스 프로필)은 `.scratch/deepseek-runs/`에 남는다(git 무시).

## 실측 메모
- `find`·`ast_grep`·`lsp` 도구는 이 환경(비운 환경 + 샌드박스)에서 쓸 수 없어 읽기 전용 허용 목록은 `read, grep, glob`이다.
- `omp -p`는 표준입력이 열려 있으면 EOF를 기다리며 멈추므로 스크립트가 `</dev/null`로 닫는다.
- 첫 시험에서 `fix-sanitize`(실제 버그 수정)를 위임해 DeepSeek이 먼저 실패 테스트로 재현한 뒤 고쳤고, Claude가 검토·검증해 커밋했다(`d806ff7`).
