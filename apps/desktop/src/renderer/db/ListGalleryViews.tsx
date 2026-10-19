import { useEffect, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { CellView } from './CellEditor';
import { cellOf, TITLE, visibleColumns, type DbData, type DbRowDto } from './types';

interface Props {
  data: DbData;
  rows: DbRowDto[];
  vaultId: string;
  onOpen: (path: string) => void;
}

const IMG = /\.(png|jpe?g|gif|webp|avif|svg)$/i;
const vaultUrl = (vaultId: string, p: string) => `vault://${vaultId}/${p.split('/').map(encodeURIComponent).join('/')}`;

/** 목록 한 줄 높이(styles.css 의 .dblist__row 와 맞춘다) */
const LIST_ROW_H = 32;
/** 갤러리 카드 한 장의 추정 높이(커버 110 + 제목·속성) — 실제 높이는 재서 맞춘다 */
const CARD_H = 210;
const CARD_GAP = 12;
const CARD_MIN_W = 200;
/** .dbgallery 좌우 padding(styles.css) */
const GALLERY_PAD = 16;

/** 카드 커버 URL: 뷰의 `cover`(files 속성)가 있으면 그 첫 이미지, 없으면 본문 첫 이미지 */
export function coverOf(data: DbData, r: DbRowDto, vaultId: string): string | null {
  const coverProp = data.view.cover;
  if (!coverProp && r.cover) return vaultUrl(vaultId, r.cover);
  const v = coverProp ? cellOf(r, coverProp) : null;
  const first = Array.isArray(v) ? v.find((x) => IMG.test(x)) : typeof v === 'string' && IMG.test(v) ? v : undefined;
  if (!first) return null;
  const name = first.replace(/^!?\[\[|\]\]$/g, '').split('|')[0]!;
  return name.includes('/') ? vaultUrl(vaultId, name) : vaultUrl(vaultId, `attachments/${name}`);
}

/** 컨테이너 너비로 한 줄에 들어가는 카드 수를 구한다(styles.css 의 `minmax(200px, 1fr)` auto-fill 과 같은 규칙) */
export function cardsPerRow(width: number): number {
  return Math.max(1, Math.floor((width - GALLERY_PAD * 2 + CARD_GAP) / (CARD_MIN_W + CARD_GAP)));
}

/** 스크롤 컨테이너의 너비(px). 처음에는 0 이고 붙은 뒤에 잰다. */
function useElementWidth(ref: React.RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    // jsdom 등 ResizeObserver 가 없는 환경(단위 테스트)에서는 잰 값 한 번으로 끝낸다
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return width;
}

/** 목록 뷰: 제목과 보조 속성을 한 줄씩. 보이는 만큼만 그린다(표 뷰와 같은 방식). */
export function ListView({ data, rows, onOpen }: Props) {
  const cols = visibleColumns(data).filter((c) => c !== TITLE).slice(0, 4);
  const scroller = useRef<HTMLDivElement>(null);
  const v = useVirtualizer({ count: rows.length, getScrollElement: () => scroller.current, estimateSize: () => LIST_ROW_H, overscan: 12 });
  return (
    <div className="dblist" data-testid="db-list" role="list" ref={scroller}>
      <div style={{ height: v.getTotalSize(), position: 'relative' }}>
        {v.getVirtualItems().map((vi) => {
          const r = rows[vi.index]!;
          return (
            <div key={r.path} className="dblist__row" role="listitem" style={{ transform: `translateY(${vi.start}px)`, height: LIST_ROW_H }}>
              <button className="dblist__title" onClick={() => onOpen(r.path)}>
                {r.title}
              </button>
              {cols.map((c) => (
                <span key={c} className="dblist__prop">
                  <CellView prop={data.schema.properties[c]} value={cellOf(r, c)} />
                </span>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** 갤러리 뷰: 커버(files 속성의 첫 이미지)가 있는 카드. 한 줄씩(카드 여러 장) 가상화한다. */
export function GalleryView({ data, rows, vaultId, onOpen }: Props) {
  const cols = visibleColumns(data).filter((c) => c !== TITLE).slice(0, 3);
  const scroller = useRef<HTMLDivElement>(null);
  const perRow = cardsPerRow(useElementWidth(scroller));
  const rowCount = Math.ceil(rows.length / perRow);
  const v = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scroller.current,
    estimateSize: () => CARD_H + CARD_GAP,
    overscan: 4,
  });
  return (
    <div className="dbgallery" data-testid="db-gallery" ref={scroller}>
      <div style={{ height: v.getTotalSize(), position: 'relative' }}>
        {v.getVirtualItems().map((vi) => (
          // 카드 높이가 내용에 따라 달라질 수 있어 줄마다 다시 잰다(measureElement)
          <div
            key={vi.index}
            ref={v.measureElement}
            data-index={vi.index}
            className="dbgallery__row"
            style={{ transform: `translateY(${vi.start}px)`, gridTemplateColumns: `repeat(${perRow}, minmax(0, 1fr))` }}
          >
            {rows.slice(vi.index * perRow, vi.index * perRow + perRow).map((r) => {
              const src = coverOf(data, r, vaultId);
              return (
                <article key={r.path} className="dbgallery__card" onClick={() => onOpen(r.path)}>
                  <div className="dbgallery__cover">{src ? <img src={src} alt="" loading="lazy" /> : <span>{r.title.slice(0, 1)}</span>}</div>
                  <strong>{r.title}</strong>
                  {cols.map((c) => (
                    <div key={c} className="dbcard__prop">
                      <CellView prop={data.schema.properties[c]} value={cellOf(r, c)} />
                    </div>
                  ))}
                </article>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
