# 수식·롤업 레퍼런스

데이터베이스 속성 중 **수식(formula)** 과 **롤업(rollup)** 은 파일에 저장되지 않고 열 때마다 계산한다(외부 편집과 충돌하지 않는다).
`_db.yaml` 의 정의만 파일에 있고, 계산 오류는 셀에 ⚠ 와 이유로 표시된다.

## 수식 문법
- 값: 숫자 `1.5`, 문자열 `"글"`/`'글'`, `true`/`false`, 목록 `[1, 2]`. 빈 값은 `prop("x")` 가 비어 있을 때만 생긴다.
- 속성 읽기: `prop("속성 이름")` (이름은 반드시 문자열 리터럴 — 의존 관계를 미리 알기 위해). 노트 제목은 `prop("title")`.
- 연산자(우선순위 낮음 → 높음): `?:` · `or`/`||` · `and`/`&&` · `== !=` · `< <= > >=` · `+ -` · `* / %` · `! not -`(단항) · `^`(거듭제곱, 오른쪽 결합)
  - `+` 는 한쪽이 문자열이면 이어 붙임, 목록끼리는 연결. 산술에서 빈 값은 0. 0으로 나누면 오류.
- 함수 호출 `f(a, b)` 와 메서드 호출 `a.f(b)` 는 같다(첫 인자가 대상): `prop("이름").upper()`.
- 목록 콜백: `list.map(식)` `filter` `find` `findIndex` `some` `every` — 식 안에서 `current`(현재 항목)와 `index`.
- 이름 붙이기: `let(x, 10, x * 2)`, `lets(a, 1, b, a + 1, a + b)`. 조건: `if(c, a, b)`, `ifs(c1, v1, c2, v2, 기본값)` (선택된 가지만 계산).

## 함수
- **문자열·변환**: concat join length lower upper trim replace replaceAll(정규식) test match contains startsWith endsWith slice substring split repeat padStart padEnd format toNumber empty boolean
- **수학·집계**: abs ceil floor round(0에서 먼 쪽으로) sqrt cbrt exp ln log10 log2 sign pow mod e pi min max sum mean median clamp (집계는 목록도 받는다)
- **목록**: at first last sort reverse unique flat includes indexOf range count countValues
- **날짜**: now today parseDate dateAdd dateSubtract dateBetween formatDate(형식, 선택 언어 `'en'`) year month date day(월=1…일=7) hour minute second timestamp fromTimestamp dateRange dateStart dateEnd startOf — 단위 `years quarters months weeks days hours minutes seconds`(단수형 가능), 달력 연산은 로컬 시간대.
- 지원하지 않는 함수는 정의할 때 위치와 함께 "알 수 없는 함수" 오류가 난다.

## 롤업
관계 속성으로 연결된 노트들의 **대상 속성** 값을 모아 집계한다.
`fn`: show_original count count_values count_unique count_empty percent_empty percent_not_empty sum avg median min max range earliest latest date_range checked unchecked percent_checked percent_unchecked
대상 속성이 다른 데이터베이스의 수식·롤업이어도 된다(순환 참조는 오류로 표시).

## 관계
값은 `[[노트]]` 위키링크 배열이라 백링크·그래프에 그대로 나타난다. `twoWay: true` + `reverse: 반대쪽 속성` 이면 연결을 추가·제거할 때 반대쪽 노트의 그 속성도 함께 고친다.
