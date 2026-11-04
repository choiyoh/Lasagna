import { useEffect, useState } from 'react';
import { t } from '@nopsidian/i18n';
import type { LanguageSetting } from '@nopsidian/ipc-contract';
import { applyPrefs, FONT_SIZES, loadPrefs, type Prefs } from './prefs';
import { applyTheme, THEME_KEY, type ThemeChoice } from './theme';
import { keys } from './keys';
import { changeLanguage } from './language';
import { useLanguage } from './useLocale';
import { McpSettings } from './McpSettings';

interface Props {
  theme: ThemeChoice;
  onTheme: (t: ThemeChoice) => void;
  onClose: () => void;
  onOpenSync: () => void;
  onOpenShortcuts: () => void;
  onOpenTrash: () => void;
  onOpenNote: (path: string) => void;
  onReverted: (path: string, kind: 'restored' | 'trashed') => void;
}

const LANGUAGE_KEY: Record<LanguageSetting, Parameters<typeof t>[0]> = {
  system: 'settings.language.system',
  ko: 'settings.language.ko',
  en: 'settings.language.en',
};

/** 설정(⌘,): 모양·편집·동기화·도움말. 값은 이 기기에만 저장된다. */
export function SettingsDialog({ theme, onTheme, onClose, onOpenSync, onOpenShortcuts, onOpenTrash, onOpenNote, onReverted }: Props) {
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
  const language = useLanguage();
  const set = (patch: Partial<Prefs>) =>
    setPrefs((cur) => {
      const next = { ...cur, ...patch };
      applyPrefs(next);
      return next;
    });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog settings" role="dialog" aria-modal="true" aria-label={t('settings.title')}>
        <header className="settings__head">
          <h2>{t('settings.title')}</h2>
          <button className="settings__x" onClick={onClose} aria-label={t('settings.close')} title={t('settings.closeHint')}>
            ×
          </button>
        </header>
        <div className="settings__body">
          <section>
            <h3>{t('settings.appearance')}</h3>
            <div className="settings__row">
              <span>{t('settings.theme')}</span>
              <div className="seg" role="radiogroup" aria-label={t('settings.theme')}>
                {(['system', 'light', 'dark'] as const).map((choice) => (
                  <button
                    key={choice}
                    role="radio"
                    aria-checked={theme === choice}
                    className={theme === choice ? 'on' : ''}
                    onClick={() => {
                      applyTheme(choice);
                      onTheme(choice);
                    }}
                  >
                    {t(THEME_KEY[choice])}
                  </button>
                ))}
              </div>
            </div>
            <div className="settings__row">
              <span>{t('settings.language')}</span>
              <div className="seg" role="radiogroup" aria-label={t('settings.language')}>
                {(['system', 'ko', 'en'] as const).map((option) => (
                  <button
                    key={option}
                    role="radio"
                    aria-checked={language.setting === option}
                    className={language.setting === option ? 'on' : ''}
                    onClick={() => void changeLanguage(option)}
                  >
                    {t(LANGUAGE_KEY[option])}
                  </button>
                ))}
              </div>
            </div>
            <label className="settings__row">
              <span>{t('settings.fontSize')}</span>
              <select value={prefs.fontSize} onChange={(e) => set({ fontSize: Number(e.target.value) })} aria-label={t('settings.fontSize')}>
                {FONT_SIZES.map((n) => (
                  <option key={n} value={n}>
                    {n === 16 ? t('settings.fontSizeDefault', { size: n }) : t('settings.fontSizeValue', { size: n })}
                  </option>
                ))}
              </select>
            </label>
            <div className="settings__row">
              <span>{t('settings.width')}</span>
              <div className="seg" role="radiogroup" aria-label={t('settings.width')}>
                {(['normal', 'wide', 'full'] as const).map((width) => (
                  <button key={width} role="radio" aria-checked={prefs.width === width} className={prefs.width === width ? 'on' : ''} onClick={() => set({ width })}>
                    {t(`settings.width.${width}`)}
                  </button>
                ))}
              </div>
            </div>
          </section>
          <section>
            <h3>{t('settings.editing')}</h3>
            <label className="settings__row">
              <span>
                {t('settings.titleSync')}
                <small className="muted">{t('settings.titleSyncHint')}</small>
              </span>
              <input type="checkbox" checked={prefs.titleSync} onChange={(e) => set({ titleSync: e.target.checked })} aria-label={t('settings.titleSync')} />
            </label>
          </section>
          <McpSettings onOpenNote={(p) => { onOpenNote(p); onClose(); }} onReverted={onReverted} />
          <section>
            <h3>{t('settings.vault')}</h3>
            <div className="settings__links">
              <button onClick={onOpenSync}>☁ {t('settings.vault.sync')}</button>
              <button onClick={onOpenTrash}>🗑 {t('settings.vault.trash')}</button>
              <button onClick={onOpenShortcuts}>⌨ {t('settings.vault.shortcuts', { key: keys('F1') })}</button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
