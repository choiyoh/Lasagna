import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { setLocale, type Locale } from '@nopsidian/i18n';

/** 앱이 쓰는 userData 폴더 이름. 예전 이름(Nopsidian)으로 쓰인 설정도 함께 본다(읽기 전용). */
const APP_NAMES = (): string[] => (process.env.NOPSIDIAN_APP_NAME ? [process.env.NOPSIDIAN_APP_NAME] : ['Lasagna', 'Nopsidian']);

/** 앱 설정 파일 후보 경로 — 앱이 쓰는 userData 규칙과 같게 계산한다(읽기 전용, 쓰지 않는다). */
export function settingsPaths(platform = process.platform, home = homedir(), env = process.env): string[] {
  const bases =
    platform === 'darwin'
      ? [path.join(home, 'Library', 'Application Support')]
      : platform === 'win32'
        ? [env.APPDATA ?? path.join(home, 'AppData', 'Roaming')]
        : [env.XDG_CONFIG_HOME ?? path.join(home, '.config')];
  // 새 이름(Lasagna) 경로를 먼저, 예전 이름(Nopsidian) 경로를 다음에 — 없으면 다음 후보를 본다.
  return APP_NAMES().flatMap((name) => bases.map((base) => path.join(base, name, 'app-settings.json')));
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
  const system = opts.systemLanguages ?? osLanguages(env);
  // 설정이 ko/en 이면 그대로, 'system' 이면 OS 로캘의 **명시적** 언어만 따른다.
  if (setting === 'ko' || setting === 'en') return setting;
  // OS 로캘에 언어 정보가 없으면(C/POSIX/빈 값) en-US 로 떨어뜨리지 않고 ko 로 둔다.
  const first = (system[0] ?? '').toLowerCase();
  return first.startsWith('ko') ? 'ko' : first.startsWith('en') ? 'en' : 'ko';
}

/**
 * OS 로캘 환경변수에서 **명시적 언어**만 고른다(우선순위 LC_ALL → LC_MESSAGES → LANG).
 * 'C'·'POSIX'·빈 값은 언어 정보가 아니므로 버린다 — 그럴 때 서버는 ko 로 둔다.
 */
export function osLanguages(env: NodeJS.ProcessEnv = process.env): string[] {
  for (const name of ['LC_ALL', 'LC_MESSAGES', 'LANG'] as const) {
    const value = env[name]?.trim();
    if (!value) continue;
    const tag = value.split('.')[0]!.split('@')[0]!;
    if (!tag || tag === 'C' || tag === 'POSIX') continue;
    if (/^[A-Za-z]{2,3}([_-][A-Za-z0-9]+)*$/.test(tag)) return [tag.replace('_', '-')];
  }
  return [];
}

/** 시작 시 한 번 적용한다. 반환값은 적용한 로캘(테스트·로그용). */
export function applyServerLocale(opts: Parameters<typeof resolveServerLocale>[0] = {}): Locale {
  const locale = resolveServerLocale(opts);
  setLocale(locale);
  return locale;
}
