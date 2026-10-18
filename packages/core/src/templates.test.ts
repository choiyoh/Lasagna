import { describe, expect, it } from 'vitest';
import { expandTemplate, formatDate, type TemplateContext } from './templates';

/** 로컬 시간 기준 Date 생성(월은 1부터). */
const at = (y: number, m: number, d: number, h = 0, min = 0, s = 0): Date =>
  new Date(y, m - 1, d, h, min, s);

const ctx = (now: Date, title = '제목'): TemplateContext => ({ now, title });

describe('formatDate 토큰', () => {
  it('모든 토큰을 해석한다', () => {
    expect(formatDate(at(2026, 10, 12, 9, 5, 3), 'YYYY YY MM M DD D HH H mm m ss s ddd dddd')).toBe(
      '2026 26 10 10 12 12 09 9 05 5 03 3 월 월요일',
    );
  });

  it('토큰이 아닌 글자는 그대로 둔다', () => {
    expect(formatDate(at(2026, 10, 12, 9, 5, 3), 'YYYY년 M월 D일 (ddd) ::')).toBe(
      '2026년 10월 12일 (월) ::',
    );
  });

  it('긴 토큰을 먼저 해석한다', () => {
    // YYYY > YY, MM > M, DD > D, HH > H, dddd > ddd (긴 토큰이 먼저면 아래 결과가 나온다)
    expect(formatDate(at(2026, 10, 12, 9, 5, 3), 'YYYYY')).toBe('2026Y');
    expect(formatDate(at(2026, 10, 12, 9, 5, 3), 'MMM')).toBe('1010');
    expect(formatDate(at(2026, 10, 12, 9, 5, 3), 'DDD')).toBe('1212');
    expect(formatDate(at(2026, 10, 12, 9, 5, 3), 'HHH')).toBe('099');
    expect(formatDate(at(2026, 10, 12, 9, 5, 3), 'dddd')).toBe('월요일');
    // 소문자 h 는 토큰이 아니다.
    expect(formatDate(at(2026, 10, 12, 9, 5, 3), 'hh')).toBe('hh');
  });

  it('요일은 한국어로, 일요일부터 토요일까지 맞는다', () => {
    const days = [0, 1, 2, 3, 4, 5, 6].map((offset) => at(2026, 10, 11 + offset));
    expect(days.map((d) => formatDate(d, 'ddd'))).toEqual([
      '일',
      '월',
      '화',
      '수',
      '목',
      '금',
      '토',
    ]);
    expect(days.map((d) => formatDate(d, 'dddd'))).toEqual([
      '일요일',
      '월요일',
      '화요일',
      '수요일',
      '목요일',
      '금요일',
      '토요일',
    ]);
  });

  it('[ ] 안은 토큰으로 해석하지 않고 괄호만 벗긴다', () => {
    expect(formatDate(at(2026, 10, 12), '[YYYY] YYYY')).toBe('YYYY 2026');
    expect(formatDate(at(2026, 10, 12), '[YYYY년 M월 D일] → YYYY-MM-DD')).toBe(
      'YYYY년 M월 D일 → 2026-10-12',
    );
    expect(formatDate(at(2026, 10, 12), '[ddd][dddd]')).toBe('ddddddd');
    expect(formatDate(at(2026, 10, 12), 'a[]b')).toBe('ab');
  });

  it('닫히지 않은 [ 는 나머지를 그대로 둔다', () => {
    expect(formatDate(at(2026, 10, 12), 'a[YYYY')).toBe('a[YYYY');
    expect(formatDate(at(2026, 10, 12), '[YYYY')).toBe('[YYYY');
  });

  it('자정 경계', () => {
    expect(formatDate(at(2026, 10, 12, 0, 0, 0), 'HH:mm:ss | H:m:s')).toBe('00:00:00 | 0:0:0');
  });

  it('연말 경계', () => {
    expect(formatDate(at(2026, 12, 31, 23, 59, 59), 'YY-MM-DD HH:mm:ss ddd')).toBe(
      '26-12-31 23:59:59 목',
    );
    expect(formatDate(at(2000, 1, 1), 'YYYY YY')).toBe('2000 00');
    expect(formatDate(at(2005, 1, 1), 'YY')).toBe('05');
  });

  it('윤년 2월 29일', () => {
    expect(formatDate(at(2028, 2, 29), 'YYYY-MM-DD dddd')).toBe('2028-02-29 화요일');
    // 평년 3월 1일이 2월 29일 다음 날이다.
    expect(formatDate(at(2027, 3, 1), 'YYYY-MM-DD')).toBe('2027-03-01');
  });

  it('빈 형식은 빈 문자열', () => {
    expect(formatDate(at(2026, 10, 12), '')).toBe('');
  });
});

describe('expandTemplate 변수', () => {
  it('기본값: {{date}} 는 YYYY-MM-DD, {{time}} 은 HH:mm', () => {
    const c = ctx(at(2026, 10, 12, 9, 5, 3));
    expect(expandTemplate('{{date}}', c)).toBe('2026-10-12');
    expect(expandTemplate('{{time}}', c)).toBe('09:05');
    expect(expandTemplate('{{date}}', c)).toBe(formatDate(c.now, 'YYYY-MM-DD'));
    expect(expandTemplate('{{time}}', c)).toBe(formatDate(c.now, 'HH:mm'));
  });

  it('{{title}} 은 제목 그대로', () => {
    expect(expandTemplate('# {{title}}', ctx(at(2026, 10, 12), '회의록'))).toBe('# 회의록');
    expect(expandTemplate('{{title}}', ctx(at(2026, 10, 12), ''))).toBe('');
  });

  it('{{date:형식}}·{{time:형식}} 은 둘 다 같은 형식 해석을 쓴다', () => {
    const c = ctx(at(2026, 10, 12, 9, 5, 3));
    expect(expandTemplate('{{date:YYYY년 M월 D일 (ddd)}}', c)).toBe('2026년 10월 12일 (월)');
    expect(expandTemplate('{{time:HH시 mm분 ss초}}', c)).toBe('09시 05분 03초');
    expect(expandTemplate('{{time:YYYY-MM-DD}}', c)).toBe('2026-10-12');
    expect(expandTemplate('{{date:HH:mm}}', c)).toBe('09:05');
    expect(expandTemplate('{{date:[YYYY]YY}}', c)).toBe('YYYY26');
  });

  it('중괄호 안 공백을 허용한다', () => {
    const c = ctx(at(2026, 10, 12, 9, 5, 3), '제목');
    expect(expandTemplate('{{ date }}', c)).toBe('2026-10-12');
    expect(expandTemplate('{{  time  }}', c)).toBe('09:05');
    expect(expandTemplate('{{ title }}', c)).toBe('제목');
    expect(expandTemplate('{{ date : YYYY년 M월 D일 }}', c)).toBe('2026년 10월 12일');
    expect(expandTemplate('{{date:  YYYY  }}', c)).toBe('2026');
    expect(expandTemplate('{{\ttitle\t}}', c)).toBe('제목');
  });

  it('대소문자를 구분한다', () => {
    expect(
      expandTemplate('{{Date}} {{DATE}} {{TITLE}} {{time}}', ctx(at(2026, 10, 12, 9, 5))),
    ).toBe('{{Date}} {{DATE}} {{TITLE}} 09:05');
  });

  it('모르는 변수는 그대로 둔다', () => {
    const c = ctx(at(2026, 10, 12));
    expect(expandTemplate('{{foo}}', c)).toBe('{{foo}}');
    expect(expandTemplate('{{ }} {{today}} {{datee}} {{titlex}}', c)).toBe(
      '{{ }} {{today}} {{datee}} {{titlex}}',
    );
    // 형식 자리를 준 title 도 정의된 문법이 아니므로 그대로 둔다.
    expect(expandTemplate('{{title:YYYY}}', c)).toBe('{{title:YYYY}}');
  });

  it('닫히지 않은 {{ 도 그대로 둔다', () => {
    const c = ctx(at(2026, 10, 12));
    expect(expandTemplate('a {{date', c)).toBe('a {{date');
    // 앞의 { 하나는 남고, 그 안의 정상적인 {{title}} 만 치환된다.
    expect(expandTemplate('앞 {{{title}}', c)).toBe('앞 {제목');
    expect(expandTemplate('{{date}', c)).toBe('{{date}');
  });

  it('치환 결과는 다시 치환하지 않는다(한 번만)', () => {
    const c = ctx(at(2026, 10, 12), '{{date}} {{title}}');
    expect(expandTemplate('{{title}}', c)).toBe('{{date}} {{title}}');
    // 변수가 아닌 문자열이 변수로 바뀌지도 않는다.
    expect(expandTemplate('{ {date} }', c)).toBe('{ {date} }');
  });

  it('제목의 $ 특수 문자를 그대로 넣는다', () => {
    const c = ctx(at(2026, 10, 12), 'a$&b$1c$\u0060d$$e');
    expect(expandTemplate('x{{title}}y', c)).toBe('xa$&b$1c$`d$$ey');
    expect(expandTemplate('# {{title}}', ctx(at(2026, 10, 12), "$'"))).toBe("# $'");
  });

  it('한 줄에 여러 변수를 치환한다', () => {
    const c = ctx(at(2026, 10, 12, 9, 5), '회의록');
    expect(
      expandTemplate('{{title}} · {{date}} {{time}} — {{title}}\n{{date:YYYY/MM/DD}}', c),
    ).toBe('회의록 · 2026-10-12 09:05 — 회의록\n2026/10/12');
  });

  it('줄바꿈(CRLF 포함)과 나머지 글자를 그대로 보존한다', () => {
    const c = ctx(at(2026, 10, 12), '제목');
    expect(expandTemplate('# {{title}}\r\n\r\n{{date}}\r\n', c)).toBe(
      '# 제목\r\n\r\n2026-10-12\r\n',
    );
    expect(expandTemplate('', c)).toBe('');
    expect(expandTemplate('no vars\r\n', c)).toBe('no vars\r\n');
  });

  it('날짜 경계(자정·연말·윤년)를 그대로 반영한다', () => {
    expect(expandTemplate('{{date}} {{time}} {{date:YY}}', ctx(at(2026, 1, 1, 0, 0, 0)))).toBe(
      '2026-01-01 00:00 26',
    );
    expect(expandTemplate('{{date}} {{time:HH:mm:ss}}', ctx(at(2026, 12, 31, 23, 59, 59)))).toBe(
      '2026-12-31 23:59:59',
    );
    expect(expandTemplate('{{date:YYYY-MM-DD dddd}}', ctx(at(2028, 2, 29)))).toBe(
      '2028-02-29 화요일',
    );
  });
});
