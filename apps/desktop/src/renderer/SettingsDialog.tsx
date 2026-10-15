import { useEffect, useState } from 'react';
import { applyPrefs, FONT_SIZES, loadPrefs, type Prefs } from './prefs';
import { applyTheme, THEME_LABEL, type ThemeChoice } from './theme';
import { keys } from './keys';
import { McpSettings } from './McpSettings';

interface Props {
  theme: ThemeChoice;
  onTheme: (t: ThemeChoice) => void;
  onClose: () => void;
  onOpenSync: () => void;
  onOpenShortcuts: () => void;
  onOpenTrash: () => void;
  onOpenNote: (path: string) => void;
}

/** 설정(⌘,): 모양·편집·동기화·도움말. 값은 이 기기에만 저장된다. */
export function SettingsDialog({ theme, onTheme, onClose, onOpenSync, onOpenShortcuts, onOpenTrash, onOpenNote }: Props) {
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
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
      <div className="dialog settings" role="dialog" aria-modal="true" aria-label="설정">
        <h2>설정</h2>
        <section>
          <h3>모양</h3>
          <div className="settings__row">
            <span>테마</span>
            <div className="seg" role="radiogroup" aria-label="테마">
              {(['system', 'light', 'dark'] as const).map((t) => (
                <button
                  key={t}
                  role="radio"
                  aria-checked={theme === t}
                  className={theme === t ? 'on' : ''}
                  onClick={() => {
                    applyTheme(t);
                    onTheme(t);
                  }}
                >
                  {THEME_LABEL[t]}
                </button>
              ))}
            </div>
          </div>
          <label className="settings__row">
            <span>본문 글자 크기</span>
            <select value={prefs.fontSize} onChange={(e) => set({ fontSize: Number(e.target.value) })} aria-label="본문 글자 크기">
              {FONT_SIZES.map((n) => (
                <option key={n} value={n}>
                  {n}px{n === 16 ? ' (기본)' : ''}
                </option>
              ))}
            </select>
          </label>
          <div className="settings__row">
            <span>본문 너비</span>
            <div className="seg" role="radiogroup" aria-label="본문 너비">
              {([
                ['normal', '보통'],
                ['wide', '넓게'],
                ['full', '창 너비'],
              ] as const).map(([w, label]) => (
                <button key={w} role="radio" aria-checked={prefs.width === w} className={prefs.width === w ? 'on' : ''} onClick={() => set({ width: w })}>
                  {label}
                </button>
              ))}
            </div>
          </div>
        </section>
        <section>
          <h3>편집</h3>
          <label className="settings__row">
            <span>
              제목을 바꾸면 파일 이름도 맞추기
              <small className="muted">노트를 떠날 때 첫 제목(H1)에 맞춰 파일 이름을 바꿔요. 링크도 함께 고쳐요.</small>
            </span>
            <input type="checkbox" checked={prefs.titleSync} onChange={(e) => set({ titleSync: e.target.checked })} aria-label="제목을 바꾸면 파일 이름도 맞추기" />
          </label>
        </section>
        <McpSettings onOpenNote={(p) => { onOpenNote(p); onClose(); }} />
        <section>
          <h3>볼트</h3>
          <div className="settings__links">
            <button onClick={onOpenSync}>☁ Google Drive 동기화…</button>
            <button onClick={onOpenTrash}>🗑 휴지통…</button>
            <button onClick={onOpenShortcuts}>⌨ 단축키 목록 ({keys('F1')})</button>
          </div>
        </section>
        <div className="dialog__actions">
          <button className="primary" onClick={onClose}>
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}
