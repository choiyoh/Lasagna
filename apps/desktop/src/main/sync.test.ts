import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CredentialStore, vaultKeyFor, type SecretBox } from './sync';

/** 테스트용 가짜 키체인: 뒤집기만 한다(평문이 파일에 남지 않는지 확인하려는 용도) */
const box = (available = true): SecretBox => ({
  available: () => available,
  encrypt: (p) => Buffer.from([...p].reverse().join('')),
  decrypt: (d) => [...d.toString()].reverse().join(''),
});
const tmpFile = () => path.join(mkdtempSync(path.join(tmpdir(), 'nops-sync-')), 'auth', 'sync-auth.json');

describe('CredentialStore', () => {
  it('저장하고 다시 읽는다. 파일에 평문이 남지 않는다', () => {
    const file = tmpFile();
    const store = new CredentialStore(file, box());
    store.save({ clientId: 'abc.apps.googleusercontent.com', clientSecret: 'shh', tokens: { accessToken: 'AT', refreshToken: 'RT-secret', expiresAt: 1 } });
    expect(store.load()).toMatchObject({ clientId: 'abc.apps.googleusercontent.com', tokens: { refreshToken: 'RT-secret' } });
    const raw = readFileSync(file, 'utf8');
    expect(raw).not.toContain('RT-secret');
    expect(raw).not.toContain('shh');
  });
  it('키체인을 쓸 수 없으면 저장을 거부한다', () => {
    expect(() => new CredentialStore(tmpFile(), box(false)).save({ clientId: 'x'.repeat(12) })).toThrow(/키체인/);
  });
  it('파일이 없거나 깨졌거나 키체인이 없으면 null', () => {
    expect(new CredentialStore(tmpFile(), box()).load()).toBeNull();
  });
  it('clearTokens 는 클라이언트 설정만 남긴다', () => {
    const store = new CredentialStore(tmpFile(), box());
    store.save({ clientId: 'c'.repeat(12), tokens: { accessToken: 'a', refreshToken: 'r', expiresAt: 1 } });
    store.clearTokens();
    expect(store.load()).toEqual({ clientId: 'c'.repeat(12) });
  });
});

describe('vaultKeyFor', () => {
  it('같은 이름이면 같은 키, 다르면 다른 키, 한글 정규화에 무관', () => {
    expect(vaultKeyFor('내 볼트')).toBe(vaultKeyFor('내 볼트'.normalize('NFD')));
    expect(vaultKeyFor('a')).not.toBe(vaultKeyFor('b'));
    expect(vaultKeyFor('a')).toMatch(/^[0-9a-f]{16}$/);
  });
});
