import { CodedError } from '@nopsidian/core';
import { planRename } from '../main/rename';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setLocale } from '@nopsidian/i18n';
import { afterEach, describe, expect, it } from 'vitest';
import { renameFailureText } from './rename-error';

const HANGUL = /[\u3131-\u318e\uac00-\ud7a3]/;
afterEach(() => setLocale('ko'));

describe('renameFailureText', () => {
  it('실제 renamePlan 충돌 경로에서 ko/en 모두 새 안내 문구가 나온다', () => {
    // 볼트에 a.md · b.md 를 만들고 a.md → b.md 로 이름을 바꾼다(실제 throw 경로).
    const root = mkdtempSync(path.join(tmpdir(), 'nops-rename-collision-'));
    try {
      writeFileSync(path.join(root, 'a.md'), '# a\n');
      writeFileSync(path.join(root, 'b.md'), '# b\n');
      const thrown = (): unknown => {
        try {
          planRename(root, { notes: [], assets: [] }, 'a.md', 'b.md');
        } catch (e) {
          return e;
        }
        throw new Error('충돌인데 던지지 않았다');
      };

      setLocale('ko');
      const koErr = thrown();
      expect((koErr as { key?: string }).key).toBe('main.err.pathExists');
      expect(renameFailureText(koErr, false, 'b.md')).toBe('이미 있는 이름이에요: b');

      setLocale('en');
      const enErr = thrown();
      const en = renameFailureText(enErr, false, 'b.md');
      expect(en).toBe('That name is already taken: b');
      expect(en).not.toMatch(HANGUL);
      expect(en).not.toMatch(/\{\w+\}/);
      setLocale('ko');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('그 밖의 실패·자동 이름 동기화 실패는 기존 문구를 쓴다', () => {
    setLocale('en');
    expect(renameFailureText(new CodedError('core.err.keyExists', { key: 'x' }), false)).toMatch(/^Couldn't rename: That key already exists: x$/);
    expect(renameFailureText(new Error('boom'), true)).toMatch(/left as is/);
  });
});
