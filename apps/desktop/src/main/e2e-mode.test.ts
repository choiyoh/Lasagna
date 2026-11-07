import { describe, expect, it } from 'vitest';
import { e2eBackground } from './e2e-mode';

describe('e2eBackground', () => {
  it('배포 앱(NOPS_E2E 없음)은 항상 false — 실제 동작 불변', () => {
    expect(e2eBackground({})).toBe(false);
    expect(e2eBackground({ NOPS_E2E_BACKGROUND: '1' })).toBe(false);
    expect(e2eBackground({ NOPS_E2E: '0', NOPS_E2E_BACKGROUND: '1' })).toBe(false);
  });

  it('테스트 빌드는 기본으로 백그라운드', () => {
    expect(e2eBackground({ NOPS_E2E: '1' })).toBe(true);
    expect(e2eBackground({ NOPS_E2E: '1', NOPS_E2E_BACKGROUND: '1' })).toBe(true);
  });

  it('포커스가 필요한 스펙은 NOPS_E2E_BACKGROUND=0 으로 끈다', () => {
    expect(e2eBackground({ NOPS_E2E: '1', NOPS_E2E_BACKGROUND: '0' })).toBe(false);
  });
});
