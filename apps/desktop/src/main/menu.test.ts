import { beforeEach, describe, expect, it } from 'vitest';
import { setLocale } from '@nopsidian/i18n';
import { buildMenuTemplate, hidesMenuBar } from './menu';

const roles = (platform: NodeJS.Platform, packaged: boolean) => {
  const tpl = buildMenuTemplate(platform, packaged) ?? [];
  return tpl.flatMap((m) => (Array.isArray(m.submenu) ? m.submenu.map((s) => s.role).filter(Boolean) : []));
};

describe('Windows/Linux 메뉴', () => {
  beforeEach(() => setLocale('ko'));

  it('win32 는 편집 role 을 유지하고 메뉴바를 숨긴다', () => {
    expect(hidesMenuBar('win32')).toBe(true);
    expect(roles('win32', true)).toEqual(['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll']);
  });

  it('패키징 빌드에는 reload·개발자 도구가 없다(개발 빌드에는 있다)', () => {
    expect(roles('win32', true)).not.toContain('reload');
    expect(roles('win32', true)).not.toContain('toggleDevTools');
    expect(roles('win32', false)).toContain('reload');
    expect(roles('win32', false)).toContain('toggleDevTools');
  });

  it('macOS 는 기존 Electron 기본 메뉴를 그대로 두고 메뉴바를 숨기지 않는다', () => {
    expect(hidesMenuBar('darwin')).toBe(false);
    expect(buildMenuTemplate('darwin', true)).toBeNull();
    expect(buildMenuTemplate('darwin', false)).toBeNull();
  });
});
