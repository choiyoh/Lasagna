import { useState } from 'react';

type Preview = NonNullable<Awaited<ReturnType<typeof window.nops.db.importCsvPreview>>>;

const TYPES: [string, string][] = [
  ['skip', '건너뛰기'], ['title', '제목'], ['text', '텍스트'], ['number', '숫자'], ['select', '선택'], ['multi_select', '다중 선택'],
  ['date', '날짜'], ['checkbox', '체크박스'], ['url', 'URL'], ['email', '이메일'], ['phone', '전화'],
];

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
        columns: cols.map((c) => ({ index: c.index, name: c.name.trim() || c.header || `열${c.index + 1}`, type: c.type })),
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
      <div className="dialog csvdialog" role="dialog" aria-modal="true" aria-label="CSV 가져오기">
        <h2>CSV 가져오기 — {preview.fileName} ({preview.rowCount}행)</h2>
        {result ? (
          <>
            <p>{result.rows}개 행을 가져왔어요.</p>
            {result.issues.length > 0 && (
              <ul className="csvdialog__issues">
                {result.issues.map((i, k) => (
                  <li key={k}>{i}</li>
                ))}
              </ul>
            )}
            <div className="dialog__actions">
              <button className="primary" onClick={() => onDone(result.folder)}>데이터베이스 열기</button>
            </div>
          </>
        ) : (
          <>
            <div className="csvdialog__target">
              <label className="small">
                <input type="radio" checked={mode === 'new'} onChange={() => setMode('new')} /> 새 데이터베이스
              </label>
              {mode === 'new' && <input value={name} onChange={(e) => setName(e.target.value)} aria-label="새 데이터베이스 이름" />}
              {existing && (
                <label className="small">
                  <input type="radio" checked={mode === 'existing'} onChange={() => setMode('existing')} aria-label="기존 데이터베이스에 추가" /> “{existing.title}” 에 행 추가
                </label>
              )}
            </div>
            <table className="csvdialog__table">
              <thead>
                <tr>
                  <th>CSV 열</th>
                  <th>예시</th>
                  <th>속성 이름</th>
                  <th>형식</th>
                </tr>
              </thead>
              <tbody>
                {cols.map((c, i) => {
                  const locked = lockedType(c);
                  return (
                    <tr key={c.index}>
                      <td>{c.header || `열${c.index + 1}`}</td>
                      <td className="muted small">{c.sample.filter(Boolean).slice(0, 2).join(' · ')}</td>
                      <td>
                        <input value={c.name} onChange={(e) => setCols(cols.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} aria-label={`${c.header} 속성 이름`} disabled={c.type === 'skip'} />
                      </td>
                      <td>
                        <select
                          value={locked ?? c.type}
                          disabled={!!locked && c.type !== 'title'}
                          onChange={(e) =>
                            setCols(cols.map((x, j) => (j === i ? { ...x, type: e.target.value } : e.target.value === 'title' && x.type === 'title' ? { ...x, type: 'text' } : x)))
                          }
                          aria-label={`${c.header} 형식`}
                        >
                          {locked && !TYPES.some(([t]) => t === locked) && <option value={locked}>{locked}(기존)</option>}
                          {TYPES.map(([t, label]) => (
                            <option key={t} value={t}>{label}</option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {titles !== 1 && <p className="warn small">제목으로 쓸 열을 하나 골라 주세요.</p>}
            {error && <p className="warn small" role="alert">{error}</p>}
            <div className="dialog__actions">
              <button onClick={onClose}>취소</button>
              <button className="primary" onClick={() => void apply()} disabled={busy || titles !== 1}>
                {busy ? '가져오는 중…' : '가져오기'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
