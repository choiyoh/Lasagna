import { useCallback, useEffect, useState } from 'react';
import { t, type MessageKey } from '@nopsidian/i18n';
import { defaultServerName, folderContains, folderError, isValidServerName, mcpSnippet, type McpInfo } from './mcp-snippet';
import { configFromPolicy, loadMcpSettings, policyFolders, saveMcpSettings, serverNameConflict, type McpSettingsConfig } from './mcp-settings';

interface AuditRow {
  t: string;
  client?: string;
  action: 'create' | 'append' | 'update' | 'denied' | 'revert' | 'comment';
  tool: string;
  path: string;
  note?: string;
}

type PolicyErrorState = { code?: string; params?: Record<string, string>; message: string };

/** 정책 오류 문구: 사전 코드가 있으면 지금 언어로, 없으면 서버가 준 문장 그대로. */
function policyErrorText(error: PolicyErrorState | null): string {
  if (!error) return '';
  if (error.code) {
    // 형식 오류는 어느 자리가 문제인지 알 때만 경로·메시지를 붙인다(base 와 같은 선택 규칙).
    const key = (error.code === 'invalidSchema' && !error.params?.path ? 'mcp.policyErr.invalidSchemaNoIssue' : `mcp.policyErr.${error.code}`) as MessageKey;
    const text = t(key, error.params as never);
    if (!text.startsWith('mcp.policyErr.')) return text;
  }
  return error.message;
}

/** 문장 안의 `{name}` 자리를 <code> 로 그린다(강조 위치는 그대로 두고 문구만 번역). */
function withCode(key: MessageKey, name: string, value: string) {
  const [before, after = ''] = t(key).split(`{${name}}`);
  return (
    <>
      {before}
      <code>{value}</code>
      {after}
    </>
  );
}

const ACTION_LABEL: Record<AuditRow['action'], string> = {
  create: 'mcp.action.create',
  append: 'mcp.action.append',
  update: 'mcp.action.update',
  denied: 'mcp.action.denied',
  revert: 'mcp.action.revert',
  comment: 'mcp.action.comment',
};

/** 설정 화면의 "AI 에이전트 연결(MCP)": 클라이언트별 연결 방법 복사와 에이전트가 한 일 보기 */
export function McpSettings({ onOpenNote, onReverted }: { onOpenNote: (path: string) => void; onReverted: (path: string, kind: 'restored' | 'trashed') => void }) {
  const [info, setInfo] = useState<McpInfo | null>(null);
  const [cfg, setCfg] = useState<McpSettingsConfig | null>(null);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [copied, setCopied] = useState('');
  /** 되돌리기 확인 중인 기록과 결과 문구 */
  const [confirming, setConfirming] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  /** 앱 정책 파일을 읽거나 쓰지 못한 이유. 있으면 쓰기는 서버에서 차단된다. */
  /** 정책 오류: 코드가 있으면 표시 시점에 지금 언어로 만든다(파일 안 문구는 옛 언어로 굳지 않게). */
  const [policyError, setPolicyError] = useState<{ code?: string; params?: Record<string, string>; message: string } | null>(null);
  /** 정책 파일이 실제로 있는가. false 면 지금은 에이전트 인자만 적용된다. */
  const [policyExists, setPolicyExists] = useState<boolean | null>(null);
  const revert = async (a: AuditRow) => {
    try {
      const r = await window.nops.mcp.revert({ t: a.t, path: a.path });
      setMessage(r.kind === 'trashed' ? t('mcp.reverted.trashed', { path: a.path }) : t('mcp.reverted.restored', { path: a.path }));
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
      const loaded = loadMcpSettings(next.vaultId, next.vaultName);
      // 예전 UI 의 빈 폴더는 볼트 전체(.)였다. 로드할 때만 '.'로 옮기고, 입력 중 빈 값은 저장하지 않는다.
      const local = loaded.folder.trim() === '' ? { ...loaded, folder: '.' } : loaded;
      void window.nops.mcp.policyGet()
        .then((read) => {
          if (read.policy) {
            const merged = { ...local, ...configFromPolicy(read.policy, next.dailyFolder) };
            setCfg(merged);
            setPolicyExists(true);
            saveMcpSettings(next.vaultId, merged);
            setPolicyError(read.error ? { code: read.errorCode ?? undefined, params: read.errorParams, message: read.error } : null);
            return;
          }
          setPolicyExists(read.exists);
          // 파일이 깨졌으면 서버가 쓰기를 막으므로 화면도 안전한 쪽(꺼짐)으로 보여 준다.
          setCfg(read.error ? { ...local, write: false } : local);
          setPolicyError(read.error ? { code: read.errorCode ?? undefined, params: read.errorParams, message: read.error } : null);
        })
        .catch((e) => {
          setPolicyExists(null);
          setCfg({ ...local, write: false });
          setPolicyError({ message: e instanceof Error ? e.message : String(e) });
        });
    });
    refresh();
  }, [refresh]);

  if (!info) return null;
  /** 설정은 볼트마다 따로 저장한다. 바뀔 때마다 이 볼트에만 쓴다. */
  const initial: McpSettingsConfig = { write: false, folder: 'AI', allowDailyFolder: false, maxWritesPerMinute: 30, name: defaultServerName(info), client: 'claude-code' };
  const current = cfg ?? initial;
  /** 빈 폴더는 입력 중일 수 있으므로 정책 파일에 쓰지 않는다(볼트 전체는 `.`). */
  const folderProblem = (folder: string) => (folder.trim() === '' ? t('mcp.needFolder') : folderError(folder));
  /** 바뀐 정책 값을 파일(정본)에 쓴다. 파일이 없으면 서버는 기존 인자 동작을 유지한다. */
  const savePolicy = (next: McpSettingsConfig) => {
    const folderIssue = folderProblem(next.folder);
    const dailyIssue = next.allowDailyFolder ? folderProblem(info.dailyFolder) : null;
    let folders: string[];
    if (folderIssue || dailyIssue) {
      if (next.write) {
        setPolicyError({ message: t('mcp.fixFolderFirst', { issue: folderIssue ?? dailyIssue ?? '' }) });
        return; // 켠 상태의 잘못된 폴더는 저장하지 않는다
      }
      folders = [t('mcp.defaultFolder')]; // 끈 상태는 폴더와 무관하므로 정책 파일을 유효하게 남긴다
    } else {
      try {
        folders = policyFolders(next.folder, next.allowDailyFolder, info.dailyFolder);
      } catch {
        return;
      }
    }
    void window.nops.mcp.policySet({ write: next.write, writeFolders: folders, maxWritesPerMinute: next.maxWritesPerMinute })
      .then((saved) => {
        setPolicyError(null);
        setPolicyExists(true);
        // 응답이 늦게 와도 그 사이 친 폴더·이름을 되돌리지 않는다.
        setCfg((prev) => (prev ? { ...prev, maxWritesPerMinute: saved.maxWritesPerMinute } : prev));
      })
      .catch((e) => setPolicyError({ message: e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e) }));
  };
  const update = (patch: Partial<McpSettingsConfig>) => {
    const next = { ...current, ...patch };
    setCfg(next);
    saveMcpSettings(info.vaultId, next);
    if ('write' in patch || 'folder' in patch || 'allowDailyFolder' in patch || 'maxWritesPerMinute' in patch) savePolicy(next);
  };
  /** 이미 되돌린 기록(`revert:<t>` 메모가 붙은 되돌림 기록이 가리키는 것) */
  const reverted = new Set(audit.filter((a) => a.action === 'revert' && a.note?.startsWith('revert:')).map((a) => `${a.note!.slice(7)}|${a.path}`));
  const nameOk = !current.name.trim() || isValidServerName(current.name);
  const conflict = nameOk && current.name.trim() !== '' && serverNameConflict(current.name, info.vaultId);
  const folderIssue = current.write ? folderProblem(current.folder) : null;
  const dailyIssue = current.write && current.allowDailyFolder ? folderProblem(info.dailyFolder) : null;
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
      <h3>{t('mcp.title')}</h3>
      <p className="muted small">
        {t('mcp.intro')}{' '}
        {info.packaged ? t('mcp.packagedServer') : t('mcp.devServer')}
      </p>
      <label className="settings__row">
        <span>
          {t('mcp.writeLabel')}
          <small className="muted">{t('mcp.writeHint')}</small>
        </span>
        <input type="checkbox" checked={current.write} onChange={(e) => update({ write: e.target.checked })} aria-label={t('mcp.writeLabel')} />
      </label>
      <p className="muted small" data-testid="mcp-policy-note">
        {withCode('mcp.policySaved', 'file', '.nopsidian/mcp-policy.json')}
      </p>
      <p className="muted small" data-testid="mcp-policy-device-note">
        {t('mcp.policyDevice')}
      </p>
      {policyError && (
        <p className="warn small" data-testid="mcp-policy-warning">
          {t('mcp.policyErrorRetry', { error: policyErrorText(policyError) })}
        </p>
      )}
      {policyExists === false && (
        <div className="settings__row" data-testid="mcp-policy-missing">
          <span>
            {t('mcp.policyMissing', { write: '--write', folder: '--write-folder' })}
            <small className="muted">{t('mcp.policyMissingHint')}</small>
          </span>
          <button type="button" data-testid="mcp-policy-create" onClick={() => savePolicy(current)}>
            {t('mcp.savePolicy')}
          </button>
        </div>
      )}
      {current.write && (
        <>
          <label className="settings__row">
            <span>
              {t('mcp.folderLabel')}
              <small className="muted">{t('mcp.folderHint')}</small>
            </span>
            <input className="settings__text" value={current.folder} onChange={(e) => update({ folder: e.target.value })} aria-label={t('mcp.folderLabel')} />
          </label>
          {folderIssue && (
            <p className="warn small" data-testid="mcp-folder-warning">
              {t('mcp.folderBlocked', { issue: folderIssue })}
            </p>
          )}
          <label className="settings__row">
            <span>
              {t('mcp.dailyAllow')}
              <small className="muted">{t('mcp.dailyAllowHint', { folder: info.dailyFolder })}</small>
            </span>
            <input
              type="checkbox"
              checked={current.allowDailyFolder}
              onChange={(e) => update({ allowDailyFolder: e.target.checked })}
              aria-label={t('mcp.dailyAllow')}
            />
          </label>
          {dailyIssue && (
            <p className="warn small" data-testid="mcp-folder-warning">
              {t('mcp.dailyFix', { issue: dailyIssue })}
            </p>
          )}
          {!current.allowDailyFolder && !folderIssue && !dailyCovered && (
            <p className="warn small" data-testid="mcp-daily-warning">
              {t('mcp.dailyNotCovered', { folder: info.dailyFolder })}
            </p>
          )}
        </>
      )}
      <label className="settings__row">
        <span>
          {t('mcp.serverName')}
          <small className="muted">{t('mcp.serverNameHint')}</small>
        </span>
        <input
          className="settings__text"
          value={current.name}
          placeholder={defaultServerName(info)}
          onChange={(e) => update({ name: e.target.value })}
          aria-label={t('mcp.serverNameAria')}
        />
      </label>
      {!nameOk && (
        <p className="warn small" data-testid="mcp-name-warning">
          {t('mcp.serverNameInvalid')}
        </p>
      )}
      {conflict && (
        <p className="warn small" data-testid="mcp-name-conflict">
          {t('mcp.serverNameTaken')}
        </p>
      )}
      {invalidFolder || !nameOk ? null : snippet && active ? (
        <div className="mcp__snippets">
          <div className="mcp__tabs" role="tablist" aria-label={t('mcp.clientsTab')}>
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
              <button onClick={() => copy(active.id, active.code)}>{copied === active.id ? t('mcp.copied') : t('mcp.copy')}</button>
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
        <p className="warn small">{t('mcp.noServer', { command: 'pnpm --filter @nopsidian/mcp build' })}</p>
      )}
      <div className="mcp__audit">
        <div className="mcp__label">
          <strong>{t('mcp.recent')}</strong>
          <button onClick={refresh}>{t('mcp.refresh')}</button>
        </div>
        {audit.length === 0 ? (
          <p className="muted small">{t('mcp.noHistory')}</p>
        ) : (
          <ul data-testid="mcp-audit">
            {audit.map((a, i) => (
              <li key={`${a.t}-${i}`} className={`${a.action === 'denied' ? 'denied' : ''}${reverted.has(`${a.t}|${a.path}`) ? ' reverted' : ''}`.trim()}>
                <span className="muted small">{new Date(a.t).toLocaleString()}</span>
                <span className="mcp__act">{t(ACTION_LABEL[a.action] as MessageKey)}</span>
                {a.action === 'denied' ? (
                  <span title={a.note}>{a.path}</span>
                ) : (
                  <button className="link" onClick={() => onOpenNote(a.path)} title={t('mcp.openNote')}>
                    {a.path}
                  </button>
                )}
                <span className="muted small">{a.client ?? ''}</span>
                {(a.action === 'create' || a.action === 'append' || a.action === 'update') && !reverted.has(`${a.t}|${a.path}`) && (
                  confirming === `${a.t}|${a.path}` ? (
                    <span className="mcp__confirm">
                      <button className="danger" onClick={() => void revert(a)} data-testid="mcp-revert-confirm">{t('mcp.confirmRevert')}</button>
                      <button onClick={() => setConfirming(null)}>{t('common.cancel')}</button>
                    </span>
                  ) : (
                    <button
                      className="mcp__undo"
                      onClick={() => setConfirming(`${a.t}|${a.path}`)}
                      data-testid="mcp-revert"
                      title={a.action === 'create' ? t('mcp.revertCreate') : t('mcp.revertUpdate')}
                    >
                      {t('mcp.revert')}
                    </button>
                  )
                )}
              </li>
            ))}
          </ul>
        )}
        {message && <p className="small" role="status" data-testid="mcp-revert-msg">{message}</p>}
        <p className="muted small">{t('mcp.revertHint')}</p>
      </div>
    </section>
  );
}
