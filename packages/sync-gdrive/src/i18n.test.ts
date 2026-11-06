import { setLocale } from '@nopsidian/i18n';
import { afterEach, describe, expect, it } from 'vitest';
import { conflictCopyPath, executePlan } from './executor.js';
import { planSync } from './planner.js';
import { errorText } from './errors.js';
import { AuthRevokedError, OAuthError } from './oauth.js';
import { RevisionConflictError } from './types.js';
import type { SyncEntry, SyncPlan } from './types.js';

// 동기화 오류·안내 문구가 지금 언어를 따르는지 실제 함수 경로로 확인한다.
const HANGUL = /[\u3131-\u318e\uac00-\ud7a3]/;
afterEach(() => setLocale('ko'));

const noEntries = async () => new Map<string, SyncEntry>();
const deps = {
  isSyncable: () => true,
  state: { entries: noEntries, put: async () => {}, remove: async () => {}, putBase: async () => {}, removeBase: async () => {} },
} as never;

describe('sync-gdrive 문구의 언어', () => {
  it('오류는 코드+params 로 던지고, 표시 시점에 지금 언어로 번역한다(ko→en→ko)', () => {
    // 던질 때는 언어를 모른다(문구를 만들지 않는다)
    const err = new AuthRevokedError();
    expect(err.message).toBe('sync.err.revoked');
    setLocale('ko');
    expect(errorText(err)).toBe('연결이 해제됐어요. 다시 로그인해 주세요.');
    setLocale('en');
    expect(errorText(err)).not.toMatch(HANGUL);

    const conflict = new RevisionConflictError('a.md');
    setLocale('en');
    expect(errorText(conflict)).toBe('The file changed on Drive first: a.md');
    setLocale('ko');
    expect(errorText(conflict)).toBe('원격이 먼저 바뀌었어요: a.md');

    // 같은 오류를 나중에(비동기 표시) 다시 그려도 그때 언어를 따른다
    const oauth = new OAuthError('sync.err.tokenRejected', 'invalid_grant');
    setLocale('en');
    expect(errorText(oauth)).toBe('The token request was rejected');
    setLocale('ko');
    expect(errorText(oauth)).toBe('토큰 요청이 거부됐어요');
  });

  it('차단 안내는 코드+params 로 만들어 두 언어 모두 자연스럽다', () => {
    const local = Array.from({ length: 10 }, (_, i) => ({ path: `n${i}.md`, hash: `h${i}`, size: 1, mtimeMs: 0 }));
    const remote: { path: string }[] = []; // 원격에서 전부 사라졌다 → 로컬도 지우려는 계획
    const entries = local.map((f) => ({ path: f.path, driveId: f.path, hash: f.hash, revision: 'r' }));
    const input = { local, remote, entries, isSyncable: () => true, now: new Date('2026-10-12T00:00:00Z') };
    setLocale('ko');
    const ko = planSync(input as never);
    expect(ko.blocked).toBe('파일 10개 중 10개(100%)를 지우려 해요. 의도한 게 맞는지 확인해 주세요.');
    setLocale('en');
    const en = planSync(input as never);
    expect(en.blocked).not.toMatch(HANGUL);
    expect(en.blocked).toBe('This would delete 10 of 10 files (100%). Check that this is what you want.');
  });

  it('차단된 계획을 실행하면 코드가 붙은 오류를 던진다(메시지는 지금 언어)', async () => {
    const plan: SyncPlan = { ops: [], deletes: 0, tracked: 0, firstSync: false, blocked: '파일 10개를 지우려 해요' };
    setLocale('en');
    await expect(executePlan(plan, deps)).rejects.toMatchObject({ key: 'blocked', code: 'BLOCKED' });
    await expect(executePlan(plan, deps)).rejects.toThrow(/^Sync stopped: /);
  });

  it('충돌 사본 이름도 지금 언어를 따른다(만들어 저장되는 값)', async () => {
    setLocale('ko');
    expect(await conflictCopyPath('a/b.md', new Date('2026-10-12T00:00:00Z'), async () => false)).toBe('a/b (충돌 2026-10-12).md');
    setLocale('en');
    const en = await conflictCopyPath('a/b.md', new Date('2026-10-12T00:00:00Z'), async () => false);
    expect(en).toBe('a/b (conflict 2026-10-12).md');
    expect(en).not.toMatch(HANGUL);
  });
});
