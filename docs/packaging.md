# 패키징·설치 파일

## 만들기
- 개발 중 폴더만: `pnpm --filter @nopsidian/desktop package` → `apps/desktop/out/Nopsidian-<플랫폼>-<arch>/`
- 설치 파일: `pnpm --filter @nopsidian/desktop make`
  - macOS → `out/make/dmg/<arch>/Nopsidian.dmg` + `out/make/zip/darwin/<arch>/*.zip`
  - Windows → `out/make/squirrel.windows/<arch>/Nopsidian-Setup.exe` (+ `.nupkg`, `RELEASES`) + `out/make/zip/win32/<arch>/*.zip`(설치 없이 쓰는 휴대용)
- **각 OS 에서 빌드해야 한다.** `better-sqlite3`·`@parcel/watcher` 가 플랫폼별 네이티브 모듈이고 `native-modules.ts` 가 현재 OS 용 바이너리만 앱에 넣는다. 그래서 맥에서 Windows 설치 파일을 만들 수 없다.
- **빌드 결과물과 문서는 GitHub 에서 만들지 않는다.** 각 PC 에서 `make` 로 만들고(맥: dmg·zip, 윈도우: Setup.exe·zip) 구글 드라이브 `AI Works/Nopsidian/빌드/<버전>/` 에 둔다. 문서 사본은 `AI Works/Nopsidian/문서/`.
- CI(`.github/workflows/build.yml`): 푸시/PR 에서 Linux 린트·타입·테스트만 돌린다(비공개 저장소 무료 분량 월 2000분, macOS 10배·Windows 2배 계산). 세 OS 전체 테스트는 Actions 탭에서 수동 실행(`all-os`).

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
