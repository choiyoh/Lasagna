import type { LanguageSetting } from '@nopsidian/i18n';
import { atomicWrite } from '@nopsidian/core';
import { readFileSync } from 'node:fs';

/** 글자수 기준(작가 모드) — 공백 포함/제외 */
export type WriterSpacing = 'include' | 'exclude';
/** 집중 모드 본문 글꼴 — 시스템 글꼴만 */
export type WriterFont = 'sans' | 'serif' | 'mono';

/** userData/app-settings.json — 앱 전체 설정(언어 + 작가 모드). 새 필드는 선택이라 예전 파일도 그대로 읽힌다. */
export interface AppSettings {
  version: 1;
  language: LanguageSetting;
  /** 작가 모드(글자수 상태줄). 기본 꺼짐 */
  writerMode?: boolean;
  /** 글자수 기준. 기본 공백 포함(잠정) */
  writerSpacing?: WriterSpacing;
  /** 일일 목표 글자수(작가 모드 전역). 없거나 0 이하면 목표 없음 */
  writerDailyGoal?: number | null;
  /** 집중 모드 본문 글꼴(기본 본고딕) */
  writerFont?: WriterFont;
  /** 집중 모드 타자기 스크롤(기본 켜짐) */
  writerTypewriter?: boolean;
}

export const DEFAULT_APP_SETTINGS: AppSettings = { version: 1, language: 'system', writerMode: false, writerSpacing: 'include', writerDailyGoal: null, writerFont: 'sans', writerTypewriter: true };
const WRITER_SPACINGS: readonly WriterSpacing[] = ['include', 'exclude'];
const WRITER_FONTS: readonly WriterFont[] = ['sans', 'serif', 'mono'];

const LANGUAGES: readonly LanguageSetting[] = ['system', 'ko', 'en'];

/** 손상·구버전 파일은 기본값으로 읽는다(앱이 설정 때문에 뜨지 않으면 안 된다). */
export function parseAppSettings(raw: string): AppSettings {
  try {
    const data = JSON.parse(raw) as { version?: unknown; language?: unknown } | null;
    if (!data || data.version !== 1) return DEFAULT_APP_SETTINGS;
    if (typeof data.language !== 'string' || !LANGUAGES.includes(data.language as LanguageSetting)) {
      return DEFAULT_APP_SETTINGS;
    }
    // 작가 모드 필드는 선택 — 없거나 이상하면 기본값(꺼짐·공백 포함)으로 읽는다.
    const rawWriter = data as { writerMode?: unknown; writerSpacing?: unknown; writerDailyGoal?: unknown; writerFont?: unknown; writerTypewriter?: unknown };
    const writerMode = typeof rawWriter.writerMode === 'boolean' ? rawWriter.writerMode : false;
    const writerSpacing = WRITER_SPACINGS.includes(rawWriter.writerSpacing as WriterSpacing)
      ? (rawWriter.writerSpacing as WriterSpacing)
      : 'include';
    const goal = rawWriter.writerDailyGoal;
    const writerDailyGoal = typeof goal === 'number' && Number.isFinite(goal) && goal > 0 ? Math.floor(goal) : null;
    const writerFont = WRITER_FONTS.includes(rawWriter.writerFont as WriterFont) ? (rawWriter.writerFont as WriterFont) : 'sans';
    const writerTypewriter = typeof rawWriter.writerTypewriter === 'boolean' ? rawWriter.writerTypewriter : true;
    return { version: 1, language: data.language as LanguageSetting, writerMode, writerSpacing, writerDailyGoal, writerFont, writerTypewriter };
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
    const next: AppSettings = { ...this.current, language };
    // 먼저 디스크에 쓴다. 실패하면 던지고 메모리 값은 그대로다(호출자가 오류를 화면에 보여 준다).
    writeAppSettings(this.file, next);
    this.current = next;
    return next;
  }

  /** 작가 모드 설정 — 준 값만 바꾸고 나머지는 그대로 둔다. */
  setWriter(next: { mode?: boolean; spacing?: WriterSpacing; dailyGoal?: number | null; font?: WriterFont; typewriter?: boolean }): AppSettings {
    const merged: AppSettings = {
      ...this.current,
      ...(next.mode === undefined ? {} : { writerMode: next.mode }),
      ...(next.spacing === undefined ? {} : { writerSpacing: next.spacing }),
      ...(next.dailyGoal === undefined ? {} : { writerDailyGoal: next.dailyGoal === null || next.dailyGoal <= 0 ? null : Math.floor(next.dailyGoal) }),
      ...(next.font === undefined ? {} : { writerFont: next.font }),
      ...(next.typewriter === undefined ? {} : { writerTypewriter: next.typewriter }),
    };
    writeAppSettings(this.file, merged);
    this.current = merged;
    return merged;
  }
}
