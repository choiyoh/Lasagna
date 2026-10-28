import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DriveApiError, DriveAuthError } from '@nopsidian/sync-gdrive';
import { CredentialStore, credentialSuffix, maskEmail, syncFailureFor, vaultKeyFor, type SecretBox } from './sync';

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
  it('load() 가 실패해도(키체인 없음·복호화 실패) 파일에 남은 토큰을 지운다', () => {
    const file = tmpFile();
    const store = new CredentialStore(file, box());
    store.save({ clientId: 'c'.repeat(12), tokens: { accessToken: 'a', refreshToken: 'r', expiresAt: 1 } });
    // 키체인을 쓸 수 없게 되어 load() 가 null 을 돌려주는 상황
    const blind = new CredentialStore(file, box(false));
    expect(blind.load()).toBeNull();
    blind.clearTokens();
    expect(existsSync(file)).toBe(false);

    // 파일이 아예 없어도 조용히 끝난다
    expect(() => new CredentialStore(file, box(false)).clearTokens()).not.toThrow();
  });
  it('이미 있던 파일에 다시 저장해도 권한을 0600 으로 맞춘다', () => {
    const file = tmpFile();
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, '{}', { mode: 0o644 });
    const store = new CredentialStore(file, box());
    store.save({ clientId: 'c'.repeat(12) });
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(store.load()).toMatchObject({ clientId: 'c'.repeat(12) });
  });
});

describe('vaultKeyFor', () => {
  it('같은 이름이면 같은 키, 다르면 다른 키, 한글 정규화에 무관', () => {
    expect(vaultKeyFor('내 볼트')).toBe(vaultKeyFor('내 볼트'.normalize('NFD')));
    expect(vaultKeyFor('a')).not.toBe(vaultKeyFor('b'));
    expect(vaultKeyFor('a')).toMatch(/^[0-9a-f]{16}$/);
  });
});


describe('동기화 진단 문구', () => {
  it('오류 상태·사유를 사람이 읽는 문구와 문서 링크로 바꾼다', () => {
    expect(syncFailureFor({ name: 'DriveAuthError' }, 1)).toMatchObject({ code: 'HTTP 401', title: 'Google 로그인이 만료됐어요' });
    expect(syncFailureFor({ name: 'DriveApiError', status: 403, reason: 'accessNotConfigured' }, 2)).toMatchObject({
      code: 'HTTP 403 · accessNotConfigured',
      title: 'Google Drive API가 꺼져 있어요',
    });
    expect(syncFailureFor({ name: 'DriveApiError', status: 403, reason: 'storageQuotaExceeded' }, 3)).toMatchObject({
      code: 'HTTP 403 · storageQuotaExceeded',
      title: 'Google Drive 저장 공간이 부족해요',
    });
    expect(syncFailureFor({ name: 'DriveApiError', status: 429 }, 4)).toMatchObject({ code: 'HTTP 429/403 · rateLimitExceeded' });
    expect(syncFailureFor({ name: 'DriveApiError', status: 0 }, 5)).toMatchObject({ code: 'NETWORK' });
    expect(syncFailureFor({ code: 'folderMissing' }, 6)).toMatchObject({ code: 'FOLDER_MISSING' });
    expect(syncFailureFor({ kind: 'auth', message: 'Google 계정이 연결되지 않았어요' }, 7)).toMatchObject({
      code: 'NOT_CONNECTED',
      title: 'Google 계정이 연결되지 않았어요',
    });
    expect(syncFailureFor({ message: '삭제가 너무 많아 멈췄어요' }, 8)).toMatchObject({ code: 'BLOCKED' });
    expect(syncFailureFor({ code: 'HTTP 403 · accessNotConfigured' }, 9)).toMatchObject({ code: 'HTTP 403 · accessNotConfigured' });
    expect(syncFailureFor({ code: 'HTTP 403 · storageQuotaExceeded' }, 10)).toMatchObject({ title: 'Google Drive 저장 공간이 부족해요' });
  });

  it('실제 Drive 오류 클래스(가짜 fetch가 만든 오류)도 같은 문구로 바꾼다', () => {
    expect(syncFailureFor(new DriveAuthError())).toMatchObject({ code: 'HTTP 401' });
    expect(syncFailureFor(new DriveApiError('x', 403, 'accessNotConfigured'))).toMatchObject({ code: 'HTTP 403 · accessNotConfigured' });
    expect(syncFailureFor(new DriveApiError('x', 403, 'storageQuotaExceeded'))).toMatchObject({ code: 'HTTP 403 · storageQuotaExceeded' });
    expect(syncFailureFor(new DriveApiError('x', 403, 'rateLimitExceeded'))).toMatchObject({ code: 'HTTP 429/403 · rateLimitExceeded' });
    expect(syncFailureFor(new DriveApiError('x', 429))).toMatchObject({ code: 'HTTP 429/403 · rateLimitExceeded' });
    expect(syncFailureFor(new DriveApiError('x', 0))).toMatchObject({ code: 'NETWORK' });
    expect(syncFailureFor(new TypeError('fetch failed'))).toMatchObject({ code: 'NETWORK' });
  });

  it('모든 문구에 docs/sync-setup.md 단계 링크가 붙는다', () => {
    const f = syncFailureFor({ code: 'rateLimit' });
    expect(f.docs).toContain('docs/sync-setup.md#');
    expect(f.action).toContain('다시');
  });

  it('클라이언트 접미사는 Google 도메인을 빼고 끝 4자리만 남긴다', () => {
    expect(credentialSuffix('1234567890-abcdefghijk.apps.googleusercontent.com')).toBe('hijk');
    expect(credentialSuffix('short')).toBe('hort');
  });

  it('이메일은 앞 2자와 도메인만 남긴다', () => {
    expect(maskEmail('someone@example.com')).toBe('so***@example.com');
    expect(maskEmail('a@example.com')).toBe('a***@example.com');
    expect(maskEmail('invalid')).toBe('•••');
  });
});
