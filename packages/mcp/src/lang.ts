import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { resolveLocale, setLocale, type Locale } from '@nopsidian/i18n';

/** 앱이 쓰는 userData 폴더 이름(패키징된 앱의 productName). 테스트는 NOPSIDIAN_APP_NAME 으로 바꾼다. */
const APP_NAME = () => process.env.NOPSIDIAN_APP_NAME ?? 'Lasagna';

/** 앱 설정 파일 후보 경로 — 앱이 쓰는 userData 규칙과 같게 계산한다(읽기 전용, 쓰지 않는다). */
export function settingsPaths(platform = process.platform, home = homedir(), env = process.env): string[] {
  const name = APP_NAME();
  if (platform === 'darwin') return [path.join(home, 'Library', 'Application Support', name, 'app-settings.json')];
  if (platform === 'win32') return [path.join(env.APPDATA ?? path.join(home, 'AppData', 'Roaming'), name, 'app-settings.json')];
  return [path.join(env.XDG_CONFIG_HOME ?? path.join(home, '.config'), name, 'app-settings.json')];
}

/** 설정 파일에서 언어 설정만 읽는다. 없거나 깨졌으면 null(조용히 폴백). */
export function readSettingsLanguage(paths: readonly string[]): 'system' | 'ko' | 'en' | null {
  for (const file of paths) {
    try {
      if (!existsSync(file)) continue;
      const data = JSON.parse(readFileSync(file, 'utf8')) as { version?: unknown; language?: unknown };
      if (data.version !== 1) continue;
      if (data.language === 'system' || data.language === 'ko' || data.language === 'en') return data.language;
    } catch {
      // 깨진 파일은 무시하고 다음 후보로
    }
  }
  return null;
}

/**
 * MCP 서버의 언어 결정 순서(승인된 설계):
 * `NOPSIDIAN_LANG`(ko|en) → 앱 설정 파일(읽기 전용) → OS 로캘 → ko.
 * 스니펫·명령 형식은 바꾸지 않는다(`--lang` 없음).
 */
export function resolveServerLocale(opts: {
  env?: NodeJS.ProcessEnv;
  paths?: readonly string[];
  systemLanguages?: readonly string[];
  platform?: NodeJS.Platform;
} = {}): Locale {
  const env = opts.env ?? process.env;
  const forced = env.NOPSIDIAN_LANG?.trim().toLowerCase();
  if (forced === 'ko' || forced === 'en') return forced;
  const setting = readSettingsLanguage(opts.paths ?? settingsPaths(opts.platform, undefined, env));
  const system = opts.systemLanguages ?? (env.LANG ? [env.LANG] : []);
  if (setting !== null) return resolveLocale(setting, system);
  const first = (system[0] ?? '').toLowerCase();
  return first.startsWith('ko') ? 'ko' : first ? 'en' : 'ko';
}

/** 시작 시 한 번 적용한다. 반환값은 적용한 로캘(테스트·로그용). */
export function applyServerLocale(opts: Parameters<typeof resolveServerLocale>[0] = {}): Locale {
  const locale = resolveServerLocale(opts);
  setLocale(locale);
  return locale;
}
