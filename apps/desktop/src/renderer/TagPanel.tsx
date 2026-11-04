import { t } from '@nopsidian/i18n';
import { useEffect, useState } from 'react';

interface Props {
  onOpen: (path: string) => void;
}

/** 태그 패널: 개수와 함께 나열하고(중첩 태그는 들여쓰기), 누르면 그 태그(하위 태그 포함)의 노트를 펼친다. */
export function TagPanel({ onOpen }: Props) {
  const [tags, setTags] = useState<{ tag: string; count: number }[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [notes, setNotes] = useState<{ path: string; title: string }[]>([]);

  useEffect(() => {
    const load = () => void window.nops.tag.list().then(setTags);
    load();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const off = window.nops.on('note.changed', () => {
      clearTimeout(timer);
      timer = setTimeout(load, 400);
    });
    return () => {
      clearTimeout(timer);
      off();
    };
  }, []);

  useEffect(() => {
    if (open === null) return setNotes([]);
    void window.nops.tag.notes({ tag: open }).then(setNotes);
  }, [open]);

  if (tags.length === 0) return <p className="muted small pad">{t('tags.empty')}</p>;

  const sorted = [...tags].sort((a, b) => a.tag.localeCompare(b.tag, 'ko'));
  return (
    <ul className="tags" data-testid="tag-panel">
      {sorted.map(({ tag, count }) => (
        <li key={tag}>
          <button
            className={open === tag ? 'tag active' : 'tag'}
            style={{ paddingLeft: 8 + (tag.split('/').length - 1) * 14 }}
            onClick={() => setOpen(open === tag ? null : tag)}
          >
            <span>#{tag.split('/').pop()}</span>
            <span className="count">{count}</span>
          </button>
          {open === tag && (
            <ul className="tagnotes">
              {notes.map((n) => (
                <li key={n.path}>
                  <button onClick={() => onOpen(n.path)} title={n.path}>
                    {n.title}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ul>
  );
}
