import { describe, expect, it } from 'vitest';
import { choseongOf, quickSwitch, type SwitchHit, type SwitchNote } from './quick-switch';

const titles = (hits: readonly SwitchHit[]): string[] => hits.map((h) => h.title);
const byTitle = (hits: readonly SwitchHit[], title: string): SwitchHit => {
  const found = hits.find((h) => h.title === title);
  if (!found) throw new Error(`결과에 ${title} 없음: ${JSON.stringify(titles(hits))}`);
  return found;
};

describe('choseongOf', () => {
  it('한글 음절은 초성으로, 나머지 문자는 그대로 둔다', () => {
    expect(choseongOf('클린 코드')).toBe('ㅋㄹ ㅋㄷ');
    expect(choseongOf('React 클린 코드')).toBe('React ㅋㄹ ㅋㄷ');
    expect(choseongOf('노트 99')).toBe('ㄴㅌ 99');
    expect(choseongOf('abc ABC · x')).toBe('abc ABC · x');
    expect(choseongOf('ㄱㄴ')).toBe('ㄱㄴ');
    expect(choseongOf('힣')).toBe('ㅎ');
    expect(choseongOf('')).toBe('');
  });

  it('원문과 길이가 같다(초성 구간 위치를 원문 위치로 그대로 쓸 수 있다)', () => {
    for (const text of ['클린 코드', 'React 클린 코드', '노트 12 · 메모', '']) {
      expect(choseongOf(text).length).toBe(text.length);
    }
  });
});

describe('quickSwitch 빈 질의', () => {
  const notes: SwitchNote[] = [
    { path: 'a/1.md', title: '첫째', aliases: ['one'] },
    { path: 'b/2.md', title: '둘째', aliases: [] },
    { path: 'c/3.md', title: '셋째', aliases: ['three'] },
  ];

  it('입력 순서대로 앞에서 limit개, score 0, ranges 빈 배열, field title', () => {
    const hits = quickSwitch(notes, '   ');
    expect(titles(hits)).toEqual(['첫째', '둘째', '셋째']);
    expect(hits.map((h) => h.path)).toEqual(['a/1.md', 'b/2.md', 'c/3.md']);
    expect(hits.every((h) => h.score === 0 && h.ranges.length === 0 && h.field === 'title')).toBe(true);
    expect(hits[0]?.matchedText).toBe('첫째');
  });

  it('limit 개수만 돌려준다', () => {
    expect(titles(quickSwitch(notes, '', 2))).toEqual(['첫째', '둘째']);
    expect(quickSwitch(notes, ' ', 0)).toEqual([]);
  });
});

describe('quickSwitch 일반 검색 순위', () => {
  const notes: SwitchNote[] = [
    { path: 'a.md', title: 'app', aliases: [] },
    { path: 'b.md', title: 'Apple Pie', aliases: [] },
    { path: 'c.md', title: 'my app store', aliases: [] },
    { path: 'd.md', title: 'snappy', aliases: [] },
    { path: 'e.md', title: 'alpha purple', aliases: [] },
  ];

  it('전체 > 접두 > 단어 시작 > 부분 문자열 > 부분 수열 순서', () => {
    const hits = quickSwitch(notes, 'app');
    expect(titles(hits)).toEqual(['app', 'Apple Pie', 'my app store', 'snappy', 'alpha purple']);
  });

  it('같은 종류라면 점수도 앞 순위가 더 높다', () => {
    const hits = quickSwitch(notes, 'app');
    for (let i = 1; i < hits.length; i++) {
      expect(hits[i - 1]!.score).toBeGreaterThan(hits[i]!.score);
    }
  });

  it('부분 수열은 질의가 2글자 이상일 때만 따진다', () => {
    // 'apple' 안에 p·a 는 있지만 순서대로 나타나지 않는다 → 일치 없음
    const single: SwitchNote[] = [{ path: 'p.md', title: 'apple', aliases: [] }];
    expect(quickSwitch(single, 'pa')).toEqual([]);
    expect(quickSwitch(single, 'zz')).toEqual([]);
    expect(quickSwitch(single, 'apple pie')).toEqual([]);
  });

  it('대소문자와 앞뒤 공백을 무시한다', () => {
    const hits = quickSwitch(notes, '  APPLE  ');
    expect(titles(hits)[0]).toBe('Apple Pie');
    expect(byTitle(hits, 'Apple Pie').field).toBe('title');
  });

  it('경로 전체(폴더명 포함)에서도 찾는다', () => {
    const notes2: SwitchNote[] = [{ path: 'archive/2026/클린 코드 메모.md', title: 'zzz', aliases: [] }];
    const hits = quickSwitch(notes2, 'archive/2026');
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ field: 'path', matchedText: 'archive/2026/클린 코드 메모.md' });
  });
});

describe('quickSwitch 초성 검색', () => {
  it('자모 질의로 제목의 초성을 찾는다', () => {
    const notes: SwitchNote[] = [
      { path: 'a.md', title: '클린 코드', aliases: [] },
      { path: 'b.md', title: '사과', aliases: [] },
    ];
    const hits = quickSwitch(notes, 'ㅋㄹ');
    expect(titles(hits)).toEqual(['클린 코드']);
    expect(hits[0]).toMatchObject({ field: 'title', matchedText: '클린 코드', ranges: [[0, 2]] });
  });

  it('띄어쓰기를 무시한 초성(ㅋㄹㅋㄷ)도 부분 수열로 찾는다', () => {
    const notes: SwitchNote[] = [{ path: 'a.md', title: '클린 코드', aliases: [] }];
    const hits = quickSwitch(notes, 'ㅋㄹㅋㄷ');
    expect(hits).toHaveLength(1);
    expect(hits[0]!.ranges).toEqual([[0, 2], [3, 5]]);
  });

  it('단어 시작 초성은 ranges 가 원문 글자 위치를 가리킨다', () => {
    const notes: SwitchNote[] = [{ path: 'a.md', title: '클린 코드', aliases: [] }];
    const hits = quickSwitch(notes, 'ㅋㄷ');
    expect(hits[0]).toMatchObject({ ranges: [[3, 5]] });
    expect('클린 코드'.slice(3, 5)).toBe('코드');
  });

  it('별칭 초성도 찾는다', () => {
    const notes: SwitchNote[] = [{ path: 'a.md', title: 'zzz', aliases: ['클린 코드'] }];
    const hits = quickSwitch(notes, 'ㅋㄹ');
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ field: 'alias', matchedText: '클린 코드', ranges: [[0, 2]] });
  });

  it('영문과 한글이 섞인 제목도 초성 위치가 정확하다', () => {
    const notes: SwitchNote[] = [{ path: 'a.md', title: 'React 클린 코드', aliases: [] }];
    const hits = quickSwitch(notes, 'ㅋㄹ');
    expect(hits[0]).toMatchObject({ matchedText: 'React 클린 코드', ranges: [[6, 8]] });
    expect('React 클린 코드'.slice(6, 8)).toBe('클린');
  });

  it('초성이 일치하지 않으면 제외한다', () => {
    const notes: SwitchNote[] = [{ path: 'a.md', title: '클린 코드', aliases: [] }];
    expect(quickSwitch(notes, 'ㄷㄷㄷ')).toEqual([]);
  });

  it('자모 질의는 초성으로만 찾는다(초성 문자열 부분 일치)', () => {
    const notes: SwitchNote[] = [
      { path: 'a.md', title: '기타 코드', aliases: [] }, // 초성 ㄱㅌ ㅋㄷ — ㅋㄹ 아님
      { path: 'b.md', title: '클린 코드', aliases: [] },
    ];
    expect(titles(quickSwitch(notes, 'ㅋㄹ'))).toEqual(['클린 코드']);
  });
});

describe('quickSwitch 필드 우선순위', () => {
  const notes: SwitchNote[] = [
    { path: 'x/1.md', title: 'xzzx', aliases: [] },
    { path: 'x/2.md', title: 'q', aliases: ['xzzx'] },
    { path: 'xzzx/3.md', title: 'w', aliases: [] },
  ];

  it('같은 일치 종류면 제목 > 별칭 > 경로', () => {
    const hits = quickSwitch(notes, 'zzx');
    expect(titles(hits)).toEqual(['xzzx', 'q', 'w']);
    expect(hits.map((h) => h.field)).toEqual(['title', 'alias', 'path']);
    expect(hits.map((h) => h.matchedText)).toEqual(['xzzx', 'xzzx', 'xzzx/3.md']);
    expect(hits[0]!.score).toBeGreaterThan(hits[1]!.score);
    expect(hits[1]!.score).toBeGreaterThan(hits[2]!.score);
  });

  it('한 노트는 한 번만 나오고 가장 높은 점수의 필드를 쓴다', () => {
    const dup: SwitchNote[] = [{ path: 'a.md', title: '클린 코드', aliases: ['클린 코드', '코드'] }];
    const hits = quickSwitch(dup, 'ㅋㄹㅋㄷ');
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ field: 'title', matchedText: '클린 코드' });
  });

  it('일치 종류가 다르면 종류가 필드보다 우선한다', () => {
    const mixed: SwitchNote[] = [
      { path: 'x/1.md', title: 'alpha notebook', aliases: [] }, // 부분 수열
      { path: 'x/2.md', title: 'z', aliases: ['alpha'] }, // 별칭 전체 일치
    ];
    const hits = quickSwitch(mixed, 'alpha');
    // 별칭 전체(=)가 제목 부분 수열보다 앞선다
    expect(titles(hits)[0]).toBe('z');
    expect(byTitle(hits, 'alpha notebook').field).toBe('title');
  });
});

describe('quickSwitch ranges', () => {
  it('전체 일치·접두·부분 문자열 구간', () => {
    const notes: SwitchNote[] = [{ path: 'h.md', title: 'Hello World', aliases: [] }];
    expect(byTitle(quickSwitch(notes, 'hello world'), 'Hello World').ranges).toEqual([[0, 11]]);
    expect(byTitle(quickSwitch(notes, 'hello'), 'Hello World').ranges).toEqual([[0, 5]]);
    expect(byTitle(quickSwitch(notes, 'world'), 'Hello World').ranges).toEqual([[6, 11]]);
  });

  it('부분 수열은 연속 구간 단위로 나뉘고 정렬·비중첩', () => {
    const notes: SwitchNote[] = [{ path: 'a.md', title: 'alpha purple', aliases: [] }];
    const hit = byTitle(quickSwitch(notes, 'app'), 'alpha purple');
    // a@0, p@2, p@6 — 순서대로 나타나는 위치를 각각 강조한다
    expect(hit.ranges).toEqual([[0, 1], [2, 3], [6, 7]]);
    const sorted = hit.ranges.every(([s, e], i) => s < e && (i === 0 || hit.ranges[i - 1]![1] < s));
    expect(sorted).toBe(true);
    for (const [s, e] of hit.ranges) {
      const ch = 'alpha purple'.slice(s, e);
      expect(ch.length).toBe(1);
    }
  });

  it('초성 검색 구간은 원문 글자를 가리킨다', () => {
    const notes: SwitchNote[] = [{ path: 'a.md', title: '노트 클린 코드', aliases: [] }];
    const hit = byTitle(quickSwitch(notes, 'ㅋㄷ'), '노트 클린 코드');
    expect('노트 클린 코드'.slice(hit.ranges[0]![0], hit.ranges[0]![1])).toBe('코드');
  });
});

describe('quickSwitch 정렬·limit', () => {
  it('점수가 같으면 제목이 짧은 것이 앞, 그다음 경로 오름차순', () => {
    const notes: SwitchNote[] = [
      { path: 'z/1.md', title: 'xab', aliases: [] },
      { path: 'a/2.md', title: 'xab', aliases: [] },
      { path: 'm/3.md', title: 'xxab', aliases: [] },
    ];
    const hits = quickSwitch(notes, 'ab');
    expect(hits.map((h) => h.path)).toEqual(['a/2.md', 'z/1.md', 'm/3.md']);
  });

  it('같은 입력은 같은 출력(결정적)', () => {
    const notes: SwitchNote[] = [
      { path: 'z/1.md', title: 'xab', aliases: [] },
      { path: 'a/2.md', title: 'xab', aliases: [] },
    ];
    expect(quickSwitch(notes, 'ab')).toEqual(quickSwitch(notes, 'ab'));
  });

  it('limit 개수와 일치 없음 처리', () => {
    const notes: SwitchNote[] = Array.from({ length: 5 }, (_, i) => ({
      path: `n/${i}.md`,
      title: `item ${i}`,
      aliases: [],
    }));
    expect(quickSwitch(notes, 'item')).toHaveLength(5);
    expect(quickSwitch(notes, 'item', 3)).toHaveLength(3);
    expect(quickSwitch(notes, 'item', 0)).toEqual([]);
    expect(quickSwitch(notes, '없는질의 zzz')).toEqual([]);
  });
});

describe('quickSwitch 성능', () => {
  it('노트 1만 개 × 질의 한 번이 200ms 이내', () => {
    const notes: SwitchNote[] = [];
    for (let i = 0; i < 10_000; i++) {
      notes.push({
        path: `folder${i % 50}/노트 ${i}.md`,
        title: `노트 ${i} 클린 코드`,
        aliases: [`alias-${i}`, `별칭 ${i}`],
      });
    }

    const measure = (q: string) => {
      const started = performance.now();
      const hits = quickSwitch(notes, q);
      return { ms: performance.now() - started, hits };
    };

    const plain = measure('클린');
    const choseong = measure('ㅋㄹㅋㄷ');
    const fuzzy = measure('ㅅㄱㄷㄱ');

    expect(plain.hits.length).toBeGreaterThan(0);
    expect(choseong.hits.length).toBeGreaterThan(0);
    expect(plain.ms).toBeLessThan(200);
    expect(choseong.ms).toBeLessThan(200);
    expect(fuzzy.ms).toBeLessThan(200);
  });
});
