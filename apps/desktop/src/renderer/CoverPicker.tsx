import { useEffect, useMemo, useRef, useState } from 'react';
import type { JSX } from 'react';
import { vaultUrl } from '@nopsidian/core/assets';
import { GRADIENTS, parseCover } from './cover';

interface Props {
  /** 볼트 안 이미지 첨부 경로 전체(이미 이미지 확장자만 걸러서 준다) */
  images: string[];
  vaultId: string;
  /** 지금 커버(프런트매터 값). 있으면 "커버 제거" 단추를 보이고, 같은 항목에 선택 표시 */
  current: string | null;
  /** 이미지를 고르면 {image: 볼트 경로}, 그라디언트를 고르면 {gradient: id}, 제거는 null */
  onPick: (choice: { image: string } | { gradient: string } | null) => void;
  /** 컴퓨터에서 고른 파일을 볼트에 저장하고 그 볼트 경로를 돌려준다(오류면 throw). 성공하면 이 컴포넌트가 곧바로 { image } 로 onPick 한다 */
  onUpload: (file: File) => Promise<string>;
  onClose: () => void;
}

/** 한 번에 그리는 썸네일 수 */
const PAGE = 60;

const baseName = (path: string) => path.slice(path.lastIndexOf('/') + 1);

/** 커버 고르기: 볼트 안 이미지(썸네일 격자·검색·업로드) 또는 내장 그라디언트. */
export function CoverPicker({ images, vaultId, current, onPick, onUpload, onClose }: Props): JSX.Element {
  const parsed = useMemo(() => parseCover(current), [current]);
  const [tab, setTab] = useState<'image' | 'gradient'>(() => (parsed?.kind === 'gradient' ? 'gradient' : 'image'));
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // 바깥 클릭(Esc 포함)이면 닫는다. EmojiPicker 와 같은 방식(캡처 단계).
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [onClose]);

  // 파일 이름 부분 일치(대소문자 무시)
  const hits = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? images.filter((p) => baseName(p).toLowerCase().includes(q)) : images;
  }, [images, query]);
  const shown = hits.slice(0, limit);

  const isPickedImage = (path: string) =>
    parsed?.kind === 'image' && (parsed.ref === path || baseName(parsed.ref) === baseName(path));

  const upload = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const path = await onUpload(file);
      onPick({ image: path });
    } catch (e) {
      setError(e instanceof Error ? e.message : '올리지 못했어요');
    } finally {
      setBusy(false);
      // 같은 파일을 다시 고를 수 있게 입력칸을 비운다
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  return (
    <div className="coverpicker" ref={box} role="dialog" aria-label="커버 고르기" data-testid="cover-picker">
      <div className="coverpicker__tabs" role="tablist" aria-label="커버 종류">
        <button role="tab" aria-selected={tab === 'image'} className={tab === 'image' ? 'active' : ''} onClick={() => setTab('image')}>
          이미지
        </button>
        <button role="tab" aria-selected={tab === 'gradient'} className={tab === 'gradient' ? 'active' : ''} onClick={() => setTab('gradient')}>
          그라디언트
        </button>
      </div>

      {tab === 'image' ? (
        <>
          <input
            autoFocus
            value={query}
            aria-label="이미지 검색"
            placeholder="이미지 검색"
            onChange={(e) => {
              setQuery(e.target.value);
              setLimit(PAGE);
            }}
          />
          <div className="coverpicker__grid">
            {images.length === 0 && <span className="muted small">볼트에 이미지가 없어요. 올려 보세요.</span>}
            {images.length > 0 && hits.length === 0 && <span className="muted small">찾는 이미지가 없어요</span>}
            {shown.map((path) => {
              const name = baseName(path);
              const selected = isPickedImage(path);
              return (
                <button
                  key={path}
                  className={selected ? 'coverpicker__thumb selected' : 'coverpicker__thumb'}
                  aria-label={name}
                  aria-pressed={selected}
                  title={name}
                  onClick={() => onPick({ image: path })}
                >
                  <img src={vaultUrl(vaultId, path)} alt="" loading="lazy" />
                </button>
              );
            })}
          </div>
          {hits.length > shown.length && <button onClick={() => setLimit((n) => n + PAGE)}>더 보기</button>}
          <div className="coverpicker__foot">
            <button data-testid="cover-upload" disabled={busy} onClick={() => fileInput.current?.click()}>
              {busy ? '올리는 중…' : '컴퓨터에서 올리기'}
            </button>
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              hidden
              data-testid="cover-upload-input"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void upload(file);
              }}
            />
            {error !== null && (
              <span className="coverpicker__error" role="alert">
                {error}
              </span>
            )}
          </div>
        </>
      ) : (
        <div className="coverpicker__swatches">
          {GRADIENTS.map((g) => {
            const selected = parsed?.kind === 'gradient' && parsed.id === g.id;
            return (
              <button
                key={g.id}
                className={selected ? 'coverpicker__swatch selected' : 'coverpicker__swatch'}
                style={{ background: g.css }}
                aria-label={g.label}
                aria-pressed={selected}
                title={g.label}
                data-testid={`gradient-${g.id}`}
                onClick={() => onPick({ gradient: g.id })}
              />
            );
          })}
        </div>
      )}

      {parsed !== null && (
        <div className="coverpicker__foot">
          <button onClick={() => onPick(null)}>커버 제거</button>
        </div>
      )}
    </div>
  );
}
