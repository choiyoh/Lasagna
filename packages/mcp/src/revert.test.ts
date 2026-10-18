import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readAudit } from './audit.js';
import type { McpPolicy } from './policy.js';
import { RevertError, applyRestore, planRevert } from './revert.js';
import { NoteWriter } from './writer.js';

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));
function setup() {
  const root = mkdtempSync(path.join(tmpdir(), 'nops-mcp-rv-'));
  dirs.push(root);
  const policy: McpPolicy = { root, write: true, writeFolders: [''], maxWritesPerMinute: 100, maxBytes: 100000 };
  let t = Date.UTC(2026, 9, 15, 12, 0, 0);
  const writer = new NoteWriter(policy, () => 'agent', () => new Date((t += 1000)));
  return { root, writer };
}
const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e instanceof RevertError ? e.code : `other:${String(e)}`;
  }
  return 'none';
};
const NOW = () => new Date(Date.UTC(2026, 9, 15, 12, 5, 0)); // 테스트 시계(쓰기와 같은 날이어야 기록 정리 규칙에 안 걸린다)
const last = (root: string, action: string) => readAudit(root).find((e) => e.action === action)!;

describe('에이전트 작업 되돌리기', () => {
  it('덧붙이기·고치기는 이전 내용으로 복원하고 되돌림 기록을 남긴다', () => {
    const { root, writer } = setup();
    mkdirSync(path.join(root, 'AI'));
    writeFileSync(path.join(root, 'AI/n.md'), '원래 내용\n');
    writer.append('append_to_note', 'AI/n', '덧붙임');
    const e = last(root, 'append');
    const { entry, plan } = planRevert(root, e.t, e.path);
    expect(plan).toEqual({ action: 'restore', content: '원래 내용\n' });
    applyRestore(root, entry, (plan as { content: string }).content, NOW());
    expect(readFileSync(path.join(root, 'AI/n.md'), 'utf8')).toBe('원래 내용\n');
    expect(last(root, 'revert')).toMatchObject({ path: 'AI/n.md', note: `revert:${e.t}` });
    expect(code(() => planRevert(root, e.t, e.path))).toBe('already');
  });
  it('새로 만든 노트는 휴지통으로 보내라는 계획이 나온다', () => {
    const { root, writer } = setup();
    writer.create('create_note', 'AI/새', 'x');
    const e = last(root, 'create');
    expect(planRevert(root, e.t, e.path).plan).toEqual({ action: 'trash' });
  });
  it('그 뒤에 또 바뀌었으면 거부한다(더 최근 것부터)', () => {
    const { root, writer } = setup();
    mkdirSync(path.join(root, 'AI'));
    writeFileSync(path.join(root, 'AI/n.md'), 'v0\n');
    writer.append('append_to_note', 'AI/n', 'a');
    const first = last(root, 'append');
    writer.append('append_to_note', 'AI/n', 'b');
    const second = last(root, 'append');
    expect(code(() => planRevert(root, first.t, first.path))).toBe('changed');
    const { entry, plan } = planRevert(root, second.t, second.path);
    applyRestore(root, entry, (plan as { content: string }).content, NOW());
    // 이제 첫 번째도 되돌릴 수 있다
    const again = planRevert(root, first.t, first.path);
    expect((again.plan as { content: string }).content).toBe('v0\n');
  });
  it('사람이 고쳤거나, 거부·되돌림 기록, 없는 기록은 되돌릴 수 없다', () => {
    const { root, writer } = setup();
    mkdirSync(path.join(root, 'AI'));
    writeFileSync(path.join(root, 'AI/n.md'), 'v0\n');
    writer.append('append_to_note', 'AI/n', 'a');
    const e = last(root, 'append');
    writeFileSync(path.join(root, 'AI/n.md'), '사람이 고침\n');
    expect(code(() => planRevert(root, e.t, e.path))).toBe('changed');
    try { writer.create('create_note', '../밖', 'x'); } catch { /* 거부 기록을 남기려는 것 */ }
    const d = last(root, 'denied');
    expect(code(() => planRevert(root, d.t, d.path))).toBe('not-revertable');
    expect(code(() => planRevert(root, 'nope', 'AI/n.md'))).toBe('not-found');
    rmSync(path.join(root, 'AI/n.md'));
    expect(code(() => planRevert(root, e.t, e.path))).toBe('missing');
    expect(existsSync(path.join(root, 'AI/n.md'))).toBe(false);
  });
});
