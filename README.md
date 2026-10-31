# Lasagna

> 예전 이름은 Nopsidian 이에요. 기존 호환을 위해 볼트 안의 `.nopsidian/` 폴더, `@nopsidian/*` 패키지 이름,
> Drive 동기화 폴더(`Nopsidian/<볼트>`), `nopsidian-mcp` 번들 이름, 앱 설정 폴더(userData)는 그대로 둬요.

Notion 의 블록 편집·데이터베이스와 Obsidian 의 위키링크·백링크·그래프를 합친 **개인용 로컬 Markdown 편집 앱**이에요.
노트는 내 컴퓨터의 `.md` 파일로 그대로 남고, 앱 자체 계정도 서버도 없어요. Google Drive 동기화는 켤 때만
동작하는 옵트인 모듈이고, 내 Google 계정의 `drive.file` 권한 하나만 써요.

## 무엇이 되나요

- **블록 에디터** — 제목·목록·체크박스·표·콜아웃·토글·열·코드 블록, 슬래시(`/`) 메뉴, 블록 드래그,
  마크다운 소스 모드(CodeMirror 6), 찾기·바꾸기.
- **Markdown 원문 보존** — 노트를 열고 저장해도 원문이 그대로 유지돼요. 밖에서 고친 파일과 편집기 저장이
  서로 덮어쓰지 않도록 3-way 병합과 원자적 저장을 써요.
- **링크** — `[[위키링크]]`·별칭·제목/블록 링크·임베드 자동 완성, 파일 이름을 바꾸면 링크도 함께 갱신,
  백링크·태그·개요 패널, 그래프 뷰(sigma.js), 빠른 전환기(⌘O), 데일리 노트.
- **데이터베이스** — 폴더 + `_db.yaml` 이 곧 데이터베이스예요. 표·보드·목록·갤러리·캘린더·타임라인 보기,
  필터·정렬·그룹, 관계·롤업·수식 속성, 계산 행, CSV 가져오기·내보내기.
- **검색** — SQLite FTS 로 제목·본문·태그를 찾고, 명령 팔레트(⌘P)로 어디서든 이동해요.
- **AI 에이전트(MCP)** — 앱이 꺼져 있어도 에이전트가 볼트를 읽고, 허용하면 정해 둔 폴더에 쓰고, 댓글을
  남길 수 있어요. [docs/mcp.md](docs/mcp.md)
- **Google Drive 동기화(옵트인)** — 두 대 사이 양방향 동기화, 충돌은 노트 단위로 병합, 삭제는 휴지통으로.
  [docs/sync-setup.md](docs/sync-setup.md)
- 그 밖에 — 탭·분할 창, 버전 기록(역사), 휴지통, Notion ZIP 가져오기, HTML 내보내기, 커버·이모지, 템플릿.

## 저장소 구조

pnpm 모노레포예요. 파싱·링크 해석·동기화 판단 같은 핵심 로직은 Electron 을 모르는 순수 TS 로 `packages/*`
에 두고, Vitest 만으로 검증해요.

```
apps/desktop/            Electron(Forge + Vite) + React 19
  src/main/              수명주기, 창·탭, app://·vault:// 프로토콜, IPC, 파일 쓰기 게이트
  src/preload/           contextBridge — window.nops.{note,db,graph,search,vault,sync,app}
  src/workers/index/     IndexWorker — better-sqlite3, watcher, 인덱싱, FTS
  src/workers/sync/      SyncWorker — Drive 동기화(네트워크를 쓰는 유일한 곳)
  src/renderer/          UI — 사이드바, 에디터, 패널, 데이터베이스 뷰, 그래프
  e2e/                   Playwright 로 패키징한 앱을 띄워 검사
packages/core/           remark 확장, md↔ProseMirror 변환, 링크 해석, DB·수식·경로 유틸
packages/editor/         에디터 확장 — 콜아웃·토글·열·위키링크·임베드·수식·DB 뷰 노드, 소스 모드
packages/ipc-contract/   IPC 채널과 zod 스키마 단일 정의
packages/sync-gdrive/    Drive 동기화 엔진(계획 수립·병합) + DriveClient 인터페이스
packages/formula/        수식 파서(Pratt)와 평가기
packages/mcp/            MCP 서버(stdio) — 에이전트가 볼트를 읽고 쓰는 통로
fixtures/vaults/         라운드트립 골든 테스트용 샘플 볼트
docs/                    PLAN.md(로드맵), adr/(결정 기록), packaging·mcp·sync-setup 안내
scripts/                 아이콘·빌드 결과물 복사 도우미
```

## 준비물

- **Node.js 22 이상** (개발·CI 는 22, 로컬은 그 이상도 됨)
- **pnpm 11.8.0** — `corepack enable` 을 한 번 실행하면 `package.json` 의 `packageManager` 대로 맞춰져요.

## 개발

```bash
corepack enable
pnpm install

pnpm --filter @nopsidian/desktop start   # 앱 실행(Electron + Vite)
pnpm lint                                # ESLint
pnpm typecheck                           # 패키지 전체 tsc
pnpm test                                # 패키지 전체 Vitest
pnpm format                              # Prettier
```

- 처음 실행하면 볼트 폴더를 고르는 화면이 떠요. 아무 폴더나 `.md` 가 있는 폴더를 고르면 돼요.
- 샘플 볼트로 둘러보려면 `fixtures/vaults/basic` 을 열어요.
- 패키징한 앱으로 도는 e2e 는 `pnpm --filter @nopsidian/desktop e2e` 예요(앱을 먼저 패키징한 뒤
  Playwright 로 실행). 리눅스(xvfb) 실행 방법과 플랫폼별 주의점은 [docs/packaging.md](docs/packaging.md) 를 보세요.

## 설치 파일 만들기

`pnpm --filter @nopsidian/desktop make` — 설치 파일은 **각 OS 에서 직접** 만들어요(네이티브 모듈 때문에
맥에서 Windows 설치 파일을 만들 수 없어요). 자세한 내용과 서명·Gatekeeper 주의 사항은
[docs/packaging.md](docs/packaging.md) 에 있어요.

## AI 에이전트에 연결하기

`pnpm --filter @nopsidian/mcp build` 로 `packages/mcp/dist/` 를 만들고, 앱의 설정(⌘,) → **AI 에이전트
연결(MCP)** 에 보이는 명령·JSON 을 Claude Code 나 Claude Desktop 에 붙여 넣으면 돼요. 읽기 도구는 항상,
쓰기 도구는 허용 폴더 안에서만 동작해요. 도구 목록과 옵션은 [docs/mcp.md](docs/mcp.md).

## Google Drive 동기화 켜기

본인의 Google Cloud 프로젝트에서 OAuth 클라이언트를 만들고 Drive API 를 켠 뒤, 앱의 설정 → **동기화** 에
클라이언트 ID·보안 비밀을 넣어요. 순서대로 따라 하는 안내는 [docs/sync-setup.md](docs/sync-setup.md).

## 문서

- [docs/PLAN.md](docs/PLAN.md) — 단계별 로드맵과 설계
- [docs/adr/](docs/adr/) — 결정 기록(동기화 도입, 보안 경계 등)
- [docs/formulas.md](docs/formulas.md) — 수식 문법
- [docs/mcp.md](docs/mcp.md) · [docs/sync-setup.md](docs/sync-setup.md) · [docs/packaging.md](docs/packaging.md)

## 라이선스

비공개 개인 프로젝트예요. `package.json` 의 `private: true`, 앱 라이선스는 `UNLICENSED` 이고, 에디터
패키지(`packages/editor`)만 MIT 예요. 이 저장소의 코드를 재배포·판매하지 않아요.
