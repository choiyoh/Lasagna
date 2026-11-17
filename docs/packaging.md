# 패키징·설치 파일

## 만들기
- 개발 중 폴더만: `pnpm --filter @nopsidian/desktop package` → `apps/desktop/out/Lasagna-<플랫폼>-<arch>/`
- 설치 파일: `pnpm --filter @nopsidian/desktop make`
  - macOS → `out/make/dmg/<arch>/Lasagna.dmg` + `out/make/zip/darwin/<arch>/*.zip`
  - Windows → `out/make/squirrel.windows/<arch>/Lasagna-Setup.exe` (+ `.nupkg`, `RELEASES`) + `out/make/zip/win32/<arch>/*.zip`(설치 없이 쓰는 휴대용)
- **각 OS 에서 빌드해야 한다.** `better-sqlite3`·`@parcel/watcher` 가 플랫폼별 네이티브 모듈이고 `native-modules.ts` 가 현재 OS 용 바이너리만 앱에 넣는다. 그래서 맥에서 Windows 설치 파일을 만들 수 없다.
- macOS 는 각 PC 에서 `make` 로 만들 수 있고, Windows 설치 파일은 릴리스 때 GitHub Actions 가 만든다(아래 CI). `make` 는 zip·nupkg·RELEASES 도 만들지만 **릴리스에는 올리지 않는다**(아래 '릴리스에 올리는 파일').
- 로컬에서 만든 설치 파일을 보관하려면 `node scripts/collect-build.mjs "<동기화 폴더>"` 로 `v<버전>/` 폴더에 복사한다(맥·윈도우 공통). 크기가 100MB 이상이라 에이전트 도구로는 올리기 어려워, 동기화 폴더로 복사하는 방식을 쓴다.
- CI(`.github/workflows/build.yml`): 푸시/PR 에서 리눅스 러너로 린트·타입·테스트만 돌린다. 세 OS 전체 테스트는 Actions 탭에서 수동 실행(`all-os`). 워크플로 변경(ubuntu-24.04 고정·수동 `e2e` 작업)은 PR 설명의 패치로 따로 넣는다.
- Windows 릴리스(`.github/workflows/release-windows.yml`): 릴리스가 게시되면(`release: published`) `windows-latest` 에서 `pnpm --filter @nopsidian/desktop make` 를 돌려 **`Lasagna-Setup.exe` 하나만** 같은 릴리스에 첨부한다(`.nupkg`·`RELEASES`·휴대용 zip 은 올리지 않는다). 이미 게시된 릴리스는 Actions → release-windows → Run workflow 에 태그(예: `v0.14.1`)를 넣어 다시 만들 수 있다. 실행 로그의 아티팩트에는 Setup.exe 가 남는다(14일 보관).

## 릴리스에 올리는 파일 (2개)
릴리스 자산은 **`Lasagna.dmg`(macOS) + `Lasagna-Setup.exe`(Windows)** 두 개만 둔다. 앱에 자동 업데이트가 없어 zip·nupkg·RELEASES 는 필요 없다.

| 파일 | 만드는 곳 | 올리는 방법 |
|---|---|---|
| `Lasagna.dmg` | 맥에서 `pnpm --filter @nopsidian/desktop make` | **수동**으로 릴리스에 첨부(`gh release upload <tag> out/make/dmg/<arch>/Lasagna.dmg`) |
| `Lasagna-Setup.exe` | GitHub Actions `release-windows.yml` | 릴리스 게시(또는 workflow_dispatch) 때 **자동** 첨부 |

- 휴대용 zip(`Lasagna-<os>-<arch>-<version>.zip`)은 만들 수는 있지만 릴리스에는 올리지 않는다.
  - 권한은 워크플로 전체 `contents: read`, 첨부하는 job 만 `contents: write` 이고 `GITHUB_TOKEN` 외 시크릿은 쓰지 않는다. 포크 PR 에서는 첨부 단계를 실행하지 않는다.
  - 코드 서명이 없어 Windows SmartScreen 경고가 나올 수 있다(추가 정보 → 실행). 설치 후 동작 확인은 Windows PC 에서 사람이 한다.

## E2E(Playwright) 실행
- 리눅스(CI 의 e2e 작업과 같음). `apps/desktop` 에서:
  ```sh
  NOPS_E2E=1 pnpm exec electron-forge package   # E2E 용으로 inspect 인자 퓨즈를 연 빌드
  xvfb-run -a pnpm exec playwright test
  ```
  - 스펙이 리눅스에서만 `--no-sandbox` 를 붙인다(GitHub Actions 러너는 `chrome-sandbox` 에 setuid 를 걸 수 없다).
  - GPU 가 없는 xvfb 에서도 그래프가 그려지도록 리눅스에서 `--enable-unsafe-swiftshader --ignore-gpu-blocklist`(소프트웨어 WebGL)도 붙인다.
  - 동기화 테스트(클라이언트 ID 저장)는 `safeStorage` 가 필요해서 Secret Service 키링(gnome-keyring 등)이 없는 리눅스에서는 실패한다(앱이 일부러 평문 저장을 쓰지 않는다). 나머지 테스트는 키링 없이 돈다.
  - `NOPS_E2E_EXECUTABLE` 로 실행 파일 경로를 덮어쓸 수 있다(기본: `out/Lasagna-<플랫폼>-<arch>/` 아래, macOS 는 `.app` 번들 안).
- macOS·Windows 는 `pnpm --filter @nopsidian/desktop e2e` 로 패키징과 실행을 한 번에 한다.
- 새 클론에서 `node_modules/electron/dist` 가 없어 `pnpm start` 가 "Electron failed to install correctly" 로 죽으면 `node scripts/ensure-electron.mjs` 를 실행한다(루트 `postinstall` 로 `pnpm install` 때 자동으로 시도한다. 오프라인이면 경고만 하고 넘어간다).
- 실패하면 그 시점 화면이 `apps/desktop/test-results` 에 남고, CI e2e 작업은 이것을 아티팩트로 올린다(`_electron` 은 자동 스크린샷이 없어 스펙의 `afterEach` 가 직접 남긴다).

## 알아 둘 것
- 서명하지 않았다. macOS 는 ad-hoc 서명(키체인 `safeStorage` 가 동작하도록 `postPackage` 훅)이라 다른 맥에서 처음 열 때 Gatekeeper 경고가 나온다(우클릭 → 열기). 배포용 서명·공증은 Apple Developer 인증서, Windows 는 코드 서명 인증서가 있어야 하며 아직 연결하지 않았다.
- 앱 아이콘: `apps/desktop/assets/icon.svg` 가 원본이고 `node scripts/make-icons.mjs` 로 `.icns`·`.ico`·`.png` 를 만든다(패키저·dmg·Squirrel 에 연결됨).
- 윈도우: `better-sqlite3` 13.x 는 `prebuilds/` 를 포함하므로 소스 빌드(Visual Studio)가 필요 없다(`pnpm-workspace.yaml` 에서 빌드를 껐다).
- Windows: Squirrel 설치·업데이트·제거 때 앱이 잠깐 뜨는 이벤트는 `electron-squirrel-startup` 이 처리한다. 자동 업데이트는 아직 없다.
- Windows 에서 `make` 로 설치 파일이 만들어지는 것은 확인했다. 설치 후 Drive 연결(`safeStorage` 는 DPAPI)은 아직 손으로 확인해야 한다.

## CI 에서 겪은 것(참고)
- Windows 러너에서 `pnpm install`(hoisted) 후 `wrappy`·`once` 가 루트에 안 깔려 Squirrel 메이커가 `inflight` 를 읽다가 실패했다(macOS 전용 선택 의존성 `appdmg` 경로가 건너뛰어지며 생기는 pnpm 쪽 문제로 보인다). 그래서 `apps/desktop` 의 devDependencies 에 `wrappy`·`once` 를 직접 넣어 두었다. 비슷한 `Cannot find module` 이 또 나오면 같은 방식으로 직접 의존성에 추가한다.
- forge 설정에서 메이커 클래스를 import 하면 설정을 읽을 때 다른 OS 메이커의 의존성 트리까지 불러온다 → `makers` 는 `{ name: '@electron-forge/maker-…' }` 문자열로 지정한다.
- 느린 러너에서 퍼즈 테스트가 5초 제한을 넘어 모든 패키지 `testTimeout` 을 30초로 두었다. 윈도우(CRLF) 줄바꿈에서 줄 끝 `^블록ID` 를 못 찾던 실제 버그도 CI 로 잡았다.

## 사용자 전용 Google 클라이언트 내장 빌드
- 개인용 빌드에는 `apps/desktop/.env.gdrive.local` 또는 `NOPS_GDRIVE_CLIENT_ID`·`NOPS_GDRIVE_CLIENT_SECRET` 환경 변수로 Google OAuth 클라이언트를 넣을 수 있다. 값은 `vite.main.config.ts`가 main 번들에만 define하고 renderer·preload에는 넣지 않는다. 자세한 설정은 `docs/sync-setup.md`를 본다.
- `.env.gdrive.local`은 git에 커밋하지 않는다. `.env.gdrive.local.example`만 저장소에 둔다.
- 값이 없으면 수동 입력 빌드로 만들어진다. 값이 있으면 설정 화면에서 클라이언트 입력을 건너뛰고 Google 로그인만 한다.
- 빌드 후 `package`·`make`·`e2e` 스크립트가 자동으로 `check:builtin`을 실행한다. 값은 빌드와 같은 로더(`환경 변수 > .env.gdrive.local`)로 읽고, 값이 없으면 검사를 건너뛴다.
- 수동으로도 실행할 수 있다: `pnpm --filter @nopsidian/desktop check:builtin`. 이 검사는 main·renderer·preload·sourcemap과 패키징된 `app.asar` 사본까지 확인하고, `.env.gdrive.local`이 결과물에 들어가지 않았는지도 본다.
- **키가 들어간 dmg·zip·설치 exe는 공유하지 않는다.** 공유할 빌드는 키 없이 만들고 각 사용자가 자기 클라이언트를 입력하게 한다.
