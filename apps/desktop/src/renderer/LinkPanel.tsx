import { useCallback, useEffect, useState } from 'react';
import type { BacklinkContext, OutgoingLink, UnlinkedMention } from '@nopsidian/ipc-contract';

type Tab = 'backlinks' | 'outgoing' | 'unlinked';

interface Props {
  path: string;
  onOpen: (path: string) => void;
}

interface Data {
  backlinks: BacklinkContext[];
  outgoing: OutgoingLink[];
  unlinked: UnlinkedMention[];
}

const EMPTY: Data = { backlinks: [], outgoing: [], unlinked: [] };

function groupBy<T extends { path: string }>(items: T[]) {
  const map = new Map<string, T[]>();
  for (const i of items) {
    const list = map.get(i.path);
    if (list) list.push(i);
    else map.set(i.path, [i]);
  }
  return [...map.entries()];
}

/** 오른쪽 패널: 백링크(문맥 스니펫), 아웃고잉 링크(미해결 표시), 링크 안 된 언급. */
export function LinkPanel({ path, onOpen }: Props) {
  const [tab, setTab] = useState<Tab>('backlinks');
  const [data, setData] = useState<Data>(EMPTY);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [backlinks, outgoing, unlinked] = await Promise.all([
        window.nops.link.backlinks({ path }),
        window.nops.link.outgoing({ path }),
        window.nops.link.unlinked({ path }),
      ]);
      setData({ backlinks, outgoing, unlinked });
    } finally {
      setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    setData(EMPTY);
    void load();
    // 다른 노트가 바뀌면(링크가 늘거나 줄 수 있다) 잠시 뒤 다시 읽는다
    let timer: ReturnType<typeof setTimeout> | undefined;
    const off = window.nops.on('note.changed', () => {
      clearTimeout(timer);
      timer = setTimeout(() => void load(), 400);
    });
    return () => {
      clearTimeout(timer);
      off();
    };
  }, [load]);

  const tabs: [Tab, string, number][] = [
    ['backlinks', '백링크', data.backlinks.length],
    ['outgoing', '나가는 링크', data.outgoing.length],
    ['unlinked', '링크 안 된 언급', data.unlinked.length],
  ];

  return (
    <aside className="linkpanel" aria-label="링크 패널">
      <div className="linkpanel__tabs" role="tablist">
        {tabs.map(([id, label, n]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>
            {label} <span className="count">{n}</span>
          </button>
        ))}
      </div>
      <div className="linkpanel__body" data-testid={`panel-${tab}`}>
        {loading && <p className="muted small pad">불러오는 중…</p>}
        {tab === 'backlinks' &&
          (data.backlinks.length === 0 ? (
            <p className="muted small pad">이 노트를 가리키는 링크가 없어요.</p>
          ) : (
            groupBy(data.backlinks).map(([p, items]) => (
              <section key={p}>
                <button className="linkpanel__note" onClick={() => onOpen(p)}>
                  {items[0]!.title}
                </button>
                {items.map((it, i) => (
                  <button key={i} className="linkpanel__snippet" onClick={() => onOpen(p)} title={`${p}:${it.line}`}>
                    {it.snippet || '(문맥 없음)'}
                    {it.kind !== 'wikilink' && <span className="kind">{it.kind === 'relation' ? '속성' : it.kind === 'embed' ? '임베드' : '링크'}</span>}
                  </button>
                ))}
              </section>
            ))
          ))}
        {tab === 'outgoing' &&
          (data.outgoing.length === 0 ? (
            <p className="muted small pad">이 노트에는 링크가 없어요.</p>
          ) : (
            <ul className="linkpanel__list">
              {data.outgoing.map((l, i) => (
                <li key={i}>
                  {l.resolvedPath ? (
                    <button onClick={() => onOpen(l.resolvedPath!)}>
                      {l.target || '이 노트'}
                      {l.heading ? ` › ${l.heading}` : ''}
                      {l.block ? ` › ^${l.block}` : ''}
                    </button>
                  ) : (
                    <span className="unresolved" title="아직 없는 노트">
                      {l.target}
                    </span>
                  )}
                  <span className="kind">{l.line}줄</span>
                </li>
              ))}
            </ul>
          ))}
        {tab === 'unlinked' &&
          (data.unlinked.length === 0 ? (
            <p className="muted small pad">링크 없이 언급된 곳이 없어요.</p>
          ) : (
            groupBy(data.unlinked).map(([p, items]) => (
              <section key={p}>
                <button className="linkpanel__note" onClick={() => onOpen(p)}>
                  {items[0]!.title}
                </button>
                {items.map((it, i) => (
                  <div key={i} className="linkpanel__mention">
                    <button className="linkpanel__snippet" onClick={() => onOpen(p)} title={`${p}:${it.line}`}>
                      {it.snippet}
                    </button>
                    <button
                      className="linkpanel__convert"
                      title="[[링크]]로 바꾸기"
                      onClick={async () => {
                        await window.nops.link.convertMention({ path: p, line: it.line, targetPath: path });
                        void load();
                      }}
                    >
                      링크로 변환
                    </button>
                  </div>
                ))}
              </section>
            ))
          ))}
      </div>
    </aside>
  );
}
