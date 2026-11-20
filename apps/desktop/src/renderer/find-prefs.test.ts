import { describe, expect, it } from 'vitest';
import { loadFindParticles, saveFindParticles } from './find-prefs';

/** localStorage 대신 쓰는 메모리 저장소 */
function memoryStore(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => void map.set(key, value) };
}

describe('조사 맞추기 설정', () => {
  it('저장한 값이 없으면 켜짐', () => {
    expect(loadFindParticles(memoryStore())).toBe(true);
  });

  it('끈 상태와 켠 상태를 기억한다', () => {
    const store = memoryStore();
    saveFindParticles(false, store);
    expect(loadFindParticles(store)).toBe(false);
    saveFindParticles(true, store);
    expect(loadFindParticles(store)).toBe(true);
  });

  it('알 수 없는 값이면 켜짐', () => {
    expect(loadFindParticles(memoryStore({ 'nops.find.particles': 'garbage' }))).toBe(true);
  });
});
