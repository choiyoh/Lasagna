import { t } from '@nopsidian/i18n';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocale } from './useLocale';
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
  const locale = useLocale();
  const [all, setAll] = useState<EmojiItem[]>([]);
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState<number | 'recent'>(recentEmojis().length ? 'recent' : 0);
  const [hover, setHover] = useState<EmojiItem | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void loadEmojis(locale).then(setAll);
  }, [locale]);
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
    <div className="emojipicker" ref={box} role="dialog" aria-label={t('emoji.title')} data-testid="emoji-picker">
      <div className="emojipicker__bar">
        <input
          autoFocus
          value={query}
          placeholder={t('emoji.search')}
          aria-label={t('emoji.searchAria')}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button onClick={() => pick(randomOf(all) ?? '📄')} title={t('emoji.random')} aria-label={t('emoji.randomAria')}>
          🎲
        </button>
        {hasIcon && (
          <button className="emojipicker__remove" onClick={() => onPick(null)}>
            {t('common.remove')}
          </button>
        )}
      </div>
      {!query.trim() && (
        <div className="emojipicker__tabs" role="tablist">
          {recentEmojis().length > 0 && (
            <button role="tab" aria-selected={group === 'recent'} className={group === 'recent' ? 'active' : ''} onClick={() => setGroup('recent')} title={t('emoji.recent')}>
              🕘
            </button>
          )}
          {EMOJI_GROUPS.map((g) => (
            <button key={g.group} role="tab" aria-selected={group === g.group} className={group === g.group ? 'active' : ''} onClick={() => setGroup(g.group)} title={t(g.labelKey)}>
              {g.icon}
            </button>
          ))}
        </div>
      )}
      <div className="emojipicker__grid" role="listbox" aria-label={t('emoji.list')}>
        {all.length === 0 && <span className="muted small">{t('common.loading')}</span>}
        {all.length > 0 && shown.length === 0 && <span className="muted small">{t('emoji.noHits')}</span>}
        {shown.map((e) => (
          <button key={e.emoji} role="option" aria-label={e.label} title={e.label} onMouseEnter={() => setHover(e)} onClick={() => pick(e.emoji)}>
            {e.emoji}
          </button>
        ))}
      </div>
      <div className="emojipicker__foot muted small">{hover ? `${hover.emoji} ${hover.label}` : t('emoji.footer')}</div>
    </div>
  );
}

function randomOf(all: EmojiItem[]): string | undefined {
  return all.length ? all[Math.floor(Math.random() * all.length)]!.emoji : undefined;
}
