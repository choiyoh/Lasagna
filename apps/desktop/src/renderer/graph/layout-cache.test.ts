// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { LEGACY_GLOBAL_KEY, clearLayoutCache, clearLayoutMemory, hydrateLayout, layoutCacheKey, loadLayout, registerLayoutPersister, saveLayout } from './layout-cache';

const PREFIX = 'nops.graph.layout.';
const pos = (pairs: Record<string, [number, number]>) => new Map(Object.entries(pairs));

beforeEach(() => {
  localStorage.clear();
  clearLayoutMemory();
  registerLayoutPersister(null);
});

describe('layoutCacheKey', () => {
  it('볼트마다 다른 키를 쓴다', () => {
    expect(layoutCacheKey('vault-a', 'global')).toBe('vault-a:global');
    expect(layoutCacheKey('vault-a', 'global')).not.toBe(layoutCacheKey('vault-b', 'global'));
    expect(layoutCacheKey(undefined, 'local:x')).toBe('vault:local:x');
  });
});

describe('saveLayout / loadLayout', () => {
  it('좌표와 수렴 여부를 그대로 복원한다', () => {
    saveLayout('v:global', pos({ a: [1.234, -5.678], b: [10, 20] }), true);
    const got = loadLayout('v:global');
    expect(got.found).toBe(true);
    expect(got.done).toBe(true);
    expect(got.positions.get('a')).toEqual([1.23, -5.68]);
    expect(got.positions.get('b')).toEqual([10, 20]);
  });

  it('수렴하지 않은 배치는 done: false 로 남는다(다음에 이어서 다듬는다)', () => {
    saveLayout('v:global', pos({ a: [1, 2] }), false);
    expect(loadLayout('v:global').done).toBe(false);
  });

  it('키가 없으면 빈 결과이고 done 은 true(콜드가 아니라 "캐시 없음")', () => {
    const got = loadLayout('missing');
    expect(got).toMatchObject({ found: false, done: true });
    expect(got.positions.size).toBe(0);
  });

  it('키가 없으면(로컬 그래프) 예전 전역 캐시도 읽지 않는다', () => {
    saveLayout(LEGACY_GLOBAL_KEY, pos({ a: [1, 1] }), true);
    expect(loadLayout(undefined, LEGACY_GLOBAL_KEY).found).toBe(false);
  });

  it('예전 형식(done 없음)은 완료된 배치로 읽는다', () => {
    localStorage.setItem(PREFIX + 'v:global', JSON.stringify({ a: [3, 4] }));
    const got = loadLayout('v:global');
    expect(got.found).toBe(true);
    expect(got.done).toBe(true);
    expect(got.positions.get('a')).toEqual([3, 4]);
  });

  it('볼트 키가 없을 때만 예전 전역 캐시로 되돌아간다', () => {
    saveLayout(LEGACY_GLOBAL_KEY, pos({ a: [1, 1] }), true);
    expect(loadLayout('new-vault:global', LEGACY_GLOBAL_KEY).positions.get('a')).toEqual([1, 1]);
    saveLayout('new-vault:global', pos({ a: [2, 2] }), false);
    expect(loadLayout('new-vault:global', LEGACY_GLOBAL_KEY).positions.get('a')).toEqual([2, 2]);
  });

  it('깨진 값은 없는 것으로 본다', () => {
    localStorage.setItem(PREFIX + 'v:global', 'not json');
    expect(loadLayout('v:global').found).toBe(false);
    localStorage.setItem(PREFIX + 'v:global', JSON.stringify({ v: 2, pos: { a: ['x', 1] } }));
    expect(loadLayout('v:global').found).toBe(false);
  });

  it('지우면 다시 콜드다', () => {
    saveLayout('v:global', pos({ a: [1, 1] }), true);
    clearLayoutCache('v:global');
    expect(loadLayout('v:global').found).toBe(false);
  });

  it('좌표가 없으면 저장하지 않는다', () => {
    saveLayout('v:global', new Map(), true);
    expect(localStorage.getItem(PREFIX + 'v:global')).toBeNull();
  });

  it('파일에서 읽은 배치를 세션 캐시로 올린다', () => {
    hydrateLayout('v:global', { v: 2, done: true, pos: { a: [1.5, 2.5] } });
    const got = loadLayout('v:global');
    expect(got.found).toBe(true);
    expect(got.done).toBe(true);
    expect(got.positions.get('a')).toEqual([1.5, 2.5]);
    // localStorage 에는 아직 없다(파일이 정본)
    expect(localStorage.getItem(PREFIX + 'v:global')).toBeNull();
  });

  it('이번 세션 localStorage 값이 있으면 파일 값으로 덮지 않는다', () => {
    saveLayout('v:global', pos({ a: [9, 9] }), true);
    registerLayoutPersister(null);
    hydrateLayout('v:global', { v: 2, done: true, pos: { a: [1, 1] } });
    expect(loadLayout('v:global').positions.get('a')).toEqual([9, 9]);
  });

  it('저장하면 볼트 파일 저장기(IPC)로도 넘긴다', () => {
    const calls: unknown[] = [];
    registerLayoutPersister((layout) => calls.push(layout));
    saveLayout('v:global', pos({ a: [1.234, 2.345] }), false);
    expect(calls).toEqual([{ v: 2, done: false, pos: { a: [1.23, 2.35] } }]);
  });

  it('localStorage 쓰기가 실패해도 파일 저장기는 계속 부른다', () => {
    const calls: unknown[] = [];
    registerLayoutPersister((layout) => calls.push(layout));
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new Error('quota');
    };
    try {
      saveLayout('v:global', pos({ a: [1, 2] }), true);
    } finally {
      Storage.prototype.setItem = original;
    }
    expect(calls).toHaveLength(1);
    expect(loadLayout('v:global').positions.get('a')).toEqual([1, 2]);
  });
});
