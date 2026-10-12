import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { View } from '@nopsidian/core/db';
import type { DbQueryResult } from '@nopsidian/ipc-contract';
import { BoardView } from './BoardView';
import { GalleryView, ListView } from './ListGalleryViews';
import { PropertyManager } from './PropertyManager';
import { TableView } from './TableView';
import { ViewToolbar } from './ViewToolbar';
import type { CellValue, DbData, DbRowDto } from './types';

interface Props {
  folder: string;
  vaultId: string;
  onOpenNote: (path: string) => void;
  onClose: () => void;
}

const asData = (r: DbQueryResult): DbData => r as unknown as DbData;
const sameView = (a: View, b: View) => JSON.stringify(a) === JSON.stringify(b);
const uid = () => `v${Math.random().toString(36).slice(2, 7)}`;

/** 데이터베이스 한 개의 화면: 보기 탭 · 필터/정렬/그룹 · 표/보드/목록/갤러리 · 속성 관리 · 새 행. */
export function DatabaseScreen({ folder, vaultId, onOpenNote, onClose }: Props) {
  const [data, setData] = useState<DbData | null>(null);
  const [viewId, setViewId] = useState<string | null>(null);
  const [draft, setDraft] = useState<View | null>(null);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState<{ title: string; values: Record<string, unknown> } | null>(null);
  const [showProps, setShowProps] = useState(false);
  const [notice, setNotice] = useState('');
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
  const dirty = !!draft && !!saved && !sameView(draft, saved);

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
      await window.nops.db.addRow({ folder, title: adding.title.trim(), values: adding.values });
      setAdding(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e));
    }
  }, [adding, folder, load]);

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
              (r) => r && setNotice(`${r.rows}행을 CSV 로 저장했어요`),
              (e) => setError(String(e)),
            )
          }
        >
          CSV 내보내기
        </button>
        <button onClick={() => setShowProps((s) => !s)} aria-expanded={showProps}>속성</button>
        <button className="primary" onClick={() => setAdding({ title: '', values: {} })}>+ 새 행</button>
        <button onClick={onClose} title="닫기 (Esc)">닫기</button>
      </header>
      {showProps && (
        <PropertyManager
          data={data}
          onSetProperty={(name, def) => void edit({ kind: 'setProperty', name, def })}
          onRemove={(name) => void edit({ kind: 'removeProperty', name })}
          onRename={(from, to) => void edit({ kind: 'renameProperty', from, to })}
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
              setDraft(null);
              setViewId(v.id);
            }}
          >
            {v.name}
          </button>
        ))}
        <button
          onClick={() => {
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
        dirty={dirty}
        onChange={(v) => setDraft(v)}
        onSave={() => {
          if (draft) void edit({ kind: 'upsertView', view: draft }).then(() => setDraft(null));
        }}
        onReset={() => setDraft(null)}
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
          <button className="primary" onClick={() => void addRow()} disabled={!adding.title.trim()}>만들기</button>
          <button onClick={() => setAdding(null)}>취소</button>
        </div>
      )}
      <div className="dbscreen__body">
        {view.type === 'table' && (
          <TableView
            data={current}
            rows={data.groups ? flat : rows}
            onOpen={onOpenNote}
            onEdit={(r, p, v) => void updateCell(r, p, v)}
            onWidth={(prop, w) => setDraft({ ...view, widths: { ...(view.widths ?? {}), [prop]: w } })}
          />
        )}
        {view.type === 'board' && (
          <BoardView
            data={current}
            onOpen={onOpenNote}
            onMove={(r, p, v) => void updateCell(r, p, v)}
            onAdd={(key) => setAdding({ title: '', values: view.groupBy && key ? { [view.groupBy]: key } : {} })}
          />
        )}
        {view.type === 'list' && <ListView data={current} rows={data.groups ? flat : rows} vaultId={vaultId} onOpen={onOpenNote} />}
        {view.type === 'gallery' && <GalleryView data={current} rows={data.groups ? flat : rows} vaultId={vaultId} onOpen={onOpenNote} />}
        {(view.type === 'calendar' || view.type === 'timeline') && <p className="muted pad">캘린더·타임라인 뷰는 6단계에서 지원해요. 위에서 다른 형태를 골라 주세요.</p>}
        {data.matched === 0 && <p className="muted pad">조건에 맞는 행이 없어요.</p>}
      </div>
    </div>
  );
}
