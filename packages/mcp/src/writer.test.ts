import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { sha256 } from '@nopsidian/core';
import { afterEach, describe, expect, it } from 'vitest';
import { readAudit } from './audit.js';
import type { McpPolicy } from './policy.js';
import { NoteWriter, WriteError, appendText, composeNote } from './writer.js';

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));
function setup(over: Partial<McpPolicy> = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'nops-mcp-w-'));
  dirs.push(root);
  const policy: McpPolicy = { root, write: true, writeFolders: ['AI'], maxWritesPerMinute: 30, maxBytes: 1000, ...over };
  let t = Date.UTC(2026, 9, 15, 12, 0, 0);
  const writer = new NoteWriter(policy, () => 'test-client', () => new Date(t));
  return { root, policy, writer, advance: (ms: number) => (t += ms) };
}
const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e instanceof WriteError ? e.code : `other:${String(e)}`;
  }
  return 'none';
};

describe('composeNote / appendText', () => {
  it('제목·태그·속성으로 프런트매터와 H1 을 만든다', () => {
    expect(composeNote('본문', { title: '회의', tags: ['#a', 'b'], properties: { 상태: '초안' } })).toBe('---\n상태: 초안\ntags:\n  - a\n  - b\n---\n\n# 회의\n\n본문\n');
    expect(composeNote('# 이미 있음\n본문', { title: '무시' })).toBe('# 이미 있음\n본문\n');
  });
  it('내용에 프런트매터가 있으면 tags/properties 와 함께 못 쓴다', () => {
    expect(code(() => composeNote('---\na: 1\n---\n본문', { tags: ['x'] }))).toBe('bad-input');
    expect(composeNote('---\na: 1\n---\n본문', {})).toBe('---\na: 1\n---\n본문\n');
  });
  it('끝에 덧붙인다', () => {
    expect(appendText('# 제목\n\n본문\n', '추가')).toBe('# 제목\n\n본문\n\n추가\n');
    expect(appendText('', '추가')).toBe('추가\n');
  });
  it('제목 구역의 끝에 덧붙인다(다음 같은/상위 제목 앞)', () => {
    const src = '# 노트\n\n## 할 일\n\n- a\n\n### 하위\n\nx\n\n## 메모\n\nm\n';
    expect(appendText(src, '- b', '할 일')).toBe('# 노트\n\n## 할 일\n\n- a\n\n### 하위\n\nx\n\n- b\n\n## 메모\n\nm\n');
    expect(appendText(src, 'z', '메모')).toBe(`${src}\nz\n`);
    expect(appendText(src, '- c', '하위')).toBe('# 노트\n\n## 할 일\n\n- a\n\n### 하위\n\nx\n\n- c\n\n## 메모\n\nm\n');
    expect(code(() => appendText(src, 'q', '없는 제목'))).toBe('bad-heading');
  });
});

describe('NoteWriter', () => {
  it('새 노트를 만들고 감사 기록을 남긴다', () => {
    const { root, writer } = setup();
    const r = writer.create('create_note', 'AI/요약', '본문', { title: '요약' });
    expect(r).toMatchObject({ path: 'AI/요약.md', status: 'saved' });
    expect(readFileSync(path.join(root, 'AI/요약.md'), 'utf8')).toBe('# 요약\n\n본문\n');
    const [a] = readAudit(root);
    expect(a).toMatchObject({ action: 'create', tool: 'create_note', path: 'AI/요약.md', client: 'test-client', hashBefore: null, hashAfter: r.hash });
  });
  it('있는 노트·허용 폴더 밖·읽기 전용은 거부하고 기록한다', () => {
    const { root, writer } = setup();
    writer.create('create_note', 'AI/a', 'x');
    expect(code(() => writer.create('create_note', 'AI/a', 'y'))).toBe('exists');
    expect(code(() => writer.create('create_note', '개인/비밀', 'y'))).toBe('forbidden-folder');
    expect(code(() => writer.create('create_note', '../밖', 'y'))).toBe('bad-input');
    expect(code(() => writer.create('create_note', '.nopsidian/x', 'y'))).toBe('bad-input');
    expect(existsSync(path.join(root, '개인'))).toBe(false);
    const denied = readAudit(root).filter((e) => e.action === 'denied');
    expect(denied.map((e) => e.path)).toEqual(['.nopsidian/x', '../밖', '개인/비밀.md', 'AI/a.md']);
    const ro = setup({ write: false, writeFolders: [] });
    expect(code(() => ro.writer.create('create_note', 'AI/a', 'x'))).toBe('read-only');
  });
  it('덧붙이기는 기존 내용을 보존하고, 기록을 남기며, 역사 스냅샷을 만든다', () => {
    const { root, writer } = setup();
    mkdirSync(path.join(root, 'AI'));
    writeFileSync(path.join(root, 'AI/n.md'), '# n\n\n본문\n');
    const r = writer.append('append_to_note', 'AI/n', '추가한 줄');
    expect(readFileSync(path.join(root, 'AI/n.md'), 'utf8')).toBe('# n\n\n본문\n\n추가한 줄\n');
    expect(r.hash).toBe(sha256('# n\n\n본문\n\n추가한 줄\n'));
    expect(readdirSync(path.join(root, '.nopsidian/history')).length).toBe(1); // 덮어쓰기 전 내용이 남는다
    expect(code(() => writer.append('append_to_note', 'AI/없음', 'x'))).toBe('not-found');
  });
  it('통째로 고치기는 base_hash 가 맞아야 한다', () => {
    const { root, writer } = setup();
    mkdirSync(path.join(root, 'AI'));
    writeFileSync(path.join(root, 'AI/n.md'), '옛 내용\n');
    expect(code(() => writer.update('update_note', 'AI/n', '새 내용', 'deadbeef'))).toBe('stale');
    expect(readFileSync(path.join(root, 'AI/n.md'), 'utf8')).toBe('옛 내용\n');
    const r = writer.update('update_note', 'AI/n', '새 내용', sha256('옛 내용\n'));
    expect(r.status).toBe('saved');
    expect(readFileSync(path.join(root, 'AI/n.md'), 'utf8')).toBe('새 내용\n');
  });
  it('partial 해시는 더 짧아지는 덮어쓰기를 막고, 낡음 검사는 전체 해시로 똑같이 한다', () => {
    const { root, writer } = setup();
    mkdirSync(path.join(root, 'AI'));
    const disk = `${'x'.repeat(80)}\n`;
    writeFileSync(path.join(root, 'AI/n.md'), disk);
    const full = sha256(disk);
    // 잘린 내용 + partial 해시 → 거부되고 파일은 그대로
    expect(code(() => writer.update('update_note', 'AI/n', 'x'.repeat(40), `partial:${full}`))).toBe('partial');
    expect(readFileSync(path.join(root, 'AI/n.md'), 'utf8')).toBe(disk);
    const denied = readAudit(root).filter((e) => e.action === 'denied');
    expect(denied[0]).toMatchObject({ action: 'denied', tool: 'update_note', path: 'AI/n.md' });
    expect(denied[0]!.note).toContain('partial:');
    // 해시가 낡았으면 partial 이어도 stale
    expect(code(() => writer.update('update_note', 'AI/n', 'y'.repeat(200), `partial:${'a'.repeat(64)}`))).toBe('stale');
    // 디스크 해시가 맞고 내용이 짧아지지 않으면 통과(같은 길이도 허용)
    const same = `${'y'.repeat(80)}\n`;
    expect(writer.update('update_note', 'AI/n', same, `partial:${full}`)).toMatchObject({ status: 'saved' });
    expect(readFileSync(path.join(root, 'AI/n.md'), 'utf8')).toBe(same);
    // 접두사 없는 전체 해시는 짧아져도 통과 — 기존 동작 그대로
    expect(writer.update('update_note', 'AI/n', 'short', sha256(same)).status).toBe('saved');
    expect(readFileSync(path.join(root, 'AI/n.md'), 'utf8')).toBe('short\n');
  });
  it('크기·횟수 한도', () => {
    const { writer, advance } = setup({ maxWritesPerMinute: 2, maxBytes: 20 });
    expect(code(() => writer.create('create_note', 'AI/big', 'x'.repeat(50)))).toBe('too-large');
    writer.create('create_note', 'AI/a', '1');
    writer.create('create_note', 'AI/b', '2');
    expect(code(() => writer.create('create_note', 'AI/c', '3'))).toBe('rate-limit');
    advance(61_000);
    expect(code(() => writer.create('create_note', 'AI/c', '3'))).toBe('none');
  });
  it('바뀌지 않는 modify(no-op)도 횟수 한도에 센다 — 파일은 그대로', () => {
    const { root, writer, advance } = setup({ maxWritesPerMinute: 2 });
    mkdirSync(path.join(root, 'AI'));
    writeFileSync(path.join(root, 'AI/n.md'), '내용\n');
    const noop = (disk: string) => disk;
    const first = writer.modify('update_database_row', 'AI/n', noop);
    expect(first).toMatchObject({ path: 'AI/n.md', status: 'saved', hash: sha256('내용\n') });
    writer.modify('update_database_row', 'AI/n', noop);
    expect(code(() => writer.modify('update_database_row', 'AI/n', noop))).toBe('rate-limit');
    expect(readFileSync(path.join(root, 'AI/n.md'), 'utf8')).toBe('내용\n');
    // 쓰지 않았으므로 역사 스냅샷도 생기지 않는다
    expect(existsSync(path.join(root, '.nopsidian/history'))).toBe(false);
    advance(61_000);
    expect(code(() => writer.modify('update_database_row', 'AI/n', noop))).toBe('none');
    // 실제로 바뀌는 수정은 그대로 저장된다
    expect(writer.modify('update_database_row', 'AI/n', (d) => `${d}추가\n`).status).toBe('saved');
    expect(readFileSync(path.join(root, 'AI/n.md'), 'utf8')).toBe('내용\n추가\n');
  });
});
