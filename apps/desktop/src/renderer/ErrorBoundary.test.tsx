// @vitest-environment jsdom
import { act, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { ErrorBoundary } from './ErrorBoundary';

let container: HTMLDivElement;
let root: Root;
let consoleError: MockInstance;

/** 항상 던지는 자식 */
function Boom(): ReactNode {
  throw new Error('그래프를 못 그려요');
}

const text = () => container.textContent ?? '';

function click(label: string): void {
  const button = [...container.querySelectorAll('button')].find((b) => b.textContent === label);
  if (!button) throw new Error(`버튼을 찾지 못했어요: ${label}`);
  act(() => button.click());
}

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  // 경계가 예외를 잡으면 React 도 console.error 로 기록한다 → 테스트 출력에서 가린다
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe('ErrorBoundary', () => {
  it('자식이 던져도 앱이 죽지 않고 role=alert 대체 화면을 보여 준다', () => {
    act(() => {
      root.render(
        <ErrorBoundary label="그래프">
          <Boom />
        </ErrorBoundary>,
      );
    });
    const alert = container.querySelector('.errorboundary[role="alert"]');
    expect(alert).not.toBeNull();
    expect(text()).toContain('그래프를 표시하는 중 문제가 생겼어요');
    expect(text()).toContain('그래프를 못 그려요'); // 예외 메시지도 함께 보여 준다
    expect(text()).toContain('다시 시도');
    expect(consoleError).toHaveBeenCalled();
  });

  it('label 이 없으면(최상위) 앱 다시 불러오기 버튼도 있다', () => {
    act(() => {
      root.render(
        <ErrorBoundary>
          <Boom />
        </ErrorBoundary>,
      );
    });
    expect(text()).toContain('이 화면을 표시하는 중 문제가 생겼어요');
    expect(text()).toContain('앱 다시 불러오기');
  });

  it('다시 시도를 누르면 자식을 다시 그린다', () => {
    let broken = true;
    function Flaky(): ReactNode {
      if (broken) throw new Error('아직 고장');
      return <p>고쳐졌어요</p>;
    }
    act(() => {
      root.render(
        <ErrorBoundary label="노트">
          <Flaky />
        </ErrorBoundary>,
      );
    });
    expect(text()).toContain('노트를 표시하는 중 문제가 생겼어요');
    broken = false;
    click('다시 시도');
    expect(text()).toContain('고쳐졌어요');
    expect(container.querySelector('.errorboundary')).toBeNull();
  });

  it('resetKeys 가 바뀌면 자동으로 다시 시도한다', () => {
    let broken = true;
    let bump: (key: number) => void = () => {};
    function Flaky(): ReactNode {
      if (broken) throw new Error('아직 고장');
      return <p>살아 있어요</p>;
    }
    function Host(): ReactNode {
      const [key, setKey] = useState(0);
      bump = setKey;
      return (
        <ErrorBoundary label="패널" resetKeys={[key]}>
          <Flaky />
        </ErrorBoundary>
      );
    }
    act(() => {
      root.render(<Host />);
    });
    expect(text()).toContain('패널을 표시하는 중 문제가 생겼어요');
    broken = false;
    act(() => bump(1));
    expect(text()).toContain('살아 있어요');
    expect(container.querySelector('.errorboundary')).toBeNull();
  });

  it('fallback 을 주면 그 화면을 그린다', () => {
    act(() => {
      root.render(
        <ErrorBoundary
          fallback={(error, reset) => (
            <div className="my-fallback" role="alert">
              <span>{error.message}</span>
              <button onClick={reset}>되돌리기</button>
            </div>
          )}
        >
          <Boom />
        </ErrorBoundary>,
      );
    });
    expect(container.querySelector('.my-fallback')).not.toBeNull();
    expect(text()).toContain('그래프를 못 그려요');
    expect(text()).not.toContain('다시 시도');
  });

  it('onError 로 예외를 알려 준다', () => {
    const onError = vi.fn();
    act(() => {
      root.render(
        <ErrorBoundary onError={onError}>
          <Boom />
        </ErrorBoundary>,
      );
    });
    expect(onError).toHaveBeenCalledTimes(1);
    const seen = onError.mock.calls[0]?.[0] as unknown as Error;
    expect(seen).toBeInstanceOf(Error);
    expect(seen.message).toBe('그래프를 못 그려요');
  });
});
