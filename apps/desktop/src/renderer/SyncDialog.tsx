import { useCallback, useEffect, useState } from 'react';
import type { SyncDiagnostics, SyncStatus } from '@nopsidian/ipc-contract';
import { formatSyncDiagnostics } from './sync-diagnostics';

type Plan = Awaited<ReturnType<typeof window.nops.sync.plan>>;
type Run = Awaited<ReturnType<typeof window.nops.sync.run>>;

const STATE_LABEL: Record<SyncStatus['state'], string> = {
  off: '꺼져 있어요',
  idle: '동기화됨',
  syncing: '동기화 중…',
  offline: '오프라인 — 연결되면 다시 시도해요',
  error: '일부 파일을 동기화하지 못했어요',
  needsAuth: 'Google 계정을 다시 연결해 주세요',
  blocked: '삭제가 많아 멈췄어요',
};

const OP_LABEL: Record<string, string> = {
  push: '올리기',
  pull: '내려받기',
  merge: '병합',
  trashLocal: '이 기기에서 삭제',
  trashRemote: 'Drive에서 삭제',
  moveLocal: '이 기기에서 이동',
  moveRemote: 'Drive에서 이동',
  record: '기록만',
  forget: '기록 정리',
};

export const syncStateText = (s: SyncStatus | null): string => (s ? STATE_LABEL[s.state] : '');

const ago = (t: number | null) => {
  if (!t) return '아직 동기화한 적이 없어요';
  const sec = Math.round((Date.now() - t) / 1000);
  if (sec < 60) return '방금';
  if (sec < 3600) return `${Math.round(sec / 60)}분 전`;
  return new Date(t).toLocaleString('ko-KR');
};

const at = (t: number | null) => (t === null ? '없음' : new Date(t).toLocaleString('ko-KR'));

interface Props {
  status: SyncStatus | null;
  onClose: () => void;
  onOpenNote: (path: string) => void;
}

/** Google Drive 동기화 설정·실행 대화상자. 첫 동기화는 계획을 먼저 보여 주고 확인을 받는다. */
export function SyncDialog({ status, onClose, onOpenNote }: Props) {
  const [clientId, setClientId] = useState('');
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [plan, setPlan] = useState<Plan | null>(null);
  const [result, setResult] = useState<Run | null>(null);
  const [diag, setDiag] = useState<SyncDiagnostics | null>(null);
  const [diagLoading, setDiagLoading] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    if (status?.state === 'syncing') return;
    let live = true;
    setDiagLoading(true);
    void window.nops.sync
      .diagnostics()
      .then((d) => live && setDiag(d))
      .catch(() => undefined)
      .finally(() => {
        if (live) setDiagLoading(false);
      });
    return () => {
      live = false;
    };
  }, [status?.configured, status?.connected, status?.state]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const act = useCallback(async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e));
    } finally {
      setBusy(null);
    }
  }, []);

  const copyDiagnostics = useCallback(async () => {
    if (!status || !diag) return;
    try {
      await navigator.clipboard.writeText(formatSyncDiagnostics(status, diag));
      setCopied('복사했어요');
    } catch {
      setCopied('복사하지 못했어요');
    }
    setTimeout(() => setCopied(null), 2500);
  }, [status, diag]);

  const s = status;
  const tokenText = !s?.connected
    ? '없음'
    : diag === null
      ? '확인 중…'
      : diag.tokenValid
        ? `유효 · ${at(diag.tokenExpiresAt)}까지`
        : `만료됨 · '지금 확인' 때 갱신을 시도해요`;
  const folder = diag?.folder;
  const folderText =
    folder === undefined || folder.checkedAt === null
      ? '확인 전'
      : folder.exists
        ? `확인됨${folder.id === null ? '' : ` · ID ${folder.id}`}`
        : '아직 없음';
  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog syncdialog" role="dialog" aria-modal="true" aria-label="Google Drive 동기화">
        <h2>Google Drive 동기화</h2>
        <p className="muted small">켜지 않으면 앱은 계속 완전한 오프라인으로 동작해요. 앱이 만든 파일에만 접근하는 <code>drive.file</code> 권한만 요청해요.</p>

        <section>
          <h3>1. Google 클라이언트</h3>
          {s?.configured ? (
            <p className="small">클라이언트 ID가 저장돼 있어요(OS 키체인에 암호화).</p>
          ) : (
            <p className="muted small">본인의 Google Cloud 프로젝트에서 “데스크톱 앱” OAuth 클라이언트를 만들어 ID를 붙여 넣어 주세요. (docs/sync-setup.md)</p>
          )}
          <input placeholder="클라이언트 ID (….apps.googleusercontent.com)" value={clientId} onChange={(e) => setClientId(e.target.value)} aria-label="클라이언트 ID" />
          <input placeholder="클라이언트 보안 비밀(있으면)" value={secret} onChange={(e) => setSecret(e.target.value)} aria-label="클라이언트 보안 비밀" type="password" />
          <button disabled={!clientId.trim() || !!busy} onClick={() => void act('client', () => window.nops.sync.setClient({ clientId: clientId.trim(), clientSecret: secret.trim() || undefined }).then(() => { setClientId(''); setSecret(''); }))}>
            저장
          </button>
        </section>

        <section>
          <h3>2. 계정</h3>
          {s?.connected ? (
            <>
              <p className="small">Google 계정이 연결돼 있어요.</p>
              <button disabled={!!busy} onClick={() => void act('disconnect', () => window.nops.sync.disconnect())}>연결 해제</button>
            </>
          ) : (
            <button disabled={!s?.configured || !!busy} onClick={() => void act('connect', () => window.nops.sync.connect())}>
              {busy === 'connect' ? '브라우저에서 로그인해 주세요…' : 'Google 계정 연결'}
            </button>
          )}
        </section>

        <section>
          <h3>3. 이 볼트</h3>
          <label className="small">
            <input type="checkbox" checked={!!s?.enabled} disabled={!s?.connected || !!busy} onChange={(e) => void act('enable', () => window.nops.sync.enable({ enabled: e.target.checked }))} /> 이 볼트를 Drive와 동기화
          </label>
          <p className="small" data-testid="sync-state">
            {syncStateText(s)}
            {s?.enabled && <> · 마지막: {ago(s.lastSync)}</>}
          </p>
          {s?.message && <p className="small warn">{s.message}</p>}
          <div className="dialog__actions left">
            <button disabled={!s?.enabled || !s.connected || !!busy || diagLoading} onClick={() => void act('plan', async () => { setResult(null); setPlan(await window.nops.sync.plan()); })}>
              {s?.confirmedFirst ? '지금 동기화…' : '첫 동기화 미리보기'}
            </button>
          </div>
        </section>

        <section data-testid="sync-diagnostics">
          <h3>4. 진단</h3>
          <p className="small">
            Google 클라이언트:{' '}
            {diag?.clientIdSuffix
              ? `등록됨 (…${diag.clientIdSuffix})`
              : s?.configured
                ? '등록됨'
                : '등록 안 됨'}
            {' · '}보안 비밀:{' '}
            {diag?.clientSecretSuffix ? `등록됨 (…${diag.clientSecretSuffix})` : '등록 안 됨'}
          </p>
          <p className="small" data-testid="sync-account">
            계정:{' '}
            {diag?.accountEmail ??
              (s?.connected
                ? diag?.folder.checkedAt
                  ? '이메일을 읽을 수 없어요'
                  : '아직 확인 전 — ‘지금 확인’을 눌러 주세요'
                : '연결 안 됨')}
          </p>
          <p className="small" data-testid="sync-token">
            토큰: {tokenText}
          </p>
          {diag?.lastRefreshFailure && (
            <div className="syncdialog__failure" data-testid="sync-refresh-failure">
              <strong className="small">토큰 갱신 실패: {diag.lastRefreshFailure.title}</strong>
              <p className="small">{diag.lastRefreshFailure.action}</p>
              <a href={diag.lastRefreshFailure.docs} target="_blank" rel="noreferrer">
                단계별 안내 (docs/sync-setup.md)
              </a>
              <details>
                <summary className="muted small">오류 코드: {diag.lastRefreshFailure.code}</summary>
                <p className="muted small">{at(diag.lastRefreshFailure.at)}</p>
              </details>
            </div>
          )}
          <p className="small">
            마지막 성공: {s?.lastSync ? at(s.lastSync) : '아직 없음'}
            {' · '}마지막 시도: {s?.lastAttempt ? at(s.lastAttempt) : '아직 없음'}
          </p>
          <p className="small" data-testid="sync-pending">
            이 기기에서 바뀐 파일: {diag?.pendingChanges === null || diag === null ? '확인 전' : `${diag.pendingChanges}개`}
            {' · '}
            {s && s.conflicts.length > 0 ? (
              <button
                className="link"
                data-testid="sync-conflicts-count"
                onClick={() => document.querySelector('[data-testid="sync-conflicts"]')?.scrollIntoView({ block: 'nearest' })}
              >
                충돌: {s.conflicts.length}건
              </button>
            ) : (
              <>충돌: 0건</>
            )}
          </p>
          <p className="small" data-testid="sync-folder">
            Drive 폴더: {folder?.path ?? 'Nopsidian/…'} · {folderText}
            {folder?.checkedAt ? ` · ${at(folder.checkedAt)} 확인` : ''}
          </p>
          {diag?.lastFailure && (
            <div className="syncdialog__failure" data-testid="sync-last-failure">
              <strong className="small">{diag.lastFailure.title}</strong>
              <p className="small">{diag.lastFailure.action}</p>
              <a href={diag.lastFailure.docs} target="_blank" rel="noreferrer">
                단계별 안내 (docs/sync-setup.md)
              </a>
              <details>
                <summary className="muted small">오류 코드: {diag.lastFailure.code}</summary>
                <p className="muted small">{at(diag.lastFailure.at)}</p>
              </details>
            </div>
          )}
          <div className="dialog__actions left">
            <button
              data-testid="sync-check"
              disabled={!s?.connected || !!busy || diagLoading || s?.state === 'syncing'}
              onClick={() =>
                void act('check', async () => {
                  setCopied(null);
                  setDiag(await window.nops.sync.check());
                })
              }
            >
              {busy === 'check' || diagLoading ? '확인 중…' : '지금 확인'}
            </button>
            <button data-testid="sync-copy-diagnostics" disabled={!diag} onClick={() => void copyDiagnostics()}>
              진단 정보 복사
            </button>
            {copied && <span className="muted small">{copied}</span>}
          </div>
          <p className="muted small">‘지금 확인’은 토큰과 Drive 폴더만 읽고, 동기화·업로드·삭제는 하지 않아요.</p>
          <p className="muted small">복사에는 비밀 값·이메일·폴더 ID/경로가 들어가지 않아요.</p>
        </section>

        {plan && (
          <section data-testid="sync-plan">
            <h3>{plan.firstSync ? '첫 동기화 계획' : '동기화 계획'}</h3>
            <p className="small">{Object.entries(plan.counts).map(([k, n]) => `${OP_LABEL[k] ?? k} ${n}`).join(' · ') || '바뀐 내용이 없어요'}</p>
            {plan.blocked && <p className="small warn">{plan.blocked}</p>}
            <ul className="syncdialog__ops">
              {plan.ops.slice(0, 60).map((o, i) => (
                <li key={i}>
                  <span className="muted">{OP_LABEL[o.type] ?? o.type}</span> {o.path}
                  {o.to ? ` → ${o.to}` : ''}
                </li>
              ))}
              {plan.ops.length > 60 && <li className="muted">… 외 {plan.ops.length - 60}개</li>}
            </ul>
            <div className="dialog__actions">
              <button onClick={() => setPlan(null)}>닫기</button>
              <button
                className="primary"
                disabled={!!busy}
                onClick={() => void act('run', async () => { const force = !!plan.blocked; setResult(await window.nops.sync.run({ force })); setPlan(null); })}
              >
                {plan.blocked ? '그래도 실행' : '실행'}
              </button>
            </div>
          </section>
        )}

        {result && (
          <section data-testid="sync-result">
            <p className="small">
              올림 {result.pushed} · 내려받음 {result.pulled} · 병합 {result.merged} · 삭제 {result.deleted}
              {result.failed > 0 && <span className="warn"> · 실패 {result.failed}</span>}
            </p>
            {result.errors.map((e, i) => (
              <p key={i} className="small warn">{e.path}: {e.message}</p>
            ))}
          </section>
        )}

        {s && s.conflicts.length > 0 && (
          <section data-testid="sync-conflicts">
            <h3>충돌 {s.conflicts.length}건</h3>
            <p className="muted small">양쪽 내용을 모두 남겼어요. 확인하고 정리해 주세요.</p>
            <ul className="syncdialog__ops">
              {s.conflicts.map((p) => (
                <li key={p}><button className="link" onClick={() => { onOpenNote(p); onClose(); }}>{p}</button></li>
              ))}
            </ul>
          </section>
        )}

        {error && <p className="small warn" role="alert">{error}</p>}
        <div className="dialog__actions">
          <button onClick={onClose}>닫기</button>
        </div>
      </div>
    </div>
  );
}
