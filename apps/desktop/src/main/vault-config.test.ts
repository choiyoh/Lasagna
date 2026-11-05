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

  it('앱 언어를 바꿔도 이미 있는 폴더를 그대로 쓴다(ko↔en 왕복)', () => {
    const root = make();
    try {
      // 영어로 만들어 둔 볼트를 한국어로 열어도 Journal/Templates 를 쓴다
      mkdirSync(path.join(root, 'Journal'));
      mkdirSync(path.join(root, 'Templates'));
      setLocale('ko');
      expect(readVaultConfig(root).dailyFolder).toBe('Journal');
      expect(readVaultConfig(root).templatesFolder).toBe('Templates');
      // 한국어로 만든 볼트를 영어로 열어도 일기/템플릿 을 쓴다
      const ko = make();
      try {
        mkdirSync(path.join(ko, '일기'));
        mkdirSync(path.join(ko, '템플릿'));
        setLocale('en');
        expect(readVaultConfig(ko).dailyFolder).toBe('일기');
        expect(readVaultConfig(ko).templatesFolder).toBe('템플릿');
      } finally {
        rmSync(ko, { recursive: true, force: true });
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('두 이름이 모두 있으면 지금 언어의 폴더를 쓴다', () => {
    const root = make();
    try {
      mkdirSync(path.join(root, '일기'));
      mkdirSync(path.join(root, 'Journal'));
      setLocale('en');
      expect(readVaultConfig(root).dailyFolder).toBe('Journal');
      setLocale('ko');
      expect(readVaultConfig(root).dailyFolder).toBe('일기');
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
