import type { LanguageSetting } from '@nopsidian/i18n';
import { atomicWrite } from '@nopsidian/core';
import { readFileSync } from 'node:fs';

/** userData/app-settings.json — 앱 전체 설정. 지금은 언어만 있다. */
export interface AppSettings {
  version: 1;
  language: LanguageSetting;
}

export const DEFAULT_APP_SETTINGS: AppSettings = { version: 1, language: 'system' };

const LANGUAGES: readonly LanguageSetting[] = ['system', 'ko', 'en'];

/** 손상·구버전 파일은 기본값으로 읽는다(앱이 설정 때문에 뜨지 않으면 안 된다). */
export function parseAppSettings(raw: string): AppSettings {
  try {
    const data = JSON.parse(raw) as { version?: unknown; language?: unknown } | null;
    if (!data || data.version !== 1) return DEFAULT_APP_SETTINGS;
    if (typeof data.language !== 'string' || !LANGUAGES.includes(data.language as LanguageSetting)) {
      return DEFAULT_APP_SETTINGS;
    }
    return { version: 1, language: data.language as LanguageSetting };
  } catch {
    return DEFAULT_APP_SETTINGS;
  }
}

export function readAppSettings(file: string): AppSettings {
  try {
    return parseAppSettings(readFileSync(file, 'utf8'));
  } catch {
    return DEFAULT_APP_SETTINGS;
  }
}

/** 반쯤 쓰인 파일을 남기지 않도록 임시 파일에 쓰고 이름을 바꾼다. */
export function writeAppSettings(file: string, settings: AppSettings): void {
  atomicWrite(file, `${JSON.stringify(settings, null, 2)}\n`);
}

/** 언어를 바꿀 때 디스크와 메모리가 어긋나지 않게 한 곳에서 쓴다. 쓰기 실패는 던지고 이전 값을 지킨다. */
export class AppSettingsStore {
  private current: AppSettings;
  constructor(
    private readonly file: string,
    initial: AppSettings = DEFAULT_APP_SETTINGS,
  ) {
    this.current = initial;
  }

  get value(): AppSettings {
    return this.current;
  }

  setLanguage(language: LanguageSetting): AppSettings {
    const next: AppSettings = { version: 1, language };
    // 먼저 디스크에 쓴다. 실패하면 던지고 메모리 값은 그대로다(호출자가 오류를 화면에 보여 준다).
    writeAppSettings(this.file, next);
    this.current = next;
    return next;
  }
}
