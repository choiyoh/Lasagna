import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { NoteSummary } from '@nopsidian/ipc-contract';
import { quickSwitch, type SwitchHit } from '../workers/index/quick-switch';

interface Props {
  notes: readonly NoteSummary[];
  onOpen: (path: string) => void;
  /** 일치하는 노트가 없을 때 Enter로 새로 만든다 */
  onCreate: (name: string) => void;
  onClose: () => void;
}

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

/** ⌘O 빠른 전환기: 제목·별칭·경로, 한글 초성(ㅋㄹㅋㄷ) 검색. */
export function QuickSwitcher({ notes, onOpen, onCreate, onClose }: Props) {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const source = useMemo(() => notes.map((n) => ({ path: n.path, title: n.title, aliases: n.aliases })), [notes]);
  const hits: SwitchHit[] = useMemo(() => quickSwitch(source, query, 30), [source, query]);

  useEffect(() => setIndex(0), [query]);
  useEffect(() => {
    listRef.current?.querySelector('.is-active')?.scrollIntoView?.({ block: 'nearest' });
  }, [index]);

  const choose = (i: number) => {
    const hit = hits[i];
    if (hit) onOpen(hit.path);
    else if (query.trim()) onCreate(query.trim());
    onClose();
  };

  return (
    <div className="dialog-backdrop top" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="switcher" role="dialog" aria-modal="true" aria-label="빠른 전환기">
        <input
          autoFocus
          value={query}
          placeholder="노트 이름·별칭·경로 (한글 초성 가능)"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setIndex((i) => Math.min(hits.length - 1, i + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setIndex((i) => Math.max(0, i - 1));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              choose(index);
            } else if (e.key === 'Escape') {
              onClose();
            }
          }}
        />
        <div className="switcher__list" ref={listRef} role="listbox">
          {hits.map((h, i) => (
            <div
              key={h.path}
              role="option"
              aria-selected={i === index}
              className={i === index ? 'switcher__item is-active' : 'switcher__item'}
              onMouseMove={() => setIndex(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(i);
              }}
            >
              <span className="switcher__title">
                <Highlighted text={h.matchedText} ranges={h.field === 'path' ? [] : h.ranges} />
              </span>
              <span className="switcher__path">
                {h.field === 'alias' ? `${h.title} · ` : ''}
                {h.field === 'path' ? <Highlighted text={h.path} ranges={h.ranges} /> : h.path}
              </span>
            </div>
          ))}
          {hits.length === 0 && query.trim() && (
            <div className="switcher__item is-active" onMouseDown={(e) => {
                e.preventDefault();
                choose(-1);
              }}>
              <span className="switcher__title">“{query.trim()}” 새 노트 만들기</span>
              <span className="switcher__path">Enter</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
