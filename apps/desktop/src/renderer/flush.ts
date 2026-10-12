/** 열려 있는 편집기의 미저장 내용을 저장하게 하는 등록소. 이름 변경처럼 디스크를 건드리는 작업 전에 부른다. */
const flushers = new Set<() => Promise<void>>();

export function registerFlush(fn: () => Promise<void>): () => void {
  flushers.add(fn);
  return () => void flushers.delete(fn);
}

export async function flushAll(): Promise<void> {
  await Promise.all([...flushers].map((f) => f()));
}
