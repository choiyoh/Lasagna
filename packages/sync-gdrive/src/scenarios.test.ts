import { merge3 } from '@nopsidian/core';
import { describe, expect, it } from 'vitest';
import { buildPlan, executePlan, syncOnce, type SyncDeps } from './executor.js';
import { MemoryDrive } from './testing/memory-drive.js';
import { MemoryLocal } from './testing/memory-local.js';
import { MemoryState } from './testing/memory-state.js';

/** 기기 하나 = 로컬 파일 + 동기화 기록. Drive 는 모든 기기가 공유한다. */
function device(drive: MemoryDrive) {
  const local = new MemoryLocal();
  const state = new MemoryState();
  const deps: SyncDeps = {
    drive,
    local,
    state,
    merge: merge3,
    now: () => new Date(2026, 9, 12),
    isSyncable: (p) => !p.startsWith('.nopsidian/'),
  };
  return { local, state, deps, sync: (opts?: { force?: boolean }) => syncOnce(deps, opts) };
}

const note = (...blocks: string[]) => blocks.join('\n\n') + '\n';

describe('3자 시나리오 (기기 A, 기기 B, Drive)', () => {
  it('A 가 만든 노트가 B 로 간다. 다시 동기화하면 아무 일도 없다', async () => {
    const drive = new MemoryDrive();
    const a = device(drive);
    const b = device(drive);
    a.local.edit('노트.md', '# 제목\n');
    await a.sync();
    const r = await b.sync();
    expect(b.local.contentOf('노트.md')).toBe('# 제목\n');
    expect(r.report.pulled).toBe(1);
    expect((await a.sync()).plan.ops).toEqual([]);
    expect((await b.sync()).plan.ops).toEqual([]);
  });

  it('A 가 고치면 B 가 받는다', async () => {
    const drive = new MemoryDrive();
    const a = device(drive);
    const b = device(drive);
    a.local.edit('n.md', '# 1\n');
    await a.sync();
    await b.sync();
    a.local.edit('n.md', '# 2\n');
    await a.sync();
    await b.sync();
    expect(b.local.contentOf('n.md')).toBe('# 2\n');
  });

  it('서로 다른 블록을 동시에 고치면 충돌 없이 합쳐지고 양쪽이 수렴한다', async () => {
    const drive = new MemoryDrive();
    const a = device(drive);
    const b = device(drive);
    a.local.edit('n.md', note('# 제목', '첫 문단', '둘째 문단'));
    await a.sync();
    await b.sync();
    a.local.edit('n.md', note('# 제목', '첫 문단 (A)', '둘째 문단'));
    b.local.edit('n.md', note('# 제목', '첫 문단', '둘째 문단 (B)'));
    await a.sync();
    const rb = await b.sync();
    expect(rb.report.merged).toBe(1);
    expect(rb.report.conflicts).toBe(0);
    const merged = note('# 제목', '첫 문단 (A)', '둘째 문단 (B)');
    expect(b.local.contentOf('n.md')).toBe(merged);
    await a.sync();
    expect(a.local.contentOf('n.md')).toBe(merged);
    expect(drive.contentOf('n.md')).toBe(merged);
  });

  it('같은 블록을 동시에 고치면 양쪽을 남기고 충돌로 보고한다', async () => {
    const drive = new MemoryDrive();
    const a = device(drive);
    const b = device(drive);
    a.local.edit('n.md', note('# 제목', '원래 문장'));
    await a.sync();
    await b.sync();
    a.local.edit('n.md', note('# 제목', 'A 의 문장'));
    b.local.edit('n.md', note('# 제목', 'B 의 문장'));
    await a.sync();
    const rb = await b.sync();
    expect(rb.report.conflicts).toBe(1);
    const merged = b.local.contentOf('n.md')!;
    expect(merged).toContain('A 의 문장');
    expect(merged).toContain('B 의 문장');
    await a.sync();
    expect(a.local.contentOf('n.md')).toBe(merged);
  });

  it('삭제는 전파되고 상대 기기는 휴지통으로 보낸다(영구 삭제 아님)', async () => {
    const drive = new MemoryDrive();
    const a = device(drive);
    const b = device(drive);
    for (const n of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']) a.local.edit(`${n}.md`, `# ${n}\n`);
    await a.sync();
    await b.sync();
    a.local.remove('a.md');
    await a.sync();
    expect(drive.paths()).not.toContain('a.md');
    await b.sync();
    expect(b.local.contentOf('a.md')).toBeUndefined();
    expect(b.local.trashed.map((t) => t.path)).toEqual(['a.md']);
  });

  it('한쪽이 지우고 다른 쪽이 고쳤으면 고친 쪽을 살린다', async () => {
    const drive = new MemoryDrive();
    const a = device(drive);
    const b = device(drive);
    a.local.edit('n.md', '# 1\n');
    await a.sync();
    await b.sync();
    a.local.remove('n.md');
    b.local.edit('n.md', '# 고침\n');
    await a.sync(); // 원격에서 지워짐
    await b.sync(); // B 는 수정본을 되살려 올린다
    expect(drive.contentOf('n.md')).toBe('# 고침\n');
    await a.sync();
    expect(a.local.contentOf('n.md')).toBe('# 고침\n');
  });

  it('이름 변경은 재업로드 없이 이동으로 전파된다', async () => {
    const drive = new MemoryDrive();
    const a = device(drive);
    const b = device(drive);
    a.local.edit('옛이름.md', '# 내용\n');
    await a.sync();
    await b.sync();
    const id = (await drive.list())[0]!.id;
    await a.local.move('옛이름.md', '폴더/새이름.md');
    drive.calls.length = 0;
    await a.sync();
    expect(drive.calls.filter((c) => c.startsWith('upload'))).toEqual([]);
    expect(drive.calls).toContain(`move:${id}:폴더/새이름.md`);
    await b.sync();
    expect(b.local.paths()).toEqual(['폴더/새이름.md']);
    expect(b.local.writes.filter((p) => p === '폴더/새이름.md')).toEqual([]); // 이동했을 뿐 다시 받지 않았다
    expect((await b.sync()).plan.ops).toEqual([]);
  });

  it('Drive 웹에서 고친 파일을 받는다', async () => {
    const drive = new MemoryDrive();
    const a = device(drive);
    a.local.edit('n.md', '# 1\n');
    await a.sync();
    drive.putExternal('n.md', '# 웹에서 고침\n');
    drive.putExternal('웹에서 만든.md', '새 파일\n');
    await a.sync();
    expect(a.local.contentOf('n.md')).toBe('# 웹에서 고침\n');
    expect(a.local.contentOf('웹에서 만든.md')).toBe('새 파일\n');
  });

  it('오프라인이면 아무것도 바꾸지 않고, 돌아오면 이어서 동기화된다', async () => {
    const drive = new MemoryDrive();
    const a = device(drive);
    a.local.edit('n.md', '# 1\n');
    drive.offline = true;
    await expect(a.sync()).rejects.toThrow('offline');
    expect(await a.state.entries()).toEqual([]);
    drive.offline = false;
    await a.sync();
    expect(drive.contentOf('n.md')).toBe('# 1\n');
  });

  it('업로드 직전에 원격이 바뀌면 그 파일은 건너뛰고 다음 동기화에서 병합한다', async () => {
    const drive = new MemoryDrive();
    const a = device(drive);
    a.local.edit('n.md', note('# 제목', '첫', '둘'));
    await a.sync();
    a.local.edit('n.md', note('# 제목', '첫 (A)', '둘'));
    const plan = await buildPlan(a.deps);
    drive.putExternal('n.md', note('# 제목', '첫', '둘 (웹)')); // 계획 뒤에 끼어든 수정
    const report = await executePlan(plan, a.deps);
    expect(report.results[0]).toMatchObject({ status: 'skipped' });
    expect(report.results[0]!.error).toContain('원격이 먼저 바뀌었어요');
    await a.sync();
    expect(a.local.contentOf('n.md')).toBe(note('# 제목', '첫 (A)', '둘 (웹)'));
    expect(drive.contentOf('n.md')).toBe(note('# 제목', '첫 (A)', '둘 (웹)'));
  });

  it('첫 동기화에서 같은 경로의 내용이 다르면 원격본을 사본으로 남기고 로컬을 올린다', async () => {
    const drive = new MemoryDrive();
    drive.putExternal('n.md', '원격 내용\n');
    const a = device(drive);
    a.local.edit('n.md', '로컬 내용\n');
    const { plan, report } = await syncOnce(a.deps);
    expect(plan.firstSync).toBe(true);
    expect(report.conflicts).toBe(1);
    expect(a.local.contentOf('n.md')).toBe('로컬 내용\n');
    expect(a.local.contentOf('n (충돌 2026-10-12).md')).toBe('원격 내용\n');
    expect(drive.contentOf('n.md')).toBe('로컬 내용\n');
    await a.sync(); // 사본도 올라간다
    expect(drive.contentOf('n (충돌 2026-10-12).md')).toBe('원격 내용\n');
  });

  it('바이너리 충돌은 병합하지 않고 사본을 남긴다', async () => {
    const drive = new MemoryDrive();
    const a = device(drive);
    const b = device(drive);
    a.local.edit('그림.png', new Uint8Array([1, 2, 3]));
    await a.sync();
    await b.sync();
    a.local.edit('그림.png', new Uint8Array([9, 9]));
    b.local.edit('그림.png', new Uint8Array([7, 7, 7]));
    await a.sync();
    const rb = await b.sync();
    expect(rb.report.conflicts).toBe(1);
    expect(b.local.paths()).toContain('그림 (충돌 2026-10-12).png');
  });

  it('한꺼번에 많이 지우려 하면 멈추고, force 면 진행한다', async () => {
    const drive = new MemoryDrive();
    const a = device(drive);
    const names = Array.from({ length: 10 }, (_, i) => `n${i}.md`);
    for (const n of names) a.local.edit(n, `# ${n}\n`);
    await a.sync();
    for (const n of names.slice(0, 4)) a.local.remove(n);
    await expect(a.sync()).rejects.toThrow(/동기화를 멈췄어요/);
    expect(drive.paths()).toHaveLength(10);
    await a.sync({ force: true });
    expect(drive.paths()).toHaveLength(6);
  });

  it('동기화 대상이 아닌 파일은 건드리지 않는다', async () => {
    const drive = new MemoryDrive();
    const a = device(drive);
    a.local.edit('.nopsidian/index.sqlite', 'x');
    a.local.edit('n.md', '# 1\n');
    await a.sync();
    expect(drive.paths()).toEqual(['n.md']);
  });

  it('한 파일의 실패가 다른 파일을 막지 않는다', async () => {
    const drive = new MemoryDrive();
    const a = device(drive);
    a.local.edit('a.md', '# a\n');
    a.local.edit('b.md', '# b\n');
    const orig = drive.upload.bind(drive);
    drive.upload = async (args) => {
      if (args.path === 'a.md') throw new Error('boom');
      return orig(args);
    };
    const { report } = await syncOnce(a.deps);
    expect(report.failed).toBe(1);
    expect(report.pushed).toBe(1);
    expect(drive.paths()).toEqual(['b.md']);
    drive.upload = orig;
    await a.sync();
    expect(drive.paths()).toEqual(['a.md', 'b.md']);
  });

  it('토큰 만료(DriveAuthError)는 작업 실패가 아니라 전체 중단이다', async () => {
    const drive = new MemoryDrive();
    const a = device(drive);
    a.local.edit('a.md', '# a\n');
    drive.upload = async () => {
      const e = new Error('401');
      e.name = 'DriveAuthError';
      throw e;
    };
    await expect(a.sync()).rejects.toThrow('401');
  });
});
