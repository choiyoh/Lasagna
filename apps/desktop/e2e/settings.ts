import { expect, type Page } from '@playwright/test';

/** 설정 페이지 이름(한/영) → 목록 testid 조각 */
const PAGE_IDS: Record<string, string> = {
  일반: 'general',
  편집: 'editing',
  외형: 'appearance',
  '작가 모드': 'writer',
  동기화: 'sync',
  단축키: 'shortcuts',
  '연결·고급': 'advanced',
  General: 'general',
  Editing: 'editing',
  Appearance: 'appearance',
  'Writer mode': 'writer',
  Sync: 'sync',
  Shortcuts: 'shortcuts',
  'Connections & advanced': 'advanced',
};

/** 설정을 연다(이미 열려 있으면 그대로 둔다). */
export async function openSettings(page: Page): Promise<void> {
  const dialog = page.getByRole('dialog', { name: /^(설정|Settings)$/ });
  if ((await dialog.count()) === 0) await page.getByTestId('settings-btn').click();
  await expect(dialog).toBeVisible();
}

/** 열려 있는 설정에서 왼쪽 목록의 페이지를 고른다. */
export async function selectSettingsPage(page: Page, name: string): Promise<void> {
  const id = PAGE_IDS[name] ?? name;
  await page.getByTestId(`settings-tab-${id}`).click();
  await expect(page.getByTestId(`settings-tab-${id}`)).toHaveAttribute('aria-selected', 'true');
}

/** 설정을 열고 페이지까지 고른다. */
export async function openSettingsPage(page: Page, name: string): Promise<void> {
  await openSettings(page);
  await selectSettingsPage(page, name);
}
