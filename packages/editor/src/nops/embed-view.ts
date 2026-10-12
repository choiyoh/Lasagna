import type { Node as PMNode } from 'prosemirror-model';
import type { EditorView, NodeView } from 'prosemirror-view';
import { assetKind, parseSizeSpec } from '@nopsidian/core/assets';
import type { NopsAssetHost } from './asset-host';
import type { WikiLinkTarget } from './plugins';

const MIN_WIDTH = 40;
const FILE_ICON: Record<string, string> = { pdf: '📕', audio: '🎵', video: '🎬', file: '📎', note: '📄' };

/**
 * `![[대상|크기]]` 임베드 노드 뷰.
 *  - 이미지: 그 자리에 그림(크기는 `|400`), 선택하면 오른쪽 아래 핸들로 크기 조절
 *  - 오디오·비디오: 플레이어
 *  - PDF·기타 파일: 파일 칩(클릭하면 열기)
 *  - 노트: 노트 칩(클릭하면 이동)
 *  - 찾을 수 없는 파일: 빨간 칩
 */
export function createEmbedView(host: NopsAssetHost, onOpenLink?: (link: WikiLinkTarget) => void) {
  return (node: PMNode, view: EditorView, getPos: () => number | undefined): NodeView => {
    const dom = document.createElement('span');
    dom.className = 'nops-embed';
    dom.contentEditable = 'false';
    let current = node;
    let img: HTMLImageElement | null = null;
    let handle: HTMLElement | null = null;
    let dragAbort: AbortController | null = null;

    const chip = (icon: string, label: string, title: string, onClick?: () => void, cls = '') => {
      const el = document.createElement('span');
      el.className = `nops-embed__chip ${cls}`.trim();
      el.title = title;
      el.textContent = `${icon} ${label}`;
      if (onClick) el.addEventListener('click', (e) => (e.preventDefault(), onClick()));
      return el;
    };

    const render = (n: PMNode) => {
      dragAbort?.abort();
      dom.replaceChildren();
      dom.className = 'nops-embed';
      img = null;
      handle = null;
      const { target, heading, block, alias } = n.attrs as { target: string; heading: string | null; block: string | null; alias: string | null };
      const kind = assetKind(target);
      const size = parseSizeSpec(alias);

      if (kind === 'note') {
        dom.append(
          chip(FILE_ICON.note!, alias || target, `노트 임베드: ${target}`, () =>
            onOpenLink?.({ target, heading, block, embed: true }),
          ),
        );
        return;
      }

      const path = host.resolve(target);
      if (!path) {
        dom.classList.add('is-missing');
        dom.append(chip('⚠', target, `파일을 찾을 수 없어요: ${target}`, undefined, 'is-missing'));
        return;
      }
      const url = host.url(path);
      const name = path.slice(path.lastIndexOf('/') + 1);

      if (kind === 'image') {
        dom.classList.add('is-image');
        img = document.createElement('img');
        img.src = url;
        img.alt = size ? name : (alias ?? name);
        img.draggable = false;
        img.className = 'nops-embed__img';
        if (size) {
          img.style.width = `${size.width}px`;
          if (size.height) img.style.height = `${size.height}px`;
        }
        img.addEventListener('error', () => {
          dom.replaceChildren(chip('⚠', name, `이미지를 불러오지 못했어요: ${path}`, undefined, 'is-missing'));
        });
        handle = document.createElement('span');
        handle.className = 'nops-embed__resize';
        handle.hidden = true;
        handle.title = '크기 조절';
        handle.addEventListener('mousedown', startResize);
        dom.append(img, handle);
      } else if (kind === 'audio' || kind === 'video') {
        const media = document.createElement(kind);
        media.controls = true;
        media.src = url;
        media.preload = 'metadata';
        if (size) media.style.width = `${size.width}px`;
        media.className = `nops-embed__${kind}`;
        dom.append(media);
      } else {
        dom.append(chip(FILE_ICON[kind] ?? FILE_ICON.file!, name, `${path} — 클릭하면 열기`, () => host.open(path)));
      }
    };

    function startResize(event: MouseEvent) {
      event.preventDefault();
      event.stopPropagation();
      if (!img) return;
      dragAbort?.abort();
      dragAbort = new AbortController();
      const { signal } = dragAbort;
      const startX = event.clientX;
      const startWidth = img.getBoundingClientRect().width;
      const natural = img.naturalWidth || startWidth;
      const maxWidth = Math.max(natural, startWidth);
      let width = startWidth;
      window.addEventListener(
        'mousemove',
        (e) => {
          width = Math.min(maxWidth * 2, Math.max(MIN_WIDTH, startWidth + e.clientX - startX));
          if (img) {
            img.style.width = `${width}px`;
            img.style.height = '';
          }
        },
        { signal },
      );
      window.addEventListener(
        'mouseup',
        () => {
          dragAbort?.abort();
          const pos = getPos();
          if (pos === undefined) return;
          // 크기는 `|너비`로 저장한다(원래 별칭이 글자였다면 크기로 대체된다)
          view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...current.attrs, alias: String(Math.round(width)) }));
        },
        { once: true, signal },
      );
    }

    render(node);
    return {
      dom,
      update(n) {
        if (n.type !== current.type) return false;
        const changed = JSON.stringify(n.attrs) !== JSON.stringify(current.attrs);
        current = n;
        if (changed) render(n);
        return true;
      },
      selectNode() {
        dom.classList.add('is-selected');
        if (handle) handle.hidden = false;
      },
      deselectNode() {
        dom.classList.remove('is-selected');
        if (handle) handle.hidden = true;
      },
      stopEvent: (e) => e.target === handle || (e.target instanceof HTMLElement && e.target.closest('audio, video') !== null),
      ignoreMutation: () => true,
      destroy() {
        dragAbort?.abort();
      },
    };
  };
}
