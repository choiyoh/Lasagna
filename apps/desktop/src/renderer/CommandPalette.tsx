import { useEffect, useMemo, useRef, useState } from 'react';
import { keys } from './keys';
import { quickSwitch } from '../workers/index/quick-switch';

export interface PaletteCommand {
  id: string;
  label: string;
  /** 오른쪽에 보일 단축키 등 */
  hint?: string;
  /** 검색 보조어(한글·영문) */
  keywords?: string[];
  /** false 면 지금은 쓸 수 없는 명령이라 목록에서 뺀다 */
  enabled?: boolean;
  run: () => void;
}

interface Props {
  commands: PaletteCommand[];
  onClose: () => void;
}

/** ⌘P 명령 팔레트: 이름·보조어·한글 초성으로 찾아 실행한다. */
export function CommandPalette({ commands, onClose }: Props) {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const usable = useMemo(() => commands.filter((c) => c.enabled !== false), [commands]);
  const hits = useMemo(() => {
    if (!query.trim()) return usable;
    const found = quickSwitch(
      usable.map((c) => ({ path: c.id, title: c.label, aliases: c.keywords ?? [] })),
      query,
      30,
    );
    return found.map((h) => usable.find((c) => c.id === h.path)!).filter(Boolean);
  }, [usable, query]);

  useEffect(() => setIndex(0), [query]);
  useEffect(() => {
    listRef.current?.querySelector('.is-active')?.scrollIntoView?.({ block: 'nearest' });
  }, [index]);

  const choose = (i: number) => {
    const cmd = hits[i];
    onClose();
    if (cmd) setTimeout(cmd.run, 0);
  };

  return (
    <div className="dialog-backdrop top" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="switcher palette" role="dialog" aria-modal="true" aria-label="명령 팔레트" data-testid="command-palette">
        <div className="switcher__search">
          <span className="switcher__icon" aria-hidden>
            ⌕
          </span>
          <input
            autoFocus
            value={query}
            placeholder="명령 검색…"
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
        </div>
        <div className="switcher__list" ref={listRef} role="listbox">
          {hits.map((c, i) => (
            <div
              key={c.id}
              role="option"
              aria-selected={i === index}
              className={i === index ? 'switcher__item is-active' : 'switcher__item'}
              onMouseMove={() => setIndex(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(i);
              }}
            >
              <span className="switcher__title">{c.label}</span>
              <span className="switcher__path">{c.hint ? keys(c.hint) : ''}</span>
            </div>
          ))}
          {hits.length === 0 && <div className="switcher__item"><span className="muted">일치하는 명령이 없어요</span></div>}
        </div>
        <div className="switcher__foot">
          <span>한글 초성 가능</span>
          <span>↑↓ 이동 · ↵ 실행 · esc 닫기</span>
        </div>
      </div>
    </div>
  );
}
