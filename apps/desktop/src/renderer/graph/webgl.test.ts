import { describe, expect, it } from 'vitest';
import { hasWebGL } from './webgl';

/** getContext 만 흉내 내는 가짜 캔버스 */
function fakeCanvas(getContext: (id: string) => unknown): () => HTMLCanvasElement {
  return () => ({ getContext: (id: string) => getContext(id) }) as unknown as HTMLCanvasElement;
}

describe('hasWebGL', () => {
  it('webgl2 컨텍스트가 있으면 true', () => {
    expect(hasWebGL(fakeCanvas((id) => (id === 'webgl2' ? { id } : null)))).toBe(true);
  });

  it('webgl1 만 있어도 true', () => {
    expect(hasWebGL(fakeCanvas((id) => (id === 'webgl' ? { id } : null)))).toBe(true);
  });

  it('experimental-webgl 만 있어도 true', () => {
    expect(hasWebGL(fakeCanvas((id) => (id === 'experimental-webgl' ? { id } : null)))).toBe(true);
  });

  it('모두 null 이면 false (webgl2 → webgl → experimental-webgl 순서로 본다)', () => {
    const asked: string[] = [];
    const canvas = fakeCanvas((id) => {
      asked.push(id);
      return null;
    });
    expect(hasWebGL(canvas)).toBe(false);
    expect(asked).toEqual(['webgl2', 'webgl', 'experimental-webgl']);
  });

  it('getContext 가 던지면 false', () => {
    expect(hasWebGL(fakeCanvas(() => {
      throw new Error('컨텍스트를 만들 수 없어요');
    }))).toBe(false);
    expect(hasWebGL(() => {
      throw new Error('캔버스를 만들 수 없어요');
    })).toBe(false);
  });
});

describe('hasWebGL 확인용 컨텍스트 정리', () => {
  it('확인에 쓴 컨텍스트는 WEBGL_lose_context 로 바로 놓아 준다', () => {
    let lost = 0;
    const gl = { getExtension: (name: string) => (name === 'WEBGL_lose_context' ? { loseContext: () => void lost++ } : null) };
    expect(hasWebGL(fakeCanvas((id) => (id === 'webgl2' ? gl : null)))).toBe(true);
    expect(lost).toBe(1);
  });

  it('확장이 없거나 loseContext 가 던져도 true', () => {
    expect(hasWebGL(fakeCanvas((id) => (id === 'webgl' ? { getExtension: () => null } : null)))).toBe(true);
    const throwing = { getExtension: () => ({ loseContext: () => { throw new Error('x'); } }) };
    expect(hasWebGL(fakeCanvas((id) => (id === 'webgl' ? throwing : null)))).toBe(true);
  });
});
