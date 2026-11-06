import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setLocale } from '@nopsidian/i18n';
import { afterEach, describe, expect, it } from 'vitest';
import { addComment } from './comments.js';
import { errorText } from './errors.js';
import { csvToRows, guessColumns } from './db/csv.js';
import { parseDbEmbed } from './db/embed.js';
import { renameFrontmatterKey, setFrontmatter } from './db/yaml-edit.js';
import { parseDbSchema } from './db/schema.js';
import { readHistory } from './history.js';
import { parseNote, replaceBlock } from './markdown/parse.js';
import { applyEdits } from './markdown/link-spans.js';
import { PathEscapeError, resolveInVault } from './vault-path.js';

// 코어 오류 문구가 지금 언어로 나오는지 **실제 throw 경로**로 확인한다(ko 문구는 base 그대로).
const HANGUL = /[\u3131-\u318e\uac00-\ud7a3]/;
const dirs: string[] = [];
const vault = () => {
  const d = mkdtempSync(path.join(tmpdir(), 'nops-core-i18n-'));
  dirs.push(d);
  return d;
};
afterEach(() => {
  setLocale('ko');
  dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true }));
});

/** 던진 오류를 **표시 시점**에 번역한다(던질 때는 언어를 모른다). */
const message = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    return errorText(e);
  }
  throw new Error('threw nothing');
};

const CASES: { name: string; run: () => string; ko: string; en: string }[] = [
  // 댓글: 실제 addComment
  { name: 'commentEmpty', run: () => message(() => addComment(vault(), 'a.md', { author: 'me', text: ' ' })), ko: '댓글 내용이 비어 있어요', en: 'The comment is empty' },
  {
    name: 'commentTooLong',
    run: () => message(() => addComment(vault(), 'a.md', { author: 'me', text: 'x'.repeat(5001) })),
    ko: '댓글이 너무 길어요(최대 5000자)',
    en: 'The comment is too long (at most 5000 characters)',
  },
  // 볼트 밖 경로
  { name: 'pathEscape', run: () => message(() => resolveInVault(vault(), '../x.md')), ko: '볼트 밖으로 벗어나는 경로: ../x.md', en: 'Path outside the vault: ../x.md' },
  // YAML: 실제 setFrontmatter / renameFrontmatterKey
  {
    name: 'yamlBroken',
    run: () =>
      message(() => setFrontmatter('---\na: [1\n---\n본문', { b: 1 }))
        .split('\n')[0]!
        .replace(/^(YAML (오류|error)): .*/, '$1'),
    ko: 'YAML 오류',
    en: 'YAML error',
  },
  {
    name: 'keyExists',
    run: () => message(() => renameFrontmatterKey('---\na: 1\nb: 2\n---\n본문', 'a', 'b')),
    ko: '이미 있는 키입니다: b',
    en: 'That key already exists: b',
  },
  // 기록
  { name: 'badHistoryName', run: () => message(() => readHistory(vault(), 'a.md', '../x')), ko: '잘못된 기록 이름입니다', en: 'Invalid history name' },
  // 블록 교체·링크 편집
  { name: 'blockMissing', run: () => message(() => replaceBlock(parseNote('# a\n\n본문\n'), 9, 'x')), ko: '블록 9 없음', en: 'Block 9 not found' },
  {
    name: 'overlappingEdit',
    run: () => message(() => applyEdits('abcdef', [{ start: 0, end: 3, text: 'x' }, { start: 2, end: 4, text: 'y' }])),
    ko: '겹치는 편집',
    en: 'Overlapping edits',
  },
];

describe('core 오류 문구의 언어', () => {
  it('던진 오류는 표시 시점 언어를 따른다(ko 로 던져 en 에서 표시)', () => {
    setLocale('ko');
    const err = (() => {
      try {
        addComment(vault(), 'a.md', { author: 'me', text: ' ' });
      } catch (e) {
        return e;
      }
      throw new Error('threw nothing');
    })();
    // 던질 때 문구를 만들지 않는다(코드만)
    expect((err as { message: string }).message).toBe('core.err.commentEmpty');
    setLocale('en');
    expect(errorText(err)).toBe('The comment is empty');
    setLocale('ko');
    expect(errorText(err)).toBe('댓글 내용이 비어 있어요');
    setLocale('en');
    expect(errorText(new PathEscapeError('../x'))).toBe('Path outside the vault: ../x');
    setLocale('ko');
    expect(errorText(new PathEscapeError('../x'))).toBe('볼트 밖으로 벗어나는 경로: ../x');
  });

  it('ko 는 base 와 같고 en 에는 한글이 없다', () => {
    for (const c of CASES) {
      setLocale('ko');
      expect(c.run()).toBe(c.ko);
      setLocale('en');
      const en = c.run();
      expect(en).not.toMatch(HANGUL);
      expect(en).not.toMatch(/\{\}/);
      expect(en).toBe(c.en);
    }
  });

  it('dbview 펜스 오류도 언어를 따른다(반환값 경로)', () => {
    setLocale('ko');
    const ko = parseDbEmbed('- a');
    expect(ko).toMatchObject({ ok: false, error: '`db: 이름` 형태로 써 주세요' });
    setLocale('en');
    const en = parseDbEmbed('- a');
    expect(en.ok).toBe(false);
    if (!en.ok) {
      expect(en.error).not.toMatch(HANGUL);
      expect(en.error).toBe('Write it as `db: name`');
    }
    const en2 = parseDbEmbed('view: x');
    expect(en2.ok).toBe(false);
    if (!en2.ok) expect(en2.error).toBe('Write a database name after `db:`');
  });

  it('CSV 값을 읽지 못한 줄도 지금 언어로 남는다', () => {
    setLocale('en');
    const enCols = guessColumns([['Title', 'Score'], ['a', '3']]);
    const rows = csvToRows([['Title', 'Score'], ['a', 'not-a-number']], enCols);
    const text = rows[0]!.issues[0]!;
    expect(text).toContain('unreadable value');
    expect(text).not.toMatch(HANGUL);
    setLocale('ko');
    const koCols = guessColumns([['Title', 'Score'], ['a', '3']]);
    const koRows = csvToRows([['Title', 'Score'], ['a', 'not-a-number']], koCols);
    expect(koRows[0]!.issues[0]).toContain("1행");
    expect(koRows[0]!.issues[0]).toContain("읽을 수 없는 값 'not-a-number'");
  });

  it('스키마 이슈는 코드+params 도 함께 남겨 화면이 표시 시점에 번역한다', () => {
    setLocale('ko');
    const ko = parseDbSchema('version: 1\nproperties:\n  title: { type: text }\n');
    const koIssue = ko.issues.find((i) => i.path === 'properties.title')!;
    expect(koIssue).toMatchObject({ key: 'db.issue.reservedTitle' });
    expect(koIssue.message).toBe('`title` 은 노트 제목에 쓰는 예약어라 속성 이름으로 쓸 수 없어요');

    // 코드로 다시 만들면 그때 언어를 따른다(저장된 message 가 아니라 key 를 쓴다)
    setLocale('en');
    const en = parseDbSchema('version: 1\nproperties:\n  title: { type: text }\n');
    const enIssue = en.issues.find((i) => i.path === 'properties.title')!;
    expect(enIssue.message).not.toMatch(HANGUL);
    expect(enIssue.message).toBe('`title` is reserved for the note title, so it cannot be a property name');
  });
});
