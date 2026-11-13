/** 설정 화면 왼쪽 목록의 페이지. 작가 모드 페이지는 켰을 때만 목록에 나타난다. */
export type SettingsPage = 'general' | 'editing' | 'appearance' | 'writer' | 'sync' | 'shortcuts' | 'advanced';

export interface SettingsPageSpec {
  id: SettingsPage;
  /** 700px 미만에서 목록이 아이콘만 남을 때 쓰는 글리프 */
  icon: string;
}

/** 시안의 목록 순서. 자동 백업 기능이 아직 없어 '동기화' 한 페이지만 둔다. */
const ALL_PAGES: readonly SettingsPageSpec[] = [
  { id: 'general', icon: '☰' },
  { id: 'editing', icon: '✎' },
  { id: 'appearance', icon: '◐' },
  { id: 'writer', icon: '✍' },
  { id: 'sync', icon: '☁' },
  { id: 'shortcuts', icon: '⌨' },
  { id: 'advanced', icon: '⚙' },
];

/** 작가 모드가 꺼져 있으면 [작가 모드] 페이지가 없는다. */
export function settingsPages(writerOn: boolean): SettingsPageSpec[] {
  return writerOn ? [...ALL_PAGES] : ALL_PAGES.filter((page) => page.id !== 'writer');
}

/** 작가 모드를 끄면 열려 있던 [작가 모드] 페이지는 [일반]으로 돌아간다. */
export function resolveSettingsPage(page: SettingsPage, writerOn: boolean): SettingsPage {
  return !writerOn && page === 'writer' ? 'general' : page;
}

/** 목록 키보드: ↑↓ 이동, Home/End 처음·끝. 다른 키는 그대로 돌려준다. */
export function moveSettingsPage(pages: readonly SettingsPageSpec[], current: SettingsPage, key: string): SettingsPage {
  const ids = pages.map((page) => page.id);
  const at = ids.indexOf(current);
  if (at < 0) return current;
  if (key === 'ArrowDown') return ids[(at + 1) % ids.length]!;
  if (key === 'ArrowUp') return ids[(at - 1 + ids.length) % ids.length]!;
  if (key === 'Home') return ids[0]!;
  if (key === 'End') return ids[ids.length - 1]!;
  return current;
}
