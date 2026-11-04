import { t } from '@nopsidian/i18n';
import { useEffect, useState } from 'react';
import { OUTLINE_EVENT, OUTLINE_JUMP, OUTLINE_REQUEST, type OutlineEvent, type OutlineItem } from './outline';

/** 오른쪽 패널의 개요: 현재 노트의 제목들(편집하는 대로 바뀐다). 누르면 그 제목으로 이동한다. */
export function OutlinePanel({ path }: { path: string }) {
  const [items, setItems] = useState<OutlineItem[]>([]);
  useEffect(() => {
    setItems([]);
    const on = (e: Event) => {
      const d = (e as CustomEvent<OutlineEvent>).detail;
      if (d.path === path) setItems(d.items);
    };
    window.addEventListener(OUTLINE_EVENT, on);
    window.dispatchEvent(new CustomEvent(OUTLINE_REQUEST, { detail: path }));
    return () => window.removeEventListener(OUTLINE_EVENT, on);
  }, [path]);
  const min = items.reduce((m, i) => Math.min(m, i.level), 6);
  return (
    <nav className="outline" aria-label={t('outline.title')} data-testid="outline">
      {items.length === 0 ? (
        <p className="muted small pad">{t('outline.empty')}</p>
      ) : (
        <ul>
          {items.map((it, i) => (
            <li key={`${i}:${it.pos}`}>
              <button
                className={`outline__item lv${it.level}`}
                style={{ paddingLeft: 8 + (it.level - min) * 14 }}
                onClick={() => window.dispatchEvent(new CustomEvent(OUTLINE_JUMP, { detail: { path, pos: it.pos } }))}
                title={it.text}
              >
                {it.text || t('outline.untitled')}
              </button>
            </li>
          ))}
        </ul>
      )}
    </nav>
  );
}
