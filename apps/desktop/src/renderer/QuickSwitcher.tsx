import { t, tPlural } from '@nopsidian/i18n';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { NoteSummary, SearchHit } from '@nopsidian/ipc-contract';
import { quickSwitch, type SwitchHit } from '../workers/index/quick-switch';
import { keys } from './keys';
import { cleanSearchSnippet } from './link-snippet';
import { matchParts } from './search-highlight';

/** 검색 범위: 전체(제목+본문) · 제목만 · 본문만 */
export type SearchScope = 'all' | 'title' | 'body';

interface Props {
  notes: readonly NoteSummary[];
  /** newTab: ⌘/Ctrl+Enter 또는 ⌘/Ctrl+클릭 */
  onOpen: (path: string, newTab: boolean) => void;
  /** 제목 일치가 없을 때 Enter 로 새로 만든다(본문 범위에서는 쓰지 않는다) */
  onCreate: (name: string) => void;
  onClose: () => void;
  /** 처음 열 때 칩. ⌘O 는 전체, ⌘⇧F 는 본문 */
  initialScope?: SearchScope;
  /** 색인이 아직 도는 중이면 본문 결과가 일부일 수 있다고 알린다 */
  indexing?: boolean;
}

type Row =
  | { id: string; kind: 'title'; path: string; hit: SwitchHit }
  | { id: string; kind: 'body'; path: string; title: string; snippet: string }
  | { id: string; kind: 'create' };

/** 본문 검색 최대 개수. 작가 모드에서도 결과가 목록을 다 먹지 않게 20개로 둔다 */
const BODY_LIMIT = 20;
const TITLE_LIMIT = 8;
const BODY_DEBOUNCE_MS = 120;

function Highlighted({ text, ranges }: { text: string; ranges: Array<[number, number]> }) {
  const parts: ReactNode[] = [];
  let pos = 0;
  ranges.forEach(([s, e], i) => {
    if (s > pos) parts.push(text.slice(pos, s));
    parts.push(<mark key={i}>{text.slice(s, e)}</mark>);
    pos = e;
  });
  if (pos < text.length) parts.push(text.slice(pos));
  return <>{parts}</>;
}

/** 본문 스니펫은 검색어 낱말을 그대로 강조한다(색인은 구간을 주지 않는다) */
function Marked({ text, query }: { text: string; query: string }) {
  return <>{matchParts(text, query).map((part, i) => (part.hit ? <mark key={i}>{part.text}</mark> : part.text))}</>;
}

/**
 * 통합 검색 팝업(⌘O · ⌘⇧F).
 * 위에는 제목·별칭·경로(한글 초성 포함) 일치를, 아래에는 색인 본문 일치를 한 목록으로 보여 준다.
 */
export function QuickSwitcher({ notes, onOpen, onCreate, onClose, initialScope = 'all', indexing = false }: Props) {
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<SearchScope>(initialScope);
  const [activeId, setActiveId] = useState('');
  const [body, setBody] = useState<{ q: string; hits: SearchHit[] } | null>(null);
  const [searching, setSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const source = useMemo(() => notes.map((n) => ({ path: n.path, title: n.title, aliases: n.aliases })), [notes]);
  const titleHits: SwitchHit[] = useMemo(() => quickSwitch(source, query, TITLE_LIMIT), [source, query]);
  const q = query.trim();
  const bodyHits = body && body.q === q ? body.hits : [];

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    if (scope !== 'body') {
      titleHits.forEach((hit) => out.push({ id: `title:${hit.path}`, kind: 'title', path: hit.path, hit }));
    }
    if (scope !== 'title') {
      bodyHits.forEach((hit) => out.push({ id: `body:${hit.path}`, kind: 'body', path: hit.path, title: hit.title, snippet: cleanSearchSnippet(hit.snippet) }));
    }
    if (scope !== 'body' && q) out.push({ id: 'create', kind: 'create' });
    return out;
  }, [scope, titleHits, bodyHits, q]);

  // 본문 결과가 늦게 와서 선택한 행이 사라졌으면 목록 첫 행으로 본다(Enter 가 죽지 않게).
  const active = rows.some((r) => r.id === activeId) ? activeId : (rows[0]?.id ?? '');

  /** 새 질의·칩의 기본 선택: 제목 일치가 없으면 만들기 행, 있으면 첫 제목 일치(본문 범위는 첫 결과). */
  const defaultIdFor = (text: string, nextScope: SearchScope): string => {
    if (nextScope === 'body') return '';
    const first = quickSwitch(source, text, TITLE_LIMIT)[0];
    if (first) return `title:${first.path}`;
    return text.trim() ? 'create' : '';
  };

  // 본문 구역: 입력이 멈추고 120ms 뒤 색인에 묻는다. 한글 IME 조합 중에는 기다린다.
  useEffect(() => {
    if (!q || scope === 'title') {
      setBody(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    let alive = true;
    const timer = setTimeout(() => {
      void window.nops.search
        .query({ q, limit: BODY_LIMIT })
        .then((hits) => {
          if (alive) setBody({ q, hits });
        })
        .catch(() => {
          if (alive) setBody({ q, hits: [] });
        })
        .finally(() => {
          if (alive) setSearching(false);
        });
    }, BODY_DEBOUNCE_MS);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [q, scope]);

  useEffect(() => {
    listRef.current?.querySelector('.is-active')?.scrollIntoView?.({ block: 'nearest' });
  }, [active]);

  const choose = (row: Row | undefined, newTab: boolean) => {
    if (!row) return;
    if (row.kind === 'create') {
      if (q) onCreate(q);
    } else {
      onOpen(row.path, newTab);
    }
    onClose();
  };

  const move = (delta: number) => {
    if (!rows.length) return;
    const at = rows.findIndex((r) => r.id === active);
    const next = at < 0 ? 0 : Math.min(rows.length - 1, Math.max(0, at + delta));
    setActiveId(rows[next].id);
  };

  const count = rows.filter((r) => r.kind !== 'create').length;
  const listId = 'quick-switcher-list';

  return (
    <div className="dialog-backdrop top" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="switcher" role="dialog" aria-modal="true" aria-label={t('quick.title')}>
        <div className="switcher__search">
          <input
            ref={inputRef}
            autoFocus
            role="combobox"
            aria-expanded
            aria-controls={listId}
            aria-autocomplete="list"
            aria-keyshortcuts={keys('⌘O ⌘⇧F')}
            aria-activedescendant={active ? `${listId}-${active}` : undefined}
            value={query}
            placeholder={t('quick.placeholder')}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveId(defaultIdFor(e.target.value, scope));
            }}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return;
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                move(1);
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                move(-1);
              } else if (e.key === 'Enter') {
                e.preventDefault();
                choose(
                  rows.find((r) => r.id === active),
                  e.metaKey || e.ctrlKey,
                );
              } else if (e.key === 'Escape') {
                // 집중 모드의 Esc(집중 모드 끝내기)가 같이 동작하지 않게 여기서 멈춘다.
                e.preventDefault();
                e.stopPropagation();
                if (query) setQuery('');
                else onClose();
              }
            }}
          />
        </div>
        <div className="switcher__chips" role="group" aria-label={t('quick.scope')}>
          {(['all', 'title', 'body'] as const).map((chip) => (
            <button
              key={chip}
              type="button"
              className={scope === chip ? 'switcher__chip is-on' : 'switcher__chip'}
              aria-pressed={scope === chip}
              data-testid={`quick-chip-${chip}`}
              onClick={() => {
                setScope(chip);
                setActiveId(defaultIdFor(query, chip));
                inputRef.current?.focus();
              }}
            >
              {t(`quick.chip.${chip}`)}
            </button>
          ))}
        </div>
        <div className="switcher__list" id={listId} ref={listRef} role="listbox" aria-label={t('quick.title')}>
          {scope !== 'body' && titleHits.length > 0 && (
            <p className="switcher__section" role="presentation">
              {t('quick.section.title')}
            </p>
          )}
          {rows.map((row, i) => {
            if (row.kind === 'create') {
              return (
                <div
                  key={row.id}
                  id={`${listId}-${row.id}`}
                  role="option"
                  aria-selected={row.id === active}
                  className={row.id === active ? 'switcher__item is-active' : 'switcher__item'}
                  onMouseMove={() => setActiveId(row.id)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    choose(row, e.metaKey || e.ctrlKey);
                  }}
                >
                  <span className="switcher__title">{t('quick.create', { name: q })}</span>
                  <span className="switcher__path">Enter</span>
                </div>
              );
            }
            return (
              <div key={row.id}>
                {row.kind === 'body' && (i === 0 || rows[i - 1].kind !== 'body') && (
                  <p className="switcher__section" role="presentation">
                    {t('quick.section.body')}
                  </p>
                )}
                <div
                  id={`${listId}-${row.id}`}
                  role="option"
                  aria-selected={row.id === active}
                  className={row.id === active ? 'switcher__item is-active' : 'switcher__item'}
                  onMouseMove={() => setActiveId(row.id)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    choose(row, e.metaKey || e.ctrlKey);
                  }}
                >
                  {row.kind === 'title' ? (
                    <>
                      <span className="switcher__title">
                        <Highlighted text={row.hit.matchedText} ranges={row.hit.field === 'path' ? [] : row.hit.ranges} />
                      </span>
                      <span className="switcher__path">
                        {row.hit.field === 'alias' ? `${row.hit.title} · ` : ''}
                        {row.hit.field === 'path' ? <Highlighted text={row.hit.path} ranges={row.hit.ranges} /> : row.hit.path}
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="switcher__title">{row.title}</span>
                      <span className="switcher__path">{row.path}</span>
                      <span className="switcher__snippet">
                        <Marked text={row.snippet} query={q} />
                      </span>
                    </>
                  )}
                </div>
              </div>
            );
          })}
          {scope !== 'title' && q && (
            <p className="switcher__note muted small" role="status" aria-live="polite">
              {searching ? t('quick.searching') : indexing ? t('quick.indexing') : bodyHits.length === 0 ? t('quick.bodyEmpty') : ''}
            </p>
          )}
        </div>
        <div className="switcher__foot">
          <span className="switcher__count" role="status" aria-live="polite">
            {q ? tPlural('search.count', count, { n: count }) : ''}
          </span>
          <span>{keys(t('quick.hints'))}</span>
        </div>
      </div>
    </div>
  );
}
