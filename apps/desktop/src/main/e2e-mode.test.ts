import { describe, expect, it } from 'vitest';
import { e2eBackground } from './e2e-mode';

describe('e2eBackground', () => {
  it('배포 빌드(빌드 상수 false)는 런타임 NOPS_E2E=1 이어도 항상 false', () => {
    expect(e2eBackground({ NOPS_E2E: '1' }, false)).toBe(false);
    expect(e2eBackground({ NOPS_E2E: '1', NOPS_E2E_BACKGROUND: '1' }, false)).toBe(false);
    expect(e2eBackground({ NOPS_E2E: '1', NOPS_E2E_BACKGROUND: '0' }, false)).toBe(false);
  });

  it('테스트 빌드(상수 true) + 런타임 NOPS_E2E=1 이면 기본 켜짐', () => {
    expect(e2eBackground({ NOPS_E2E: '1' }, true)).toBe(true);
    expect(e2eBackground({ NOPS_E2E: '1', NOPS_E2E_BACKGROUND: '1' }, true)).toBe(true);
  });

  it('테스트 빌드라도 런타임 변수가 없거나 BACKGROUND=0 이면 끔', () => {
    expect(e2eBackground({}, true)).toBe(false);
    expect(e2eBackground({ NOPS_E2E: '0' }, true)).toBe(false);
    expect(e2eBackground({ NOPS_E2E: '1', NOPS_E2E_BACKGROUND: '0' }, true)).toBe(false);
  });

  it('빌드 상수가 없으면(치환 안 됨) false 로 안전하게 떨어진다', () => {
    expect(e2eBackground({ NOPS_E2E: '1' })).toBe(false);
  });
});
