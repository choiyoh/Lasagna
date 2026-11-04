import { t } from '@nopsidian/i18n';
import { useEffect, useMemo, useRef, useState } from 'react';
import { quickSwitch } from '../workers/index/quick-switch';

interface Props {
  onPick: (path: string) => void;
  onClose: () => void;
}

/** "템플릿 삽입"에서 템플릿 노트를 고르는 작은 목록(초성·퍼지 검색). */
export function TemplatePicker({ onPick, onClose }: Props) {
  const [templates, setTemplates] = useState<{ path: string; title: string }[] | null>(null);
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void window.nops.template.list().then(setTemplates);
  }, []);
  useEffect(() => setIndex(0), [query]);
  // 슬래시 메뉴가 항목을 실행한 직후 에디터로 포커스를 되돌리므로, 그 뒤에 입력창을 다시 잡는다
  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 40);
    return () => clearTimeout(t);
  }, []);

  const hits = useMemo(
    () => quickSwitch((templates ?? []).map((t) => ({ path: t.path, title: t.title, aliases: [] })), query, 20),
    [templates, query],
  );

  return (
    <div className="dialog-backdrop top" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="switcher" role="dialog" aria-modal="true" aria-label={t('template.title')}>
        <input
          ref={inputRef}
          autoFocus
          value={query}
          placeholder={t('template.search')}
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
              const hit = hits[index];
              if (hit) onPick(hit.path);
            } else if (e.key === 'Escape') {
              onClose();
            }
          }}
        />
        <div className="switcher__list" role="listbox">
          {templates === null && <div className="switcher__item"><span className="switcher__path">{t('common.loading')}</span></div>}
          {templates !== null && templates.length === 0 && (
            <div className="switcher__item">
              <span className="switcher__title">{t('template.empty')}</span>
              <span className="switcher__path">{t('template.hint')}</span>
            </div>
          )}
          {hits.map((h, i) => (
            <div
              key={h.path}
              role="option"
              aria-selected={i === index}
              className={i === index ? 'switcher__item is-active' : 'switcher__item'}
              onMouseMove={() => setIndex(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                onPick(h.path);
              }}
            >
              <span className="switcher__title">{h.title}</span>
              <span className="switcher__path">{h.path}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
