import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import { dbEmbedSource } from '@nopsidian/core/db/embed';
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
      <div className="dialog" role="dialog" aria-modal="true" aria-label="데이터베이스 보기 넣기">
        <h2>{db ? `“${db.title}” 의 보기` : '어떤 데이터베이스를 넣을까요?'}</h2>
        {dbs === null ? (
          <p className="muted">불러오는 중…</p>
        ) : !db ? (
          dbs.length === 0 ? (
            <p className="muted">데이터베이스가 없어요. 사이드바의 DB 탭에서 만들어 주세요.</p>
          ) : (
            <ul className="picker">
              {dbs.map((d) => (
                <li key={d.folder}>
                  <button onClick={() => setDb(d)}>🗂 {d.title} <span className="muted small">{d.rowCount}행</span></button>
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
          {db && <button onClick={() => setDb(null)}>뒤로</button>}
          <button onClick={() => onDone(null)}>취소</button>
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
