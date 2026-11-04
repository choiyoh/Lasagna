import { setLocale, type Locale } from '@nopsidian/i18n';
import type { AppLanguage, LanguageSetting } from '@nopsidian/ipc-contract';

/** main 이 들고 있는 언어 설정의 렌더러 사본. 여러 창이 같은 값을 본다. */
let current: AppLanguage = { setting: 'system', locale: 'ko' };
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

/** 설정에서 언어를 바꾼다. main 이 저장·브로드캐스트하고, 돌아온 값으로 즉시 전환한다. */
export async function changeLanguage(language: LanguageSetting): Promise<void> {
  try {
    apply(await window.nops.settings.setLanguage({ language }));
  } catch {
    // 저장에 실패하면 이전 언어를 그대로 둔다.
  }
}

/** 다른 창에서 바꾼 언어를 따라간다. 반환값은 구독 해제. */
export function watchLanguage(): () => void {
  return window.nops.on('language.changed', (payload) => apply(payload as AppLanguage));
}
