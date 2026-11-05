import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setLocale } from '@nopsidian/i18n';
import { readVaultConfig } from './vault';

afterEach(() => setLocale('ko'));

/** 설정 파일이 없는 볼트의 기본 폴더 — 만드는 시점 언어를 따르되 예전 한국어 폴더는 계속 쓴다. */
describe('readVaultConfig 기본 폴더', () => {
  const make = () => mkdtempSync(path.join(tmpdir(), 'nops-vault-cfg-'));

  it('한국어에서는 지금까지와 같은 이름', () => {
    const root = make();
    try {
      const cfg = readVaultConfig(root);
      expect(cfg.dailyFolder).toBe('일기');
      expect(cfg.templatesFolder).toBe('템플릿');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('영어에서는 영어 기본 이름을 쓰고, 예전 한국어 폴더가 있으면 그대로 인식한다', () => {
    const fresh = make();
    try {
      setLocale('en');
      expect(readVaultConfig(fresh).dailyFolder).toBe('Journal');
      expect(readVaultConfig(fresh).templatesFolder).toBe('Templates');
    } finally {
      rmSync(fresh, { recursive: true, force: true });
    }

    const legacy = make();
    try {
      mkdirSync(path.join(legacy, '일기'));
      mkdirSync(path.join(legacy, '템플릿'));
      setLocale('en');
      expect(readVaultConfig(legacy).dailyFolder).toBe('일기');
      expect(readVaultConfig(legacy).templatesFolder).toBe('템플릿');
    } finally {
      rmSync(legacy, { recursive: true, force: true });
    }
  });
});
