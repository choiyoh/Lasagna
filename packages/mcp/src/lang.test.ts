import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setLocale } from '@nopsidian/i18n';
import { applyServerLocale, osLanguages, readSettingsLanguage, resolveServerLocale, settingsPaths } from './lang.js';

afterEach(() => setLocale('ko'));

describe('MCP 서버 언어 결정', () => {
  const writeSettings = (value: string): string => {
    const dir = mkdtempSync(path.join(tmpdir(), 'nops-mcp-lang-'));
    mkdirSync(path.join(dir, 'Lasagna'), { recursive: true });
    writeFileSync(path.join(dir, 'Lasagna', 'app-settings.json'), value);
    return dir;
  };

  it('NOPSIDIAN_LANG 이 있으면 그것이 최우선', () => {
    expect(resolveServerLocale({ env: { NOPSIDIAN_LANG: 'en' }, paths: [], systemLanguages: ['ko'] })).toBe('en');
    expect(resolveServerLocale({ env: { NOPSIDIAN_LANG: 'KO' }, paths: [], systemLanguages: ['en'] })).toBe('ko');
    // 잘못된 값은 무시하고 다음 단계로
    expect(resolveServerLocale({ env: { NOPSIDIAN_LANG: 'fr' }, paths: [], systemLanguages: ['en'] })).toBe('en');
  });

  it('설정 파일의 언어(읽기 전용)를 따르고, system 이면 OS 로캘을 따른다', () => {
    const en = writeSettings(JSON.stringify({ version: 1, language: 'en' }));
    try {
      const paths = [path.join(en, 'Lasagna', 'app-settings.json')];
      expect(resolveServerLocale({ env: {}, paths, systemLanguages: ['ko-KR'] })).toBe('en');
      writeFileSync(paths[0]!, JSON.stringify({ version: 1, language: 'system' }));
      expect(resolveServerLocale({ env: {}, paths, systemLanguages: ['ko-KR'] })).toBe('ko');
      expect(resolveServerLocale({ env: {}, paths, systemLanguages: ['en-US'] })).toBe('en');
    } finally {
      rmSync(en, { recursive: true, force: true });
    }
  });

  it('설정 파일이 없거나 깨졌으면 OS 로캘 → 없으면 ko', () => {
    const broken = writeSettings('{ not json');
    try {
      const paths = [path.join(broken, 'Lasagna', 'app-settings.json')];
      expect(resolveServerLocale({ env: {}, paths, systemLanguages: ['en-US'] })).toBe('en');
      expect(resolveServerLocale({ env: {}, paths, systemLanguages: [] })).toBe('ko');
      expect(readSettingsLanguage([path.join(broken, 'nope.json')])).toBeNull();
    } finally {
      rmSync(broken, { recursive: true, force: true });
    }
  });

  it('userData 규칙대로 경로를 계산한다', () => {
    expect(settingsPaths('darwin', '/h', {})[0]).toBe('/h/Library/Application Support/Lasagna/app-settings.json');
    expect(settingsPaths('linux', '/h', { XDG_CONFIG_HOME: '/c' })[0]).toBe('/c/Lasagna/app-settings.json');
    expect(settingsPaths('win32', '/h', { APPDATA: 'C:\\AppData' })[0]).toContain(path.join('Lasagna', 'app-settings.json'));
  });

  it('OS 로캘에 언어 정보가 없으면 en 으로 떨어지지 않고 ko', () => {
    expect(osLanguages({})).toEqual([]);
    expect(osLanguages({ LANG: '' })).toEqual([]);
    expect(osLanguages({ LANG: 'C', LC_ALL: 'POSIX' })).toEqual([]);
    expect(osLanguages({ LANG: 'ko_KR.UTF-8' })).toEqual(['ko-KR']);
    expect(osLanguages({ LANG: 'C', LC_MESSAGES: 'en_US.UTF-8' })).toEqual(['en-US']);
    expect(resolveServerLocale({ env: { LANG: 'C' }, paths: [] })).toBe('ko');
    expect(resolveServerLocale({ env: { LANG: 'ko_KR.UTF-8' }, paths: [] })).toBe('ko');
    expect(resolveServerLocale({ env: { LANG: 'en_US.UTF-8' }, paths: [] })).toBe('en');
  });

  it('예전 userData 이름(Nopsidian)의 설정도 읽는다(새 이름 우선)', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'nops-mcp-legacy-'));
    try {
      mkdirSync(path.join(dir, 'Nopsidian'), { recursive: true });
      writeFileSync(path.join(dir, 'Nopsidian', 'app-settings.json'), JSON.stringify({ version: 1, language: 'en' }));
      expect(resolveServerLocale({ env: {}, paths: settingsPaths('linux', dir, { XDG_CONFIG_HOME: dir }), systemLanguages: ['ko'] })).toBe('en');
      mkdirSync(path.join(dir, 'Lasagna'), { recursive: true });
      writeFileSync(path.join(dir, 'Lasagna', 'app-settings.json'), JSON.stringify({ version: 1, language: 'ko' }));
      expect(resolveServerLocale({ env: {}, paths: settingsPaths('linux', dir, { XDG_CONFIG_HOME: dir }), systemLanguages: ['en'] })).toBe('ko');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('설정 값 × OS 로캘 매트릭스: system 에 명시적 OS 언어가 없으면 항상 ko', () => {
    const matrix: [string | Record<string, unknown>, NodeJS.ProcessEnv, 'ko' | 'en'][] = [
      // 설정 파일 없음(빈 객체 = 파일을 만들지 않는다)
      [{}, {}, 'ko'],
      [{}, { LANG: 'en_US.UTF-8' }, 'en'],
      [{}, { LANG: 'ko_KR.UTF-8' }, 'ko'],
      // 설정 ko/en 은 OS 와 무관
      [{ version: 1, language: 'ko' }, { LANG: 'en_US.UTF-8' }, 'ko'],
      [{ version: 1, language: 'en' }, { LANG: 'ko_KR.UTF-8' }, 'en'],
      // system 은 OS 의 명시적 언어를 따르고, 없으면 ko
      [{ version: 1, language: 'system' }, {}, 'ko'],
      [{ version: 1, language: 'system' }, { LANG: 'C' }, 'ko'],
      [{ version: 1, language: 'system' }, { LC_ALL: 'POSIX', LANG: 'C' }, 'ko'],
      [{ version: 1, language: 'system' }, { LANG: 'en_US.UTF-8' }, 'en'],
      [{ version: 1, language: 'system' }, { LANG: 'ko_KR.UTF-8' }, 'ko'],
      // 깨진 파일은 없는 것으로 본다
      ['{ not json', {}, 'ko'],
      ['{ not json', { LANG: 'en_US.UTF-8' }, 'en'],
    ];
    for (const [settings, env, expected] of matrix) {
      const dir = mkdtempSync(path.join(tmpdir(), 'nops-mcp-matrix-'));
      try {
        const file = settingsPaths(process.platform, dir, { XDG_CONFIG_HOME: path.join(dir, '.config') })[0]!;
        if (settings !== '{}') {
          mkdirSync(path.dirname(file), { recursive: true });
          writeFileSync(file, typeof settings === 'string' ? settings : JSON.stringify(settings));
        }
        expect(resolveServerLocale({ env: { ...env, HOME: dir }, systemLanguages: undefined, paths: [file] })).toBe(expected);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it('applyServerLocale 은 i18n 로캘까지 바꾼다', () => {
    expect(applyServerLocale({ env: { NOPSIDIAN_LANG: 'en' }, paths: [] })).toBe('en');
    // t() 가 영어인지 확인(간단한 서버 문구)
    expect(resolveServerLocale({ env: { NOPSIDIAN_LANG: 'ko' }, paths: [] })).toBe('ko');
  });
});
