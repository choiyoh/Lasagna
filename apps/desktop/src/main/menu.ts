import type { MenuItemConstructorOptions } from 'electron';
import { t } from '@nopsidian/i18n';

/** macOS 는 Electron 기본 메뉴(앱·편집 메뉴)를 그대로 쓴다. Windows·Linux 만 앱 메뉴를 숨긴다. */
export function hidesMenuBar(platform: NodeJS.Platform): boolean {
  return platform !== 'darwin';
}

/**
 * Windows·Linux 용 최소 메뉴. 메뉴바는 숨기지만(autoHideMenuBar) 복사·붙여넣기·실행 취소 role 은 살아 있어야
 * 입력창 단축키가 동작한다. 패키징 빌드에는 reload·개발자 도구를 넣지 않는다(앱 단축키와 충돌 방지).
 * macOS 는 null — Electron 기본 메뉴를 건드리지 않는다.
 */
export function buildMenuTemplate(platform: NodeJS.Platform, packaged: boolean): MenuItemConstructorOptions[] | null {
  if (platform === 'darwin') return null;
  const edit: MenuItemConstructorOptions = {
    label: t('menu.edit'),
    submenu: [
      { role: 'undo' },
      { role: 'redo' },
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      { role: 'selectAll' },
    ],
  };
  if (packaged) return [edit];
  // 개발 빌드에서만 reload·개발자 도구(패키징 산출물에는 accelerator 가 남지 않는다).
  return [edit, { label: t('menu.view'), submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }] }];
}
