import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { t, tPlural, translate } from '@nopsidian/i18n';
import type { DbRow, View } from '@nopsidian/core/db';
import type { DbQueryResult } from '@nopsidian/ipc-contract';
import type { Toast } from '../app-types';
import { BoardView } from './BoardView';
import { CalendarView } from './CalendarView';
import { TimelineView } from './TimelineView';
import { GalleryView, ListView } from './ListGalleryViews';
import { ConfirmDialog } from '../ConfirmDialog';
import { CsvImportDialog } from './CsvImportDialog';
import { PropertyManager } from './PropertyManager';
import { TableView, type RowAction } from './TableView';
import { TemplateSettings } from './TemplateSettings';
import { ViewToolbar } from './ViewToolbar';
import { type CellValue, type DbData, type DbRowDto } from './types';
import { hiddenColumnView, sortedView } from './view-edit';
import { isHiddenByFilter } from './row-visibility';
import { addConditionTo, childrenOf, groupKind, isCondition, normalizeRoot, simplify } from './filter-tree';
import { defaultOp } from './filter-ops';
import { suggestFilterRemovals } from './filter-suggestions';
import { EmptyState } from '../components/EmptyState';
import { useLocale } from '../useLocale';
import { userMessage } from '../user-message';

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
  /** 앱 공통 토스트(필터에 가린 새 행 안내 등) */
  onToast?: (toast: Toast) => void;
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

/** 창 폭이 max 이하인가(헤더를 접을지 결정). 리사이즈에 즉시 반응한다. */
function useNarrow(max: number): boolean {
  const query = `(max-width: ${max}px)`;
  const [narrow, setNarrow] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setNarrow(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);
  return narrow;
}

/** 데이터베이스 한 개의 화면: 보기 탭 · 필터/정렬/그룹 · 표/보드/목록/갤러리 · 속성 관리 · 새 행. */
export function DatabaseScreen({ folder, vaultId, onOpenNote, onClose, notes, onRenameNote, renderNote, onToast }: Props) {
  const [data, setData] = useState<DbData | null>(null);
  const [allRows, setAllRows] = useState<DbRow[] | null>(null);
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
  /** 삭제 확인 중인 보기 */
  const [confirmDeleteView, setConfirmDeleteView] = useState<View | null>(null);
  /** 좁은 창에서 접힌 헤더 메뉴 */
  const [moreOpen, setMoreOpen] = useState(false);
  useEffect(() => {
    if (!moreOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      setMoreOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [moreOpen]);
  const seq = useRef(0);
  const narrow = useNarrow(1100);
  // 폭이 바뀌면 접힌 메뉴는 닫는다
  useEffect(() => setMoreOpen(false), [narrow]);

  const locale = useLocale();

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
        if (n === seq.current) setError(userMessage(e));
      }
    },
    // locale 이 바뀌면 스키마 문제·기본 이름 문구가 옛 언어로 남지 않게 다시 읽는다.
    [folder, viewId, draft, locale],
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
  const filterRoot = view?.filter ? normalizeRoot(view.filter) : null;
  const suggestable =
    !!data &&
    data.matched === 0 &&
    data.total <= 5000 &&
    !!filterRoot &&
    groupKind(filterRoot) === 'and' &&
    childrenOf(filterRoot).some(isCondition);

  // "빼면 N개"는 필터 전 행이 필요하다. 0행일 때만 필터를 뺀 보기로 한 번 더 읽는다.
  useEffect(() => {
    if (!suggestable || !view) {
      setAllRows(null);
      return;
    }
    let live = true;
    const allView = {
      ...view,
      filter: undefined,
      sort: [],
      groupBy: undefined,
      subGroupBy: undefined,
      calc: undefined,
      manualOrder: undefined,
    };
    void window.nops.db.query({ folder, view: allView, limit: 5000 }).then(
      (r) => live && setAllRows(r.rows as unknown as DbRow[]),
      () => live && setAllRows(null),
    );
    return () => {
      live = false;
    };
  }, [folder, suggestable, view]);

  // 조건 라벨은 지금 언어의 t() 결과라, 언어가 바뀌면 다시 만든다.
  const suggestions = useMemo(() => {
    if (!suggestable || !allRows || !view || !data) return [];
    const started = performance.now();
    const out = suggestFilterRemovals(data.schema, view.filter, allRows);
    return performance.now() - started > 200 ? [] : out;
  }, [allRows, data, locale, suggestable, view]);

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
        setError(userMessage(e));
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
        setError(userMessage(e));
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
        setError(userMessage(e));
        void load();
      }
    },
    [load],
  );

  const addRow = useCallback(async () => {
    if (!adding || !adding.title.trim()) return;
    try {
      const { path } = await window.nops.db.addRow({
        folder,
        title: adding.title.trim(),
        values: adding.values,
        ...(adding.template !== undefined ? { template: adding.template ?? '' } : {}),
      });
      setAdding(null);
      await load();
      // 인덱스 반영은 조금 늦을 수 있다. 새 행이 보일 때까지 짧게 기다린 뒤 기존 evalFilter 로 판정한다.
      let added: DbRowDto | null = null;
      for (let i = 0; i < 15 && !added; i++) {
        const info = await window.nops.db.row({ path }).catch(() => null);
        if (info) added = info.row;
        else await new Promise((r) => setTimeout(r, 120));
      }
      if (added && data && view && isHiddenByFilter(data.schema, view.filter, added)) {
        onToast?.({
          message: t('db.rowHiddenByFilter'),
          action: {
            label: t('db.clearFilter'),
            onClick: () => {
              const next = { ...view, filter: undefined };
              setDraft(next);
              void load(next);
            },
          },
          duration: 6000,
        });
      }
    } catch (e) {
      setError(userMessage(e));
    }
  }, [adding, data, folder, load, onToast, view]);

  /** 행 우클릭 메뉴·선택 막대: 열기·복제·삭제(휴지통, 되돌리기 가능) */
  const rowAction = useCallback(
    async (action: RowAction, paths: string[]) => {
      if (action === 'open') return openRowRef.current(paths[0]!);
      try {
        if (action === 'duplicate') {
          for (const p of paths) await window.nops.note.duplicate({ path: p });
          setUndoDelete(null);
          setNotice(paths.length > 1 ? t('db.rowsDuplicated', { count: paths.length }) : t('db.rowDuplicated'));
        } else {
          const trashIds: string[] = [];
          for (const p of paths) trashIds.push((await window.nops.note.trash({ path: p })).trashId);
          setNotice('');
          setUndoDelete({ message: paths.length > 1 ? t('db.rowsTrashed', { count: paths.length }) : t('db.rowTrashed'), trashIds });
        }
      } catch (e) {
        setError(userMessage(e));
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

  const exportCsv = () =>
    void window.nops.db.exportCsv({ folder, viewId: data?.view.id ?? '' }).then(
      (r) => r && setNotice(tPlural('db.csvSaved', r.rows)),
      (e) => setError(userMessage(e)),
    );
  const importCsv = () =>
    void window.nops.db.importCsvPreview().then(
      (p) => p && setImporting(p),
      (e) => setError(userMessage(e)),
    );
  const tabs = data?.schema.views ?? [];
  const rows = useMemo(() => data?.rows ?? [], [data]);
  const flat = useMemo(() => (data?.groups ? data.groups.flatMap((g) => g.rows) : rows), [data, rows]);

  if (!data || !view) {
    return <div className="dbscreen">{error ? <p className="warn pad" role="alert">{error}</p> : <p className="muted pad">{t('db.loading')}</p>}</div>;
  }
  const current: DbData = { ...data, view };
  // 회차 DB 감지: 회차 열(number) + note_chars() 자동 열. → 새 행 회차 기본값·빈 상태 '+ 첫 회차'.
  const episodeNames = [translate('ko', 'work.db.episode'), translate('en', 'work.db.episode')];
  const episodeCol = Object.keys(data.schema.properties).find(
    (n) => episodeNames.includes(n) && data.schema.properties[n]?.type === 'number',
  );
  const isEpisodeDb = !!episodeCol && Object.values(data.schema.properties).some((p) => p.type === 'formula' && /\bnote_chars\s*\(/.test(p.expr));
  const statusCol = Object.keys(data.schema.properties).find((n) => data.schema.properties[n]?.type === 'status');
  const draftOption = statusCol
    ? (data.schema.properties[statusCol] as { options: { name: string; group?: string }[] }).options.find((o) => o.group === 'todo')?.name
    : undefined;
  const nextEpisode = isEpisodeDb
    ? Math.max(0, ...data.rows.map((r) => (typeof r.values[episodeCol!] === 'number' ? (r.values[episodeCol!] as number) : 0))) + 1
    : null;
  const addFirstEpisode = () => {
    if (!isEpisodeDb || !episodeCol || nextEpisode === null) return;
    const title = translate(locale, 'db.episodeTitle', { n: nextEpisode });
    void window.nops.db
      .addRow({ folder, title, values: { [episodeCol]: nextEpisode, ...(statusCol && draftOption ? { [statusCol]: draftOption } : {}) } })
      .then(() => load())
      .catch((e) => setError(userMessage(e)));
  };
  const emptyState = data.matched === 0 ? (
    <EmptyState
      title={view.filter ? t('db.emptyFiltered') : t('db.emptyNoRows')}
      description={view.filter ? t('db.emptyFilteredHint') : t('db.emptyNoRowsHint')}
      suggestions={suggestions.map((s) => ({
        ...s,
        onApply: () => {
          const next = { ...view, filter: s.filter };
          setDraft(next);
          void load(next);
        },
      }))}
      onReset={
        isEpisodeDb && !view.filter
          ? addFirstEpisode
          : view.filter
          ? () => {
              const next = { ...view, filter: undefined };
              setDraft(next);
              void load(next);
            }
          : undefined
      }
      resetLabel={isEpisodeDb && !view.filter ? t('db.firstEpisode') : view.filter ? t('db.clearAllFilters') : undefined}
      countUnit="rows"
    />
  ) : null;
  const propertyManager = showProps ? (
    <PropertyManager
      data={data}
      onClose={() => setShowProps(false)}
      onSetProperty={(name, def) => void edit({ kind: 'setProperty', name, def })}
      onRemove={(name) => void edit({ kind: 'removeProperty', name })}
      onRename={(from, to) => void edit({ kind: 'renameProperty', from, to })}
    />
  ) : null;

  return (
    <div className="dbscreen" data-testid="db-screen">
      <header className="dbscreen__head">
        <div className="dbscreen__title">
          <h2 title={data.schema.title ?? t('db.database')}>{data.schema.title ?? t('db.database')}</h2>
          <span className="dbscreen__count muted small">
            {data.matched === data.total ? tPlural('count.rows', data.total) : tPlural('db.rowsFiltered', data.total, { matched: data.matched })}
          </span>
        </div>
        <span className="spacer" />
        {!narrow && (
          <>
            <button onClick={exportCsv}>{t('db.exportCsv')}</button>
            <button onClick={importCsv}>{t('db.importCsv')}</button>
            <button onClick={() => setShowTpl((s) => !s)} aria-expanded={showTpl}>{t('db.templates')}</button>
            <div className="dbscreen__props dbscreen__popanchor">
              <button onClick={() => setShowProps((s) => !s)} aria-expanded={showProps}>{t('db.props')}</button>
              {propertyManager}
            </div>
          </>
        )}
        {renderNote && (
          <label className="dbscreen__peek small">
            {!narrow && <span className="muted">{t('db.openRow')} </span>}
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
              aria-label={t('db.openRowMode')}
            >
              <option value="full">{t('db.openFull')}</option>
              <option value="side">{t('db.openSide')}</option>
              <option value="center">{t('db.openCenter')}</option>
            </select>
          </label>
        )}
        {narrow && (
          <div className="dbscreen__more dbscreen__popanchor">
            <button aria-label={t('db.more')} aria-expanded={moreOpen} onClick={() => setMoreOpen((v) => !v)}>⋯</button>
            {moreOpen && (
              <>
                <div className="dbscreen__menumask" onMouseDown={() => setMoreOpen(false)} />
                <div className="dbscreen__menu" role="menu" aria-label={t('db.menu')}>
                  <button role="menuitem" onClick={() => { setMoreOpen(false); exportCsv(); }}>{t('db.exportCsv')}</button>
                  <button role="menuitem" onClick={() => { setMoreOpen(false); importCsv(); }}>{t('db.importCsv')}</button>
                  <button role="menuitem" onClick={() => { setMoreOpen(false); setShowTpl(true); }}>{t('db.templates')}</button>
                  <button role="menuitem" onClick={() => { setMoreOpen(false); setShowProps(true); }}>{t('db.props')}</button>
                </div>
              </>
            )}
            {propertyManager}
          </div>
        )}
        <button
          className="primary"
          data-testid="db-new-row"
          onClick={() => setAdding({ title: '', values: isEpisodeDb && episodeCol && nextEpisode !== null ? { [episodeCol]: nextEpisode } : {} })}
        >
          {t('db.newRow')}
        </button>
        <button onClick={onClose} title={t('db.closeHint')}>{t('db.close')}</button>
      </header>
      {showTpl && (
        <TemplateSettings
          data={data}
          notes={notes}
          onSave={({ templates, defaultTemplate }) => void edit({ kind: 'meta', templates, defaultTemplate })}
        />
      )}
      <nav className="dbtabs" role="tablist" aria-label={t('db.views')}>
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
            const nv: View = { id: uid(), name: t('default.dbView', { n: tabs.length + 1 }), type: 'table', sort: [] };
            void window.nops.db.editSchema({ folder, op: { kind: 'upsertView', view: nv } }).then(() => {
              setDraft(null);
              setViewId(nv.id);
            });
          }}
          aria-label={t('db.addView')}
        >
          +
        </button>
        {tabs.length > 1 && (
          <button className="dbtabs__del" onClick={() => setConfirmDeleteView(data.view)} aria-label={t('db.deleteView')} title={t('db.deleteView')}>
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
          <summary>{tPlural('db.yamlIssues', data.issues.length)}</summary>
          <ul>
            {data.issues.map((i, k) => (
              <li key={k}>
                <code>{i.path || t('db.document')}</code> {i.key ? t(i.key as never, (i.params ?? {}) as never) : i.message}
              </li>
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
            {t('db.undoDelete')}
          </button>
          <button aria-label={t('db.dismiss')} onClick={() => setUndoDelete(null)}>×</button>
        </p>
      )}
      {!data.groups && data.matched > data.rows.length && (
        <p className="muted small pad">{t('db.truncated', { shown: data.rows.length, total: data.matched })}</p>
      )}
      {adding && (
        <div className="dbadd" role="form" aria-label={t('db.newRowForm')}>
          <input
            autoFocus
            data-testid="db-add-title"
            value={adding.title}
            placeholder={t('db.newRowTitle')}
            onChange={(e) => setAdding({ ...adding, title: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void addRow();
              if (e.key === 'Escape') setAdding(null);
            }}
            aria-label={t('db.newRowTitleAria')}
          />
          {data.schema.templates.length > 0 && (
            <select
              value={adding.template ?? data.schema.defaultTemplate ?? ''}
              onChange={(e) => setAdding({ ...adding, template: e.target.value || null })}
              aria-label={t('db.newRowTemplate')}
            >
              <option value="">{t('db.noTemplate')}</option>
              {data.schema.templates.map((t) => (
                <option key={t} value={t}>{notes.find((n) => n.path === t)?.title ?? t}</option>
              ))}
            </select>
          )}
          <button className="primary" onClick={() => void addRow()} disabled={!adding.title.trim()}>{t('db.create')}</button>
          <button onClick={() => setAdding(null)}>{t('db.cancel')}</button>
        </div>
      )}
      <div className={peek && peekMode === 'side' ? 'dbscreen__split' : 'dbscreen__splitoff'}>
      <div className="dbscreen__body">
        {view.type === 'table' && (
          <TableView
            data={current}
            episode={isEpisodeDb}
            rows={data.groups ? flat : rows}
            empty={emptyState}
            onOpen={openRow}
            onEdit={(r, p, v) => void updateCell(r, p, v)}
            onRenameTitle={onRenameNote ? (r, title) => onRenameNote(r.path, title) : undefined}
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
            empty={emptyState}
            onOpen={openRow}
            onMove={(r, p, v) => void updateCell(r, p, v)}
            onReorder={(order) => setDraft({ ...view, sort: [], manualOrder: order })}
            onAdd={(key) => setAdding({ title: '', values: view.groupBy && key ? { [view.groupBy]: key } : {} })}
          />
        )}
        {view.type === 'list' && <ListView data={current} rows={data.groups ? flat : rows} vaultId={vaultId} empty={emptyState} onOpen={openRow} />}
        {data.matched > 0 && view.type === 'gallery' && <GalleryView data={current} rows={data.groups ? flat : rows} vaultId={vaultId} onOpen={openRow} />}
        {view.type === 'calendar' && (
          <CalendarView
            data={current}
            rows={data.groups ? flat : rows}
            empty={emptyState}
            onOpen={openRow}
            onMove={(r, p, v) => void updateCell(r, p, v)}
            onAdd={(date) => {
              const dp = view.dateProp ?? Object.entries(data.schema.properties).find(([, p]) => p.type === 'date')?.[0];
              setAdding({ title: '', values: dp ? { [dp]: { start: date } } : {} });
            }}
            onOpenDaily={(date) => void window.nops.daily.open({ date }).then((r) => onOpenNote(r.path))}
          />
        )}
        {view.type === 'timeline' && <TimelineView data={current} rows={data.groups ? flat : rows} empty={emptyState} onOpen={openRow} onChange={(r, p, v) => void updateCell(r, p, v)} />}
        {data.matched === 0 && view.type !== 'table' && view.type !== 'board' && view.type !== 'list' && view.type !== 'calendar' && view.type !== 'timeline' && <div className="dbscreen__empty">{emptyState}</div>}
      </div>
      {peek && renderNote && peekMode === 'side' && (
        <aside className="dbpeek" aria-label={t('db.peek')} data-testid="db-peek">
          <header>
            <strong>{rowTitle(peek)}</strong>
            <span className="spacer" />
            <button onClick={() => onOpenNote(peek)} title={t('db.openFullScreen')}>⤢</button>
            <button onClick={() => setPeek(null)} aria-label={t('db.close')}>✕</button>
          </header>
          <div className="dbpeek__body">{renderNote(peek)}</div>
        </aside>
      )}
      </div>
      {importing && (
        <CsvImportDialog
          preview={importing}
          existing={{ folder, title: data.schema.title ?? t('db.database'), properties: data.schema.properties }}
          onClose={() => setImporting(null)}
          onDone={() => {
            setImporting(null);
            void load();
          }}
        />
      )}
      {confirmDeleteView && (
        <ConfirmDialog
          title={t('db.deleteViewTitle')}
          lines={[t('db.deleteViewQuestion', { name: confirmDeleteView.name }), t('db.deleteViewDetail')]}
          confirmLabel={t('db.delete')}
          tone="danger"
          onCancel={() => setConfirmDeleteView(null)}
          onConfirm={() => {
            const id = confirmDeleteView.id;
            setConfirmDeleteView(null);
            void edit({ kind: 'removeView', id });
            setDraft(null);
            setViewId(null);
          }}
        />
      )}
      {peek && renderNote && peekMode === 'center' && (
        <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setPeek(null)}>
          <div className="dbpeek dbpeek--center" role="dialog" aria-modal="true" aria-label={t('db.peek')} data-testid="db-peek">
            <header>
              <strong>{rowTitle(peek)}</strong>
              <span className="spacer" />
              <button onClick={() => onOpenNote(peek)} title={t('db.openFullScreen')}>⤢</button>
              <button onClick={() => setPeek(null)} aria-label={t('db.close')}>✕</button>
            </header>
            <div className="dbpeek__body">{renderNote(peek)}</div>
          </div>
        </div>
      )}
    </div>
  );
}
