import { t, tPlural, type MessageKey } from '@nopsidian/i18n';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { BacklinkContext, OutgoingLink, UnlinkedMention } from '@nopsidian/ipc-contract';
import { cleanSnippet, noteNameOf } from './link-snippet';
import { matchParts } from './search-highlight';

type Tab = 'backlinks' | 'outgoing' | 'unlinked';

interface Props {
  path: string;
  onOpen: (path: string) => void;
}

interface Data {
  backlinks: BacklinkContext[];
  outgoing: OutgoingLink[];
  /** 링크 안 된 언급은 전문 검색이라 무겁다: 그 탭을 열었을 때만 계산한다(null = 아직 안 셈) */
  unlinked: UnlinkedMention[] | null;
}

const EMPTY: Data = { backlinks: [], outgoing: [], unlinked: null };

/** 스니펫에서 지금 노트의 이름과 겹치는 글자만 표시한다 */
function Highlighted({ text, term }: { text: string; term: string }) {
  return <>{matchParts(text, term).map((p, i) => (p.hit ? <mark key={i}>{p.text}</mark> : p.text))}</>;
}

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
  const tabRef = useRef(tab);
  tabRef.current = tab;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const withUnlinked = tabRef.current === 'unlinked';
      const [backlinks, outgoing, unlinked] = await Promise.all([
        window.nops.link.backlinks({ path }),
        window.nops.link.outgoing({ path }),
        withUnlinked ? window.nops.link.unlinked({ path }) : Promise.resolve(null),
      ]);
      // 탭을 안 열었으면 이전에 센 값은 낡았으므로 버린다(다시 열면 새로 센다)
      setData({ backlinks, outgoing, unlinked });
    } finally {
      setLoading(false);
    }
  }, [path]);
  // "링크 안 된 언급" 탭을 처음 열 때 센다
  useEffect(() => {
    if (tab === 'unlinked' && data.unlinked === null) void load();
  }, [tab, data.unlinked, load]);

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

  const tabs: [Tab, MessageKey, number | null][] = [
    ['backlinks', 'link.backlinks', data.backlinks.length],
    ['outgoing', 'link.outgoing', data.outgoing.length],
    ['unlinked', 'link.unlinked', data.unlinked?.length ?? null],
  ];
  /** 스니펫에서 강조할 말 = 지금 노트의 파일 이름 */
  const term = noteNameOf(path);

  return (
    <aside className="linkpanel" aria-label={t('link.panel')}>
      <div className="linkpanel__tabs" role="tablist">
        {tabs.map(([id, label, n]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>
            {t(label)} {n !== null && <span className="count">{n}</span>}
          </button>
        ))}
      </div>
      <div className="linkpanel__body" data-testid={`panel-${tab}`}>
        {loading && <p className="muted small pad">{t('common.loading')}</p>}
        {tab === 'backlinks' &&
          (data.backlinks.length === 0 ? (
            <p className="muted small pad">{t('link.noBacklinks')}</p>
          ) : (
            groupBy(data.backlinks).map(([p, items]) => (
              <section key={p}>
                <button className="linkpanel__note" onClick={() => onOpen(p)}>
                  {items[0]!.title}
                </button>
                {items.map((it, i) => (
                  <button key={i} className="linkpanel__snippet" onClick={() => onOpen(p)} title={`${p}:${it.line} — ${it.snippet}`}>
                    <span className="linkpanel__text">
                      <Highlighted text={cleanSnippet(it.snippet) || t('link.noContext')} term={term} />
                    </span>
                    {it.kind !== 'wikilink' && <span className="kind">{it.kind === 'relation' ? t('link.kind.relation') : it.kind === 'embed' ? t('link.kind.embed') : t('link.kind.link')}</span>}
                  </button>
                ))}
              </section>
            ))
          ))}
        {tab === 'outgoing' &&
          (data.outgoing.length === 0 ? (
            <p className="muted small pad">{t('link.noOutgoing')}</p>
          ) : (
            <ul className="linkpanel__list">
              {data.outgoing.map((l, i) => (
                <li key={i}>
                  {l.resolvedPath ? (
                    <button onClick={() => onOpen(l.resolvedPath!)}>
                      {l.target || t('link.thisNote')}
                      {l.heading ? ` › ${l.heading}` : ''}
                      {l.block ? ` › ^${l.block}` : ''}
                    </button>
                  ) : (
                    <span className="unresolved" title={t('link.unresolvedTitle')}>
                      {l.target}
                    </span>
                  )}
                  <span className="kind">{tPlural('link.line', l.line)}</span>
                </li>
              ))}
            </ul>
          ))}
        {tab === 'unlinked' &&
          (data.unlinked === null ? null : data.unlinked.length === 0 ? (
            <p className="muted small pad">{t('link.noUnlinked')}</p>
          ) : (
            groupBy(data.unlinked).map(([p, items]) => (
              <section key={p}>
                <button className="linkpanel__note" onClick={() => onOpen(p)}>
                  {items[0]!.title}
                </button>
                {items.map((it, i) => (
                  <div key={i} className="linkpanel__mention">
                    <button className="linkpanel__snippet" onClick={() => onOpen(p)} title={`${p}:${it.line} — ${it.snippet}`}>
                      <span className="linkpanel__text">
                        <Highlighted text={cleanSnippet(it.snippet)} term={term} />
                      </span>
                    </button>
                    <button
                      className="linkpanel__convert"
                      title={t('link.convertTitle')}
                      onClick={async () => {
                        await window.nops.link.convertMention({ path: p, line: it.line, targetPath: path });
                        void load();
                      }}
                    >
                      {t('link.convert')}
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
