import { useCallback, useEffect, useState } from 'react';
import { mcpSnippet, type McpInfo } from './mcp-snippet';

interface AuditRow {
  t: string;
  client?: string;
  action: 'create' | 'append' | 'update' | 'denied' | 'revert' | 'comment';
  tool: string;
  path: string;
  note?: string;
}

const KEY = 'nops.mcp';
const ACTION_LABEL: Record<AuditRow['action'], string> = { create: '새로 만듦', append: '덧붙임', update: '고침', denied: '거부됨', revert: '되돌림', comment: '댓글' };

const load = (): { write: boolean; folder: string } => {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}') as { write?: boolean; folder?: string };
    return { write: !!v.write, folder: typeof v.folder === 'string' ? v.folder : 'AI' };
  } catch {
    return { write: false, folder: 'AI' };
  }
};

/** 설정 화면의 "AI 에이전트 연결(MCP)": 연결 방법 복사와 에이전트가 한 일 보기 */
export function McpSettings({ onOpenNote, onReverted }: { onOpenNote: (path: string) => void; onReverted: (path: string, kind: 'restored' | 'trashed') => void }) {
  const [info, setInfo] = useState<McpInfo | null>(null);
  const [cfg, setCfg] = useState(load);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [copied, setCopied] = useState('');
  /** 되돌리기 확인 중인 기록과 결과 문구 */
  const [confirming, setConfirming] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const revert = async (a: AuditRow) => {
    try {
      const r = await window.nops.mcp.revert({ t: a.t, path: a.path });
      setMessage(r.kind === 'trashed' ? `휴지통으로 옮겼어요: ${a.path}` : `이전 내용으로 되돌렸어요: ${a.path}`);
      onReverted(a.path, r.kind);
    } catch (e) {
      setMessage(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e));
    }
    setConfirming(null);
    refresh();
  };

  const refresh = useCallback(() => void window.nops.mcp.audit({ limit: 30 }).then(setAudit), []);
  useEffect(() => {
    void window.nops.mcp.info().then(setInfo);
    refresh();
  }, [refresh]);
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(cfg));
    } catch {
      /* 저장 못 해도 이번 실행에는 적용된다 */
    }
  }, [cfg]);

  if (!info) return null;
  /** 이미 되돌린 기록(`revert:<t>` 메모가 붙은 되돌림 기록이 가리키는 것) */
  const reverted = new Set(audit.filter((a) => a.action === 'revert' && a.note?.startsWith('revert:')).map((a) => `${a.note!.slice(7)}|${a.path}`));
  const snippet = mcpSnippet(info, { write: cfg.write, folder: cfg.folder });
  const copy = (label: string, text: string) => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(label);
      setTimeout(() => setCopied(''), 1800);
    });
  };

  return (
    <section data-testid="mcp-settings">
      <h3>AI 에이전트 연결 (MCP)</h3>
      <p className="muted small">
        Claude 같은 AI 에이전트가 이 볼트의 노트를 찾아 읽고(기본), 허용하면 새 노트를 쓰게 해요. 앱이 꺼져 있어도 동작해요.{' '}
        {info.packaged ? 'Node.js 없이 이 앱 실행 파일이 MCP 서버로 동작해요.' : '개발 빌드라 Node.js 22 이상이 필요해요.'}
      </p>
      <label className="settings__row">
        <span>
          에이전트가 노트 쓰기 허용
          <small className="muted">끄면 읽기만 가능해요. 쓰기는 아래 폴더 안에서만, 기존 노트는 덧붙이기·해시 확인 후 고치기만 돼요.</small>
        </span>
        <input type="checkbox" checked={cfg.write} onChange={(e) => setCfg({ ...cfg, write: e.target.checked })} aria-label="에이전트가 노트 쓰기 허용" />
      </label>
      {cfg.write && (
        <label className="settings__row">
          <span>
            쓸 수 있는 폴더
            <small className="muted">볼트 전체는 .(점)으로 적어요.</small>
          </span>
          <input className="settings__text" value={cfg.folder} onChange={(e) => setCfg({ ...cfg, folder: e.target.value })} aria-label="쓸 수 있는 폴더" />
        </label>
      )}
      {snippet ? (
        <div className="mcp__snippets">
          <div>
            <div className="mcp__label">
              <strong>Claude Code</strong>
              <button onClick={() => copy('cli', snippet.cli)}>{copied === 'cli' ? '복사했어요' : '명령 복사'}</button>
            </div>
            <pre className="mcp__code" data-testid="mcp-cli">{snippet.cli}</pre>
          </div>
          <div>
            <div className="mcp__label">
              <strong>Claude Desktop 등 (JSON 설정)</strong>
              <button onClick={() => copy('json', snippet.json)}>{copied === 'json' ? '복사했어요' : '설정 복사'}</button>
            </div>
            <pre className="mcp__code" data-testid="mcp-json">{snippet.json}</pre>
          </div>
        </div>
      ) : (
        <p className="warn small">이 빌드에는 MCP 서버 파일이 없어요. 앱을 다시 설치하거나 개발 중이면 <code>pnpm --filter @nopsidian/mcp build</code> 를 실행하세요.</p>
      )}
      <div className="mcp__audit">
        <div className="mcp__label">
          <strong>최근 에이전트 작업</strong>
          <button onClick={refresh}>새로고침</button>
        </div>
        {audit.length === 0 ? (
          <p className="muted small">아직 에이전트가 쓴 기록이 없어요.</p>
        ) : (
          <ul data-testid="mcp-audit">
            {audit.map((a, i) => (
              <li key={`${a.t}-${i}`} className={`${a.action === 'denied' ? 'denied' : ''}${reverted.has(`${a.t}|${a.path}`) ? ' reverted' : ''}`.trim()}>
                <span className="muted small">{new Date(a.t).toLocaleString()}</span>
                <span className="mcp__act">{ACTION_LABEL[a.action]}</span>
                {a.action === 'denied' ? (
                  <span title={a.note}>{a.path}</span>
                ) : (
                  <button className="link" onClick={() => onOpenNote(a.path)} title="노트 열기">
                    {a.path}
                  </button>
                )}
                <span className="muted small">{a.client ?? ''}</span>
                {(a.action === 'create' || a.action === 'append' || a.action === 'update') && !reverted.has(`${a.t}|${a.path}`) && (
                  confirming === `${a.t}|${a.path}` ? (
                    <span className="mcp__confirm">
                      <button className="danger" onClick={() => void revert(a)} data-testid="mcp-revert-confirm">정말 되돌리기</button>
                      <button onClick={() => setConfirming(null)}>취소</button>
                    </span>
                  ) : (
                    <button className="mcp__undo" onClick={() => setConfirming(`${a.t}|${a.path}`)} data-testid="mcp-revert" title={a.action === 'create' ? '이 노트를 휴지통으로' : '이 작업 전 내용으로 복원'}>
                      되돌리기
                    </button>
                  )
                )}
              </li>
            ))}
          </ul>
        )}
        {message && <p className="small" role="status" data-testid="mcp-revert-msg">{message}</p>}
        <p className="muted small">“되돌리기”는 그 뒤로 노트가 바뀌지 않았을 때만 돼요(더 최근 작업부터). 그 밖에는 노트의 “버전 기록”에서 복원하세요.</p>
      </div>
    </section>
  );
}
