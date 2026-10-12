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

/** 목록 뷰: 제목과 보조 속성을 한 줄씩. */
export function ListView({ data, rows, onOpen }: Props) {
  const cols = visibleColumns(data).filter((c) => c !== TITLE).slice(0, 4);
  return (
    <ul className="dblist" data-testid="db-list">
      {rows.map((r) => (
        <li key={r.path}>
          <button className="dblist__title" onClick={() => onOpen(r.path)}>
            {r.title}
          </button>
          {cols.map((c) => (
            <span key={c} className="dblist__prop">
              <CellView prop={data.schema.properties[c]} value={cellOf(r, c)} />
            </span>
          ))}
        </li>
      ))}
    </ul>
  );
}

/** 갤러리 뷰: 커버(files 속성의 첫 이미지)가 있는 카드. */
export function GalleryView({ data, rows, vaultId, onOpen }: Props) {
  const cols = visibleColumns(data).filter((c) => c !== TITLE).slice(0, 3);
  const coverProp = data.view.cover;
  const cover = (r: DbRowDto): string | null => {
    const v = coverProp ? cellOf(r, coverProp) : null;
    const first = Array.isArray(v) ? v.find((x) => IMG.test(x)) : typeof v === 'string' && IMG.test(v) ? v : undefined;
    if (!first) return null;
    const name = first.replace(/^!?\[\[|\]\]$/g, '').split('|')[0]!;
    return name.includes('/') ? vaultUrl(vaultId, name) : vaultUrl(vaultId, `attachments/${name}`);
  };
  return (
    <div className="dbgallery" data-testid="db-gallery">
      {rows.map((r) => {
        const src = cover(r);
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
  );
}
