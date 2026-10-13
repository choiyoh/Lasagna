import { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { NopsRowPropsHost } from '@nopsidian/editor/nops';
import { CellEditor, CellView } from './CellEditor';
import { makeDef, TYPE_LABEL, WITH_OPTIONS } from './PropertyManager';
import type { CellValue, DbRowDto, DbSchema, Property } from './types';

/** 행 패널에서 바로 만들 수 있는 속성 형식(관계·롤업·수식은 데이터베이스 화면의 속성 관리에서) */
const QUICK_TYPES = ['text', 'number', 'select', 'multi_select', 'status', 'date', 'checkbox', 'url', 'email', 'phone'];

interface RowInfo {
  folder: string;
  schema: DbSchema;
  row: DbRowDto;
  errors: Record<string, string>;
}

const COMPUTED = new Set(['rollup', 'formula', 'created_time', 'updated_time', 'unique_id']);

/** 데이터베이스 행 노트의 제목 아래 속성 목록. 값을 눌러 바로 고친다(프런트매터에 쓰인다). */
function RowProps({ path, notes, hasTitle, onRename }: { path: string; notes: () => { path: string; title: string }[]; hasTitle: boolean; onRename?: () => void }) {
  const [info, setInfo] = useState<RowInfo | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [open, setOpen] = useState(true);
  const [adding, setAdding] = useState<{ name: string; type: string; opts: string } | null>(null);
  const [addError, setAddError] = useState('');

  const load = useCallback(async () => {
    try {
      setInfo((await window.nops.db.row({ path })) as RowInfo | null);
    } catch {
      setInfo(null);
    }
  }, [path]);

  useEffect(() => {
    void load();
    let t: ReturnType<typeof setTimeout> | undefined;
    const off = window.nops.on('note.changed', (e) => {
      if (e.path !== path) return;
      clearTimeout(t);
      t = setTimeout(() => void load(), 300);
    });
    const offAsset = window.nops.on('asset.changed', (e) => {
      if (e.path.endsWith('_db.yaml')) void load();
    });
    return () => {
      clearTimeout(t);
      off();
      offAsset();
    };
  }, [path, load]);

  const commit = async (prop: string, value: CellValue) => {
    setEditing(null);
    setInfo((cur) => (cur ? { ...cur, row: { ...cur.row, values: { ...cur.row.values, [prop]: value } } } : cur));
    try {
      await window.nops.db.updateCell({ path, prop, value });
    } finally {
      void load();
    }
  };

  const addProperty = async () => {
    if (!adding || !info) return;
    const name = adding.name.trim();
    if (!name || name === 'title' || name in (info.schema.properties as Record<string, unknown>)) {
      setAddError(!name ? '이름을 입력해 주세요' : '이미 있는 이름이에요');
      return;
    }
    try {
      await window.nops.db.editSchema({ folder: info.folder, op: { kind: 'setProperty', name, def: makeDef(adding.type, adding.opts) } });
      setAdding(null);
      setAddError('');
      await load();
      setEditing(name);
    } catch (e) {
      setAddError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e));
    }
  };

  if (!info) return null;
  const entries = Object.entries(info.schema.properties) as [string, Property][];
  if (entries.length === 0) return null;
  const dbName = info.schema.title ?? info.folder.split('/').pop() ?? '데이터베이스';

  return (
    <div className="rowprops" data-testid="row-props-panel">
      {!hasTitle && (
        <h1 className="rowprops__title" title="이름 바꾸기" onClick={onRename}>
          {info.row.title}
        </h1>
      )}
      <button className="rowprops__head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span aria-hidden>{open ? '▾' : '▸'}</span> {dbName} 속성
      </button>
      {open &&
        entries.map(([name, prop]) => {
          const value = (info.row.values[name] ?? null) as CellValue;
          const computed = COMPUTED.has(prop.type);
          const err = info.errors[name];
          return (
            <div key={name} className="rowprops__row" data-prop={name}>
              <span className="rowprops__name" title={prop.type}>
                {name}
              </span>
              <div className="rowprops__value">
                {err ? (
                  <span className="warn small" title={err}>⚠ {err}</span>
                ) : computed ? (
                  <CellView prop={prop} value={value} />
                ) : editing === name ? (
                  <CellEditor prop={prop} value={value} autoFocus notes={notes()} onCommit={(v) => void commit(name, v)} />
                ) : (
                  <button className="rowprops__cell" onClick={() => setEditing(name)} aria-label={`${name} 편집`}>
                    {value === null || (Array.isArray(value) && !value.length) ? <span className="muted">비어 있음</span> : <CellView prop={prop} value={value} />}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      {open &&
        (adding ? (
          <div className="rowprops__new" data-testid="row-prop-add-form">
            <input
              autoFocus
              value={adding.name}
              placeholder="속성 이름"
              aria-label="새 속성 이름"
              onChange={(e) => setAdding({ ...adding, name: e.target.value })}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing) return;
                if (e.key === 'Enter') void addProperty();
                if (e.key === 'Escape') setAdding(null);
              }}
            />
            <select value={adding.type} aria-label="새 속성 형식" onChange={(e) => setAdding({ ...adding, type: e.target.value })}>
              {QUICK_TYPES.map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABEL[t]}
                </option>
              ))}
            </select>
            {WITH_OPTIONS.has(adding.type) && (
              <input value={adding.opts} placeholder="옵션(쉼표로 구분)" aria-label="새 속성 옵션" onChange={(e) => setAdding({ ...adding, opts: e.target.value })} />
            )}
            <button className="primary" onClick={() => void addProperty()}>추가</button>
            <button onClick={() => setAdding(null)}>취소</button>
            {addError && <span className="warn small">{addError}</span>}
          </div>
        ) : (
          <button className="rowprops__add" onClick={() => setAdding({ name: '', type: 'text', opts: '' })} data-testid="row-prop-add">
            + 속성 추가
          </button>
        ))}
    </div>
  );
}

/** 에디터에 꽂는 속성 패널 호스트 */
export function createRowPropsHost(path: string, notes: () => { path: string; title: string }[], onRename?: () => void): NopsRowPropsHost {
  return {
    mount(container, { hasTitle }) {
      const root = createRoot(container);
      root.render(<RowProps path={path} notes={notes} hasTitle={hasTitle} onRename={onRename} />);
      return { destroy: () => root.unmount() };
    },
  };
}
