import { useCallback, useEffect, useState } from 'react';
import { parseDbEmbed } from '@nopsidian/core/db/embed';
import type { DbQueryResult } from '@nopsidian/ipc-contract';
import { BoardView } from './BoardView';
import { CalendarView } from './CalendarView';
import { GalleryView, ListView } from './ListGalleryViews';
import { TableView } from './TableView';
import { TimelineView } from './TimelineView';
import type { CellValue, DbData, DbRowDto } from './types';

export interface DbEmbedHost {
  vaultId: string;
  notes: { path: string; title: string }[];
  openNote: (path: string) => void;
  /** 전체 화면 데이터베이스 화면으로 */
  openDb: (folder: string) => void;
}

const clean = (e: unknown) => (e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e));

/** 노트 안에 들어가는 데이터베이스 보기(```dbview). 값은 바로 고칠 수 있고, 제목·카드를 누르면 노트가 열린다. */
export function EmbeddedDb({ source, host }: { source: string; host: DbEmbedHost }) {
  const [data, setData] = useState<DbData | null>(null);
  const [folder, setFolder] = useState<string | null>(null);
  const [error, setError] = useState('');
  const parsed = parseDbEmbed(source);
  const cfg = parsed.ok ? parsed.config : null;

  const load = useCallback(async () => {
    if (!cfg) return;
    try {
      const dbs = await window.nops.db.list();
      const found = dbs.find((d) => d.title === cfg.db) ?? dbs.find((d) => d.folder === cfg.db) ?? dbs.find((d) => d.title.toLowerCase() === cfg.db.toLowerCase());
      if (!found) {
        setData(null);
        setError(`데이터베이스를 찾을 수 없어요: ${cfg.db}`);
        return;
      }
      // 보기 이름 → id: 먼저 한 번 질의해 스키마의 보기 목록에서 찾는다
      let r = (await window.nops.db.query({ folder: found.folder, limit: cfg.limit ?? 100, groupLimit: 50 })) as DbQueryResult;
      if (cfg.view) {
        const views = (r.schema as DbData['schema']).views;
        const v = views.find((x) => x.id === cfg.view) ?? views.find((x) => x.name === cfg.view);
        if (v && v.id !== (r.view as { id: string }).id) r = (await window.nops.db.query({ folder: found.folder, viewId: v.id, limit: cfg.limit ?? 100, groupLimit: 50 })) as DbQueryResult;
        else if (!v) {
          setError(`보기를 찾을 수 없어요: ${cfg.view}`);
        }
      }
      setFolder(found.folder);
      setData(r as unknown as DbData);
      if (!cfg.view || (r.schema as DbData['schema']).views.some((x) => x.id === cfg.view || x.name === cfg.view)) setError('');
    } catch (e) {
      setError(clean(e));
    }
  }, [cfg?.db, cfg?.view, cfg?.limit]);

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

  if (!parsed.ok) return <p className="warn small pad" role="alert">⚠ {parsed.error}</p>;
  if (!data) return <p className={error ? 'warn small pad' : 'muted small pad'} role={error ? 'alert' : undefined}>{error ? `⚠ ${error}` : '불러오는 중…'}</p>;

  const flat = data.groups ? data.groups.flatMap((g) => g.rows) : data.rows;
  const t = data.view.type;
  return (
    <div className="dbembed" data-testid="db-embed">
      <div className="dbembed__head">
        <strong>{data.schema.title ?? '데이터베이스'}</strong>
        <span className="muted small"> · {data.view.name} · {data.matched}행</span>
        <span className="spacer" />
        <button onClick={() => folder !== null && host.openDb(folder)}>전체 화면</button>
      </div>
      {error && <p className="warn small pad" role="alert">⚠ {error}</p>}
      {t === 'table' && <TableView data={data} rows={flat} onOpen={host.openNote} onEdit={(r, p, v) => void updateCell(r, p, v)} onWidth={() => undefined} notes={host.notes} />}
      {t === 'board' && <BoardView data={data} onOpen={host.openNote} onMove={(r, p, v) => void updateCell(r, p, v)} onAdd={() => host.openDb(folder ?? '')} />}
      {t === 'list' && <ListView data={data} rows={flat} vaultId={host.vaultId} onOpen={host.openNote} />}
      {t === 'gallery' && <GalleryView data={data} rows={flat} vaultId={host.vaultId} onOpen={host.openNote} />}
      {t === 'calendar' && <CalendarView data={data} rows={flat} onOpen={host.openNote} onMove={(r, p, v) => void updateCell(r, p, v)} onAdd={() => host.openDb(folder ?? '')} onOpenDaily={() => undefined} />}
      {t === 'timeline' && <TimelineView data={data} rows={flat} onOpen={host.openNote} onChange={(r, p, v) => void updateCell(r, p, v)} />}
    </div>
  );
}
