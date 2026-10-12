import { describe, expect, it } from 'vitest';
import { planSync } from './planner.js';
import type { LocalFile, RemoteFile, SyncEntry } from './types.js';

const lf = (path: string, hash: string): LocalFile => ({ path, hash, size: 1 });
const rf = (path: string, hash: string, id = `id-${path}`, revision = `rev-${hash}`): RemoteFile => ({ id, path, hash, revision, size: 1 });
const en = (path: string, hash: string, id = `id-${path}`): SyncEntry => ({ path, driveId: id, hash, revision: `rev-${hash}` });
const types = (p: ReturnType<typeof planSync>) => p.ops.map((o) => `${o.type}:${'path' in o ? o.path : o.from}`);

describe('planSync — 경로 하나의 판단표', () => {
  it('아무것도 안 바뀌었으면 계획이 비어 있다', () => {
    expect(planSync({ local: [lf('a.md', 'h1')], remote: [rf('a.md', 'h1')], entries: [en('a.md', 'h1')] }).ops).toEqual([]);
  });
  it('기록 없음: 로컬만 → push(new), 원격만 → pull(new)', () => {
    const p = planSync({ local: [lf('a.md', 'h')], remote: [rf('b.md', 'h2')], entries: [] });
    expect(p.ops.map((o) => [o.type, 'reason' in o ? o.reason : ''])).toEqual([['push', 'new'], ['pull', 'new']]);
    expect(p.firstSync).toBe(true);
  });
  it('기록 없음: 양쪽이 같으면 기록만, 다르면 병합(기록 없음)', () => {
    expect(types(planSync({ local: [lf('a.md', 'h')], remote: [rf('a.md', 'h')], entries: [] }))).toEqual(['record:a.md']);
    const p = planSync({ local: [lf('a.md', 'h1')], remote: [rf('a.md', 'h2')], entries: [] });
    expect(p.ops[0]).toMatchObject({ type: 'merge', entry: null });
  });
  it('로컬만 바뀜 → push(changed, 원격 revision 동반)', () => {
    const p = planSync({ local: [lf('a.md', 'h2')], remote: [rf('a.md', 'h1')], entries: [en('a.md', 'h1')] });
    expect(p.ops).toEqual([{ type: 'push', path: 'a.md', existing: { id: 'id-a.md', revision: 'rev-h1' }, reason: 'changed' }]);
  });
  it('원격만 바뀜 → pull(changed)', () => {
    const p = planSync({ local: [lf('a.md', 'h1')], remote: [rf('a.md', 'h2')], entries: [en('a.md', 'h1')] });
    expect(p.ops[0]).toMatchObject({ type: 'pull', reason: 'changed' });
  });
  it('로컬 삭제(원격 그대로) → 원격 휴지통, 원격 삭제(로컬 그대로) → 로컬 휴지통', () => {
    expect(types(planSync({ local: [], remote: [rf('a.md', 'h1')], entries: [en('a.md', 'h1')], guardMinTracked: 99 }))).toEqual(['trashRemote:a.md']);
    expect(types(planSync({ local: [lf('a.md', 'h1')], remote: [], entries: [en('a.md', 'h1')], guardMinTracked: 99 }))).toEqual(['trashLocal:a.md']);
  });
  it('양쪽이 같은 내용으로 바뀜 → 기록만', () => {
    expect(types(planSync({ local: [lf('a.md', 'h2')], remote: [rf('a.md', 'h2')], entries: [en('a.md', 'h1')] }))).toEqual(['record:a.md']);
  });
  it('양쪽이 다르게 바뀜 → 병합(기록 동반)', () => {
    const p = planSync({ local: [lf('a.md', 'h2')], remote: [rf('a.md', 'h3')], entries: [en('a.md', 'h1')] });
    expect(p.ops[0]).toMatchObject({ type: 'merge', entry: { hash: 'h1' } });
  });
  it('한쪽은 삭제, 다른 쪽은 수정 → 수정본을 살린다', () => {
    expect(planSync({ local: [], remote: [rf('a.md', 'h2')], entries: [en('a.md', 'h1')] }).ops[0]).toMatchObject({ type: 'pull', reason: 'restore' });
    expect(planSync({ local: [lf('a.md', 'h2')], remote: [], entries: [en('a.md', 'h1')] }).ops[0]).toMatchObject({ type: 'push', reason: 'restore' });
  });
  it('양쪽에서 모두 사라짐 → 기록 삭제', () => {
    expect(types(planSync({ local: [], remote: [], entries: [en('a.md', 'h1')] }))).toEqual(['forget:a.md']);
  });
  it('동기화 대상이 아닌 경로는 무시한다', () => {
    const p = planSync({ local: [lf('.nopsidian/index.sqlite', 'x'), lf('a.md', 'h')], remote: [], entries: [], isSyncable: (x) => !x.startsWith('.nopsidian/') });
    expect(types(p)).toEqual(['push:a.md']);
  });
});

describe('planSync — 이름 변경', () => {
  it('원격 이름 변경 → moveLocal', () => {
    const p = planSync({ local: [lf('a.md', 'h')], remote: [rf('b.md', 'h', 'id-a.md')], entries: [en('a.md', 'h')] });
    expect(p.ops).toHaveLength(1);
    expect(p.ops[0]).toMatchObject({ type: 'moveLocal', from: 'a.md', to: 'b.md' });
  });
  it('원격 이름 변경 + 로컬 수정 → 이동으로 보지 않는다(데이터를 잃지 않는 쪽으로)', () => {
    const p = planSync({ local: [lf('a.md', 'h2')], remote: [rf('b.md', 'h', 'id-a.md')], entries: [en('a.md', 'h')] });
    expect(p.ops.some((o) => o.type === 'moveLocal')).toBe(false);
  });
  it('로컬 이름 변경 → moveRemote(업로드·삭제 대신)', () => {
    const p = planSync({ local: [lf('b.md', 'h')], remote: [rf('a.md', 'h')], entries: [en('a.md', 'h')] });
    expect(p.ops).toHaveLength(1);
    expect(p.ops[0]).toMatchObject({ type: 'moveRemote', from: 'a.md', to: 'b.md' });
  });
  it('같은 해시의 새 파일이 둘이면 모호하므로 이동으로 보지 않는다', () => {
    const p = planSync({ local: [lf('b.md', 'h'), lf('c.md', 'h')], remote: [rf('a.md', 'h')], entries: [en('a.md', 'h')], guardMinTracked: 99 });
    expect(p.ops.some((o) => o.type === 'moveRemote')).toBe(false);
    expect(types(p).sort()).toEqual(['push:b.md', 'push:c.md', 'trashRemote:a.md']);
  });
});

describe('planSync — 안전장치', () => {
  const many = (n: number) => Array.from({ length: n }, (_, i) => `n${i}.md`);
  it('삭제가 20%를 넘으면 blocked', () => {
    const names = many(10);
    const p = planSync({ local: names.slice(3).map((n) => lf(n, 'h')), remote: names.map((n) => rf(n, 'h')), entries: names.map((n) => en(n, 'h')) });
    expect(p.deletes).toBe(3);
    expect(p.blocked).toMatch(/30%/);
  });
  it('20% 이하면 통과, 추적 파일이 적으면 적용하지 않는다', () => {
    const names = many(10);
    const p = planSync({ local: names.slice(2).map((n) => lf(n, 'h')), remote: names.map((n) => rf(n, 'h')), entries: names.map((n) => en(n, 'h')) });
    expect(p.blocked).toBeNull();
    expect(planSync({ local: [], remote: [rf('a.md', 'h')], entries: [en('a.md', 'h')] }).blocked).toBeNull();
  });
});
