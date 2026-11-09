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

describe('타자기 스크롤 — 클릭·입력 시나리오', () => {
  it('문서 중간 문단을 클릭했을 때(스크롤 0, 커서 60% 지점) 42%로 내린다', () => {
    // 컨테이너 top 100, 높이 800, 42% 지점 = 436. 커서가 화면 580(=60%) → 144px 내린다.
    expect(typewriterScrollTop({ ...base, caretTop: 580, scrollTop: 0 })).toBe(144);
  });
  it('입력 뒤 커서가 화면 위로 튀었을 때(스크롤 535, 커서 106)는 그대로 둔다', () => {
    // 커서 문서 위치 = 106-100+535 = 541, 목표 = 541-336 = 205... 화면상 42%보다 위면 위로 올린다.
    expect(typewriterScrollTop({ ...base, caretTop: 106, scrollTop: 535 })).toBe(205);
  });
  it('문서 끝은 최대 스크롤로 클램프', () => {
    expect(typewriterScrollTop({ ...base, caretTop: 900, scrollTop: 4500 })).toBe(4200);
  });
});
