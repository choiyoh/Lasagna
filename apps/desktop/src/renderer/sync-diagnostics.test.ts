import { describe, expect, it } from 'vitest';
import { setLocale } from '@nopsidian/i18n';
import type { SyncDiagnostics, SyncStatus } from '@nopsidian/ipc-contract';
import { formatSyncDiagnostics } from './sync-diagnostics';

const status: SyncStatus = {
  configured: true,
  clientSource: 'custom',
  builtinClientAvailable: false,
  connected: true,
  enabled: true,
  confirmedFirst: true,
  state: 'idle',
  lastSync: 1_700_000_000_000,
  lastAttempt: 1_700_000_100_000,
  message: null,
  conflicts: ['private-note.md'],
};

const diagnostics: SyncDiagnostics = {
  clientIdSuffix: 'hijk',
  hasClientSecret: true,
  accountEmail: 'so***@example.com',
  tokenExpiresAt: 1_700_000_200_000,
  tokenValid: true,
  lastRefreshFailure: null,
  pendingChanges: 3,
  folder: { name: 'MyVault', path: 'Nopsidian/MyVault', id: 'folder-secret-id', exists: true, checkedAt: 1_700_000_150_000 },
  lastFailure: { at: 1_700_000_050_000, code: 'NETWORK', title: '인터넷에 연결되지 않았어요', action: '연결을 확인해 주세요', docs: 'https://example.com/docs' },
};

describe('formatSyncDiagnostics', () => {
  it('상태·토큰·폴더·오류 코드를 복사용 텍스트로 만든다', () => {
    const text = formatSyncDiagnostics(status, diagnostics);
    expect(text).toContain('상태: idle');
    expect(text).toContain('클라이언트: 직접 입력 (…hijk)');
    expect(text).toContain('마지막 시도: 2023-11-14T22:15:00.000Z');
    expect(text).toContain('이 기기에서 바뀐 파일: 3개');
    expect(text).toContain('계정 연결됨');
    expect(text).not.toContain('so***@example.com');
    expect(text).not.toContain('Nopsidian/MyVault');
    expect(text).not.toContain('MyVault');
    expect(text).not.toContain('folder-secret-id');
    expect(text).not.toContain('…cret');
    expect(text).not.toContain('cret');
    expect(text).toContain('NETWORK');
  });

  it('내장 클라이언트도 출처와 끝 4자리만 복사한다', () => {
    const text = formatSyncDiagnostics({ ...status, clientSource: 'builtin', builtinClientAvailable: true }, diagnostics);
    expect(text).toContain('클라이언트: 내장 (…hijk)');
    expect(text).not.toContain('builtin-secret');
  });

  it('영어 설정에서는 같은 정보를 영어 라벨로 만든다(서버 문구 제외)', () => {
    setLocale('en');
    try {
      const text = formatSyncDiagnostics(status, { ...diagnostics, lastFailure: null, lastRefreshFailure: null });
      expect(text).toContain('Lasagna sync diagnostics');
      expect(text).toContain('State: idle');
      expect(text).toContain('Conflicts: 1');
      expect(text).toContain('Files changed on this device: 3 files');
      expect(text).not.toMatch(/[가-힣]/);
    } finally {
      setLocale('ko');
    }
  });

  it('토큰·전체 이메일·노트 이름/경로는 넣지 않는다', () => {
    const text = formatSyncDiagnostics(status, diagnostics);
    expect(text).not.toContain('accessToken');
    expect(text).not.toContain('refreshToken');
    expect(text).not.toContain('someone@example.com');
    expect(text).not.toContain('example.com');
    expect(text).not.toContain('private-note.md');
    expect(text).toContain('노트 이름·경로는 이 진단에 포함하지 않았습니다.');
  });
});
