import { t } from '@nopsidian/i18n';
import { useEffect, useRef, useState } from 'react';
import type { EditorView } from 'prosemirror-view';
import { clearFind, findCount, findFromCursor, findMove, replaceEvery, replaceOne, setFind } from '@nopsidian/editor/nops';
import { loadFindParticles, saveFindParticles } from './find-prefs';
import { keys } from './keys';

interface Props {
  view: EditorView;
  /** 처음 열 때 채울 말(에디터에서 고른 글자) */
  initial: string;
  /** 다시 ⌘F 를 누를 때마다 바뀌어 입력창에 초점을 다시 준다 */
  focusTick: number;
  /** 문서가 바뀔 때마다 바뀌어 개수를 다시 센다 */
  docTick: number;
  onClose: () => void;
}

/** 노트 안 찾기·바꾸기 막대(⌘F). Enter 다음, ⇧Enter 이전, Esc 닫기. */
export function FindBar({ view, initial, focusTick, docTick, onClose }: Props) {
  const [text, setText] = useState(initial);
  const [replace, setReplace] = useState('');
  const [showReplace, setShowReplace] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  // 기기 설정에 기억한다(기본 켬)
  const [particles, setParticles] = useState(() => loadFindParticles());
  const [count, setCount] = useState({ current: 0, total: 0 });
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [focusTick]);
  useEffect(() => {
    if (initial) setText(initial);
  }, [initial, focusTick]);

  // 찾을 말이 바뀌면 강조를 다시 하고, 처음 일치로 간다
  useEffect(() => {
    setFind(view, text, replace, { caseSensitive });
    setCount(findCount(view));
  }, [view, text, replace, caseSensitive]);
  useEffect(() => {
    if (!text) return;
    findFromCursor(view);
    setCount(findCount(view));
    // 찾을 말이 바뀔 때만 이동한다
  }, [view, text, caseSensitive]);
  useEffect(() => setCount(findCount(view)), [view, docTick]);
  // 닫히면 강조를 지운다
  useEffect(() => () => clearFind(view), [view]);

  const move = (dir: 1 | -1) => {
    findMove(view, dir);
    setCount(findCount(view));
  };
  const toggleParticles = () => {
    const next = !particles;
    setParticles(next);
    saveFindParticles(next);
  };
  const replaceAtCursor = () => {
    replaceOne(view, particles);
    setCount(findCount(view));
  };
  const replaceEverywhere = () => {
    replaceEvery(view, particles);
    setCount(findCount(view));
  };
  const close = () => {
    onClose();
    view.focus();
  };

  return (
    <div className="findbar" role="search" data-testid="find-bar">
      <div className="findbar__row">
        <button
          className="findbar__toggle"
          onClick={() => setShowReplace((v) => !v)}
          aria-expanded={showReplace}
          aria-label={showReplace ? t('find.toggleHide') : t('find.toggleShow')}
          title={t('find.toggle')}
        >
          {showReplace ? '▾' : '▸'}
        </button>
        <input
          ref={inputRef}
          value={text}
          placeholder={t('find.placeholder')}
          aria-label={t('find.term')}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              move(e.shiftKey ? -1 : 1);
            } else if (e.key === 'Escape') {
              e.preventDefault();
              close();
            }
          }}
        />
        <span className="findbar__count" data-testid="find-count">
          {text ? (count.total ? `${count.current || '–'}/${count.total}` : t('find.none')) : ''}
        </span>
        <button
          className="findbar__opt"
          aria-pressed={caseSensitive}
          onClick={() => setCaseSensitive((v) => !v)}
          title={t('find.case')}
        >
          Aa
        </button>
        <button onClick={() => move(-1)} aria-label={t('find.previous')} title={keys(t('find.previousTitle'))} disabled={!count.total}>
          ↑
        </button>
        <button onClick={() => move(1)} aria-label={t('find.next')} title={t('find.nextTitle')} disabled={!count.total}>
          ↓
        </button>
        <button onClick={close} aria-label={t('find.closeAria')} title={t('find.closeTitle')}>
          ×
        </button>
      </div>
      {showReplace && (
        <div className="findbar__row">
          <span className="findbar__spacer" />
          <input
            value={replace}
            placeholder={t('find.replacePlaceholder')}
            aria-label={t('find.replacePlaceholder')}
            onChange={(e) => setReplace(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                replaceAtCursor();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                close();
              }
            }}
          />
          <button disabled={!count.total} onClick={replaceAtCursor}>
            {t('find.replace')}
          </button>
          <button disabled={!count.total} onClick={replaceEverywhere}>
            {t('find.replaceAll')}
          </button>
          <label className="findbar__check" title={t('find.particlesTitle')}>
            <input type="checkbox" checked={particles} onChange={toggleParticles} />
            {t('find.particles')}
          </label>
        </div>
      )}
    </div>
  );
}
