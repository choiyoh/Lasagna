import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { View } from '@nopsidian/core/db';
import type { DbQueryResult } from '@nopsidian/ipc-contract';
import { BoardView } from './BoardView';
import { CalendarView } from './CalendarView';
import { TimelineView } from './TimelineView';
import { GalleryView, ListView } from './ListGalleryViews';
import { CsvImportDialog } from './CsvImportDialog';
import { PropertyManager } from './PropertyManager';
import { TableView, type RowAction } from './TableView';
import { TemplateSettings } from './TemplateSettings';
import { ViewToolbar } from './ViewToolbar';
import { type CellValue, type DbData, type DbRowDto } from './types';
import { hiddenColumnView, sortedView } from './view-edit';
import { addConditionTo, normalizeRoot, simplify } from './filter-tree';
import { defaultOp } from './filter-ops';

interface Props {
  folder: string;
  vaultId: string;
  onOpenNote: (path: string) => void;
  onClose: () => void;
  /** 관계 속성에서 고를 수 있는 볼트의 노트 */
  notes: { path: string; title: string }[];
  /** 제목 칸에서 이름을 바꾸면 노트 이름 변경 흐름(링크 갱신 포함)으로 넘긴다 */
  onRenameNote?: (path: string, title: string) => void;
  /** 행을 옆/가운데 창에서 열 때 노트 편집기를 그린다 */
  renderNote?: (path: string) => ReactNode;
}

type PeekMode = 'full' | 'side' | 'center';
const PEEK_KEY = 'nops.db.peek';
const readPeek = (): PeekMode => {
  try {
    const v = localStorage.getItem(PEEK_KEY);
    return v === 'side' || v === 'center' ? v : 'full';
  } catch {
    return 'full';
  }
};

const asData = (r: DbQueryResult): DbData => r as unknown as DbData;
const sameView = (a: View, b: View) => JSON.stringify(a) === JSON.stringify(b);
const uid = () => `v${Math.random().toString(36).slice(2, 7)}`;

/** 데이터베이스 한 개의 화면: 보기 탭 · 필터/정렬/그룹 · 표/보드/목록/갤러리 · 속성 관리 · 새 행. */
export function DatabaseScreen({ folder, vaultId, onOpenNote, onClose, notes, onRenameNote, renderNote }: Props) {
  const [data, setData] = useState<DbData | null>(null);
  const [viewId, setViewId] = useState<string | null>(null);
  const [draft, setDraft] = useState<View | null>(null);
  /** 열 머리 메뉴에서 "필터 추가"를 누르면 올라가 필터 창을 연다 */
  const [filterRequest, setFilterRequest] = useState(0);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState<{ title: string; values: Record<string, unknown>; template?: string | null } | null>(null);
  const [showProps, setShowProps] = useState(false);
  const [notice, setNotice] = useState('');
  /** 행 삭제 직후 되돌리기 */
  const [undoDelete, setUndoDelete] = useState<{ message: string; trashIds: string[] } | null>(null);
  const [peekMode, setPeekMode] = useState<PeekMode>(readPeek);
  const [peek, setPeek] = useState<string | null>(null);
  const [showTpl, setShowTpl] = useState(false);
  const [importing, setImporting] = useState<Parameters<typeof CsvImportDialog>[0]['preview'] | null>(null);
  const seq = useRef(0);

  const load = useCallback(
    async (override?: View | null) => {
      const n = ++seq.current;
      try {
        const v = override === undefined ? draft : override;
        const r = await window.nops.db.query({ folder, ...(v ? { view: v } : { viewId: viewId ?? undefined }), limit: 5000, groupLimit: 200 });
        if (n === seq.current) {
          setData(asData(r));
          setError('');
        }
      } catch (e) {
        if (n === seq.current) setError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e));
      }
    },
    [folder, viewId, draft],
  );

  useEffect(() => {
    void load();
  }, [load]);

  // 노트·`_db.yaml` 이 바뀌면(외부 편집 포함) 다시 불러온다.
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const again = () => {
      clearTimeout(t);
      t = setTimeout(() => void load(), 350);
    };
    const offs = [window.nops.on('note.changed', again), window.nops.on('asset.changed', (p) => (p as { path: string }).path.endsWith('_db.yaml') && again())];
    return () => {
      clearTimeout(t);
      offs.forEach((o) => o());
    };
  }, [load]);

  const saved = data?.schema.views.find((v) => v.id === data.view.id);
  const view = draft ?? data?.view ?? null;

  // 보기 설정(필터·정렬·열 등)은 바꾸면 잠시 뒤 `_db.yaml` 에 자동 저장한다.
  // "되돌리기"는 아직 저장 전이면 바꾼 것을 버리고, 저장 뒤면 바로 앞의 보기로 돌려놓는다.
  const [undoView, setUndoView] = useState<View | null>(null);
  const burstBase = useRef<View | null>(null);
  /** 마지막으로 저장한 초안. 저장된 `_db.yaml` 은 정규화되어 초안과 글자가 다를 수 있어 이것과 비교한다 */
  const [savedJson, setSavedJson] = useState<string | null>(null);
  const draftJson = draft ? JSON.stringify(draft) : null;
  const pending = !!draft && !!saved && draft.id === saved.id && draftJson !== savedJson && !sameView(draft, saved);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const saveDraft = useCallback(
    async (v: View) => {
      clearTimeout(saveTimer.current);
      const base = burstBase.current;
      burstBase.current = null;
      try {
        await window.nops.db.editSchema({ folder, op: { kind: 'upsertView', view: v } });
        setSavedJson(JSON.stringify(v));
        if (base) setUndoView(base);
        await load(v);
      } catch (e) {
        setError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e));
      }
    },
    [folder, load],
  );
  useEffect(() => {
    if (!pending || !draft) return;
    if (!burstBase.current) burstBase.current = saved ?? null;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void saveDraft(draft), 700);
    return () => clearTimeout(saveTimer.current);
    // 초안 내용이 바뀔 때만 다시 잡는다(불러오기로 `saved` 객체만 새로 생기는 것은 무시)
  }, [pending, draftJson]);
  // 화면을 닫을 때 저장 전 변경이 남아 있으면 저장한다
  const pendingRef = useRef<{ folder: string; view: View } | null>(null);
  pendingRef.current = draft && pending ? { folder, view: draft } : null;
  useEffect(
    () => () => {
      const p = pendingRef.current;
      if (p) void window.nops.db.editSchema({ folder: p.folder, op: { kind: 'upsertView', view: p.view } });
    },
    [],
  );
  /** 다른 보기로 가기 전에 남은 변경을 바로 저장한다 */
  const flushDraft = () => {
    clearTimeout(saveTimer.current);
    if (draft && pending) void window.nops.db.editSchema({ folder, op: { kind: 'upsertView', view: draft } });
    burstBase.current = null;
    setUndoView(null);
    setSavedJson(null);
  };
  const undoViewChange = () => {
    clearTimeout(saveTimer.current);
    if (pending) {
      burstBase.current = null;
      setDraft(null);
      return;
    }
    if (!undoView) return;
    const v = undoView;
    setUndoView(null);
    setSavedJson(null);
    setDraft(null);
    void window.nops.db.editSchema({ folder, op: { kind: 'upsertView', view: v } }).then(() => load(null));
  };

  const edit = useCallback(
    async (op: Parameters<typeof window.nops.db.editSchema>[0]['op']) => {
      try {
        await window.nops.db.editSchema({ folder, op });
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e));
      }
    },
    [folder, load],
  );

  const updateCell = useCallback(
    async (row: DbRowDto, prop: string, value: CellValue) => {
      // 화면은 먼저 바꾸고(낙관적), 실패하면 다시 불러온다.
      setData((d) =>
        d && {
          ...d,
          rows: d.rows.map((r) => (r.path === row.path ? { ...r, values: { ...r.values, [prop]: value } } : r)),
          groups: d.groups && d.groups.map((g) => ({ ...g, rows: g.rows.map((r) => (r.path === row.path ? { ...r, values: { ...r.values, [prop]: value } } : r)) })),
        },
      );
      try {
        await window.nops.db.updateCell({ path: row.path, prop, value });
        // 정렬·필터·그룹이 값에 따라 달라지므로 한 번 더 맞춘다
        void load();
      } catch (e) {
        setError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e));
        void load();
      }
    },
    [load],
  );

  const addRow = useCallback(async () => {
    if (!adding || !adding.title.trim()) return;
    try {
      await window.nops.db.addRow({
        folder,
        title: adding.title.trim(),
        values: adding.values,
        ...(adding.template !== undefined ? { template: adding.template ?? '' } : {}),
      });
      setAdding(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e));
    }
  }, [adding, folder, load]);

  /** 행 우클릭 메뉴·선택 막대: 열기·복제·삭제(휴지통, 되돌리기 가능) */
  const rowAction = useCallback(
    async (action: RowAction, paths: string[]) => {
      if (action === 'open') return openRowRef.current(paths[0]!);
      try {
        if (action === 'duplicate') {
          for (const p of paths) await window.nops.note.duplicate({ path: p });
          setUndoDelete(null);
          setNotice(paths.length > 1 ? `${paths.length}개 행을 복제했어요` : '행을 복제했어요');
        } else {
          const trashIds: string[] = [];
          for (const p of paths) trashIds.push((await window.nops.note.trash({ path: p })).trashId);
          setNotice('');
          setUndoDelete({ message: paths.length > 1 ? `${paths.length}개 행을 휴지통으로 옮겼어요` : '행을 휴지통으로 옮겼어요', trashIds });
        }
      } catch (e) {
        setError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e));
      }
      await load();
    },
    [load],
  );

  /** 행 열기: 설정에 따라 옆/가운데 창 또는 전체 화면 */
  const openRow = useCallback(
    (path: string) => {
      if (peekMode === 'full' || !renderNote) onOpenNote(path);
      else setPeek(path);
    },
    [peekMode, renderNote, onOpenNote],
  );
  const openRowRef = useRef(openRow);
  openRowRef.current = openRow;
  useEffect(() => {
    if (!peek) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !(e.target instanceof HTMLInputElement) && setPeek(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [peek]);

  const rowTitle = (p: string) => notes.find((n) => n.path === p)?.title ?? p.replace(/^.*\//, '').replace(/\.md$/, '');
  const tabs = data?.schema.views ?? [];
  const rows = useMemo(() => data?.rows ?? [], [data]);
  const flat = useMemo(() => (data?.groups ? data.groups.flatMap((g) => g.rows) : rows), [data, rows]);

  if (!data || !view) {
    return <div className="dbscreen">{error ? <p className="warn pad" role="alert">{error}</p> : <p className="muted pad">불러오는 중…</p>}</div>;
  }
  const current: DbData = { ...data, view };

  return (
    <div className="dbscreen" data-testid="db-screen">
      <header className="dbscreen__head">
        <h2>{data.schema.title ?? '데이터베이스'}</h2>
        <span className="muted small">
          {data.matched === data.total ? `${data.total}행` : `${data.matched} / ${data.total}행`}
        </span>
        <span className="spacer" />
        <button
          onClick={() =>
            void window.nops.db.exportCsv({ folder, viewId: data.view.id }).then(
              (r) => r && setNotice(`${r.rows}행을 CSV로 저장했어요`),
              (e) => setError(String(e)),
            )
          }
        >
          CSV 내보내기
        </button>
        {renderNote && (
          <label className="small">
            <span className="muted">행 열기 </span>
            <select
              value={peekMode}
              onChange={(e) => {
                const m = e.target.value as PeekMode;
                setPeekMode(m);
                try {
                  localStorage.setItem(PEEK_KEY, m);
                } catch {
                  // 저장할 수 없으면 이번 실행에서만 유지
                }
              }}
              aria-label="행 열기 방식"
            >
              <option value="full">전체 화면</option>
              <option value="side">옆 창</option>
              <option value="center">가운데 창</option>
            </select>
          </label>
        )}
        <button
          onClick={() =>
            void window.nops.db.importCsvPreview().then(
              (p) => p && setImporting(p),
              (e) => setError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e)),
            )
          }
        >
          CSV 가져오기
        </button>
        <button onClick={() => setShowTpl((s) => !s)} aria-expanded={showTpl}>템플릿</button>
        <div className="dbscreen__props">
          <button onClick={() => setShowProps((s) => !s)} aria-expanded={showProps}>속성</button>
          {showProps && (
            <PropertyManager
              data={data}
              onClose={() => setShowProps(false)}
              onSetProperty={(name, def) => void edit({ kind: 'setProperty', name, def })}
              onRemove={(name) => void edit({ kind: 'removeProperty', name })}
              onRename={(from, to) => void edit({ kind: 'renameProperty', from, to })}
            />
          )}
        </div>
        <button className="primary" onClick={() => setAdding({ title: '', values: {} })}>+ 새 행</button>
        <button onClick={onClose} title="닫기 (Esc)">닫기</button>
      </header>
      {showTpl && (
        <TemplateSettings
          data={data}
          notes={notes}
          onSave={({ templates, defaultTemplate }) => void edit({ kind: 'meta', templates, defaultTemplate })}
        />
      )}
      <nav className="dbtabs" role="tablist" aria-label="보기">
        {tabs.map((v) => (
          <button
            key={v.id}
            role="tab"
            aria-selected={v.id === data.view.id}
            className={v.id === data.view.id ? 'active' : ''}
            onClick={() => {
              flushDraft();
              setDraft(null);
              setViewId(v.id);
            }}
          >
            {v.name}
          </button>
        ))}
        <button
          onClick={() => {
            flushDraft();
            const nv: View = { id: uid(), name: `보기 ${tabs.length + 1}`, type: 'table', sort: [] };
            void window.nops.db.editSchema({ folder, op: { kind: 'upsertView', view: nv } }).then(() => {
              setDraft(null);
              setViewId(nv.id);
            });
          }}
          aria-label="보기 추가"
        >
          +
        </button>
        {tabs.length > 1 && (
          <button
            className="danger"
            onClick={() => {
              void edit({ kind: 'removeView', id: data.view.id });
              setDraft(null);
              setViewId(null);
            }}
            aria-label="이 보기 삭제"
            title="이 보기 삭제"
          >
            ×
          </button>
        )}
      </nav>
      <ViewToolbar
        data={current}
        view={view}
        saveState={pending ? 'pending' : undoView ? 'saved' : 'idle'}
        onChange={(v) => setDraft(v)}
        onUndo={undoViewChange}
        openFilterRequest={filterRequest}
      />
      {data.issues.length > 0 && (
        <details className="dbissues">
          <summary>⚠ _db.yaml 문제 {data.issues.length}건</summary>
          <ul>
            {data.issues.map((i, k) => (
              <li key={k}><code>{i.path || '(문서)'}</code> {i.message}</li>
            ))}
          </ul>
        </details>
      )}
      {error && <p className="warn small pad" role="alert">{error}</p>}
      {notice && <p className="small pad" role="status">{notice}</p>}
      {undoDelete && (
        <p className="small pad dbundo" role="status">
          {undoDelete.message}{' '}
          <button
            onClick={async () => {
              const ids = undoDelete.trashIds;
              setUndoDelete(null);
              for (const id of ids) await window.nops.note.restore({ trashId: id });
              await load();
            }}
          >
            삭제 되돌리기
          </button>
          <button aria-label="알림 닫기" onClick={() => setUndoDelete(null)}>×</button>
        </p>
      )}
      {!data.groups && data.matched > data.rows.length && (
        <p className="muted small pad">처음 {data.rows.length}행만 보여요(전체 {data.matched}행). 필터로 좁혀 보세요.</p>
      )}
      {adding && (
        <div className="dbadd" role="form" aria-label="새 행">
          <input
            autoFocus
            value={adding.title}
            placeholder="새 행의 제목"
            onChange={(e) => setAdding({ ...adding, title: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void addRow();
              if (e.key === 'Escape') setAdding(null);
            }}
            aria-label="새 행 제목"
          />
          {data.schema.templates.length > 0 && (
            <select
              value={adding.template ?? data.schema.defaultTemplate ?? ''}
              onChange={(e) => setAdding({ ...adding, template: e.target.value || null })}
              aria-label="새 행 템플릿"
            >
              <option value="">템플릿 없음</option>
              {data.schema.templates.map((t) => (
                <option key={t} value={t}>{notes.find((n) => n.path === t)?.title ?? t}</option>
              ))}
            </select>
          )}
          <button className="primary" onClick={() => void addRow()} disabled={!adding.title.trim()}>만들기</button>
          <button onClick={() => setAdding(null)}>취소</button>
        </div>
      )}
      <div className={peek && peekMode === 'side' ? 'dbscreen__split' : 'dbscreen__splitoff'}>
      <div className="dbscreen__body">
        {view.type === 'table' && (
          <TableView
            data={current}
            rows={data.groups ? flat : rows}
            onOpen={openRow}
            onEdit={(r, p, v) => void updateCell(r, p, v)}
            onRenameTitle={onRenameNote ? (r, t) => onRenameNote(r.path, t) : undefined}
            onWidth={(prop, w) => setDraft({ ...view, widths: { ...(view.widths ?? {}), [prop]: w } })}
            onSort={(prop, dir) => setDraft(sortedView(view, prop, dir))}
            onHide={(prop) => setDraft(hiddenColumnView(current, view, prop))}
            onColumns={(cols) => setDraft({ ...view, columns: cols })}
            onFilter={(prop) => {
              const def = prop === 'title' ? undefined : data!.schema.properties[prop];
              const next = addConditionTo(normalizeRoot(view.filter), [], { prop, op: defaultOp(def), value: '' });
              setDraft({ ...view, filter: simplify(next) as View['filter'] });
              setFilterRequest((n) => n + 1);
            }}
            onReorderRows={(order) => setDraft({ ...view, sort: [], manualOrder: order })}
            onRowAction={(a, p) => void rowAction(a, p)}
            notes={notes}
          />
        )}
        {view.type === 'board' && (
          <BoardView
            vaultId={vaultId}
            data={current}
            onOpen={openRow}
            onMove={(r, p, v) => void updateCell(r, p, v)}
            onReorder={(order) => setDraft({ ...view, sort: [], manualOrder: order })}
            onAdd={(key) => setAdding({ title: '', values: view.groupBy && key ? { [view.groupBy]: key } : {} })}
          />
        )}
        {view.type === 'list' && <ListView data={current} rows={data.groups ? flat : rows} vaultId={vaultId} onOpen={openRow} />}
        {view.type === 'gallery' && <GalleryView data={current} rows={data.groups ? flat : rows} vaultId={vaultId} onOpen={openRow} />}
        {view.type === 'calendar' && (
          <CalendarView
            data={current}
            rows={data.groups ? flat : rows}
            onOpen={openRow}
            onMove={(r, p, v) => void updateCell(r, p, v)}
            onAdd={(date) => {
              const dp = view.dateProp ?? Object.entries(data.schema.properties).find(([, p]) => p.type === 'date')?.[0];
              setAdding({ title: '', values: dp ? { [dp]: { start: date } } : {} });
            }}
            onOpenDaily={(date) => void window.nops.daily.open({ date }).then((r) => onOpenNote(r.path))}
          />
        )}
        {view.type === 'timeline' && <TimelineView data={current} rows={data.groups ? flat : rows} onOpen={openRow} onChange={(r, p, v) => void updateCell(r, p, v)} />}
        {data.matched === 0 && <p className="muted pad">조건에 맞는 행이 없어요.</p>}
      </div>
      {peek && renderNote && peekMode === 'side' && (
        <aside className="dbpeek" aria-label="행 미리보기" data-testid="db-peek">
          <header>
            <strong>{rowTitle(peek)}</strong>
            <span className="spacer" />
            <button onClick={() => onOpenNote(peek)} title="전체 화면으로 열기">⤢</button>
            <button onClick={() => setPeek(null)} aria-label="닫기">✕</button>
          </header>
          <div className="dbpeek__body">{renderNote(peek)}</div>
        </aside>
      )}
      </div>
      {importing && (
        <CsvImportDialog
          preview={importing}
          existing={{ folder, title: data.schema.title ?? '데이터베이스', properties: data.schema.properties }}
          onClose={() => setImporting(null)}
          onDone={() => {
            setImporting(null);
            void load();
          }}
        />
      )}
      {peek && renderNote && peekMode === 'center' && (
        <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setPeek(null)}>
          <div className="dbpeek dbpeek--center" role="dialog" aria-modal="true" aria-label="행 미리보기" data-testid="db-peek">
            <header>
              <strong>{rowTitle(peek)}</strong>
              <span className="spacer" />
              <button onClick={() => onOpenNote(peek)} title="전체 화면으로 열기">⤢</button>
              <button onClick={() => setPeek(null)} aria-label="닫기">✕</button>
            </header>
            <div className="dbpeek__body">{renderNote(peek)}</div>
          </div>
        </div>
      )}
    </div>
  );
}
