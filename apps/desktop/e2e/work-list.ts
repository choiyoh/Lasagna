import { expect, type Locator, type Page } from '@playwright/test';

/**
 * 작품 목록(UX-1b)에서 이름으로 작품을 찾아, 이름 한 줄로 접혀 있으면 펼친 뒤 열린 작품 블록을 돌려준다.
 * 열린 작품 블록에만 회차·목표·칩·`⋯` 버튼이 있다.
 */
export async function workCard(page: Page, name: string): Promise<Locator> {
  const section = page.getByTestId('work-section');
  await expect(section).toBeVisible({ timeout: 15_000 });
  const card = page.locator(`[data-testid="work-card"][data-work="${name}"]`);
  const row = page.locator(`[data-testid="work-row"][data-work="${name}"]`);
  await expect(card.or(row).first()).toBeVisible({ timeout: 15_000 });
  if ((await card.count()) === 0) {
    await row.first().click();
    await expect(card).toBeVisible();
  }
  return card;
}

/** 열린 작품의 `⋯` 메뉴에서 항목을 고른다(예: '+ 새 캐릭터', '설정집 폴더 열기'). */
export async function workMenuItem(page: Page, item: string): Promise<void> {
  await page.getByTestId('work-more').click();
  await page.getByRole('menuitem', { name: item }).click();
}
