import { setLocale, type Locale } from '@nopsidian/i18n';
import type { AppLanguage, LanguageSetting } from '@nopsidian/ipc-contract';

/** main 이 들고 있는 언어 설정의 렌더러 사본. 여러 창이 같은 값을 본다. */
let current: AppLanguage = { setting: 'system', locale: 'ko', writerMode: false, writerSpacing: 'include', writerDailyGoal: null, writerFont: 'sans', writerTypewriter: true, writerPaperCount: false };
const listeners = new Set<() => void>();

export function getLanguage(): AppLanguage {
  return current;
}

export function subscribeLanguage(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function apply(next: AppLanguage): void {
  current = next;
  applyLocale(next.locale);
  for (const listener of [...listeners]) listener();
}

/** i18n 모듈과 <html lang> 을 함께 맞춘다(스크린리더·맞춤법·폰트 선택이 따라간다). */
function applyLocale(locale: Locale): void {
  setLocale(locale);
  document.documentElement.lang = locale;
}

/** 시작할 때 한 번: main 에서 설정과 시스템 판정을 받아 첫 렌더 전에 언어를 정한다. */
export async function initLanguage(): Promise<void> {
  try {
    apply(await window.nops.settings.language());
  } catch {
    // IPC 가 없거나 실패해도 앱은 한국어로 뜬다(설정 하나 때문에 흰 화면을 만들지 않는다).
    applyLocale(current.locale);
  }
}

/**
 * 설정에서 언어를 바꾼다. main 이 저장·브로드캐스트하고, 돌아온 값으로 즉시 전환한다.
 * 저장에 실패하면 그대로 던져서 설정 화면이 오류를 보여 주고 라디오는 이전 값에 머문다.
 */
export async function changeLanguage(language: LanguageSetting): Promise<void> {
  apply(await window.nops.settings.setLanguage({ language }));
}

/**
 * 작가 모드 설정만 바꾼다(언어는 그대로). main 이 저장·브로드캐스트하고 돌아온 값으로 즉시 반영한다.
 * 저장에 실패하면 그대로 던져 설정 화면이 이전 값을 유지한다.
 */
export async function changeWriterSettings(next: { mode?: boolean; spacing?: 'include' | 'exclude'; dailyGoal?: number | null; font?: 'sans' | 'serif' | 'mono'; typewriter?: boolean; paperCount?: boolean }): Promise<void> {
  apply(
    await window.nops.settings.setLanguage({
      ...(next.mode === undefined ? {} : { writerMode: next.mode }),
      ...(next.spacing === undefined ? {} : { writerSpacing: next.spacing }),
      ...(next.dailyGoal === undefined ? {} : { writerDailyGoal: next.dailyGoal }),
      ...(next.font === undefined ? {} : { writerFont: next.font }),
      ...(next.typewriter === undefined ? {} : { writerTypewriter: next.typewriter }),
      ...(next.paperCount === undefined ? {} : { writerPaperCount: next.paperCount }),
    }),
  );
}

/** 다른 창에서 바꾼 언어를 따라간다. 반환값은 구독 해제. */
export function watchLanguage(): () => void {
  return window.nops.on('language.changed', (payload) => apply(payload as AppLanguage));
}
