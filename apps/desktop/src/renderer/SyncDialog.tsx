import { useCallback, useEffect, useState } from 'react';
import type { SyncStatus } from '@nopsidian/ipc-contract';

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

  const s = status;
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
            <button disabled={!s?.enabled || !s.connected || !!busy} onClick={() => void act('plan', async () => { setResult(null); setPlan(await window.nops.sync.plan()); })}>
              {s?.confirmedFirst ? '지금 동기화…' : '첫 동기화 미리보기'}
            </button>
          </div>
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
