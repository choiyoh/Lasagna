/* global process */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { electronBinary, ensureElectron } from './ensure-electron.mjs';

const dirs = [];
const tempDir = () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'nops-ensure-electron-'));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** `path.txt` + `dist/<실행 파일>` 을 만들어 "설치된" 상태로 만든다. */
const installed = (dir, name = process.platform === 'win32' ? 'electron.exe' : 'electron') => {
  mkdirSync(path.join(dir, 'dist'), { recursive: true });
  writeFileSync(path.join(dir, 'path.txt'), name);
  writeFileSync(path.join(dir, 'dist', name), '');
};

describe('electronBinary', () => {
  it('path.txt 가 가리키는 파일이 dist 안에 있어야 설치된 것으로 본다', () => {
    const dir = tempDir();
    writeFileSync(path.join(dir, 'path.txt'), 'electron');
    expect(electronBinary(dir)).toBe(null); // dist 가 없다(새 클론에서 겪은 상태)
    installed(dir);
    expect(electronBinary(dir)).toBe(path.join(dir, 'dist', 'electron'));
  });
});

describe('ensureElectron', () => {
  it('이미 설치돼 있으면 설치 스크립트를 돌리지 않는다(빠른 no-op)', () => {
    const dir = tempDir();
    installed(dir);
    const spawn = vi.fn(() => {
      throw new Error('설치 스크립트를 부르면 안 된다');
    });
    expect(ensureElectron({ dir, spawn, log: () => {}, warn: () => {} })).toBe('ok');
    expect(spawn).not.toHaveBeenCalled();
  });

  it('실행 파일이 없으면 electron/install.js 를 그 패키지 폴더에서 돌린다', () => {
    const dir = tempDir();
    writeFileSync(path.join(dir, 'install.js'), '');
    const spawn = vi.fn((_node, [script], options) => {
      expect(script).toBe(path.join(dir, 'install.js'));
      expect(options.cwd).toBe(dir);
      installed(dir); // 내려받기를 흉내 낸다
      return { status: 0 };
    });
    expect(ensureElectron({ dir, spawn, log: () => {}, warn: () => {} })).toBe('installed');
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it('내려받기에 실패해도 던지지 않고 경고만 한다(설치가 멈추면 안 된다)', () => {
    const dir = tempDir();
    writeFileSync(path.join(dir, 'install.js'), '');
    const warn = vi.fn();
    expect(ensureElectron({ dir, spawn: () => ({ status: 1 }), log: () => {}, warn })).toBe('failed');
    expect(warn).toHaveBeenCalled();
  });

  it('electron 패키지가 없으면 경고하고 넘어간다', () => {
    const warn = vi.fn();
    expect(ensureElectron({ dir: null, warn, log: () => {} })).toBe('missing');
    expect(warn).toHaveBeenCalled();
  });
});
