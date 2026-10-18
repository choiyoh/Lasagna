/**
 * 템플릿 변수 확장.
 *
 * 템플릿 노트(데일리 노트, "템플릿 삽입")의 `{{date}}`·`{{time}}`·`{{title}}` 을 채운다.
 * 예전 main 프로세스의 단순 치환(`{{date}}`·`{{title}}`)을 대신하는 순수 함수다.
 */

export interface TemplateContext {
  /** "지금" — 테스트에서 고정할 수 있게 주입한다 */
  now: Date;
  /** 새 노트의 제목(파일 이름에서 확장자를 뺀 것) */
  title: string;
}

const WEEKDAY_SHORT = ['일', '월', '화', '수', '목', '금', '토'];
const WEEKDAY_LONG = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];

/** 긴 토큰이 먼저 오도록 나열한다(YYYY > YY, MM > M, dddd > ddd). 현재 위치에서만(sticky) 본다. */
const TOKEN = /dddd|ddd|YYYY|YY|MM|DD|HH|mm|ss|M|D|H|m|s/y;

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** 해석된 토큰 하나의 값. 로컬 시간 기준. */
function tokenValue(date: Date, token: string): string {
  switch (token) {
    case 'YYYY':
      return String(date.getFullYear()).padStart(4, '0');
    case 'YY':
      return pad2(date.getFullYear() % 100);
    case 'MM':
      return pad2(date.getMonth() + 1);
    case 'M':
      return String(date.getMonth() + 1);
    case 'DD':
      return pad2(date.getDate());
    case 'D':
      return String(date.getDate());
    case 'HH':
      return pad2(date.getHours());
    case 'H':
      return String(date.getHours());
    case 'mm':
      return pad2(date.getMinutes());
    case 'm':
      return String(date.getMinutes());
    case 'ss':
      return pad2(date.getSeconds());
    case 's':
      return String(date.getSeconds());
    case 'ddd':
      return WEEKDAY_SHORT[date.getDay()]!;
    case 'dddd':
      return WEEKDAY_LONG[date.getDay()]!;
    default:
      // 정규식이 위 토큰만 통과시키므로 도달하지 않는다.
      return token;
  }
}

/**
 * 날짜 형식 문자열 적용: `YYYY` `YY` `MM` `M` `DD` `D` `HH` `H` `mm` `m` `ss` `s`
 * `ddd`(요일: 월) `dddd`(요일: 월요일) 와 `[이스케이프]`.
 * 토큰이 아닌 글자는 그대로 두고, `[ ]` 안은 토큰으로 해석하지 않고 괄호만 벗긴다.
 */
export function formatDate(date: Date, format: string): string {
  let out = '';
  let i = 0;
  while (i < format.length) {
    if (format[i] === '[') {
      const end = format.indexOf(']', i + 1);
      // 닫히지 않은 이스케이프는 나머지 전체를 글자 그대로 둔다.
      if (end === -1) return out + format.slice(i);
      out += format.slice(i + 1, end);
      i = end + 1;
      continue;
    }
    TOKEN.lastIndex = i;
    const match = TOKEN.exec(format);
    if (match) {
      out += tokenValue(date, match[0]);
      i = TOKEN.lastIndex;
      continue;
    }
    out += format[i];
    i += 1;
  }
  return out;
}

/**
 * 변수 하나를 찾는 정규식. 형식이 붙은 `{{date:형식}}`/`{{time:형식}}` 과
 * 형식이 없는 `{{date}}`/`{{time}}`/`{{title}}` 만 인식한다. 그 밖의 `{{…}}` 는 손대지 않는다.
 * 중괄호 안 공백은 허용하지만 이름의 대소문자는 구분한다.
 */
const VARIABLE = /\{\{\s*(?:(date|time)\s*:\s*([^}]*?)\s*|(date|time|title)\s*)\}\}/g;

/** `{{date}}` 기본 형식 */
const DEFAULT_DATE = 'YYYY-MM-DD';
/** `{{time}}` 기본 형식 */
const DEFAULT_TIME = 'HH:mm';

/**
 * 템플릿 변수를 한 번만 치환한다.
 *
 * `{{date}}`(YYYY-MM-DD) · `{{time}}`(HH:mm) · `{{title}}` · `{{date:형식}}` · `{{time:형식}}` 을 지원하고,
 * 모르는 변수와 닫히지 않은 `{{` 는 그대로 둔다. 치환 결과 안의 `{{…}}` 는 다시 해석하지 않는다.
 * 줄바꿈을 포함한 나머지 글자는 그대로 보존한다.
 */
export function expandTemplate(template: string, ctx: TemplateContext): string {
  return template.replace(
    VARIABLE,
    (_match, dated: string | undefined, format: string | undefined, plain: string | undefined) => {
      const name = plain ?? dated;
      if (name === 'title') return ctx.title;
      // 함수 치환은 반환 값을 그대로 쓴다 — 제목의 `$&` 같은 특수 문자도 그대로 들어간다.
      return formatDate(ctx.now, format ?? (name === 'date' ? DEFAULT_DATE : DEFAULT_TIME));
    },
  );
}
