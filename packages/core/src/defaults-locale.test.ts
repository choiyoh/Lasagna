import { afterEach, describe, expect, it } from 'vitest';
import { setLocale } from '@nopsidian/i18n';
import { csvToRows, guessColumns } from './db/csv.js';
import { defaultSchema } from './db/schema.js';
import { newDbYaml } from './db/yaml-edit.js';
import { parseDbSchema } from './db/schema.js';
import { conflictCopyPath } from './save.js';
import { formatDate, expandTemplate } from './templates.js';

afterEach(() => setLocale('ko'));

describe('data defaults follow the app language when they are created', () => {
  it('names empty CSV columns and untitled rows', () => {
    setLocale('ko');
    expect(guessColumns([['', 'Score'], ['a', '1']])[0]!.name).toBe('열1');
    const koRows = csvToRows([['Name'], ['']], guessColumns([['Name'], ['']]));
    expect(koRows[0]!.title).toBe('제목 없음 1');

    setLocale('en');
    expect(guessColumns([['', 'Score'], ['a', '1']])[0]!.name).toBe('Column 1');
    const enRows = csvToRows([['Name'], ['']], guessColumns([['Name'], ['']]));
    expect(enRows[0]!.title).toBe('Untitled 1');
  });

  it('names a new database view', () => {
    setLocale('ko');
    expect(defaultSchema('x').views[0]!.name).toBe('표');
    expect(parseDbSchema(newDbYaml('x')).schema.views[0]!.name).toBe('표');
    setLocale('en');
    expect(defaultSchema('x').views[0]!.name).toBe('Table');
    expect(parseDbSchema(newDbYaml('x')).schema.views[0]!.name).toBe('Table');
  });

  it('names a conflict copy', () => {
    const now = new Date(Date.UTC(2026, 10, 5));
    setLocale('ko');
    expect(conflictCopyPath('/v/Note.md', now)).toBe('/v/Note (충돌 2026-11-05).md');
    setLocale('en');
    expect(conflictCopyPath('/v/Note.md', now)).toBe('/v/Note (conflict 2026-11-05).md');
  });

  it('expands template weekdays in the app language', () => {
    const now = new Date(2024, 0, 1); // 월요일
    const ctx = { now, title: 'x' };
    setLocale('ko');
    expect(formatDate(now, 'dddd ddd')).toBe('월요일 월');
    expect(expandTemplate('{{date:dddd}}', ctx)).toBe('월요일');
    setLocale('en');
    expect(formatDate(now, 'dddd ddd')).toBe('Monday Mon');
    expect(expandTemplate('{{date:dddd}}', ctx)).toBe('Monday');
  });
});
