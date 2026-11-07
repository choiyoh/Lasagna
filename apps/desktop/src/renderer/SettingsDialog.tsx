import { useEffect, useRef, useState } from 'react';
import { t } from '@nopsidian/i18n';
import type { LanguageSetting } from '@nopsidian/ipc-contract';
import { applyPrefs, FONT_SIZES, loadPrefs, type Prefs } from './prefs';
import { applyTheme, THEME_KEY, type ThemeChoice } from './theme';
import { keys } from './keys';
import { changeLanguage, changeWriterSettings } from './language';
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

interface SegOption<T extends string> {
  value: T;
  label: string;
}

/**
 * 테마·언어 라디오그룹. 표준 라디오 패턴: 선택된 항목만 Tab 으로 닿고(로빙 tabindex),
 * ←/→/↑/↓ 는 이동하며 선택, Home/End 는 처음/끝. Space·Enter 는 버튼 기본 동작.
 * onSelect 가 false(저장 실패)를 돌려주면 선택된 항목으로 포커스를 되돌린다.
 */
function RadioSeg<T extends string>({
  label,
  value,
  options,
  onSelect,
}: {
  label: string;
  value: T;
  options: ReadonlyArray<SegOption<T>>;
  onSelect: (value: T) => void | boolean | Promise<boolean>;
}) {
  const refs = useRef(new Map<T, HTMLButtonElement | null>());
  const focusValue = (next: T) => refs.current.get(next)?.focus();
  const pick = (option: SegOption<T>) => {
    const result = onSelect(option.value);
    if (result instanceof Promise) {
      void result.then((ok) => {
        if (ok === false) focusValue(value);
      });
      return;
    }
    if (result === false) focusValue(value);
  };
  const selectAt = (index: number) => {
    const option = options[index];
    if (!option) return;
    pick(option);
    focusValue(option.value);
  };
  const step = (from: number, delta: -1 | 1) => {
    const next = (from + delta + options.length) % options.length;
    selectAt(next);
  };
  return (
    <div className="seg" role="radiogroup" aria-label={label}>
      {options.map((option, index) => (
        <button
          key={option.value}
          ref={(node) => {
            refs.current.set(option.value, node);
          }}
          role="radio"
          aria-checked={option.value === value}
          tabIndex={option.value === value ? 0 : -1}
          className={option.value === value ? 'on' : ''}
          onClick={() => pick(option)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
              event.preventDefault();
              step(index, 1);
            } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
              event.preventDefault();
              step(index, -1);
            } else if (event.key === 'Home') {
              event.preventDefault();
              selectAt(0);
            } else if (event.key === 'End') {
              event.preventDefault();
              selectAt(options.length - 1);
            }
          }}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** 설정(⌘,): 모양·편집·동기화·도움말. 값은 이 기기에만 저장된다. */
export function SettingsDialog({ theme, onTheme, onClose, onOpenSync, onOpenShortcuts, onOpenTrash, onOpenNote, onReverted }: Props) {
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
  const [languageError, setLanguageError] = useState(false);
  const [writerError, setWriterError] = useState(false);
  const language = useLanguage();
  const chooseLanguage = async (option: LanguageSetting): Promise<boolean> => {
    setLanguageError(false);
    try {
      await changeLanguage(option);
      return true;
    } catch {
      // 저장 실패: useLanguage() 가 이전 설정을 그대로 보여 주고, 라디오 포커스도 원래 값으로 돌아간다.
      setLanguageError(true);
      return false;
    }
  };
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
              <RadioSeg
                label={t('settings.theme')}
                value={theme}
                options={(['system', 'light', 'dark'] as const).map((choice) => ({ value: choice, label: t(THEME_KEY[choice]) }))}
                onSelect={(choice) => {
                  applyTheme(choice);
                  onTheme(choice);
                }}
              />
            </div>
            <div className="settings__row">
              <span>{t('settings.language')}</span>
              <RadioSeg
                label={t('settings.language')}
                value={language.setting}
                options={(['system', 'ko', 'en'] as const).map((option) => ({ value: option, label: t(LANGUAGE_KEY[option]) }))}
                onSelect={(option) => chooseLanguage(option)}
              />
            </div>
            {languageError ? <p className="error" role="alert">{t('settings.language.error')}</p> : null}
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
            <h3>{t('settings.writer')}</h3>
            <label className="settings__row">
              <span>
                {t('settings.writerMode')}
                <small className="muted">{t('settings.writerModeHint')}</small>
              </span>
              <input
                type="checkbox"
                data-testid="writer-mode"
                checked={language.writerMode === true}
                onChange={(e) => void changeWriterSettings({ mode: e.target.checked }).catch(() => setWriterError(true))}
                aria-label={t('settings.writerMode')}
              />
            </label>
            {language.writerMode === true && (
              <label className="settings__row">
                <span>
                  {t('settings.writerDailyGoal')}
                  <small className="muted">{t('settings.writerDailyGoalHint')}</small>
                </span>
                <input
                  type="number"
                  min={1}
                  inputMode="numeric"
                  className="settings__input"
                  data-testid="writer-daily-goal"
                  aria-label={t('settings.writerDailyGoal')}
                  value={language.writerDailyGoal ?? ''}
                  onChange={(e) => {
                    const value = Number(e.target.value);
                    void changeWriterSettings({ dailyGoal: Number.isFinite(value) && value > 0 ? Math.floor(value) : null }).catch(() => setWriterError(true));
                  }}
                />
              </label>
            )}
            {language.writerMode === true && (
              <div className="settings__row">
                <span>{t('settings.writerSpacing')}</span>
                <RadioSeg
                  label={t('settings.writerSpacing')}
                  value={language.writerSpacing ?? 'include'}
                  options={(['include', 'exclude'] as const).map((option) => ({ value: option, label: t(`settings.writerSpacing.${option}`) }))}
                  onSelect={(option) => void changeWriterSettings({ spacing: option }).catch(() => setWriterError(true))}
                />
              </div>
            )}
            {writerError ? <p className="error" role="alert">{t('settings.writer.error')}</p> : null}
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
