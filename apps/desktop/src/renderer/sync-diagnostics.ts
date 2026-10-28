import type { SyncDiagnostics, SyncStatus } from '@nopsidian/ipc-contract';

const iso = (t: number | null): string => (t === null ? '없음' : new Date(t).toISOString());

const yes = (v: boolean): string => (v ? '예' : '아니오');

/**
 * 진단 정보 복사용 텍스트. 비밀·토큰·전체 이메일·노트 이름/경로는 절대 넣지 않는다.
 * 경로·폴더 이름은 넣지 않고, 대기 중 변경은 개수만 넣는다.
 */
export function formatSyncDiagnostics(status: SyncStatus, d: SyncDiagnostics): string {
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
    `클라이언트 ID: ${d.clientIdSuffix === null ? '등록 안 됨' : `등록됨 (…${d.clientIdSuffix})`}`,
    `클라이언트 보안 비밀: ${d.clientSecretSuffix === null ? '등록 안 됨' : `등록됨 (…${d.clientSecretSuffix})`}`,
    `계정: ${d.accountEmail ?? '표시할 이메일 없음'}`,
    `토큰 만료: ${iso(d.tokenExpiresAt)} (${d.tokenValid ? '유효' : '만료/없음'})`,
    `마지막 토큰 갱신 실패: ${d.lastRefreshFailure === null ? '없음' : `${d.lastRefreshFailure.title} [${d.lastRefreshFailure.code}] @ ${iso(d.lastRefreshFailure.at)}`}`,
    '',
    `Drive 폴더: ${d.folder.exists ? '확인됨' : d.folder.checkedAt === null ? '확인 전' : '없음'}`,
    `Drive 폴더 ID: ${d.folder.id ?? '없음'}`,
    `Drive 폴더 확인: ${d.folder.checkedAt === null ? '확인 전' : `${iso(d.folder.checkedAt)} (${d.folder.exists ? '있음' : '없음'})`}`,
    `마지막 실패: ${d.lastFailure === null ? '없음' : `${d.lastFailure.title} [${d.lastFailure.code}] @ ${iso(d.lastFailure.at)}`}`,
    '',
    '노트 이름·경로는 이 진단에 포함하지 않았습니다.',
  ];
  return `${lines.join('\n')}\n`;
}
