import type { ComponentType } from 'react';
import type { MessageKey } from '@nopsidian/i18n';
import { ThemeMonitorIcon, ThemeMoonIcon, ThemeSunIcon } from './icons';

export type ThemeChoice = 'system' | 'light' | 'dark';

const KEY = 'nops.theme';

export function loadTheme(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

/** 문서 루트의 `data-theme` 을 바꾼다. 앱 CSS 와 에디터(업스트림)의 `[data-theme]` 토큰이 같이 따라간다. */
export function applyTheme(choice: ThemeChoice): void {
  document.documentElement.dataset.theme = choice;
  try {
    localStorage.setItem(KEY, choice);
  } catch {
    /* 저장 못 해도 이번 실행에는 적용된다 */
  }
  window.dispatchEvent(new CustomEvent('nops:theme', { detail: choice }));
}

export const nextTheme = (c: ThemeChoice): ThemeChoice => (c === 'system' ? 'light' : c === 'light' ? 'dark' : 'system');
/** 설정 라디오·푸터 버튼이 쓰는 메시지 키(표시 언어에 따라 번역된다). */
export const THEME_KEY: Record<ThemeChoice, MessageKey> = { system: 'theme.system', light: 'theme.light', dark: 'theme.dark' };
export const THEME_ICON: Record<ThemeChoice, ComponentType<{ size?: number }>> = {
  system: ThemeMonitorIcon,
  light: ThemeSunIcon,
  dark: ThemeMoonIcon,
};
