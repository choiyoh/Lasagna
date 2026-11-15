// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { trapFocus } from './focus-guard';

function key(shiftKey = false): { key: string; shiftKey: boolean; prevented: boolean; preventDefault(): void } {
  return {
    key: 'Tab',
    shiftKey,
    prevented: false,
    preventDefault() {
      this.prevented = true;
    },
  };
}

function setup(): { box: HTMLElement; first: HTMLButtonElement; last: HTMLButtonElement } {
  document.body.innerHTML = '<button id="outside">outside</button><div id="box"><button id="first">first</button><input id="middle" /><button id="last">last</button></div>';
  return {
    box: document.querySelector<HTMLElement>('#box')!,
    first: document.querySelector<HTMLButtonElement>('#first')!,
    last: document.querySelector<HTMLButtonElement>('#last')!,
  };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('trapFocus', () => {
  it('마지막에서 Tab 이면 첫 컨트롤로 감는다', () => {
    const { box, first, last } = setup();
    last.focus();
    const event = key();
    trapFocus(event, box);
    expect(event.prevented).toBe(true);
    expect(document.activeElement).toBe(first);
  });

  it('첫 컨트롤에서 Shift+Tab 이면 마지막으로 감는다', () => {
    const { box, first, last } = setup();
    first.focus();
    const event = key(true);
    trapFocus(event, box);
    expect(event.prevented).toBe(true);
    expect(document.activeElement).toBe(last);
  });

  it('가운데에서는 막지 않고, 대화상자 밖에서 누르면 첫 컨트롤로 되돌린다', () => {
    const { box, first } = setup();
    document.querySelector<HTMLInputElement>('#middle')!.focus();
    const middle = key();
    trapFocus(middle, box);
    expect(middle.prevented).toBe(false);
    expect(document.activeElement?.id).toBe('middle');

    document.querySelector<HTMLButtonElement>('#outside')!.focus();
    const outside = key();
    trapFocus(outside, box);
    expect(outside.prevented).toBe(true);
    expect(document.activeElement).toBe(first);
  });

  it('Tab 이 아니면 아무 것도 하지 않는다', () => {
    const { box, last } = setup();
    last.focus();
    const event = { ...key(), key: 'Enter' };
    trapFocus(event, box);
    expect(event.prevented).toBe(false);
  });
});
