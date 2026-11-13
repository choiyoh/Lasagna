// @vitest-environment jsdom
import { act } from 'react';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TableView } from './TableView';
import type { DbData, DbRowDto } from './types';

let container: HTMLDivElement;
let root: Root;

function stubSizes(): void {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 800 });
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get: () => 800 });
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => 400 });
}

function data(over: Partial<DbData> = {}): DbData {
  return {
    folder: 'db',
    schema: {
      version: 1,
      rowsFolder: '.',
      properties: { 점수: { type: 'number', format: 'number' }, 상태: { type: 'select', options: [{ name: '진행' }] } },
      views: [],
      templates: [],
    },
    issues: [],
    view: { id: 'v1', name: '표', type: 'table', sort: [], columns: ['title', '점수', '상태'] },
    total: 2,
    matched: 0,
    rows: [],
    groups: null,
    calc: {},
    errors: {},
    ...over,
  };
}

const row = (i: number): DbRowDto => ({ path: `db/행${i}.md`, title: `행${i}`, values: { 점수: i, 상태: '진행' } });

const render = (node: ReactNode) => act(() => root.render(node));

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  stubSizes();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

const episodeData = (): DbData => ({
  folder: '작품/회차',
  schema: {
    version: 1,
    rowsFolder: '.',
    properties: {
      회차: { type: 'number', format: 'number' },
      상태: { type: 'status', options: [{ name: '초고', group: 'todo' }, { name: '퇴고', group: 'doing' }] },
      '목표 달성': { type: 'formula', expr: 'goal_met()' },
      수정일: { type: 'updated_time' },
    },
    views: [],
    templates: [],
  },
  issues: [],
  view: { id: 'v1', name: '전체', type: 'table', sort: [], columns: ['회차', 'title', '상태', '목표 달성', '수정일'] },
  total: 3,
  matched: 0,
  rows: [],
  groups: null,
  calc: {},
  errors: {},
});

describe('회차 DB 표시(episode)', () => {
  it('상태는 칩으로 보이고, 누르면 드롭다운 편집기가 열린다', () => {
    const rows: DbRowDto[] = [{ path: 'r1.md', title: '1화', values: { 상태: '초고', '목표 달성': true, 수정일: new Date(2026, 10, 13, 14, 5).toISOString() } }];
    render(
      <TableView
        data={episodeData()}
        rows={rows}
        episode
        onOpen={() => undefined}
        onEdit={() => undefined}
        onWidth={() => undefined}
        notes={[]}
      />,
    );
    const cell = container.querySelector<HTMLElement>('[role="cell"][data-prop="상태"]')!;
    expect(cell.querySelector('.chip')?.textContent).toBe('초고');
    expect(cell.querySelector('select')).toBeNull();
    act(() => cell.click());
    expect(cell.querySelector('select')).not.toBeNull();
  });

  it('수정일은 사람이 읽는 형식, goal_met 은 달성/미달/목표 없음 3상태', () => {
    const rows: DbRowDto[] = [
      { path: 'r1.md', title: '1화', values: { 상태: '초고', '목표 달성': true, 수정일: new Date(2026, 10, 13, 14, 5).toISOString() } },
      { path: 'r2.md', title: '2화', values: { 상태: '초고', '목표 달성': false, 수정일: new Date(2026, 10, 13, 14, 6).toISOString() } },
      { path: 'r3.md', title: '3화', values: { 상태: '초고', '목표 달성': null, 수정일: new Date(2026, 10, 13, 14, 7).toISOString() } },
    ];
    render(
      <TableView
        data={episodeData()}
        rows={rows}
        episode
        onOpen={() => undefined}
        onEdit={() => undefined}
        onWidth={() => undefined}
        notes={[]}
      />,
    );
    const goal = (title: string) =>
      [...container.querySelectorAll('.dbtable__row')]
        .find((el) => el.textContent?.includes(title))!
        .querySelector('[role="cell"][data-prop="목표 달성"]')!.textContent;
    expect(goal('1화')).toBe('달성');
    expect(goal('2화')).toBe('미달');
    expect(goal('3화')).toBe('—');
    const updated = container.querySelector('[role="cell"][data-prop="수정일"]')!.textContent;
    expect(updated).toBe('2026-11-13 14:05');
  });

  it('일반 DB 는 상태 선택기와 수정일 원문 표시가 그대로다', () => {
    const general = episodeData();
    general.folder = '일반DB';
    const rows: DbRowDto[] = [{ path: 'g1.md', title: '행1', values: { 상태: '초고', 수정일: new Date(2026, 10, 13, 14, 5).toISOString() } }];
    render(
      <TableView
        data={general}
        rows={rows}
        onOpen={() => undefined}
        onEdit={() => undefined}
        onWidth={() => undefined}
        notes={[]}
      />,
    );
    const cell = container.querySelector<HTMLElement>('[role="cell"][data-prop="상태"]')!;
    expect(cell.querySelector('select')).not.toBeNull();
    expect(cell.querySelector('.chip')).toBeNull();
    expect(container.querySelector('[role="cell"][data-prop="수정일"]')!.textContent).toContain('T');
  });
});

describe('TableView', () => {
  it('0행이어도 헤더와 열 메뉴를 남기고 빈 상태를 본문에 그린다', () => {
    const onSort = vi.fn();
    render(
      <TableView
        data={data()}
        rows={[]}
        empty={<p data-testid="table-empty">조건에 맞는 결과가 없어요</p>}
        onOpen={() => undefined}
        onEdit={() => undefined}
        onWidth={() => undefined}
        onSort={onSort}
        onHide={() => undefined}
        notes={[]}
      />,
    );

    const heads = [...container.querySelectorAll('.dbtable__th')].map((el) => el.textContent?.trim());
    expect(heads).toEqual(['제목', '점수', '상태']);
    expect(container.querySelector('[data-testid="table-empty"]')?.textContent).toBe('조건에 맞는 결과가 없어요');

    const head = document.querySelector<HTMLButtonElement>('[data-testid="th-점수"]');
    act(() => head!.click());
    const menu = document.querySelector('.dbtable__menu');
    expect(menu).not.toBeNull();
    expect(menu?.parentElement).toBe(document.body); // th overflow 에 잘리지 않게 포털로 띄운다
    const asc = [...document.querySelectorAll<HTMLButtonElement>('.dbtable__menu button')].find((b) => b.textContent?.includes('오름차순'));
    act(() => asc!.click());
    expect(onSort).toHaveBeenCalledWith('점수', 'asc');
    expect(document.activeElement).toBe(head);
  });

  it('Esc는 메뉴만 닫고 열 머리로 초점을 돌린다', () => {
    render(
      <TableView
        data={data()}
        rows={[]}
        onOpen={() => undefined}
        onEdit={() => undefined}
        onWidth={() => undefined}
        onSort={() => undefined}
        onHide={() => undefined}
        notes={[]}
      />,
    );
    const head = document.querySelector<HTMLButtonElement>('[data-testid="th-점수"]')!;
    act(() => head.click());
    expect(document.querySelector('.dbtable__menu')).not.toBeNull();
    expect(document.activeElement).toBe(document.querySelector('.dbtable__menu [role="menuitem"]'));

    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(document.querySelector('.dbtable__menu')).toBeNull();
    expect(document.activeElement).toBe(head);
  });

  it('바깥 pointerdown·표 스크롤·창 리사이즈로 메뉴를 닫는다', () => {
    render(
      <TableView
        data={data()}
        rows={[]}
        onOpen={() => undefined}
        onEdit={() => undefined}
        onWidth={() => undefined}
        onSort={() => undefined}
        onHide={() => undefined}
        notes={[]}
      />,
    );
    const head = document.querySelector<HTMLButtonElement>('[data-testid="th-점수"]')!;
    const table = container.querySelector<HTMLElement>('.dbtable')!;
    const isOpen = () => !!document.querySelector('.dbtable__menu');

    act(() => head.click());
    expect(isOpen()).toBe(true);
    act(() => document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })));
    expect(isOpen()).toBe(false);

    act(() => head.click());
    expect(isOpen()).toBe(true);
    act(() => table.dispatchEvent(new Event('scroll', { bubbles: true })));
    expect(isOpen()).toBe(false);

    act(() => head.click());
    expect(isOpen()).toBe(true);
    act(() => window.dispatchEvent(new Event('resize')));
    expect(isOpen()).toBe(false);
  });

  it('키보드로 항목을 이동하고 Tab으로 메뉴를 닫는다', () => {
    render(
      <TableView
        data={data()}
        rows={[]}
        onOpen={() => undefined}
        onEdit={() => undefined}
        onWidth={() => undefined}
        onSort={() => undefined}
        onHide={() => undefined}
        notes={[]}
      />,
    );
    const head = document.querySelector<HTMLButtonElement>('[data-testid="th-점수"]')!;
    act(() => head.focus());
    act(() => head.click());
    const items = [...document.querySelectorAll<HTMLButtonElement>('.dbtable__menu [role="menuitem"]')];
    expect(items.length).toBeGreaterThan(1);
    expect(document.activeElement).toBe(items[0]);

    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })));
    expect(document.activeElement).toBe(items[1]);
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true })));
    expect(document.activeElement).toBe(items[0]);

    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true })));
    expect(document.querySelector('.dbtable__menu')).toBeNull();
    expect(document.activeElement).toBe(head);
  });

  it('0행에서도 열 너비 손잡이가 동작한다', () => {
    const onWidth = vi.fn();
    render(
      <TableView
        data={data()}
        rows={[]}
        empty={<p>비어 있음</p>}
        onOpen={() => undefined}
        onEdit={() => undefined}
        onWidth={onWidth}
        onSort={() => undefined}
        onHide={() => undefined}
        notes={[]}
      />,
    );

    const grip = container.querySelector('.dbtable__th .dbtable__grip')!;
    act(() => {
      grip.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 100 }));
    });
    act(() => {
      window.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 160 }));
      window.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
    });
    expect(onWidth).toHaveBeenCalled();
    expect(onWidth.mock.calls[0]![0]).toBe('title');
    expect(onWidth.mock.calls[0]![1]).toBeGreaterThan(0);
  });

  it('행이 생기면 빈 상태를 지우고 같은 헤더 아래에 행을 그린다', () => {
    const props = {
      onOpen: () => undefined,
      onEdit: () => undefined,
      onWidth: () => undefined,
      onSort: () => undefined,
      onHide: () => undefined,
      notes: [],
    };
    render(<TableView {...props} data={data()} rows={[]} empty={<p data-testid="table-empty">비어 있음</p>} />);
    expect(container.querySelectorAll('.dbtable__head')).toHaveLength(1);

    render(<TableView {...props} data={data({ matched: 2, rows: [row(1), row(2)] })} rows={[row(1), row(2)]} />);
    expect(container.querySelectorAll('.dbtable__head')).toHaveLength(1);
    expect(container.querySelector('[data-testid="table-empty"]')).toBeNull();
    expect(container.querySelectorAll('.dbtable__row')).toHaveLength(2);
  });
});
