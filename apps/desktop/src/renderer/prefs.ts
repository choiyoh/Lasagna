/** 기기별 화면·편집 설정(localStorage). 볼트에는 쓰지 않는다. */
export interface Prefs {
  /** 본문 글자 크기(px) */
  fontSize: number;
  /** 본문 너비 */
  width: 'normal' | 'wide' | 'full';
  /** 제목(첫 H1)을 바꾸면 파일 이름도 맞춘다 */
  titleSync: boolean;
}

export const DEFAULT_PREFS: Prefs = { fontSize: 16, width: 'normal', titleSync: true };
export const FONT_SIZES = [14, 15, 16, 17, 18, 20] as const;
const KEY = 'nops.prefs';

export function loadPrefs(): Prefs {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Prefs>;
    return {
      fontSize: typeof raw.fontSize === 'number' && raw.fontSize >= 12 && raw.fontSize <= 24 ? raw.fontSize : DEFAULT_PREFS.fontSize,
      width: raw.width === 'wide' || raw.width === 'full' ? raw.width : 'normal',
      titleSync: raw.titleSync !== false,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

/** 문서 루트에 반영하고 저장한다 */
export function applyPrefs(p: Prefs, save = true): void {
  const root = document.documentElement;
  root.style.setProperty('--nops-font-size', `${p.fontSize}px`);
  root.dataset.width = p.width;
  if (!save) return;
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* 저장 못 해도 이번 실행에는 적용된다 */
  }
}
