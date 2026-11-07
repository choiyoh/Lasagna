import { describe, expect, it } from 'vitest';
import { readGoalChars, withGoalChars } from './writer-goal.js';

describe('문서 목표 글자수(goal_chars)', () => {
  it('프런트매터가 없으면 맨 앞에 한 줄만 더한다(본문 바이트 그대로)', () => {
    expect(withGoalChars('# 제목\n\n본문\n', 5000)).toBe('---\ngoal_chars: 5000\n---\n# 제목\n\n본문\n');
  });

  it('다른 속성 값과 본문 바이트는 그대로 두고 목표만 바꾼다', () => {
    const before = '---\ntitle: 1화\ngoal_chars: 3000\naliases:\n  - 가\n---\n**본문**\n\n\n끝\n';
    const after = withGoalChars(before, 5000);
    expect(after).toContain('goal_chars: 5000');
    expect(after).toContain('title: 1화');
    expect(after).toContain('aliases:\n  - 가');
    expect(after.endsWith('---\n**본문**\n\n\n끝\n')).toBe(true);
  });

  it('목표 해제(null)는 키만 지우고, 마지막 키였으면 프런트매터를 없앤다', () => {
    expect(withGoalChars('---\ntitle: 1화\ngoal_chars: 5000\n---\n본문\n', null)).toBe('---\ntitle: 1화\n---\n본문\n');
    expect(withGoalChars('---\ngoal_chars: 5000\n---\n본문\n', null)).toBe('본문\n');
  });

  it('CRLF 노트는 CRLF 를 유지한다', () => {
    expect(withGoalChars('---\r\ntitle: 1화\r\n---\r\n본문\r\n', 1200)).toBe('---\r\ntitle: 1화\r\ngoal_chars: 1200\r\n---\r\n본문\r\n');
  });

  it('값이 그대로면 원문을 바꾸지 않는다', () => {
    const s = '---\ngoal_chars: 5000\n---\n본문\n';
    expect(withGoalChars(s, 5000)).toBe(s);
  });

  it('읽기: 없음·0 이하·숫자 아님·따옴표 숫자·실수', () => {
    expect(readGoalChars('본문\n')).toBeNull();
    expect(readGoalChars('---\ngoal_chars: 0\n---\n본문\n')).toBeNull();
    expect(readGoalChars('---\ngoal_chars: -5\n---\n본문\n')).toBeNull();
    expect(readGoalChars('---\ngoal_chars: 많이\n---\n본문\n')).toBeNull();
    expect(readGoalChars('---\ngoal_chars: "5000"\n---\n본문\n')).toBe(5000);
    expect(readGoalChars('---\ngoal_chars: 5000.9\n---\n본문\n')).toBe(5000);
    expect(readGoalChars('---\ngoal_chars: 5000\n---\n')).toBe(5000);
  });

  it('깨진 YAML 은 덮어쓰지 않고 던진다', () => {
    expect(() => withGoalChars('---\na: [\n---\n본문\n', 1000)).toThrow();
  });
});
