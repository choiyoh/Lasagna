# 업스트림

- 원본: https://github.com/choiyoh/oh-new-editor (private) `packages/core`
- 포크 기준 커밋: `65acc2ef3e1502ab90344dd50f4d00638a80df96`
- 포크 이유: Nopsidian이 필요한 노드(콜아웃·토글·열·위키링크·임베드), 슬래시 메뉴 확장, 블록 핸들,
  마크다운 직렬화(바이트 보존)를 이쪽에서 자유롭게 바꾸기 위해서다.
- 되돌리기: oh-new-editor가 npm에 배포되면 이 패키지의 변경분을 업스트림에 반영하거나,
  확장 지점(스키마·슬래시 항목·뷰 접근)을 업스트림 API로 제안한 뒤 `@oh-new-editor/core` 의존성으로 교체한다.
- 변경 내역은 이 폴더의 git 이력에서 `packages/editor` 경로로 추적한다.
