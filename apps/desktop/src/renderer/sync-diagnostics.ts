import type { SyncDiagnostics, SyncStatus } from '@nopsidian/ipc-contract';

const iso = (t: number | null): string => (t === null ? '없음' : new Date(t).toISOString());

const yes = (v: boolean): string => (v ? '예' : '아니오');

/**
 * 진단 정보 복사용 텍스트. 비밀 값·토큰·이메일·폴더 ID/경로·노트 이름/경로는 절대 넣지 않는다.
 * 경로는 개수만, 폴더는 있음/없음/확인 못 함만 넣는다.
 */
export function formatSyncDiagnostics(status: SyncStatus, d: SyncDiagnostics): string {
  const source = status.clientSource === 'builtin' ? '내장' : status.clientSource === 'custom' ? '직접 입력' : '없음';
  const lines = [
    'Nopsidian 동기화 진단',
    `생성: ${new Date().toISOString()}`,
    '',
    `상태: ${status.state}`,
    `동기화 켜짐: ${yes(status.enabled)}`,
    `첫 동기화 완료: ${yes(status.confirmedFirst)}`,
    `마지막 성공: ${iso(status.lastSync)}`,
    `마지막 시도: ${iso(status.lastAttempt)}`,
    `이 기기에서 바뀐 파일: ${d.pendingChanges === null ? '확인 전' : `${d.pendingChanges}개`}`,
    `충돌: ${status.conflicts.length}건`,
    '',
    `클라이언트: ${d.clientIdSuffix === null ? '없음' : `${source} (…${d.clientIdSuffix})`}`,
    `클라이언트 보안 비밀: ${d.hasClientSecret ? '등록됨' : '등록 안 됨'}`,
    `계정: ${status.connected ? '계정 연결됨' : '계정 연결 안 됨'}`,
    `토큰 만료: ${iso(d.tokenExpiresAt)} (${d.tokenValid ? '유효' : '만료/없음'})`,
    `마지막 토큰 갱신 실패: ${d.lastRefreshFailure === null ? '없음' : `${d.lastRefreshFailure.title} [${d.lastRefreshFailure.code}] @ ${iso(d.lastRefreshFailure.at)}`}`,
    '',
    `Drive 폴더: ${d.folder.checkedAt === null ? '확인 못 함' : d.folder.exists ? '있음' : '없음'}`,
    `마지막 실패: ${d.lastFailure === null ? '없음' : `${d.lastFailure.title} [${d.lastFailure.code}] @ ${iso(d.lastFailure.at)}`}`,
    '',
    '노트 이름·경로는 이 진단에 포함하지 않았습니다.',
  ];
  return `${lines.join('\n')}\n`;
}
