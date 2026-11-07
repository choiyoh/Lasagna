import { useEffect, useState } from 'react';
import { t } from '@nopsidian/i18n';
import { CsvImportDialog } from './CsvImportDialog';
import { DatabaseIcon } from '../icons';
import { userMessage } from '../user-message';

interface Props {
  onOpen: (folder: string) => void;
}

/** 사이드바의 데이터베이스 목록 + 새 데이터베이스 만들기 */
export function DbList({ onOpen }: Props) {
  const [dbs, setDbs] = useState<Awaited<ReturnType<typeof window.nops.db.list>>>([]);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [importing, setImporting] = useState<Parameters<typeof CsvImportDialog>[0]['preview'] | null>(null);

  useEffect(() => {
    const load = () => void window.nops.db.list().then(setDbs).catch(() => undefined);
    load();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const again = () => {
      clearTimeout(timer);
      timer = setTimeout(load, 500);
    };
    // 언어가 바뀌면 제목 없는 데이터베이스의 기본 이름도 새 언어로 다시 읽는다.
    const offs = [window.nops.on('note.changed', again), window.nops.on('asset.changed', again), window.nops.on('language.changed', again)];
    return () => {
      clearTimeout(timer);
      offs.forEach((o) => o());
    };
  }, []);

  const create = async () => {
    const n = name.trim().replace(/[\\/:*?"<>|]/g, ' ').trim();
    if (!n) return;
    try {
      const r = await window.nops.db.create({ folder: n, title: n });
      setName('');
      setCreating(false);
      onOpen(r.folder);
    } catch (e) {
      setError(userMessage(e));
    }
  };

  return (
    <div className="dblistpanel" data-testid="db-panel">
      {dbs.length === 0 && <p className="muted small pad">{t('db.noneBefore')} <code>_db.yaml</code> {t('db.noneAfter')}</p>}
      <ul className="tags">
        {dbs.map((d) => (
          <li key={d.folder}>
            <button className="tag" onClick={() => onOpen(d.folder)} title={d.folder || t('db.vaultRoot')}>
              <span className="tag__name"><DatabaseIcon size={15} />{d.title}</span>
              <span className="count">{d.rowCount}</span>
            </button>
          </li>
        ))}
      </ul>
      {creating ? (
        <div className="dbadd">
          <input
            autoFocus
            value={name}
            placeholder={t('db.newDbPlaceholder')}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void create();
              if (e.key === 'Escape') setCreating(false);
            }}
            aria-label={t('db.dbNameAria')}
          />
          <button className="primary" onClick={() => void create()} disabled={!name.trim()}>{t('db.create')}</button>
        </div>
      ) : (
        <>
          <button className="new-note" onClick={() => setCreating(true)}>{t('db.newDb')}</button>
          <button
            className="new-note"
            onClick={() =>
              void window.nops.db.importCsvPreview().then(
                (p) => p && setImporting(p),
                (e) => setError(userMessage(e)),
              )
            }
          >
            {t('db.importCsv')}
          </button>
        </>
      )}
      {error && <p className="warn small pad">{error}</p>}
      {importing && (
        <CsvImportDialog
          preview={importing}
          onClose={() => setImporting(null)}
          onDone={(f) => {
            setImporting(null);
            onOpen(f);
          }}
        />
      )}
    </div>
  );
}
