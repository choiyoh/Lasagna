import { t } from '@nopsidian/i18n';
import type { ReactNode } from 'react';
import type { TabsAction, TabsState } from './tabs';

interface Props {
  tabs: TabsState;
  dispatch: (a: TabsAction) => void;
  titleOf: (path: string) => string;
  /** 탭 하나의 에디터(활성 탭만 그린다) */
  renderEditor: (path: string, pane: number) => ReactNode;
  empty: ReactNode;
  /** 탭을 새 창으로 띄운다 */
  onPopOut: (path: string) => void;
}

/** 탭 막대 + 분할 칸. 노트를 연 칸에만 탭 막대가 보인다. */
export function Panes({ tabs, dispatch, titleOf, renderEditor, empty, onPopOut }: Props) {
  return (
    <div className={`panes panes--${tabs.dir}`} data-testid="panes">
      {tabs.panes.map((pane, i) => (
        <section
          key={i}
          className={`pane${tabs.panes.length > 1 && i === tabs.activePane ? ' is-active' : ''}`}
          data-testid={`pane-${i}`}
          onMouseDownCapture={() => i !== tabs.activePane && dispatch({ type: 'focusPane', pane: i })}
        >
          {(pane.tabs.length > 0 || tabs.panes.length > 1) && (
            <div className="tabbar" role="tablist" aria-label={t('tab.bar', { n: i + 1 })}>
              {pane.tabs.map((p) => (
                <div
                  key={p}
                  role="tab"
                  aria-selected={p === pane.active}
                  className={p === pane.active ? 'tab active' : 'tab'}
                  data-testid="note-tab"
                  title={p}
                  onClick={() => dispatch({ type: 'activate', pane: i, path: p })}
                  onAuxClick={(e) => {
                    if (e.button === 1) dispatch({ type: 'close', pane: i, path: p });
                  }}
                  onDoubleClick={() => onPopOut(p)}
                >
                  <span className="tab__title">{titleOf(p)}</span>
                  <button
                    className="tab__close"
                    aria-label={t('tab.close', { title: titleOf(p) })}
                    onClick={(e) => {
                      e.stopPropagation();
                      dispatch({ type: 'close', pane: i, path: p });
                    }}
                  >
                    ×
                  </button>
                </div>
              ))}
              {pane.tabs.length === 0 && <span className="muted small tabbar__empty">{t('tab.empty')}</span>}
            </div>
          )}
          <div className="pane__body">{pane.active ? renderEditor(pane.active, i) : <div className="pane__empty">{empty}</div>}</div>
        </section>
      ))}
    </div>
  );
}
