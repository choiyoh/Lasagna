import { describe, expect, it } from 'vitest';
import { platformText } from './export-platform.js';
import { countMarkdown } from './text-stats.js';

const md = [
  '---',
  'title: 1화',
  'goal_chars: 4000',
  '---',
  '# 1화 밤의 시작',
  '',
  '**굵은** 문장과 *기울임*, `코드`, [[노트|별칭]], [링크](https://x.y), ![그림](a.png)',
  '',
  '> 인용문',
  '- 목록 하나',
  '- 목록 둘',
  '',
  '| a | b |',
  '|---|---|',
  '| 1 | 2 |',
  '',
  '```ts',
  'const a = 1;',
  '```',
  '',
  '',
  '',
  '끝 문단',
].join('\n');

describe('플랫폼용 텍스트 변환', () => {
  it('frontmatter·첫 H1 제외, 기호 제거, 링크·이미지·표·코드 처리, 빈 줄 정리', () => {
    expect(platformText(md)).toBe(
      [
        '굵은 문장과 기울임, 코드, 별칭, 링크, 그림',
        '',
        '인용문',
        '목록 하나',
        '목록 둘',
        '',
        'a\tb',
        '1\t2',
        '',
        'const a = 1;',
        '',
        '끝 문단',
      ].join('\n'),
    );
  });

  it('CRLF 도 같게 처리하고, 제목이 없으면 H1 만 건너뛰지 않는다', () => {
    expect(platformText('# 제목\r\n\r\n본문 **강조**\r\n')).toBe('본문 강조');
    // 첫 H1 은 위치와 무관하게 제목으로 보고 뺀다(플랫폼 제목 칸에 따로 넣는다).
    expect(platformText('본문만\n\n# 나중 제목\n')).toBe('본문만');
  });

  it('변환 결과 글자수 == W1 총계 − 제목 글자수', () => {
    const body = '# 1화 밤의 시작\n\n**굵은** 문장과 [[노트|별칭]], [링크](https://x.y)\n';
    const total = countMarkdown(body).chars;
    const title = countMarkdown('# 1화 밤의 시작\n').chars;
    expect(countMarkdown(platformText(body)).chars).toBe(total - title);
  });

});
