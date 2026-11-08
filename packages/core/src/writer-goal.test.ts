import { describe, expect, it } from 'vitest';
import { readGoalChars, withGoalChars } from './writer-goal.js';

/** 두 원문에서 바뀐 줄만 돌려준다(줄 번호·전/후). */
function changedLines(before: string, after: string): { at: number; from: string; to: string }[] {
  const a = before.split(/\r?\n/);
  const b = after.split(/\r?\n/);
  const out: { at: number; from: string; to: string }[] = [];
  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max; i += 1) {
    if ((a[i] ?? '') !== (b[i] ?? '')) out.push({ at: i, from: a[i] ?? '', to: b[i] ?? '' });
  }
  return out;
}

describe('문서 목표 글자수(goal_chars) — 텍스트 한 줄만 바꾼다', () => {
  it('프런트매터가 없으면 맨 앞에 한 줄만 더한다(본문 바이트 그대로)', () => {
    const before = '# 제목\n\n**본문** [[링크]]\n\n| a | b |\n';
    const after = withGoalChars(before, 5000);
    const block = '---\ngoal_chars: 5000\n---\n';
    expect(after).toBe(block + before);
    expect(after.slice(block.length)).toBe(before); // 본문은 앞에 블록만 붙고 그대로
  });

  it('인라인 배열·따옴표·주석·들여쓰기·키 순서를 그대로 둔다(값만 한 줄 바뀜)', () => {
    const before = '---\ntitle: "1화"\ntags: [작품]\naliases: [ 작품 ]\n# 내 메모\ngoal_chars: 3000\ndraft: true\n---\n본문\n';
    const after = withGoalChars(before, 5000);
    expect(after).toBe('---\ntitle: "1화"\ntags: [작품]\naliases: [ 작품 ]\n# 내 메모\ngoal_chars: 5000\ndraft: true\n---\n본문\n');
    expect(changedLines(before, after)).toEqual([{ at: 5, from: 'goal_chars: 3000', to: 'goal_chars: 5000' }]);
  });

  it('인라인 주석은 그 줄에 남긴다', () => {
    expect(withGoalChars('---\ngoal_chars: 3000 # 임시\n---\n본문\n', 5000)).toBe('---\ngoal_chars: 5000 # 임시\n---\n본문\n');
  });

  it('여러 줄 배열·블록 스칼라를 건드리지 않는다', () => {
    const before = '---\ntags:\n  - 작품\n  - 연재\nsummary: |\n  첫 줄\n  둘째 줄\n---\n본문\n';
    const after = withGoalChars(before, 1200);
    expect(after).toBe('---\ntags:\n  - 작품\n  - 연재\nsummary: |\n  첫 줄\n  둘째 줄\ngoal_chars: 1200\n---\n본문\n');
  });

  it('속성이 많아도 목표 줄 하나만 바뀐다', () => {
    const fields = Array.from({ length: 30 }, (_, i) => `f${i}: 값 ${i}`).join('\n');
    const before = `---\n${fields}\ngoal_chars: 100\n---\n본문\n`;
    const after = withGoalChars(before, 200);
    expect(changedLines(before, after)).toEqual([{ at: 31, from: 'goal_chars: 100', to: 'goal_chars: 200' }]);
  });

  it('CRLF·마지막 줄바꿈 없음도 그대로 유지한다', () => {
    const crlf = '---\r\ntags: [작품]\r\n---\r\n본문\r\n';
    expect(withGoalChars(crlf, 800)).toBe('---\r\ntags: [작품]\r\ngoal_chars: 800\r\n---\r\n본문\r\n');
    const noEol = '---\ntags: [작품]\n---\n본문';
    expect(withGoalChars(noEol, 800)).toBe('---\ntags: [작품]\ngoal_chars: 800\n---\n본문');
    expect(withGoalChars('본문', 800)).toBe('---\ngoal_chars: 800\n---\n본문');
  });

  it('목표 해제는 그 줄만 지운다(다른 속성·본문 그대로, 마지막 키였으면 프런트매터 제거)', () => {
    const before = '---\ntags: [작품]\ngoal_chars: 5000\ntitle: 1화\n---\n본문\n';
    expect(withGoalChars(before, null)).toBe('---\ntags: [작품]\ntitle: 1화\n---\n본문\n');
    expect(withGoalChars('---\ngoal_chars: 5000\n---\n본문\n', null)).toBe('본문\n');
    expect(withGoalChars('# 제목\n\n본문\n', null)).toBe('# 제목\n\n본문\n');
  });

  it('따옴표 키·중복 키는 첫 줄만 처리한다', () => {
    expect(withGoalChars('---\n"goal_chars": 1000\n---\n본문\n', 2000)).toBe('---\n"goal_chars": 2000\n---\n본문\n');
    expect(withGoalChars('---\ngoal_chars: 1000\ngoal_chars: 2000\n---\n본문\n', 3000)).toBe('---\ngoal_chars: 3000\ngoal_chars: 2000\n---\n본문\n');
  });

  it('값이 그대로면 원문을 바꾸지 않는다', () => {
    const s = '---\ntags: [작품]\ngoal_chars: 5000\n---\n본문\n';
    expect(withGoalChars(s, 5000)).toBe(s);
  });

  it('읽기: 없음·0 이하·숫자 아님·따옴표 숫자·실수', () => {
    expect(readGoalChars('본문\n')).toBeNull();
    expect(readGoalChars('---\ngoal_chars: 0\n---\n본문\n')).toBeNull();
    expect(readGoalChars('---\ngoal_chars: -5\n---\n본문\n')).toBeNull();
    expect(readGoalChars('---\ngoal_chars: 많이\n---\n본문\n')).toBeNull();
    expect(readGoalChars('---\ngoal_chars: "5000"\n---\n본문\n')).toBe(5000);
    expect(readGoalChars('---\ngoal_chars: 5000.9\n---\n본문\n')).toBe(5000);
  });
});
