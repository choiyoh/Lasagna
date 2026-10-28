import { useCallback, useEffect, useState } from 'react';
import { defaultServerName, folderContains, folderError, isValidServerName, mcpSnippet, type McpInfo } from './mcp-snippet';
import { loadMcpSettings, saveMcpSettings, serverNameConflict, type McpSettingsConfig } from './mcp-settings';

interface AuditRow {
  t: string;
  client?: string;
  action: 'create' | 'append' | 'update' | 'denied' | 'revert' | 'comment';
  tool: string;
  path: string;
  note?: string;
}

const ACTION_LABEL: Record<AuditRow['action'], string> = { create: '새로 만듦', append: '덧붙임', update: '고침', denied: '거부됨', revert: '되돌림', comment: '댓글' };

/** 설정 화면의 "AI 에이전트 연결(MCP)": 클라이언트별 연결 방법 복사와 에이전트가 한 일 보기 */
export function McpSettings({ onOpenNote, onReverted }: { onOpenNote: (path: string) => void; onReverted: (path: string, kind: 'restored' | 'trashed') => void }) {
  const [info, setInfo] = useState<McpInfo | null>(null);
  const [cfg, setCfg] = useState<McpSettingsConfig | null>(null);
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
    void window.nops.mcp.info().then((next) => {
      setInfo(next);
      setCfg(loadMcpSettings(next.vaultId, next.vaultName));
    });
    refresh();
  }, [refresh]);

  if (!info) return null;
  /** 설정은 볼트마다 따로 저장한다. 바뀔 때마다 이 볼트에만 쓴다. */
  const initial: McpSettingsConfig = { write: false, folder: 'AI', allowDailyFolder: false, name: defaultServerName(info), client: 'claude-code' };
  const current = cfg ?? initial;
  const update = (patch: Partial<McpSettingsConfig>) => {
    const next = { ...current, ...patch };
    setCfg(next);
    saveMcpSettings(info.vaultId, next);
  };
  /** 이미 되돌린 기록(`revert:<t>` 메모가 붙은 되돌림 기록이 가리키는 것) */
  const reverted = new Set(audit.filter((a) => a.action === 'revert' && a.note?.startsWith('revert:')).map((a) => `${a.note!.slice(7)}|${a.path}`));
  const nameOk = !current.name.trim() || isValidServerName(current.name);
  const conflict = nameOk && current.name.trim() !== '' && serverNameConflict(current.name, info.vaultId);
  const folderIssue = current.write ? folderError(current.folder) : null;
  const dailyIssue = current.write && current.allowDailyFolder ? folderError(info.dailyFolder) : null;
  const invalidFolder = folderIssue ?? dailyIssue;
  /** 데일리 폴더가 이미 허용 범위(볼트 전체 또는 상위 폴더)에 들어 있는가 — 정책의 canWrite 와 같은 판정 */
  const dailyCovered = !folderIssue && folderContains(current.folder, info.dailyFolder);
  const snippet = invalidFolder || !nameOk ? null : mcpSnippet(info, { write: current.write, folder: current.folder, allowDailyFolder: current.allowDailyFolder, dailyFolder: info.dailyFolder, name: current.name });
  const active = snippet?.clients.find((c) => c.id === current.client) ?? snippet?.clients[0];
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
        <input type="checkbox" checked={current.write} onChange={(e) => update({ write: e.target.checked })} aria-label="에이전트가 노트 쓰기 허용" />
      </label>
      {current.write && (
        <>
          <label className="settings__row">
            <span>
              쓸 수 있는 폴더
              <small className="muted">볼트 전체는 .(점)으로 적어요.</small>
            </span>
            <input className="settings__text" value={current.folder} onChange={(e) => update({ folder: e.target.value })} aria-label="쓸 수 있는 폴더" />
          </label>
          {folderIssue && (
            <p className="warn small" data-testid="mcp-folder-warning">
              {folderIssue} 폴더를 고치기 전에는 붙여 넣을 스니펫을 만들지 않아요.
            </p>
          )}
          <label className="settings__row">
            <span>
              오늘의 노트 폴더도 허용
              <small className="muted">
                켜면 {info.dailyFolder}/ 도 쓰기 허용 폴더에 넣어요. 끄면 append_to_daily_note 가 forbidden-folder 로 거부돼요.
              </small>
            </span>
            <input
              type="checkbox"
              checked={current.allowDailyFolder}
              onChange={(e) => update({ allowDailyFolder: e.target.checked })}
              aria-label="오늘의 노트 폴더도 허용"
            />
          </label>
          {dailyIssue && (
            <p className="warn small" data-testid="mcp-folder-warning">
              {dailyIssue} 오늘의 노트 폴더 설정을 앱에서 고쳐 주세요.
            </p>
          )}
          {!current.allowDailyFolder && !folderIssue && !dailyCovered && (
            <p className="warn small" data-testid="mcp-daily-warning">
              오늘의 노트 폴더({info.dailyFolder}/)가 허용 폴더에 없어요. 이대로면 오늘의 노트에 쓰기는 forbidden-folder 로 실패해요.
            </p>
          )}
        </>
      )}
      <label className="settings__row">
        <span>
          서버 이름
          <small className="muted">클라이언트 설정 파일의 키예요. 두 볼트를 함께 등록해도 겹치지 않게 볼트 이름이 붙어요.</small>
        </span>
        <input
          className="settings__text"
          value={current.name}
          placeholder={defaultServerName(info)}
          onChange={(e) => update({ name: e.target.value })}
          aria-label="MCP 서버 이름"
        />
      </label>
      {!nameOk && (
        <p className="warn small" data-testid="mcp-name-warning">
          이름에는 공백 없이 글자·숫자와 . _ - 만 쓸 수 있어요. 고치기 전에는 붙여 넣을 스니펫을 만들지 않아요.
        </p>
      )}
      {conflict && (
        <p className="warn small" data-testid="mcp-name-conflict">
          같은 이름을 쓰는 다른 볼트 설정이 있어요. 두 볼트를 함께 등록하면 나중에 등록한 쪽이 앞의 것을 덮어써요.
        </p>
      )}
      {invalidFolder || !nameOk ? null : snippet && active ? (
        <div className="mcp__snippets">
          <div className="mcp__tabs" role="tablist" aria-label="MCP 클라이언트">
            {snippet.clients.map((c) => (
              <button key={c.id} role="tab" aria-selected={c.id === active.id} className={c.id === active.id ? 'on' : ''} onClick={() => update({ client: c.id })}>
                {c.label}
              </button>
            ))}
          </div>
          <div>
            <div className="mcp__label">
              <strong>{active.label}</strong>
              <span className="muted small">{active.target}</span>
              <button onClick={() => copy(active.id, active.code)}>{copied === active.id ? '복사했어요' : '복사'}</button>
            </div>
            <pre
              className="mcp__code"
              data-testid={active.id === 'claude-code' ? 'mcp-cli' : active.id === 'claude-desktop' ? 'mcp-json' : `mcp-code-${active.id}`}
            >
              {active.code}
            </pre>
            <p className="muted small">{active.hint}</p>
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
