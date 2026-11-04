import { getLocale, t } from '@nopsidian/i18n';
import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** 무엇이 실패했는지 알려 주는 이름(예: '그래프'). 없으면 앱 전체를 감싸는 최상위 경계로 본다 */
  label?: string;
  /** 직접 만든 대체 화면. 두 번째 인자(reset)를 부르면 자식을 다시 그린다 */
  fallback?: (error: Error, reset: () => void) => ReactNode;
  /** 이 값들 중 하나라도 바뀌면 자동으로 다시 시도한다(예: 연 노트 경로) */
  resetKeys?: unknown[];
  onError?: (error: Error) => void;
}

interface State {
  error: Error | null;
}

/** 목적격 조사(을/를)를 앞말의 받침에 맞춰 고른다(한글이 아니면 '를') */
function objectParticle(word: string): string {
  const last = Array.from(word).pop() ?? '';
  const code = last.codePointAt(0) ?? 0;
  // 한글 음절(가~힣)은 (코드 - 0xAC00) % 28 이 0 이 아니면 받침이 있다
  return code >= 0xac00 && code <= 0xd7a3 && (code - 0xac00) % 28 !== 0 ? '을' : '를';
}

/** resetKeys 가 바뀌었는지 얕게 비교한다 */
function keysChanged(prev: unknown[] | undefined, next: unknown[] | undefined): boolean {
  if (prev === next) return false;
  if (!prev || !next || prev.length !== next.length) return true;
  return prev.some((value, i) => !Object.is(value, next[i]));
}

/**
 * 렌더·이펙트에서 난 예외를 붙잡아 그 자리만 대체 화면으로 바꾼다.
 * 경계가 없으면 예외 하나로 React 트리 전체가 언마운트되어 앱이 하얀 창이 된다.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[ErrorBoundary${this.props.label ? `:${this.props.label}` : ''}]`, error, info.componentStack);
    this.props.onError?.(error);
  }

  override componentDidUpdate(prev: Props): void {
    if (this.state.error && keysChanged(prev.resetKeys, this.props.resetKeys)) this.reset();
  }

  private reset = (): void => {
    this.setState({ error: null });
  };

  override render(): ReactNode {
    const { children, label, fallback } = this.props;
    const { error } = this.state;
    if (!error) return children;
    if (fallback) return fallback(error, this.reset);
    return (
      <div className="errorboundary" role="alert">
        <strong>{label ? t('error.crashedWith', { label: getLocale() === 'ko' ? `${label}${objectParticle(label)}` : label }) : t('error.crashed')}</strong>
        <pre className="errorboundary__message muted small">
          <code>{error.message || String(error)}</code>
        </pre>
        <div className="errorboundary__actions">
          <button type="button" onClick={this.reset}>
            {t('error.retry')}
          </button>
          {/* 앱 전체를 감싸는 최상위 경계에서만 창을 새로 불러온다(자식 경계에서 새로고침은 과하다) */}
          {!label && (
            <button type="button" onClick={() => window.location.reload()}>
              {t('error.reload')}
            </button>
          )}
        </div>
      </div>
    );
  }
}
