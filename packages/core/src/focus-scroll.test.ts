import { describe, expect, it } from 'vitest';
import { focusContentWidth, typewriterScrollTop } from './focus-scroll.js';

const base = { containerTop: 100, containerHeight: 800, scrollHeight: 5000 };

describe('타자기 스크롤 계산', () => {
  it('문서 처음에는 위로 더 가지 않는다(0 클램프)', () => {
    expect(typewriterScrollTop({ ...base, caretTop: 120, scrollTop: 0 })).toBe(0);
  });
  it('중간은 커서 줄을 42% 위치로 맞춘다', () => {
    // caretTop 화면 기준 700 → 목표 화면 위치 100+336=436 → 264px 아래로 스크롤
    expect(typewriterScrollTop({ ...base, caretTop: 700, scrollTop: 1000 })).toBe(1264);
  });
  it('문서 끝에서는 최대 스크롤을 넘지 않는다', () => {
    expect(typewriterScrollTop({ ...base, caretTop: 900, scrollTop: 4190 })).toBe(4200);
  });
  it('집중 모드 본문 폭', () => {
    expect(focusContentWidth(1440)).toBe(680);
    expect(focusContentWidth(920)).toBe(560);
  });
});
