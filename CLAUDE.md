# Nopsidian — Claude Code 작업 지침

개인용 로컬 Markdown 편집 앱(Notion의 블록 편집·DB + Obsidian의 링크·그래프). 설계 문서와 진행 상황은 `docs/PLAN.md`, 결정 기록은 `docs/adr/`.

## 역할 분담: 메인 Claude + DeepSeek 보조 에이전트

- **메인 Claude(이 세션)** 는 전체 설계, 작업 분배, 에디터 코어, 검토·테스트·병합·커밋을 맡는다.
- **DeepSeek V4.1 Flash**(OMP 경유, 모델 `commandcode/deepseek/deepseek-v4.1-flash`)는 **독립적으로 떼어 낼 수 있는 개발 작업**만 맡는다. 설계 결정은 하지 않는다.
- 두 보조 에이전트는 Claude Code 서브에이전트로 등록되어 있다. 둘 다 `.claude/scripts/*.sh` 를 부르는 얇은 전달자(haiku)일 뿐 직접 분석·코딩을 하지 않는다.

| 서브에이전트 | 용도 | 권한 |
|---|---|---|
| `deepseek-analyst` | 코드 읽기·분석·리뷰·조사 | **읽기 전용** (도구 허용 목록 + OS 샌드박스 + 전후 git 상태 비교) |
| `deepseek-dev` | 독립적인 코드 작성 | 격리된 git 워크트리 `ds/<작업ID>` + 샌드박스, 보호 경로 쓰기 잠금 |

### 맡기기 좋은 일 / 맡기면 안 되는 일
- 좋음: 새 유틸리티·순수 함수 + 테스트, 테스트 보강, 인덱서·워커 기능, 에디터 코어 밖의 렌더러 UI 컴포넌트, 문서·픽스처, 버그 후보 탐색(분석).
- **금지(Claude가 직접)**: `.claude/omp/protected-paths.txt` 에 적힌 경로 — 에디터 코어(`packages/editor/**`, `packages/core/src/markdown/**`, `save.ts`, `merge3.ts` 등), IPC·메인·프리로드, 빌드/패키지 설정, `docs/adr`, `docs/PLAN.md`. 설계가 정해지지 않은 일, 여러 모듈을 가로지르는 리팩터링도 직접 한다.

### 표준 절차 (코드 작성)
1. **작업 설명 작성**: Claude가 `.scratch/deepseek-tasks/<작업ID>.md` 에 목표·대상 파일·요구사항·검증 방법을 구체적으로 쓴다(맥락을 모르는 사람에게 주는 명세처럼).
2. **분석이 먼저 필요하면** `deepseek-analyst` 를 호출한다.
3. **위임**: `deepseek-dev` 서브에이전트를 호출하며 작업ID, 작업 설명 경로, 허용 경로(`--allow` glob)를 알려 준다.
4. **검토**: 보고서의 `git diff <base>..ds/<작업ID>` 를 Claude가 직접 읽는다(설계 부합, 숨은 부작용, 테스트 약화 여부). 코드를 실행하기 전에 읽는다.
5. **검증**: `.claude/scripts/deepseek-verify.sh <작업ID>` (샌드박스 안에서 typecheck·lint·test, 필요하면 `--e2e`).
6. **병합**: `.claude/scripts/deepseek-accept.sh <작업ID>` 로 스테이징(squash) → Claude가 직접 커밋(커밋 메시지에 구현=DeepSeek, 검토·검증=Claude 명시) → `.claude/scripts/deepseek-discard.sh <작업ID>` 로 정리. 마음에 안 들면 바로 discard.
- 한 번에 여러 작업을 병렬로 돌릴 수 있다(작업ID가 다르면 워크트리가 분리된다). 같은 파일을 건드리는 작업은 동시에 맡기지 않는다.

### 실패 처리 (중요)
- DeepSeek 작업이 **실패하거나 거부(REJECTED)** 되면 다른 모델로 자동 대체하지 않는다. 서브에이전트도, 스크립트도, OMP 설정(`retry.modelFallback: false`, 빈 `fallbackChains`)도 대체/재시도를 하지 않는다.
- 실패하면 보고서와 `stderr.log`(실행 기록 폴더)를 읽고 **사용자에게 알린 뒤** 작업을 쪼개 다시 맡길지, Claude가 직접 할지 판단한다.
- 모델을 바꾸려면 사용자가 명시적으로 요청해야 한다(`DEEPSEEK_MODEL` 환경 변수는 사용자가 직접 지정한 경우에만).

### 연결 점검
- `.claude/scripts/deepseek-doctor.sh` — 설치, 모델 등록, 인증, 응답 모델 일치, "존재하지 않는 모델 지정 시 대체 없이 실패" 까지 확인한다. 연결에 의심이 가면 먼저 이것부터.
- `.claude/scripts/deepseek-status.sh` — 진행 중인 DeepSeek 워크트리 목록.

자세한 구조·보안 모델·한계는 `docs/deepseek-agents.md`.
