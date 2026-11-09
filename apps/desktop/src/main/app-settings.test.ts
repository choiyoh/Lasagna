import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AppSettingsStore, DEFAULT_APP_SETTINGS, parseAppSettings, readAppSettings, writeAppSettings } from './app-settings';

const dirs: string[] = [];
const tempDir = () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'nops-settings-'));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('parseAppSettings', () => {
  it('reads a stored language', () => {
    // 작가 모드 필드는 선택 — 없으면 꺼짐·공백 포함으로 읽는다(예전 파일 호환)
    expect(parseAppSettings('{"version":1,"language":"en"}')).toEqual({ version: 1, language: 'en', writerMode: false, writerSpacing: 'include', writerDailyGoal: null, writerFont: 'sans', writerTypewriter: true });
    expect(parseAppSettings('{"version":1,"language":"ko"}')).toEqual({ version: 1, language: 'ko', writerMode: false, writerSpacing: 'include', writerDailyGoal: null, writerFont: 'sans', writerTypewriter: true });
  });

  it('reads writer mode fields when present and repairs bad values', () => {
    expect(parseAppSettings('{"version":1,"language":"ko","writerMode":true,"writerSpacing":"exclude"}')).toEqual({
      version: 1,
      language: 'ko',
      writerMode: true,
      writerSpacing: 'exclude',
      writerDailyGoal: null,
      writerFont: 'sans',
      writerTypewriter: true,
    });
    expect(parseAppSettings('{"version":1,"language":"ko","writerMode":"yes","writerSpacing":"odd"}')).toEqual({
      version: 1,
      language: 'ko',
      writerMode: false,
      writerSpacing: 'include',
      writerDailyGoal: null,
      writerFont: 'sans',
      writerTypewriter: true,
    });
  });

  it('falls back to system for damaged, old, or unknown content', () => {
    for (const raw of ['', 'not json', 'null', '[]', '{"version":2,"language":"en"}', '{"version":1,"language":"fr"}', '{"language":"en"}']) {
      expect(parseAppSettings(raw)).toEqual(DEFAULT_APP_SETTINGS);
    }
  });
});

describe('readAppSettings / writeAppSettings', () => {
  it('round-trips through the file and survives a missing file', () => {
    const file = path.join(tempDir(), 'app-settings.json');
    expect(readAppSettings(file)).toEqual(DEFAULT_APP_SETTINGS);
    writeAppSettings(file, { version: 1, language: 'en' });
    expect(readAppSettings(file)).toEqual({ version: 1, language: 'en', writerMode: false, writerSpacing: 'include', writerDailyGoal: null, writerFont: 'sans', writerTypewriter: true });
    writeFileSync(file, '{ damaged');
    expect(readAppSettings(file)).toEqual(DEFAULT_APP_SETTINGS);
  });
});

describe('AppSettingsStore', () => {
  it('writes the new language and keeps the old one when the write fails', () => {
    const dir = tempDir();
    const file = path.join(dir, 'app-settings.json');
    const store = new AppSettingsStore(file, { version: 1, language: 'en' });
    expect(store.setLanguage('ko')).toEqual({ version: 1, language: 'ko' });
    expect(store.value).toEqual({ version: 1, language: 'ko' });
    expect(readAppSettings(file)).toEqual({ version: 1, language: 'ko', writerMode: false, writerSpacing: 'include', writerDailyGoal: null, writerFont: 'sans', writerTypewriter: true });

    // 파일 자리에 디렉터리를 두면 원자적 rename 이 실패한다 → 오류를 던지고 메모리 값은 그대로.
    rmSync(file);
    mkdirSync(file);
    expect(() => store.setLanguage('system')).toThrow();
    expect(store.value).toEqual({ version: 1, language: 'ko' });
  });
});

describe('작가 모드 설정', () => {
  it('준 값만 바꾸고 언어·나머지 필드는 그대로 둔다(원자적 저장)', () => {
    const file = path.join(tempDir(), 'app-settings.json');
    const store = new AppSettingsStore(file, { version: 1, language: 'ko' });
    store.setWriter({ mode: true });
    expect(store.value).toEqual({ version: 1, language: 'ko', writerMode: true });
    store.setWriter({ spacing: 'exclude' });
    expect(store.value).toEqual({ version: 1, language: 'ko', writerMode: true, writerSpacing: 'exclude' });
    // 언어를 바꿔도 작가 모드 설정은 유지된다
    store.setLanguage('en');
    expect(store.value).toEqual({ version: 1, language: 'en', writerMode: true, writerSpacing: 'exclude' });
    expect(readAppSettings(file)).toEqual({ ...store.value, writerDailyGoal: null, writerFont: 'sans', writerTypewriter: true });
  });

  it('깨진 파일은 기본값(꺼짐·공백 포함)으로 복구된다', () => {
    const file = path.join(tempDir(), 'app-settings.json');
    writeFileSync(file, '{ broken');
    const store = new AppSettingsStore(file, readAppSettings(file));
    expect(store.value).toMatchObject({ writerMode: false, writerSpacing: 'include', writerDailyGoal: null, writerFont: 'sans', writerTypewriter: true });
  });
});

describe('일일 목표 글자수', () => {
  it('양수만 읽고, 0 이하·숫자 아님은 목표 없음(null)', () => {
    expect(parseAppSettings('{"version":1,"language":"ko","writerDailyGoal":3000}').writerDailyGoal).toBe(3000);
    for (const raw of ['0', '-5', '"3000"', 'null', 'true']) {
      expect(parseAppSettings(`{"version":1,"language":"ko","writerDailyGoal":${raw}}`).writerDailyGoal).toBeNull();
    }
  });

  it('저장은 정수로 내리고 0 이하는 삭제(null)한다', () => {
    const file = path.join(tempDir(), 'app-settings.json');
    const store = new AppSettingsStore(file, { version: 1, language: 'ko' });
    expect(store.setWriter({ dailyGoal: 3000.7 }).writerDailyGoal).toBe(3000);
    expect(store.setWriter({ dailyGoal: 0 }).writerDailyGoal).toBeNull();
    expect(store.setWriter({ dailyGoal: null }).writerDailyGoal).toBeNull();
    expect(store.setWriter({ mode: true }).writerDailyGoal).toBeNull(); // 안 준 값은 그대로
  });
});

describe('집중 모드 글꼴·타자기 설정', () => {
  it('값이 없거나 깨져도 기본값으로 읽고, 유효한 값은 그대로', () => {
    expect(parseAppSettings('{"version":1,"language":"ko"}')).toMatchObject({ writerFont: 'sans', writerTypewriter: true });
    expect(parseAppSettings('{"version":1,"language":"ko","writerFont":"serif","writerTypewriter":false}')).toMatchObject({
      writerFont: 'serif',
      writerTypewriter: false,
    });
    expect(parseAppSettings('{"version":1,"language":"ko","writerFont":"webfont","writerTypewriter":"no"}')).toMatchObject({
      writerFont: 'sans',
      writerTypewriter: true,
    });
  });

  it('저장은 준 값만 바꾸고 다시 읽힌다', () => {
    const file = path.join(tempDir(), 'app-settings.json');
    const store = new AppSettingsStore(file, { version: 1, language: 'ko' });
    expect(store.setWriter({ font: 'mono', typewriter: false })).toMatchObject({ writerFont: 'mono', writerTypewriter: false });
    expect(readAppSettings(file)).toMatchObject({ writerFont: 'mono', writerTypewriter: false });
  });
});
