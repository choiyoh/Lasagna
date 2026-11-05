import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import { t, tPlural } from '@nopsidian/i18n';
import { dbEmbedSource } from '@nopsidian/core/db/embed';
import { showTextPrompt } from '@nopsidian/editor/nops';
import type { NopsDbViewHost } from '@nopsidian/editor/nops';
import { EmbeddedDb, type DbEmbedHost } from './EmbeddedDb';

type DbInfo = Awaited<ReturnType<typeof window.nops.db.list>>[number];

/** 슬래시 "데이터베이스 보기": 데이터베이스(와 보기)를 고르는 모달. 고른 YAML 을 돌려준다. */
function Picker({ onDone }: { onDone: (src: string | null) => void }) {
  const [dbs, setDbs] = useState<DbInfo[] | null>(null);
  const [views, setViews] = useState<{ id: string; name: string }[]>([]);
  const [db, setDb] = useState<DbInfo | null>(null);
  useEffect(() => {
    void window.nops.db.list().then(setDbs, () => setDbs([]));
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onDone(null);
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onDone]);
  useEffect(() => {
    if (!db) return setViews([]);
    void window.nops.db.query({ folder: db.folder, limit: 1 }).then((r) => setViews((r.schema as { views: { id: string; name: string }[] }).views));
  }, [db]);
  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onDone(null)}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label={t('dbview.insert')}>
        <h2>{db ? t('dbview.viewsOf', { title: db.title }) : t('dbview.which')}</h2>
        {dbs === null ? (
          <p className="muted">{t('db.loading')}</p>
        ) : !db ? (
          dbs.length === 0 ? (
            <p className="muted">{t('dbview.noDbs')}</p>
          ) : (
            <ul className="picker">
              {dbs.map((d) => (
                <li key={d.folder}>
                  <button onClick={() => setDb(d)}>🗂 {d.title} <span className="muted small">{tPlural('count.rows', d.rowCount)}</span></button>
                </li>
              ))}
            </ul>
          )
        ) : (
          <ul className="picker">
            {views.map((v) => (
              <li key={v.id}>
                <button onClick={() => onDone(dbEmbedSource(db.title, v.name))}>{v.name}</button>
              </li>
            ))}
          </ul>
        )}
        <div className="dialog__actions">
          {db && <button onClick={() => setDb(null)}>{t('dbview.back')}</button>}
          <button onClick={() => onDone(null)}>{t('db.cancel')}</button>
        </div>
      </div>
    </div>
  );
}

/** 에디터가 쓰는 dbview 호스트: React 로 데이터베이스 뷰를 그린다. */
export function createDbViewHost(host: DbEmbedHost): NopsDbViewHost {
  return {
    mount(container, source) {
      const root = createRoot(container);
      root.render(<EmbeddedDb source={source} host={host} />);
      return {
        update: (s) => root.render(<EmbeddedDb source={s} host={host} />),
        // 에디터가 노드 뷰를 정리하는 도중에 동기적으로 unmount 하면 React 가 경고하므로 한 틱 미룬다
        destroy: () => void setTimeout(() => root.unmount(), 0),
      };
    },
    async create() {
      const raw = await showTextPrompt(t('db.newDbName'), '할 일');
      const name = raw?.trim().replace(/[\\/:*?"<>|]/g, ' ').trim();
      if (!name) return null;
      // 이름이 겹치면 번호를 붙인다(폴더 = 데이터베이스)
      const taken = new Set((await window.nops.db.list()).flatMap((d) => [d.folder, d.title]));
      let folder = name;
      for (let n = 2; taken.has(folder); n++) folder = `${name} ${n}`;
      await window.nops.db.create({ folder, title: folder });
      const edit = (op: Parameters<typeof window.nops.db.editSchema>[0]['op']) => window.nops.db.editSchema({ folder, op });
      // 노션처럼 바로 쓸 수 있게 기본 속성과 보기를 둔다.
      // 속성·옵션·보기 이름은 _db.yaml 에 쓰이는 데이터 기본값이라 L3(새 기본값의 언어 대응) 전까지 한국어 그대로 둔다.
      await edit({ kind: 'setProperty', name: '상태', def: { type: 'select', options: [{ name: '할 일', color: 'gray' }, { name: '진행 중', color: 'blue' }, { name: '완료', color: 'green' }] } });
      await edit({ kind: 'setProperty', name: '날짜', def: { type: 'date' } });
      await edit({ kind: 'setProperty', name: '태그', def: { type: 'multi_select', options: [] } });
      await edit({ kind: 'upsertView', view: { id: 'v1', name: '표', type: 'table', sort: [] } });
      await edit({ kind: 'upsertView', view: { id: 'v2', name: '보드', type: 'board', groupBy: '상태', sort: [] } });
      await edit({ kind: 'upsertView', view: { id: 'v3', name: '캘린더', type: 'calendar', dateProp: '날짜', sort: [] } });
      return dbEmbedSource(folder, '표');
    },
    pick() {
      return new Promise((resolve) => {
        const el = document.createElement('div');
        document.body.append(el);
        const root = createRoot(el);
        const done = (src: string | null) => {
          root.unmount();
          el.remove();
          resolve(src);
        };
        root.render(<Picker onDone={done} />);
      });
    },
  };
}
