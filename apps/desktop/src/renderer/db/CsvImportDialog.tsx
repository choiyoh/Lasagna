import { useState } from 'react';
import { t, tPlural } from '@nopsidian/i18n';
import { typeLabel } from './labels';

type Preview = NonNullable<Awaited<ReturnType<typeof window.nops.db.importCsvPreview>>>;

/** 가져올 때 고를 수 있는 열 형식. 값은 저장되는 키라 그대로 두고 라벨만 옮긴다. */
const TYPES = ['skip', 'title', 'text', 'number', 'select', 'multi_select', 'date', 'checkbox', 'url', 'email', 'phone'];
const typeLabelFor = (type: string): string => (type === 'skip' ? t('csv.skip') : typeLabel(type));

interface Props {
  preview: Preview;
  /** 현재 열려 있는 데이터베이스가 있으면 그쪽으로 가져오는 선택지를 준다 */
  existing?: { folder: string; title: string; properties: Record<string, { type: string }> };
  onClose: () => void;
  onDone: (folder: string) => void;
}

/** CSV 가져오기: 열마다 이름·형식을 고치고, 새 데이터베이스로 만들지 기존 데이터베이스에 더할지 정한다. */
export function CsvImportDialog({ preview, existing, onClose, onDone }: Props) {
  const [mode, setMode] = useState<'new' | 'existing'>(existing ? 'existing' : 'new');
  const [name, setName] = useState(preview.fileName.replace(/\.[^.]+$/, ''));
  const [cols, setCols] = useState(() =>
    preview.columns.map((c) => ({
      ...c,
      // 기존 DB 로 가져올 때 같은 이름의 속성이 있으면 그 형식을 따른다(아래 select 는 잠금)
    })),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ folder: string; rows: number; issues: string[] } | null>(null);

  const titles = cols.filter((c) => c.type === 'title').length;
  const lockedType = (c: (typeof cols)[number]) => (mode === 'existing' && existing?.properties[c.name] ? existing.properties[c.name]!.type : null);

  const apply = async () => {
    setBusy(true);
    setError('');
    try {
      const r = await window.nops.db.importCsvApply({
        token: preview.token,
        target: mode === 'new' ? { mode: 'new', name: name.trim() || preview.fileName } : { mode: 'existing', folder: existing!.folder },
        columns: cols.map((c) => ({ index: c.index, name: c.name.trim() || c.header || t('default.csvColumn', { n: c.index + 1 }), type: c.type })),
      });
      setResult(r);
    } catch (e) {
      setError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog csvdialog" role="dialog" aria-modal="true" aria-label={t('csv.title')}>
        <h2>{tPlural('csv.heading', preview.rowCount, { file: preview.fileName })}</h2>
        {result ? (
          <>
            <p>{tPlural('csv.done', result.rows)}</p>
            {result.issues.length > 0 && (
              <ul className="csvdialog__issues">
                {result.issues.map((i, k) => (
                  <li key={k}>{i}</li>
                ))}
              </ul>
            )}
            <div className="dialog__actions">
              <button className="primary" onClick={() => onDone(result.folder)}>{t('csv.openDb')}</button>
            </div>
          </>
        ) : (
          <>
            <div className="csvdialog__target">
              <label className="small">
                <input type="radio" checked={mode === 'new'} onChange={() => setMode('new')} /> {t('csv.newDb')}
              </label>
              {mode === 'new' && <input value={name} onChange={(e) => setName(e.target.value)} aria-label={t('csv.newDbName')} />}
              {existing && (
                <label className="small">
                  <input type="radio" checked={mode === 'existing'} onChange={() => setMode('existing')} aria-label={t('csv.addToExisting')} /> {t('csv.addRowsTo', { title: existing.title })}
                </label>
              )}
            </div>
            <table className="csvdialog__table">
              <thead>
                <tr>
                  <th>{t('csv.colCsv')}</th>
                  <th>{t('csv.sample')}</th>
                  <th>{t('csv.propName')}</th>
                  <th>{t('csv.type')}</th>
                </tr>
              </thead>
              <tbody>
                {cols.map((c, i) => {
                  const locked = lockedType(c);
                  return (
                    <tr key={c.index}>
                      <td>{c.header || t('default.csvColumn', { n: c.index + 1 })}</td>
                      <td className="muted small">{c.sample.filter(Boolean).slice(0, 2).join(' · ')}</td>
                      <td>
                        <input value={c.name} onChange={(e) => setCols(cols.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} aria-label={t('csv.propNameAria', { header: c.header })} disabled={c.type === 'skip'} />
                      </td>
                      <td>
                        <select
                          value={locked ?? c.type}
                          disabled={!!locked && c.type !== 'title'}
                          onChange={(e) =>
                            setCols(cols.map((x, j) => (j === i ? { ...x, type: e.target.value } : e.target.value === 'title' && x.type === 'title' ? { ...x, type: 'text' } : x)))
                          }
                          aria-label={t('csv.typeAria', { header: c.header })}
                        >
                          {locked && !TYPES.includes(locked) && <option value={locked}>{t('csv.existingType', { type: typeLabelFor(locked) })}</option>}
                          {TYPES.map((type) => (
                            <option key={type} value={type}>{typeLabelFor(type)}</option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {titles !== 1 && <p className="warn small">{t('csv.needTitle')}</p>}
            {error && <p className="warn small" role="alert">{error}</p>}
            <div className="dialog__actions">
              <button onClick={onClose}>{t('db.cancel')}</button>
              <button className="primary" onClick={() => void apply()} disabled={busy || titles !== 1}>
                {busy ? t('csv.importing') : t('csv.import')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
