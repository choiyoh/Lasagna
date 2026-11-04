import { useEffect } from 'react';
import { t, type MessageKey } from '@nopsidian/i18n';
import { keys } from './keys';

const shortcutGroups = (): { title: MessageKey; items: [string, MessageKey][] }[] => [
  {
    title: 'shortcuts.move',
    items: [
      ['⌘O', 'shortcuts.quickSwitch'],
      ['⌘P', 'shortcuts.palette'],
      ['⌘⇧F', 'shortcuts.search'],
      ['⌘⇧\\', 'shortcuts.panel'],
      ['⌘,', 'shortcuts.settings'],
      ['⌘⌥D', 'shortcuts.daily'],
      ['⌘⇧G', 'shortcuts.graph'],
      ['⌘N', 'shortcuts.newNote'],
      ['⌘W', 'shortcuts.closeTab'],
      [t('shortcuts.metaClick'), 'shortcuts.newTab'],
    ],
  },
  {
    title: 'shortcuts.note',
    items: [
      ['F2', 'shortcuts.rename'],
      ['⌘F', 'shortcuts.find'],
      ['⌘E', 'shortcuts.mode'],
      ['⌘⇧B', 'shortcuts.bookmark'],
    ],
  },
  {
    title: 'shortcuts.edit',
    items: [
      ['/', 'shortcuts.slash'],
      ['[[', 'shortcuts.wikilink'],
      ['⌘/', 'shortcuts.blockMenu'],
      ['⌘D', 'shortcuts.duplicate'],
      ['⌘⇧↑ / ⌘⇧↓', 'shortcuts.moveBlock'],
      ['⌘Z / ⌘⇧Z', 'shortcuts.undo'],
    ],
  },
];

/** 단축키 목록(F1). 운영체제에 맞게 ⌘ 또는 Ctrl 로 보인다. */
export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const groups = shortcutGroups();
  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog shortcuts" role="dialog" aria-modal="true" aria-label={t('shortcuts.title')}>
        <h2>{t('shortcuts.title')}</h2>
        <div className="shortcuts__grid">
          {groups.map((g) => (
            <section key={g.title}>
              <h3>{t(g.title)}</h3>
              <dl>
                {g.items.map(([k, label]) => (
                  <div key={k}>
                    <dt>
                      <kbd>{keys(k)}</kbd>
                    </dt>
                    <dd>{t(label)}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
        <div className="dialog__actions">
          <button className="primary" onClick={onClose}>
            {t('common.close')}
          </button>
        </div>
      </div>
    </div>
  );
}
