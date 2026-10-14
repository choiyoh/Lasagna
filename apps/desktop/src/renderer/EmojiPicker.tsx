import { useEffect, useMemo, useRef, useState } from 'react';
import { EMOJI_GROUPS, loadEmojis, pushRecentEmoji, recentEmojis, searchEmojis, type EmojiItem } from './emoji';

interface Props {
  /** 고른 이모지(null = 아이콘 제거) */
  onPick: (emoji: string | null) => void;
  onClose: () => void;
  /** 이미 아이콘이 있으면 "제거" 단추를 보인다 */
  hasIcon: boolean;
}

/** 이모지 고르기: 이름·태그 검색, 분류 탭, 최근 사용. 표준 유니코드 이모지(운영체제 글꼴로 보인다). */
export function EmojiPicker({ onPick, onClose, hasIcon }: Props) {
  const [all, setAll] = useState<EmojiItem[]>([]);
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState<number | 'recent'>(recentEmojis().length ? 'recent' : 0);
  const [hover, setHover] = useState<EmojiItem | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void loadEmojis().then(setAll);
  }, []);
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [onClose]);

  const shown = useMemo<EmojiItem[]>(() => {
    if (query.trim()) return searchEmojis(all, query);
    if (group === 'recent') {
      const byEmoji = new Map(all.map((e) => [e.emoji, e]));
      return recentEmojis().map((e) => byEmoji.get(e) ?? { emoji: e, label: e, tags: [], group: 0 });
    }
    return all.filter((e) => e.group === group);
  }, [all, query, group]);

  const pick = (emoji: string) => {
    pushRecentEmoji(emoji);
    onPick(emoji);
  };

  return (
    <div className="emojipicker" ref={box} role="dialog" aria-label="아이콘 고르기" data-testid="emoji-picker">
      <div className="emojipicker__bar">
        <input
          autoFocus
          value={query}
          placeholder="이모지 검색 (예: 책, 웃음, 로켓)"
          aria-label="이모지 검색"
          onChange={(e) => setQuery(e.target.value)}
        />
        <button onClick={() => pick(randomOf(all) ?? '📄')} title="무작위로 고르기" aria-label="무작위 이모지">
          🎲
        </button>
        {hasIcon && (
          <button className="emojipicker__remove" onClick={() => onPick(null)}>
            제거
          </button>
        )}
      </div>
      {!query.trim() && (
        <div className="emojipicker__tabs" role="tablist">
          {recentEmojis().length > 0 && (
            <button role="tab" aria-selected={group === 'recent'} className={group === 'recent' ? 'active' : ''} onClick={() => setGroup('recent')} title="최근 사용">
              🕘
            </button>
          )}
          {EMOJI_GROUPS.map((g) => (
            <button key={g.group} role="tab" aria-selected={group === g.group} className={group === g.group ? 'active' : ''} onClick={() => setGroup(g.group)} title={g.name}>
              {g.icon}
            </button>
          ))}
        </div>
      )}
      <div className="emojipicker__grid" role="listbox" aria-label="이모지 목록">
        {all.length === 0 && <span className="muted small">불러오는 중…</span>}
        {all.length > 0 && shown.length === 0 && <span className="muted small">찾는 이모지가 없어요</span>}
        {shown.map((e) => (
          <button key={e.emoji} role="option" aria-label={e.label} title={e.label} onMouseEnter={() => setHover(e)} onClick={() => pick(e.emoji)}>
            {e.emoji}
          </button>
        ))}
      </div>
      <div className="emojipicker__foot muted small">{hover ? `${hover.emoji} ${hover.label}` : '이모지를 눌러 이 문서의 아이콘으로 정해요'}</div>
    </div>
  );
}

function randomOf(all: EmojiItem[]): string | undefined {
  return all.length ? all[Math.floor(Math.random() * all.length)]!.emoji : undefined;
}
