/**
 * 그래프 배치 좌표를 기기에 저장한다.
 *
 * 예전에는 키가 `global` 하나여서 볼트를 바꾸면 좌표가 섞였고, 배치가 "끝났을 때"만 저장해
 * 중간에 화면을 닫으면 다음 진입이 또 콜드였다. 지금은 볼트별 키에, 수렴 여부(`done`)까지
 * 함께 저장한다. `done: false` 로 복원하면 다음 진입은 이어서 다듬기(resume)만 한다.
 */
import type { GraphLayout } from '@nopsidian/ipc-contract';

const PREFIX = 'nops.graph.layout.';
/** 예전 버전이 쓰던 키. 볼트 구분이 없어 첫 복원 때만 쓴다. */
export const LEGACY_GLOBAL_KEY = 'global';

export interface CachedLayout {
  positions: Map<string, [number, number]>;
  /** 저장 당시 배치가 수렴했는가 */
  done: boolean;
  found: boolean;
}

/** 볼트마다 다른 키. 같은 320 노드라도 다른 볼트의 좌표를 물려받지 않는다. */
export function layoutCacheKey(vaultId: string | undefined, scope: string): string {
  return `${vaultId ?? 'vault'}:${scope}`;
}

function read(key: string): CachedLayout | null {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFIX + key) ?? 'null') as unknown;
    if (!raw || typeof raw !== 'object') return null;
    const obj = raw as { v?: number; done?: boolean; pos?: unknown };
    const map = obj.v === 2 && obj.pos && typeof obj.pos === 'object' ? (obj.pos as Record<string, unknown>) : (raw as Record<string, unknown>);
    // 예전 형식은 다 가라앉은 배치만 저장했으므로 done 으로 본다
    const done = obj.v === 2 ? obj.done !== false : true;
    const positions = new Map<string, [number, number]>();
    for (const [id, p] of Object.entries(map)) {
      if (Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])) positions.set(id, [p[0] as number, p[1] as number]);
    }
    return positions.size ? { positions, done, found: true } : null;
  } catch {
    return null;
  }
}

/**
 * localStorage 는 같은 세션의 빠른 사본이고, 정본은 볼트 파일(`.nopsidian/graph-layout.json`)이다.
 * 앱 종료가 불안정해 localStorage flush 가 빠져도 파일은 남으므로 재시작 뒤에도 배치를 그대로 연다.
 */
const memory = new Map<string, CachedLayout>();
type Persister = (layout: GraphLayout) => void;
let persister: Persister | null = null;

/** 볼트 파일 저장기를 연결한다(GraphScreen 이 IPC 로 연결). */
export function registerLayoutPersister(fn: Persister | null): void {
  persister = fn;
}

/** 파일에서 읽은 배치를 이번 세션의 캐시로 올린다. localStorage 가 이미 있으면 그쪽이 더 최신이다. */
export function hydrateLayout(key: string, layout: GraphLayout): void {
  if (!key) return;
  try {
    if (localStorage.getItem(PREFIX + key)) return;
  } catch {
    /* localStorage 를 못 쓰면 메모리로만 간다 */
  }
  const positions = new Map<string, [number, number]>();
  for (const [id, p] of Object.entries(layout.pos)) positions.set(id, [p[0], p[1]]);
  memory.set(key, { positions, done: layout.done, found: true });
}

export function loadLayout(key: string | undefined, legacyKey?: string): CachedLayout {
  const empty: CachedLayout = { positions: new Map(), done: true, found: false };
  if (!key) return empty;
  const fromMemory = memory.get(key);
  if (fromMemory) return fromMemory;
  const direct = read(key);
  if (direct) return direct;
  // 볼트별 키로 바뀌기 전에 저장한 좌표가 있으면 첫 복원에만 쓴다
  if (legacyKey && legacyKey !== key) {
    const legacy = read(legacyKey);
    if (legacy) return legacy;
  }
  return empty;
}

export function saveLayout(key: string | undefined, positions: ReadonlyMap<string, [number, number]>, done: boolean): void {
  if (!key || positions.size === 0) return;
  const pos: Record<string, [number, number]> = {};
  for (const [id, p] of positions) pos[id] = [Math.round(p[0] * 100) / 100, Math.round(p[1] * 100) / 100];
  const layout: GraphLayout = { v: 2, done, pos };
  memory.set(key, { positions: new Map(Object.entries(pos)), done, found: true });
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(layout));
  } catch {
    /* localStorage 를 못 써도 볼트 파일로 남는다 */
  }
  try {
    persister?.(layout);
  } catch {
    /* 파일 저장 실패는 다음 진입이 콜드일 뿐이다 */
  }
}

/** 테스트용: 세션 메모리 캐시를 비운다(앱에서는 쓰지 않는다) */
export function clearLayoutMemory(): void {
  memory.clear();
}

/** 테스트용: 저장된 키를 지운다 */
export function clearLayoutCache(key: string): void {
  memory.delete(key);
  try {
    localStorage.removeItem(PREFIX + key);
  } catch {
    /* noop */
  }
}
