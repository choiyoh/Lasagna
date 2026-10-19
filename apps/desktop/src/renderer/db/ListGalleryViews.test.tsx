// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GalleryView, ListView, cardsPerRow } from './ListGalleryViews';
import type { DbData, DbRowDto } from './types';

let container: HTMLDivElement;
let root: Root;

/** jsdom 기본 크기는 0 이라 가상화가 아무것도 그리지 않는다 → 스크롤 영역을 800×400 으로 흉내 낸다 */
function stubSizes(): void {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 800 });
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get: () => 800 });
  // 갤러리 줄은 카드 높이(200), 나머지(스크롤 영역)는 뷰포트 높이(400)
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get(this: HTMLElement) {
      return this.classList?.contains('dbgallery__row') ? 200 : 400;
    },
  });
}

function row(i: number, over: Partial<DbRowDto> = {}): DbRowDto {
  return { path: `db/행${i}.md`, title: `행${i}`, values: { memo: `메모${i}`, files: [`attachments/커버${i}.png`] }, ...over };
}

function data(over: Partial<DbData> = {}): DbData {
  return {
    folder: 'db',
    schema: { version: 1, rowsFolder: '.', properties: { files: { type: 'files' }, memo: { type: 'text' } }, views: [], templates: [] },
    issues: [],
    view: { id: 'v1', name: '목록', type: 'list', sort: [], columns: ['title', 'memo'] },
    total: 100,
    matched: 100,
    rows: [],
    groups: null,
    calc: {},
    errors: {},
    ...over,
  };
}

const rows = (n: number) => Array.from({ length: n }, (_, i) => row(i));

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

describe('cardsPerRow', () => {
  it('컨테이너 너비로 한 줄 카드 수를 센다(minmax(200px) 규칙)', () => {
    expect(cardsPerRow(0)).toBe(1); // 재기 전
    expect(cardsPerRow(200)).toBe(1);
    expect(cardsPerRow(500)).toBe(2);
    expect(cardsPerRow(800)).toBe(3);
    expect(cardsPerRow(1200)).toBe(5);
  });
});

describe('ListView', () => {
  it('보이는 만큼만 그리면서 목록 선택자는 그대로 둔다', () => {
    act(() => {
      root.render(<ListView data={data()} rows={rows(100)} vaultId="v1" onOpen={() => undefined} />);
    });

    const list = container.querySelector('.dblist[data-testid="db-list"]');
    expect(list?.getAttribute('role')).toBe('list');
    const items = container.querySelectorAll('.dblist__row[role="listitem"]');
    expect(items.length).toBeGreaterThan(0);
    expect(items.length).toBeLessThan(100); // 100줄을 다 그리지 않는다
    expect(items[0]?.textContent).toContain('행0');
    expect(items[0]?.textContent).toContain('메모0');
  });

  it('제목을 누르면 그 노트를 연다', () => {
    const opened: string[] = [];
    act(() => {
      root.render(<ListView data={data()} rows={rows(5)} vaultId="v1" onOpen={(p) => opened.push(p)} />);
    });
    act(() => (container.querySelector('.dblist__title') as HTMLButtonElement).click());
    expect(opened).toEqual(['db/행0.md']);
  });
});

describe('GalleryView', () => {
  it('카드를 여러 장씩 줄 단위로 가상화하고 커버를 붙인다', () => {
    act(() => {
      root.render(
        <GalleryView data={data({ view: { id: 'v1', name: '갤러리', type: 'gallery', sort: [], columns: ['title', 'memo'], cover: 'files' } })} rows={rows(100)} vaultId="v1" onOpen={() => undefined} />,
      );
    });

    expect(container.querySelector('.dbgallery[data-testid="db-gallery"]')).not.toBeNull();
    const cards = container.querySelectorAll('.dbgallery__card');
    expect(cards.length).toBeGreaterThan(0);
    expect(cards.length).toBeLessThan(100);
    // 800px → 한 줄에 3장
    const firstRow = container.querySelector('.dbgallery__row') as HTMLElement;
    expect(firstRow.style.gridTemplateColumns).toBe('repeat(3, minmax(0, 1fr))');
    expect(firstRow.querySelectorAll('.dbgallery__card')).toHaveLength(3);
    expect(cards[0]?.textContent).toContain('행0');
    expect(container.querySelector('.dbgallery__cover img')?.getAttribute('src')).toContain('vault://v1/attachments/');
  });

  it('커버가 없으면 제목 첫 글자를 보여 주고, 카드를 누르면 연다', () => {
    const opened: string[] = [];
    const bare = [row(0, { values: { memo: '메모' } }), row(1, { values: { memo: '메모' } })];
    act(() => {
      root.render(<GalleryView data={data()} rows={bare} vaultId="v1" onOpen={(p) => opened.push(p)} />);
    });
    expect(container.querySelector('.dbgallery__cover img')).toBeNull();
    expect(container.querySelector('.dbgallery__cover')?.textContent).toBe('행');
    act(() => (container.querySelector('.dbgallery__card') as HTMLElement).click());
    expect(opened).toEqual(['db/행0.md']);
  });
});
