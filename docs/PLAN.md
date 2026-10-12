# Nopsidian 구현 계획 (v0.1)

## Context
- **목표**: 설계 문서 「Nopsidian — 설계 문서 v0.1」(Google Docs `1idIt9x9…`)을 토대로, Notion의 블록 편집·DB와 Obsidian의 위키링크·백링크·그래프를 합친 **개인용 로컬 Markdown 편집 앱**을 만든다.
- **현재 상태**: `/Users/yohan/Documents/workspace/nopsidian`은 빈 폴더(`.claude/`만 있음)이고, `git init`과 `origin = github.com/choiyoh/Nopsidian.git` 설정까지 끝났다. 재사용할 기존 코드는 없다.
- **설계 문서에서 바꾸는 점**: 사용자가 **앱에 내장된 Google Drive API 동기화**를 고르셨어. 그래서 설계 문서의 N1(로그인 없음), N4(자체 동기화 없음), G2(100% 오프라인), G3(계정 없음)을 아래처럼 고친다.
  - 동기화는 **옵트인 모듈**이다. 켜지 않으면 앱은 설계 문서 그대로 완전 오프라인·무계정으로 동작한다.
  - 계정은 사용자 본인의 Google 계정 하나뿐이고 OAuth로 연결한다. 앱 자체 계정·서버·결제는 여전히 없다.
  - 네트워크는 SyncWorker가 Google 도메인 허용 목록 안에서만 쓴다. 범용 네트워크 프록시를 두지 않는다는 원칙(S4)은 그대로 지킨다.
  - 이 변경은 ADR-0001로 저장소에 기록한다.
- **결과물**: 이 계획 문서. 승인을 받으면 Google Drive(설계 문서와 같은 위치)에 Google Docs로 저장하고, 저장소 `docs/PLAN.md`에도 커밋한다.

---

## 1. 저장소 구조 (pnpm 모노레포)

```
nopsidian/
├─ apps/desktop/                 # Electron(Forge + Vite) + React 19
│  ├─ src/main/                  # 수명주기, 창/탭, 프로토콜, IPC 라우터, FS 쓰기 게이트
│  ├─ src/preload/               # contextBridge: window.nops.{note,db,graph,search,vault,sync,app}
│  ├─ src/workers/index/         # IndexWorker: better-sqlite3, watcher, 인덱싱
│  ├─ src/workers/sync/          # SyncWorker: Drive API 동기화 (네트워크는 이 워커만)
│  └─ src/renderer/              # UI: 사이드바, 에디터, 패널, 빠른 전환기
├─ packages/core/                # 순수 TS(Electron 의존 없음): remark 확장, md↔PM 변환, 링크 해석, 경로 유틸
├─ packages/ipc-contract/        # 채널·zod 스키마 단일 정의 (ipc-contract.ts)
├─ packages/sync-gdrive/         # 순수 TS 동기화 엔진(계획 수립·병합), Drive 클라이언트 인터페이스 분리
├─ packages/formula/             # (5~6단계) Pratt 파서 + 평가기
├─ fixtures/vaults/              # 라운드트립 골든 테스트용 샘플 볼트
└─ docs/ (PLAN.md, adr/)
```

핵심 원칙: **파싱·링크 해석·동기화 판단 로직은 `packages/*`에 순수 TS로 둔다.** 그래야 Vitest만으로 테스트할 수 있고, 나중에 Tauri로 옮길 길도 남는다(설계 5.1).

## 2. 전체 로드맵

기간은 부업(주 20시간) 기준 추정치다.

| 단계 | 범위 | 완료 기준 | 기간 |
|---|---|---|---|
| **0. 기반** | Electron 하드닝, IPC 계약, 볼트 열기, watcher, IndexWorker + SQLite, app://·vault:// | 볼트를 열면 노트 목록과 FTS 검색이 동작 | 3~4주 |
| **1. Markdown 코어** | remark 확장(wikilink·callout·directive·^blockid), md↔ProseMirror, 원문 보존 블록, 원자적 저장, 3-way 병합 | 샘플 볼트 500개 파일 라운드트립 100% | 4~6주 |
| **2. 블록 에디터 MVP** | BlockNote 기반 P0 블록, 슬래시 메뉴, 인라인 서식, 단축 입력, 드래그&드롭, 소스 모드(CM6) | 일상 노트 작성 가능 | 8~10주 |
| **3. 링크 코어** | `[[` 자동 완성, 별칭, 제목/블록 링크, 임베드, 이름 변경 시 링크 갱신, 백링크, 태그, 빠른 전환기, 데일리 노트 | **MVP, 자기 사용 시작** | 4~6주 |
| **3.5 Drive 동기화** (신규) | OAuth, SyncWorker, 양방향 동기화, 충돌 처리, 동기화 UI | 맥 2대 사이에서 볼트 왕복 동기화, 무손실 | 4~5주 |
| 4. 그래프 | sigma.js + graphology, 워커 레이아웃, 전역·로컬, 필터·그룹 | 5천 노트에서 30fps | 3~4주 |
| 5. DB 코어 | `_db.yaml`, 기본 속성, 표·보드·목록·갤러리, 필터·정렬·그룹, 링크된 뷰, CSV | 독서·할 일 DB 실사용 | 8~10주 |
| 6. DB 고급 | 관계·롤업·수식, 캘린더·타임라인 | 수식 골든 테스트 95% | 8~10주 |
| 7. 마감 | 탭·분할·다중 창, 버전 기록, Notion ZIP 가져오기, HTML/PDF 내보내기, 성능 | 1만 노트 목표 성능 | 4~6주 |
| 8. P2 | 캔버스, 플러그인 샌드박스, 로컬 LLM·MCP, 암호화 | 선택 | 지속 |

동기화(3.5)를 MVP 바로 뒤에 두는 이유: 자기 사용을 시작하면 바로 여러 기기에서 쓰고 싶어진다. 또 동기화가 다루는 대상(.md·_db.yaml·첨부 파일)은 파일 형식이 이미 확정되어 있어서, 뒤 단계 기능이 추가돼도 동기화 엔진은 바뀌지 않는다.

---

## 3. 단계별 상세 — A. MVP (0~3단계 + 3.5)

### 0단계: 기반
1. **스캐폴딩**: pnpm 워크스페이스, Electron Forge + Vite + TS 템플릿, ESLint, Prettier, Vitest, Playwright(Electron).
2. **보안 하드닝** (설계 5.5·6장)
   - 모든 BrowserWindow/WebContentsView에 `contextIsolation:true, sandbox:true, nodeIntegration:false, webviewTag:false` 적용.
   - CSP 헤더, `setWindowOpenHandler`·`will-navigate` 차단, `setPermissionRequestHandler`로 기본 거부.
   - Electron Fuses: RunAsNode·NodeOptions·CliInspect를 끄고, OnlyLoadAppFromAsar·AsarIntegrity를 켠다.
   - CI 테스트로 webPreferences 스냅샷을 검사한다. IPC 계약에 없는 `ipcMain.on`/`ipcRenderer.send` 사용은 린트로 금지한다.
3. **IPC 계약**: `packages/ipc-contract`에서 채널명과 zod 스키마로 `invoke` 핸들러와 preload 함수를 생성한다. 공통 미들웨어는 발신자 프레임이 `app://` 최상위 프레임인지, 등록된 webContents인지 확인하고, zod로 인자를 검증하고, 볼트 경로를 realpath로 탈출 검사한다.
4. **프로토콜**: `app://nopsidian/`는 번들 전용이다. `vault://<id>/<path>`는 볼트 하위만 허용하고 Range를 지원하며, SVG/HTML은 attachment로 내려준다.
5. **볼트**: 볼트 선택기 창(열기/생성/최근 목록)을 만들고, `.nopsidian/config.json`을 생성한다.
6. **IndexWorker** (worker_threads)
   - better-sqlite3(WAL)로 설계 5.9의 테이블을 만든다. 이 단계에서는 meta, pages, headings, links, tags, aliases, blocks, fts(trigram), assets.
   - `@parcel/watcher`를 300ms 디바운스로 붙이고, 시작할 때 mtime+size+hash로 바뀐 파일만 재인덱싱한다.
7. **UI 셸**: 파일 탐색기 트리, 읽기 전용 미리보기(이 단계는 remark→HTML + DOMPurify), 검색 패널, 다크 모드, ko/en i18n 골격.

### 1단계: Markdown 코어 (`packages/core`)
- remark 파이프라인: gfm, frontmatter, math에 자체 확장(wikilink/embed, callout·toggle `> [!type]±`, `:::columns` directive, `^blockid`, `{.toggle}`, `==highlight==`)을 더한다.
- **mdast ↔ ProseMirror JSON 변환기**: 각 PM 노드가 원본 소스 범위(offset)를 기억한다. 바뀐 블록만 다시 직렬화하고, 나머지는 원문 바이트를 그대로 둔다. 모르는 문법은 `rawBlock` 노드로 보존한다.
- 노트 ID: 프런트매터 `id`(ULID)를 처음 저장할 때만 넣는다. 외부 파일을 여는 것만으로는 쓰지 않는다.
- **저장 경로**: `note.save(id, patch, baseHash)` → Main FS 게이트 → `.nopsidian/history/`에 스냅샷 → 임시 파일 → fsync → rename. 쓴 파일의 해시를 기억해 자기 쓰기 이벤트는 무시한다.
- **3-way 병합**(블록 단위, base = 마지막 저장본): 충돌한 블록은 양쪽을 다 보존하고 배너를 띄운다. 병합이 실패하면 `노트 (충돌 YYYY-MM-DD).md` 사본을 만든다. 이 모듈은 3.5단계 Drive 충돌에서도 그대로 다시 쓴다.
- **골든 테스트**: `fixtures/vaults/`의 md를 doc으로 바꿨다가 다시 md로 바꿨을 때 바이트가 같아야 한다(정규화 허용 목록 제외). 퍼즈 테스트도 둔다.

### 2단계: 블록 에디터 MVP
- BlockNote(MIT 패키지만 사용)로 P0 블록을 만든다: 문단, H1~3, 목록, 할 일, 인용, 코드(Shiki), 구분선, GFM 표, 콜아웃, 토글, 이미지·파일(vault://).
- 슬래시 메뉴(퍼지 + 한글 초성), 플로팅 툴바, 마크다운 단축 입력, 블록 핸들 드래그·다중 이동, Turn into, Cmd+D.
- 노트 단위 undo/redo, 500ms 디바운스 자동 저장.
- 소스 모드: CodeMirror 6로 원문 편집을 토글한다. 두 모드는 같은 저장 경로를 쓴다.
- 한글 IME 회귀 테스트: Playwright로 조합 중 Enter/블록 분할 시나리오를 검사한다.
- BlockNote로 콜아웃 중첩·커스텀 노드를 만들 수 없으면, 그 블록만 TipTap 확장으로 내려 구현한다(설계 5.2).

### 3단계: 링크 코어 → MVP
- 링크 해석(`packages/core`) 순서: 경로 정확 일치 → 파일명/제목(최단 경로 우선) → 별칭 → 미해결. 결과는 links 테이블에 저장한다.
- `[[` 자동 완성(제목·별칭·초성), `[[노트#제목]]`, `[[노트#^id]]`, "블록 링크 복사", `![[…]]` 임베드 렌더링.
- **이름 변경·이동 시 링크 갱신**: 영향받는 파일 목록을 미리 보여주고, 일괄로 원자적으로 쓰고, op_log로 되돌릴 수 있게 한다.
- 백링크 패널(문맥 스니펫), 태그 패널, 빠른 전환기 팝업(Cmd+O, 50ms 이하), 데일리 노트, 휴지통(`.nopsidian/trash/`).
- 7.1 MVP 체크리스트를 모두 통과하면 이 단계가 끝난다.

### 3.5단계: Google Drive 동기화 (신규 설계)
**구조**
- **SyncWorker**(utility process)만 네트워크를 쓴다. 허용 호스트는 `oauth2.googleapis.com`, `accounts.google.com`, `www.googleapis.com`뿐이다. Main과는 IPC 계약의 `sync.*` 채널로만 통신한다. 렌더러는 상태 구독과 명령만 할 수 있다.
- **인증**: 데스크톱 OAuth 2.0(PKCE + loopback `127.0.0.1` 리다이렉트), 시스템 브라우저로 로그인한다. refresh token은 Electron `safeStorage`(macOS Keychain)로 암호화해 둔다.
- **스코프**: `drive.file`만 쓴다. 앱이 만든 파일만 접근할 수 있어서 Drive 전체 권한이 필요 없다. 클라이언트 ID는 사용자 본인 GCP 프로젝트에서 만든다. 셋업 가이드를 `docs/`에 쓴다.

**Drive 쪽 구조**
- `Nopsidian/<볼트명>/` 아래에 볼트 폴더 구조를 그대로 미러링한다. Drive 웹에서도 .md를 그대로 볼 수 있다.
- 각 파일의 `appProperties`에 `nopsId`(노트 ID), `relPath`, `contentHash`를 넣는다.

**동기화 대상**
- 포함: `*.md`, `_db.yaml`, 첨부, `.canvas`, `.nopsidian/config.json`, `.nopsidian/comments/`.
- 제외: `index.sqlite`, `history/`, `trash/`, `graph-cache`, 기기별 앱 상태.

**로컬 상태**: `.nopsidian/sync/state.sqlite`(기기별, 동기화 안 함)에 relPath ↔ driveFileId, 마지막 동기화 시점의 해시와 Drive headRevisionId, changes `startPageToken`을 저장한다. **base 스냅샷**은 `.nopsidian/sync/base/`에 둔다. 3-way 병합의 공통 조상이다.

**알고리즘** (`packages/sync-gdrive`, 순수 함수로 테스트 가능)
1. 원격 변경은 `changes.list(pageToken)`로 받는다. 로컬 변경은 IndexWorker 이벤트와 state를 비교해 얻는다.
2. 파일별로 계획을 세운다: 한쪽만 바뀌었으면 push 또는 pull, 양쪽 다 바뀌었으면 1단계 3-way 병합 → 결과를 push. 병합에 실패하면 충돌 사본을 만든다.
3. 삭제는 base가 있을 때만 전파하고, 상대 쪽은 휴지통으로 옮긴다(Drive trash / 로컬 trash). 이름 변경은 `nopsId`와 fileId로 추적해 move로 처리한다.
4. 업로드할 때는 `headRevisionId` 기반 낙관적 동시성으로 검사한다. 불일치하면 다시 pull해서 병합한다.
- **트리거**: 앱 시작, 저장 후 10초 디바운스, 2분 주기 폴링, 수동 "지금 동기화" 버튼. 오프라인이면 큐에 쌓았다가 재시도한다(지수 백오프, 429/403 rate limit 대응).
- **UI**: 상태 표시줄(동기화됨/진행/오프라인/오류), 설정의 "Google 계정 연결/해제", 충돌 목록 패널.
- **안전장치**: 첫 동기화는 dry-run 결과를 보여주고 확인을 받는다. 한 번에 파일을 20% 넘게 삭제하려 하면 멈추고 묻는다.

---

## 3-B. 후속 단계 상세 (4~8단계)

### 4단계: 그래프 뷰 (3~4주)
- **데이터**
  - IPC에 `graph.global(filter)`와 `graph.local(noteId, depth, dir)`를 추가한다.
  - 전역 그래프는 IndexWorker가 links를 조인한 엣지 리스트를 청크로 스트리밍한다.
  - 로컬 그래프는 재귀 CTE로 깊이 1~5까지 BFS한다.
  - 증분 갱신: `note.changed` 이벤트가 오면 노드·엣지 diff를 브로드캐스트한다.
- **렌더링**: `src/renderer/graph/`에서 sigma.js + graphology를 쓴다.
  - 레이아웃은 별도 Web Worker에서 ForceAtlas2(graphology-layout-forceatlas2/worker)로 돌린다.
  - 위치는 `graph_layout` 테이블에 캐시해 다음에 열 때 바로 그린다.
  - 노드 크기는 링크 수에 비례하고, 라벨은 줌 임계값을 넘을 때만 보인다. 호버하면 이웃을 강조하고, 클릭하면 노트를 연다.
- **필터·그룹**
  - 검색어(1단계 검색 쿼리 파서 재사용)로 필터한다.
  - 노드 종류 토글: 태그·첨부·미해결 링크·고아 노트·DB 관계 링크(5단계 이후 활성).
  - 색 그룹은 쿼리 → 색 목록이다. 설정은 `.nopsidian/graph.json`에 둔다(동기화 대상).
- **힘 설정**: 중심력·반발력·장력·링크 거리 슬라이더 값을 워커에 전달해 레이아웃을 다시 돌린다. 화살표 표시도 토글한다.
- **로컬 그래프**: 오른쪽 사이드 패널에 두고, 현재 노트를 따라간다.
- **검증**: 5천·1만 노드 합성 볼트로 FPS를 측정한다(Playwright로 `requestAnimationFrame` 샘플링). 목표는 30fps 이상.

### 5단계: 데이터베이스 코어 (8~10주)
- **스키마**: `_db.yaml` 파서와 zod 검증(`packages/core/db`)을 만든다. 폴더 = DB, 행 = 프런트매터를 가진 노트. 스키마 오류는 문제 패널에 위치와 함께 표시한다.
- **인덱스**
  - `db_schemas`, `db_views`, `properties`(v_text/v_num/v_date/v_bool 정규화) 테이블을 추가한다.
  - 프런트매터가 바뀌면 해당 행만 다시 넣는다.
  - SQLite 스키마 버전을 올리면 마이그레이션 대신 인덱스를 다시 만든다. 인덱스는 파생 데이터라서 가능하다.
- **속성 타입**: text, number(형식: 숫자/% /통화/별점), select, multi-select, status(그룹), date(기간), checkbox, url/email/phone, files, created/updated time, unique ID.
  - 각 타입마다 프런트매터 직렬화 규칙, 셀 편집기, 정렬 키를 정한다.
- **뷰**: `src/renderer/db/`, TanStack Virtual로 가상화한다.
  - 표: 열 너비·순서·고정, 계산 행(개수/합/평균 등), 셀 인라인 편집.
  - 보드: groupBy 칸반. 카드를 드래그하면 속성 값을 바꿔서 쓴다.
  - 목록, 갤러리(커버/첫 이미지).
- **쿼리 엔진**
  - 필터 AST(AND/OR 3단계)를 SQL로 컴파일해 IndexWorker에서 실행한다. 다중 정렬, 그룹·하위 그룹.
  - 뷰 설정은 `_db.yaml`의 views에 다시 쓴다(원자적 저장, 외부 편집과 3-way 병합).
- **링크된 DB 뷰**: ```` ```dbview ```` 펜스를 파싱하고, 에디터 커스텀 노드에 같은 뷰 컴포넌트를 임베드한다.
- **템플릿**: `.templates/` 폴더, 새 행 기본 템플릿, `{{date}} {{title}}` 변수.
- **행 열기**: 사이드 피크 / 센터 피크 / 전체 노트, 설정으로 고른다.
- **CSV**: 가져올 때 타입을 추론하고 매핑 UI를 보여준 뒤 행 노트를 생성한다. 내보낼 때는 현재 뷰의 필터·정렬을 반영한다.
- **"새 DB" 명령**: 폴더와 `_db.yaml`, 기본 표 뷰를 만든다.
- **검증**: 2만 행 DB에서 필터·정렬 응답 100ms 이하. `_db.yaml`·행 노트 라운드트립 골든 테스트.

### 6단계: DB 고급 (8~10주)
- **관계(Relation)**
  - 값은 위키링크 배열이다. links 테이블에 `kind=relation`으로 들어가서 백링크와 그래프에 자동 반영된다.
  - 단방향/양방향, 자기 참조를 지원한다.
  - 양방향이면 반대편 노트 프런트매터도 일괄 트랜잭션으로 갱신한다(op_log로 되돌릴 수 있음).
  - 셀 편집기는 노트 검색 피커다.
- **롤업**: 관계 대상의 속성을 집계한다(개수, 고유 개수, 합/평균/중앙값/최소/최대, 비율, 날짜 범위, 빈 값 수).
- **수식** (`packages/formula`)
  - Pratt 파서, 타입 검사기, 평가기를 만든다. 선행 문서 2.11.5의 함수군(문자열·수학·날짜·논리·리스트·`prop()`)을 지원한다.
  - 지원하지 않는 함수는 명시적 오류를 낸다.
  - 의존 그래프 기반 **증분 재계산**은 ComputeWorker에서 한다. 결과는 `computed` 테이블(deps_hash)에만 두고 파일에는 쓰지 않는다.
  - 에디터는 자동 완성과 오류 위치를 표시한다.
- **캘린더 뷰**: 월/주 단위, 날짜를 드래그로 바꾸고, 데일리 노트로 이동한다.
- **타임라인 뷰**: 기간 막대, 일/주/월 축.
- **고급 필터 UI**: 중첩 그룹 편집기, 롤업·수식 결과로도 필터·정렬한다(computed 조인).
- **검증**: 수식 골든 테스트 95% 이상 통과(공개 문서 예제 기반). 관계 양방향 일관성 테스트. 순환 참조 검출.

### 7단계: 마감·가져오기·내보내기 (4~6주)
- **탭·분할·다중 창**
  - 창 셸과 탭별 WebContentsView, 좌우/상하 분할, 노트를 새 창으로 띄우기.
  - 창 사이 일관성은 `note.changed` 브로드캐스트로 맞춘다.
  - 레이아웃은 `.nopsidian/workspace.json`(기기별)에 둔다.
- **명령 팔레트**(Cmd+P), 단축키 설정, 북마크, 링크 호버 미리보기, 언링크드 멘션(FTS + 한글 조사 허용 경계 검사, 요청 시 지연 계산), 아웃고잉 링크 패널.
- **버전 기록**: `history/` 스냅샷 목록, 블록 diff 뷰어, 복원. 보존 정책(예: 30일 + 일 1개).
- **가져오기**
  - Notion 내보내기 ZIP(Markdown & CSV): 페이지 → 노트, DB CSV → 폴더 + `_db.yaml`, 내부 링크 → 위키링크, 첨부 재배치.
  - 일반 Markdown 폴더 / Obsidian 형식 볼트: 그대로 열고, 콜아웃 문법은 호환된다.
- **내보내기**: 노트·볼트를 정적 HTML 사이트로 내보낸다(위키링크 → 상대 링크, 그래프 제외). PDF는 `webContents.printToPDF`로 만든다.
- **미디어 P1**: PDF 뷰어(pdf.js), 오디오/비디오, 열 레이아웃(`:::columns`, 드래그로 생성), KaTeX, 자동 목차, 동기화 블록(`![[노트#^id]]` 편집 가능 트랜스클루전).
- **성능 튜닝**
  - 1만 노트 / 10만 블록 / 5만 링크 / DB 2만 행 합성 볼트로 프로파일링한다.
  - 콜드 인덱싱은 병렬 파싱 + 배치 트랜잭션으로 줄인다.
  - 메모리 상한을 확인한다.
- **패키징**: macOS dmg, 코드 서명은 선택. SHA-256 해시 매니페스트를 만들고 시작할 때 검증한다. 배포물에서 dev 의존성·테스트를 제거한다.
- **검증**: 실제 Notion 내보내기 샘플로 가져오기 골든 테스트. 목표 성능 지표를 모두 달성.

### 8단계: P2 (지속, 각 항목 독립)
- **캔버스**: JSON Canvas 호환 `.canvas` 파일. 노트·카드·이미지·링크 노드, 무한 줌/팬. 캔버스 안 링크도 그래프에 반영한다.
- **플러그인 샌드박스**(설계 5.6)
  - PluginHost 워커와 플러그인별 sandboxed iframe(`plugin-<id>://`, CSP connect-src 'none')을 만든다.
  - MessageChannel RPC로 통신하고, 매니페스트 권한을 검사한다. 설치할 때 동의를 받고, 기본은 비활성이다.
  - API: 명령, 사이드 패널, Markdown 후처리기, 커스텀 블록. 응답하지 않으면 강제 종료하고, 호출 빈도를 제한한다.
- **자동화·버튼 블록**: 속성 변경·행 추가 트리거 → 액션(속성 설정, 템플릿 노트 생성).
- **쿼리 DB(가상 DB)**: 태그·링크·프런트매터 조건으로 노트를 모아 DB 뷰로 보여준다.
- **Mermaid** 미리보기.
- **로컬 LLM·MCP**: 기본 비활성. 볼트 읽기 전용에서 시작하고, 쓰기는 명시적으로 허용받고 감사 로그를 남긴다(S9).
- **볼트 암호화**: OS 키체인 키로 파일 단위 암호화한다. Drive 동기화와 결합하면 암호문만 업로드한다.
- **"신뢰하지 않는 볼트" 모드**: 플러그인·임베드·원격 이미지를 끈다.
- **Drive 동기화 고도화**: Drive 웹·모바일에서 수정된 .md 감지 개선, 선택적 폴더 동기화, 대용량 첨부 재개 가능 업로드(resumable).

---

## 4. 결정 기록 (ADR, `docs/adr/`)
- 0001: Drive API 내장 동기화 도입, 설계 문서 N1·N4·G2·G3 수정
- 0002: Electron + React 19 + TS (설계 5.1)
- 0003: BlockNote 시작 → TipTap/PM 폴백 (설계 5.2)
- 0004: 파일이 진실, SQLite는 인덱스 (설계 4.1)

## 5. 검증
- **단위**: `pnpm -r test`(Vitest). core 라운드트립 골든·퍼즈, 링크 해석, 3-way 병합, sync 계획 수립 테이블 테스트(로컬/원격/base 조합 전수).
- **동기화 통합**: Drive 클라이언트 인터페이스의 인메모리 가짜 구현으로 "기기 A, 기기 B, Drive" 3자 시나리오를 시뮬레이션한다(동시 편집, 이름 변경 + 편집, 삭제 + 편집, 오프라인 후 복귀). 그 다음 실제 테스트 계정으로 수동 E2E를 한다.
- **E2E**: Playwright(Electron)로 볼트 열기 → 노트 작성 → 외부 편집 반영 → 이름 변경 링크 갱신 → 검색.
- **보안 회귀**: webPreferences 스냅샷, IPC 계약 외 채널 린트, CSP 헤더 검사, vault:// 경로 탈출 테스트.
- **성능**: 1만 노트 합성 볼트로 콜드 인덱싱 시간, 빠른 전환기 지연(50ms 이하)을 측정한다.

## 6. 주의 사항
- **상표**: "Nopsidian"은 개인용 코드네임이다(설계 8장). **GitHub 저장소가 public이면 private 전환을 권장한다.**
- **클린룸**: REA 산출물은 저장소에 넣지 않는다.

## 7. 승인 후 바로 할 일
1. 이 계획을 Google Drive에 Google Docs 「Nopsidian — 구현 계획 v0.1」로 저장한다.
2. `docs/PLAN.md`와 ADR-0001을 커밋하고 push한다.
3. 0단계 스캐폴딩에 착수한다.

---

## 진행 상황

### 0단계: 기반 (2026-10-12 구현 완료)
- [x] pnpm 워크스페이스, TS/ESLint/Prettier/Vitest, Playwright(Electron) E2E
- [x] 보안 하드닝: contextIsolation·sandbox, CSP, 외부 이동·새 창·권한 차단, Fuses(RunAsNode/NodeOptions/CliInspect/FileProtocol 끔, AsarIntegrity·OnlyLoadAppFromAsar 켬). 단 `NOPS_E2E=1` E2E 빌드에서만 inspect 퓨즈를 켠다
- [x] IPC 계약(`packages/ipc-contract`): 발신자 프레임·오리진·등록된 webContents 검사 + zod 입출력 검증
- [x] `app://`(번들 전용), `vault://`(볼트 하위·realpath 검사·Range 지원)
- [x] 볼트 열기/최근 목록, `.nopsidian/config.json`
- [x] IndexWorker: SQLite(WAL) + FTS5 trigram, 증분 스캔, @parcel/watcher(300ms 디바운스), 2글자 이하 LIKE 대체
- [x] UI 셸: 폴더 트리, 전문 검색, 읽기 전용 미리보기(DOMPurify), 다크 모드
- [ ] ko/en i18n 골격 (미구현)
- [ ] 빌드 시 네이티브 모듈 SHA-256 매니페스트 생성·검증 (7단계 패키징에서)

구현 중 확인한 사항
- Electron Forge는 pnpm에서 `nodeLinker: hoisted`가 필요하다.
- Forge Vite 플러그인은 `.vite/`만 패키징하므로, external 네이티브 모듈(better-sqlite3, @parcel/watcher)은 `packageAfterCopy` 훅(`apps/desktop/native-modules.ts`)에서 직접 복사하고 `.node`는 asar 밖으로 푼다.
- 파일 감시 이벤트 경로는 realpath 기준이라(macOS `/var` → `/private/var`) 감시 루트도 realpath로 맞춘다.

### 1단계: Markdown 코어 (2026-10-12 구현, 일부는 2단계로 이월)
- [x] 파서(`packages/core/src/markdown`): 프런트매터(YAML, 깨져도 원문 보존), 위키링크·임베드·`#제목`·`^블록`·별칭, 태그(인라인·프런트매터), 제목/슬러그, 블록 ID(줄 끝·단독 줄), 콜아웃(`> [!type]±`), `:::name` 펜스, GFM/수식
- [x] 바이트 보존: 문서를 [사이 공백 + 블록 원문] 단위로 나누고 `replaceBlock`은 해당 블록만 바꾼다. 합성 노트 500개 + 깨진 입력 3000개 퍼즈로 재조립 == 원문 검증
- [x] 링크 해석(`link-resolve.ts`): 경로 → 파일명(짧은 경로·가까운 폴더 우선) → 제목 → 별칭. 인덱서가 추가·삭제 시 일괄 재해석
- [x] 인덱서 연동: headings / links / tags / aliases / blocks 저장, 백링크·미해결 링크·태그 조회(스키마 v2)
- [x] 노트 ID(ULID) `ensureNoteId` — 프런트매터에 한 줄만 삽입
- [x] 원자적 저장 + 히스토리 스냅샷 + 3-way 병합(블록 단위, 이웃 블록 변경 자동 병합, 충돌 시 양쪽 보존 + HTML 주석 표식, 공통 조상이 없으면 충돌 사본)
- [x] IPC `note.read`(hash 포함) / `note.save`, 자기 쓰기 에코 구분(`note.changed.external`)
- [ ] mdast ↔ ProseMirror/BlockNote 변환, 바뀐 블록의 mdast → Markdown 직렬화(커스텀 노드 포함) — 에디터를 확정하는 2단계에서 함께 구현
- 결정: `:::` 펜스는 remark-directive를 쓰지 않는다(`[[a:b]]`·`시간:30` 같은 일반 텍스트의 `:name`을 디렉티브로 오인해 링크가 깨짐). 펜스는 앞뒤에 빈 줄이 있는 한 줄 문단으로 인식하고, 중첩은 콜론 개수로 구분한다(`::::columns` ⊃ `:::column`).

### 개발 명령
- `pnpm test` / `pnpm typecheck` / `pnpm lint`
- `pnpm --filter @nopsidian/desktop start` — 개발 실행
- `pnpm --filter @nopsidian/desktop e2e` — E2E 빌드 후 Playwright 실행
