import { useEffect, useRef, useState } from 'react';
import type { EditorView } from 'prosemirror-view';
import { clearFind, findCount, findFromCursor, findMove, replaceEvery, replaceOne, setFind } from '@nopsidian/editor/nops';
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
          aria-label="바꾸기 열기"
          title="바꾸기"
        >
          {showReplace ? '▾' : '▸'}
        </button>
        <input
          ref={inputRef}
          value={text}
          placeholder="노트에서 찾기"
          aria-label="찾을 말"
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
          {text ? (count.total ? `${count.current || '–'}/${count.total}` : '없음') : ''}
        </span>
        <button
          className="findbar__opt"
          aria-pressed={caseSensitive}
          onClick={() => setCaseSensitive((v) => !v)}
          title="대소문자 구분"
        >
          Aa
        </button>
        <button onClick={() => move(-1)} aria-label="이전" title={keys('이전 (⇧Enter)')} disabled={!count.total}>
          ↑
        </button>
        <button onClick={() => move(1)} aria-label="다음" title="다음 (Enter)" disabled={!count.total}>
          ↓
        </button>
        <button onClick={close} aria-label="찾기 닫기" title="닫기 (Esc)">
          ×
        </button>
      </div>
      {showReplace && (
        <div className="findbar__row">
          <span className="findbar__spacer" />
          <input
            value={replace}
            placeholder="바꿀 말"
            aria-label="바꿀 말"
            onChange={(e) => setReplace(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                replaceOne(view);
                setCount(findCount(view));
              } else if (e.key === 'Escape') {
                e.preventDefault();
                close();
              }
            }}
          />
          <button
            disabled={!count.total}
            onClick={() => {
              replaceOne(view);
              setCount(findCount(view));
            }}
          >
            바꾸기
          </button>
          <button
            disabled={!count.total}
            onClick={() => {
              replaceEvery(view);
              setCount(findCount(view));
            }}
          >
            모두 바꾸기
          </button>
        </div>
      )}
    </div>
  );
}
