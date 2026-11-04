import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_APP_SETTINGS, parseAppSettings, readAppSettings, writeAppSettings } from './app-settings';

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
    expect(parseAppSettings('{"version":1,"language":"en"}')).toEqual({ version: 1, language: 'en' });
    expect(parseAppSettings('{"version":1,"language":"ko"}')).toEqual({ version: 1, language: 'ko' });
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
    expect(readAppSettings(file)).toEqual({ version: 1, language: 'en' });
    writeFileSync(file, '{ damaged');
    expect(readAppSettings(file)).toEqual(DEFAULT_APP_SETTINGS);
  });
});
