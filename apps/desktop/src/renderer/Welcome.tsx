import { t } from '@nopsidian/i18n';
import type { NoteSummary } from '@nopsidian/ipc-contract';
import { keys } from './keys';
import { Logo } from './Logo';
import { useLocale } from './useLocale';

export interface WelcomeAction {
  icon: string;
  label: string;
  hint: string;
  run: () => void;
}

/** 열린 노트가 없을 때의 첫 화면: 자주 쓰는 동작과 최근 고친 노트 */
export function Welcome({ notes, onOpen, actions }: { notes: NoteSummary[]; onOpen: (path: string) => void; actions: WelcomeAction[] }) {
  useLocale();
  const recent = [...notes].sort((a, b) => b.mtime - a.mtime).slice(0, 6);
  return (
    <div className="welcome" data-testid="welcome">
      <Logo size={56} />
      <h2>{t('welcome.title')}</h2>
      <div className="welcome__actions">
        {actions.map((a) => (
          <button key={a.label} onClick={a.run}>
            <span className="welcome__icon" aria-hidden>{a.icon}</span>
            <span>{a.label}</span>
            {a.hint && <kbd>{keys(a.hint)}</kbd>}
          </button>
        ))}
      </div>
      {recent.length > 0 ? (
        <section className="welcome__recent">
          <h3>{t('welcome.recent')}</h3>
          <ul>
            {recent.map((n) => (
              <li key={n.path}>
                <button onClick={() => onOpen(n.path)}>
                  <span>{n.icon ? <span className="emoji">{n.icon}</span> : null}{n.title}</span>
                  <span className="muted small">{n.path}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <p className="muted">{t('welcome.empty')}</p>
      )}
    </div>
  );
}
