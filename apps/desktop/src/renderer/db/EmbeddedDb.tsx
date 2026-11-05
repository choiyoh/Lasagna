import { useCallback, useEffect, useState } from 'react';
import { t, tPlural } from '@nopsidian/i18n';
import { parseDbEmbed } from '@nopsidian/core/db/embed';
import type { DbQueryResult } from '@nopsidian/ipc-contract';
import { BoardView } from './BoardView';
import { CalendarView } from './CalendarView';
import { GalleryView, ListView } from './ListGalleryViews';
import { TableView } from './TableView';
import { TimelineView } from './TimelineView';
import type { CellValue, DbData, DbRowDto, View } from './types';
import { hiddenColumnView, sortedView } from './view-edit';

export interface DbEmbedHost {
  vaultId: string;
  notes: { path: string; title: string }[];
  openNote: (path: string) => void;
  /** 전체 화면 데이터베이스 화면으로 */
  openDb: (folder: string) => void;
  /** 제목(파일 이름)을 바꾼다. 폴더는 그대로 */
  renameNote?: (path: string, title: string) => void;
}

const clean = (e: unknown) => (e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e));

/** 노트 안에 들어가는 데이터베이스 보기(```dbview). 값은 바로 고칠 수 있고, 제목·카드를 누르면 노트가 열린다. */
export function EmbeddedDb({ source, host }: { source: string; host: DbEmbedHost }) {
  const [data, setData] = useState<DbData | null>(null);
  const [folder, setFolder] = useState<string | null>(null);
  const [error, setError] = useState('');
  /** 보기 탭에서 고른 보기(파일에는 쓰지 않는다. 노트에 적힌 보기가 기본) */
  /** 방금 만든 행: 제목 입력 상태로 시작한다 */
  const [fresh, setFresh] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  /** 열 머리 메뉴로 바꾼 임시 정렬·열(저장하지 않는다. 보기 탭을 바꾸면 사라진다) */
  const [tmp, setTmp] = useState<Partial<View> | null>(null);
  const parsed = parseDbEmbed(source);
  const cfg = parsed.ok ? parsed.config : null;

  const load = useCallback(async () => {
    if (!cfg) return;
    try {
      const dbs = await window.nops.db.list();
      const found = dbs.find((d) => d.title === cfg.db) ?? dbs.find((d) => d.folder === cfg.db) ?? dbs.find((d) => d.title.toLowerCase() === cfg.db.toLowerCase());
      if (!found) {
        setData(null);
        setError(t('db.dbNotFound', { name: cfg.db }));
        return;
      }
      // 보기 이름 → id: 먼저 한 번 질의해 스키마의 보기 목록에서 찾는다
      let r = (await window.nops.db.query({ folder: found.folder, limit: cfg.limit ?? 100, groupLimit: 50 })) as DbQueryResult;
      const want = picked ?? cfg.view;
      if (want) {
        const views = (r.schema as DbData['schema']).views;
        const v = views.find((x) => x.id === want) ?? views.find((x) => x.name === want);
        if (v && v.id !== (r.view as { id: string }).id) r = (await window.nops.db.query({ folder: found.folder, viewId: v.id, limit: cfg.limit ?? 100, groupLimit: 50 })) as DbQueryResult;
        else if (!v) {
          setError(t('db.viewNotFound', { name: want }));
        }
      }
      if (tmp) r = (await window.nops.db.query({ folder: found.folder, view: { ...(r.view as View), ...tmp }, limit: cfg.limit ?? 100, groupLimit: 50 })) as DbQueryResult;
      setFolder(found.folder);
      setData(r as unknown as DbData);
      if (!want || (r.schema as DbData['schema']).views.some((x) => x.id === want || x.name === want)) setError('');
    } catch (e) {
      setError(clean(e));
    }
  }, [cfg?.db, cfg?.view, cfg?.limit, picked, tmp]);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const again = () => {
      clearTimeout(t);
      t = setTimeout(() => void load(), 400);
    };
    const offs = [window.nops.on('note.changed', again), window.nops.on('asset.changed', (p) => (p as { path: string }).path.endsWith('_db.yaml') && again())];
    return () => {
      clearTimeout(t);
      offs.forEach((o) => o());
    };
  }, [load]);

  const updateCell = useCallback(
    async (row: DbRowDto, prop: string, value: CellValue) => {
      setData((d) => d && { ...d, rows: d.rows.map((r) => (r.path === row.path ? { ...r, values: { ...r.values, [prop]: value } } : r)) });
      try {
        await window.nops.db.updateCell({ path: row.path, prop, value });
        void load();
      } catch (e) {
        setError(clean(e));
        void load();
      }
    },
    [load],
  );

  const addRow = async (values?: Record<string, unknown>) => {
    if (folder === null || !data) return;
    // 새 행은 첫 번째 선택(상태) 속성의 첫 옵션으로 시작한다(노션처럼 보드에서 바로 보이게)
    const firstSelect = Object.entries(data.schema.properties).find(([, p]) => p.type === 'select' || p.type === 'status');
    const first = firstSelect && 'options' in firstSelect[1] ? (firstSelect[1] as { options: { name: string }[] }).options[0]?.name : undefined;
    const base: Record<string, unknown> = firstSelect && first ? { [firstSelect[0]]: first } : {};
    try {
      const r = await window.nops.db.addRow({ folder, title: t('default.untitled'), values: { ...base, ...(values ?? {}) } });
      setFresh(r.path);
      void load();
    } catch (e) {
      setError(clean(e));
    }
  };

  if (!parsed.ok) return <p className="warn small pad" role="alert">⚠ {parsed.error}</p>;
  if (!data) return <p className={error ? 'warn small pad' : 'muted small pad'} role={error ? 'alert' : undefined}>{error ? `⚠ ${error}` : t('db.loading')}</p>;

  const flat = data.groups ? data.groups.flatMap((g) => g.rows) : data.rows;
  const type = data.view.type;
  return (
    <div className="dbembed" data-testid="db-embed">
      <div className="dbembed__head">
        <strong>{data.schema.title ?? t('db.database')}</strong>
        <div className="dbembed__views" role="tablist" aria-label={t('db.views')}>
          {data.schema.views.map((v) => (
            <button key={v.id} role="tab" aria-selected={v.id === data.view.id} className={v.id === data.view.id ? 'active' : ''} onClick={() => {
                setTmp(null);
                setPicked(v.id);
              }}>
              {v.name}
            </button>
          ))}
        </div>
        <span className="muted small">{tPlural('count.rows', data.matched)}</span>
        <span className="spacer" />
        <button onClick={() => folder !== null && host.openDb(folder)}>{t('db.openFullView')}</button>
      </div>
      {error && <p className="warn small pad" role="alert">⚠ {error}</p>}
      {type === 'table' && (
        <TableView
          data={data}
          rows={flat}
          onOpen={host.openNote}
          onEdit={(r, p, v) => void updateCell(r, p, v)}
          onWidth={() => undefined}
          notes={host.notes}
          onRenameTitle={host.renameNote ? (r, title) => host.renameNote!(r.path, title) : undefined}
          startRenaming={fresh}
          onStartedRenaming={() => setFresh(null)}
          onSort={(prop, dir) => {
            const v = sortedView(data.view, prop, dir);
            setTmp({ sort: v.sort, manualOrder: undefined });
          }}
          onHide={(prop) => setTmp({ columns: hiddenColumnView(data, data.view, prop).columns })}
          onColumns={(cols) => setTmp({ columns: cols })}
        />
      )}
      {(type === 'table' || type === 'list' || type === 'gallery' || type === 'timeline') && (
        <button className="dbembed__add" onClick={() => void addRow()} data-testid="embed-add-row">
          {t('db.embedAdd')}
        </button>
      )}
      {type === 'board' && <BoardView vaultId={host.vaultId} data={data} onOpen={host.openNote} onMove={(r, p, v) => void updateCell(r, p, v)} onAdd={(key) => void addRow(data.view.groupBy && key ? { [data.view.groupBy]: key } : undefined)} />}
      {type === 'list' && <ListView data={data} rows={flat} vaultId={host.vaultId} onOpen={host.openNote} />}
      {type === 'gallery' && <GalleryView data={data} rows={flat} vaultId={host.vaultId} onOpen={host.openNote} />}
      {type === 'calendar' && <CalendarView data={data} rows={flat} onOpen={host.openNote} onMove={(r, p, v) => void updateCell(r, p, v)} onAdd={(date) => void addRow(data.view.dateProp ? { [data.view.dateProp]: date } : undefined)} onOpenDaily={() => undefined} />}
      {type === 'timeline' && <TimelineView data={data} rows={flat} onOpen={host.openNote} onChange={(r, p, v) => void updateCell(r, p, v)} />}
    </div>
  );
}
