import { describe, expect, it } from 'vitest';
import { moveSettingsPage, resolveSettingsPage, settingsPages } from './settings-pages';

const ids = (writerOn: boolean) => settingsPages(writerOn).map((page) => page.id);

describe('설정 목록 구성', () => {
  it('작가 모드가 켜져 있을 때만 [작가 모드] 페이지가 목록에 있다', () => {
    expect(ids(true)).toEqual(['general', 'editing', 'appearance', 'writer', 'sync', 'shortcuts', 'advanced']);
    expect(ids(false)).toEqual(['general', 'editing', 'appearance', 'sync', 'shortcuts', 'advanced']);
  });

  it('작가 모드를 끄면 열려 있던 [작가 모드] 페이지는 [일반]으로 돌아간다', () => {
    expect(resolveSettingsPage('writer', false)).toBe('general');
    expect(resolveSettingsPage('writer', true)).toBe('writer');
    expect(resolveSettingsPage('appearance', false)).toBe('appearance');
  });
});

describe('목록 키보드 이동', () => {
  const pages = settingsPages(true);

  it('↑↓ 은 목록을 돌고 Home/End 는 처음·끝', () => {
    expect(moveSettingsPage(pages, 'general', 'ArrowDown')).toBe('editing');
    expect(moveSettingsPage(pages, 'advanced', 'ArrowDown')).toBe('general');
    expect(moveSettingsPage(pages, 'general', 'ArrowUp')).toBe('advanced');
    expect(moveSettingsPage(pages, 'appearance', 'Home')).toBe('general');
    expect(moveSettingsPage(pages, 'general', 'End')).toBe('advanced');
  });

  it('작가 모드가 꺼진 목록에서는 [작가 모드]를 건너뛴다', () => {
    const off = settingsPages(false);
    expect(moveSettingsPage(off, 'appearance', 'ArrowDown')).toBe('sync');
  });

  it('이동 키가 아니면 페이지를 바꾸지 않는다', () => {
    expect(moveSettingsPage(pages, 'appearance', 'Enter')).toBe('appearance');
  });
});
