import { afterEach, describe, expect, it } from 'vitest';
import { setLocale } from '@nopsidian/i18n';
import { localizedFailure, syncFailureFor } from './sync';
import { errorDetails } from '../workers/sync/error-info';
import { syncBusyError } from '../workers/sync/errors';
import { executePlan } from '@nopsidian/sync-gdrive';
import { duplicateNote } from './trash';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

afterEach(() => setLocale('ko'));

describe('메인 프로세스 문구의 로캘', () => {
  it('동기화 실패 안내: ko 는 base 글자 그대로, en 은 영어', () => {
    setLocale('ko');
    const ko = syncFailureFor({ kind: 'auth' });
    expect(ko.title).toBe('Google 로그인이 만료됐어요');
    expect(ko.action).toBe('Google 계정을 다시 연결해 주세요');
    setLocale('en');
    const en = syncFailureFor({ kind: 'auth' });
    expect(en.title).toBe('Google sign-in expired');
    expect(en.action).toBe('Reconnect your Google account');
    expect(`${en.title} ${en.action}`).not.toMatch(/[가-힣]/);
    // 문서 링크는 앱 언어를 따른다(L5): 영어는 영어 문서·영어 앵커
    expect(ko.docs).toBe('https://github.com/choiyoh/Lasagna/blob/main/docs/sync-setup.md#2-앱에서-연결');
    expect(en.docs).toBe('https://github.com/choiyoh/Lasagna/blob/main/docs/sync-setup.en.md#2-connect-in-the-app');
  });

  it('저장된 실패를 성공 응답에서 다시 그릴 때도 지금 언어를 따른다(성공 경로)', () => {
    // check() 성공 경로는 워커를 거치지 않고 저장된 실패를 localizedFailure 로 다시 만든다.
    setLocale('ko');
    const stored = syncFailureFor({ key: 'network', kind: 'network' });
    setLocale('en');
    const shown = localizedFailure(stored)!;
    expect(shown.title).toBe('No internet connection');
    expect(shown.action).toBe('Check the connection and try again');
    expect(`${shown.title} ${shown.action}`).not.toMatch(/[가-힣]/);
    expect(shown.docs).toBe('https://github.com/choiyoh/Lasagna/blob/main/docs/sync-setup.en.md#troubleshooting');
    setLocale('ko');
    const back = localizedFailure(stored)!;
    expect(back.title).toBe('인터넷에 연결되지 않았어요');
    // kind 가 없는 옛 기록은 그대로 둔다
    expect(localizedFailure({ ...stored, kind: undefined })).toMatchObject({ title: stored.title });
    expect(localizedFailure(null)).toBeNull();
  });

  it('사본 파일 이름: ko 는 base, en 은 copy', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'nops-main-i18n-'));
    try {
      writeFileSync(path.join(root, '메모.md'), '# 메모\n');
      setLocale('ko');
      expect(duplicateNote(root, '메모.md')).toBe('메모 (사본).md');
      setLocale('en');
      expect(duplicateNote(root, '메모.md')).toBe('메모 (copy).md');
      // 사본이 이미 있으면 번호를 붙인다
      writeFileSync(path.join(root, '메모 (copy).md'), '# 메모\n');
      expect(duplicateNote(root, '메모.md')).toBe('메모 (copy 2).md');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('동기화 오류 코드와 저장된 실패', () => {
  it('실제 throw 지점의 busy/blocked 를 코드로 분류한다(문구 매칭 없이, 영어 모드 포함)', async () => {
    for (const locale of ['ko', 'en'] as const) {
      setLocale(locale);
      const busy = errorDetails(syncBusyError());
      expect(busy).toMatchObject({ key: 'busy', code: 'BUSY' });
      // 실제 실행 지점(패키지)의 blocked 오류
      const err = await executePlan({ blocked: '삭제가 너무 많아요' } as never, {} as never).catch((e) => e);
      expect(errorDetails(err)).toMatchObject({ key: 'blocked', code: 'BLOCKED' });
      expect(syncFailureFor(err).title).toBe(locale === 'ko' ? '삭제가 너무 많아 동기화를 멈췄어요' : 'Sync stopped because too much would be deleted');
    }
  });

  it('실패에는 kind 가 남아 저장본을 지금 언어로 다시 만들 수 있다', () => {
    setLocale('ko');
    const ko = syncFailureFor({ code: 'HTTP 401' });
    expect(ko.kind).toBe('auth');
    setLocale('en');
    const en = syncFailureFor({ code: 'HTTP 401' });
    expect(en.kind).toBe('auth');
    expect(en.title).toBe('Google sign-in expired');
  });
});
