import { useEffect, useState } from 'react';
import { t } from '@nopsidian/i18n';
import type { VaultInfo } from '@nopsidian/ipc-contract';
import { Logo } from './Logo';
import { applyTheme, loadTheme, nextTheme, THEME_ICON, THEME_KEY, type ThemeChoice } from './theme';
import { useLocale } from './useLocale';
import { userMessage } from './user-message';

export function VaultPicker({ onOpen }: { onOpen: (v: VaultInfo) => void }) {
  useLocale();
  const [recent, setRecent] = useState<VaultInfo[]>([]);
  const [error, setError] = useState('');
  const [theme, setTheme] = useState<ThemeChoice>(() => loadTheme());
  const ThemeIcon = THEME_ICON[theme];
  useEffect(() => {
    void window.nops.vault.listRecent().then(setRecent);
  }, []);

  const run = async (fn: () => Promise<VaultInfo | null>) => {
    try {
      const v = await fn();
      if (v) onOpen(v);
    } catch (e) {
      setError(userMessage(e));
    }
  };

  return (
    <main className="start">
      <div className="start__drag drag" />
      <button
        className="start__theme"
        title={t('vault.themeTitle', { theme: t(THEME_KEY[theme]) })}
        aria-label={t('vault.themeAria', { theme: t(THEME_KEY[theme]) })}
        onClick={() => {
          const next = nextTheme(theme);
          applyTheme(next);
          setTheme(next);
        }}
      >
        <ThemeIcon />
      </button>
      <div className="start__card">
        <Logo size={88} />
        <h1>Lasagna</h1>
        <p className="start__tagline">{t('vault.tagline')}</p>
        <button className="primary start__cta" onClick={() => run(() => window.nops.vault.pick())}>
          {t('vault.open')}
        </button>
        <p className="start__hint">{t('vault.hint')}</p>
        {error && <p className="error">{error}</p>}
        {recent.length > 0 ? (
          <section className="start__recent" aria-label={t('vault.recent')}>
            <h2>{t('vault.recent')}</h2>
            <ul className="recent">
              {recent.map((v) => (
                <li key={v.id}>
                  <button onClick={() => run(() => window.nops.vault.open({ id: v.id }))}>
                    <span className="recent__icon" aria-hidden>📁</span>
                    <span className="recent__text">
                      <strong>{v.name}</strong>
                      <span className="muted recent__path" title={v.path}>{v.path}</span>
                    </span>
                    <span className="recent__go" aria-hidden>{t('vault.openRecent')}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : (
          <ul className="start__features" aria-label={t('vault.featuresAria')}>
            <li><strong>{t('vault.feature.editor.title')}</strong><span>{t('vault.feature.editor.body')}</span></li>
            <li><strong>{t('vault.feature.links.title')}</strong><span>{t('vault.feature.links.body')}</span></li>
            <li><strong>{t('vault.feature.db.title')}</strong><span>{t('vault.feature.db.body')}</span></li>
          </ul>
        )}
      </div>
    </main>
  );
}
