import { t } from '@nopsidian/i18n';
import type { Node as PMNode } from 'prosemirror-model';
import type { EditorView, NodeView } from 'prosemirror-view';
import { assetKind, parseSizeSpec } from '@nopsidian/core/assets';
import type { NopsAssetHost } from './asset-host';
import type { WikiLinkTarget } from './plugins';
import type { NopsPeekHost } from './peek-host';

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
export function createEmbedView(host: NopsAssetHost, onOpenLink?: (link: WikiLinkTarget) => void, peek?: NopsPeekHost) {
  return (node: PMNode, view: EditorView, getPos: () => number | undefined): NodeView => {
    const dom = document.createElement('span');
    dom.className = 'nops-embed';
    dom.contentEditable = 'false';
    let current = node;
    let img: HTMLImageElement | null = null;
    let handle: HTMLElement | null = null;
    let dragAbort: AbortController | null = null;
    let editing = false;
    let offChange: (() => void) | undefined;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;

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

      if (kind === 'note' && peek) {
        // 노트·제목·블록 임베드: 발췌를 인용 상자로 보여 준다(읽기 전용, 클릭하면 원본으로 이동)
        const open = () => onOpenLink?.({ target, heading, block, embed: true });
        const box = document.createElement('span');
        box.className = 'nops-embed__note';
        box.setAttribute('data-testid', 'note-embed');
        box.textContent = t('db.loading');
        box.addEventListener('click', (e) => (e.preventDefault(), open()));
        dom.classList.add('is-note');
        dom.append(box);
        void peek.peek({ target, heading, block }).then((r) => {
          if (!box.isConnected) return;
          if (!r) {
            dom.classList.add('is-missing');
            box.textContent = t('editor.embed.noteMissing', { target });
            return;
          }
          box.replaceChildren();
          const head = document.createElement('span');
          head.className = 'nops-embed__note-title';
          head.textContent = `📄 ${alias || r.title}${heading ? ` › ${heading}` : block ? ` › ^${block}` : ''}`;
          const body = document.createElement('span');
          body.className = 'nops-embed__note-body';
          body.textContent = r.found
            ? r.text || t('editor.embed.empty')
            : `(${heading ? t('editor.embed.headingNotFound') : t('editor.embed.blockNotFound')})\n${r.text}`;
          box.append(head, body);
          if (block && r.found && peek.source && peek.save) {
            const edit = document.createElement('button');
            edit.type = 'button';
            edit.className = 'nops-embed__note-edit';
            edit.textContent = `✎ ${t('editor.embed.edit')}`;
            edit.title = t('editor.embed.editHint');
            edit.setAttribute('data-testid', 'note-embed-edit');
            edit.addEventListener('mousedown', (e) => e.stopPropagation());
            edit.addEventListener('click', (e) => {
              e.preventDefault();
              e.stopPropagation();
              void startEdit(box, body, edit);
            });
            head.append(edit);
          }
        });
        return;
      }

      if (kind === 'note') {
        dom.append(
          chip(FILE_ICON.note!, alias || target, t('editor.embed.noteChip', { target }), () =>
            onOpenLink?.({ target, heading, block, embed: true }),
          ),
        );
        return;
      }

      const path = host.resolve(target);
      if (!path) {
        dom.classList.add('is-missing');
        dom.append(chip('⚠', target, t('editor.embed.fileMissing', { target }), undefined, 'is-missing'));
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
          dom.replaceChildren(chip('⚠', name, t('editor.embed.imageFailed', { path }), undefined, 'is-missing'));
        });
        handle = document.createElement('span');
        handle.className = 'nops-embed__resize';
        handle.hidden = true;
        handle.title = t('editor.embed.resize');
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
      } else if (kind === 'pdf') {
        // PDF: 칩(누르면 기본 앱으로 열기) + 펼치면 그 자리에서 보는 뷰어(Chromium 내장 PDF 뷰어)
        dom.classList.add('is-pdf');
        const head = document.createElement('span');
        head.className = 'nops-embed__pdfhead';
        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'nops-embed__pdftoggle';
        toggle.textContent = `▸ ${t('editor.embed.preview')}`;
        toggle.setAttribute('aria-expanded', 'false');
        toggle.setAttribute('data-testid', 'pdf-toggle');
        let frame: HTMLIFrameElement | null = null;
        toggle.addEventListener('mousedown', (e) => e.preventDefault());
        toggle.addEventListener('click', () => {
          const open = toggle.getAttribute('aria-expanded') !== 'true';
          toggle.setAttribute('aria-expanded', String(open));
          toggle.textContent = open ? `▾ ${t('editor.embed.collapse')}` : `▸ ${t('editor.embed.preview')}`;
          if (open && !frame) {
            frame = document.createElement('iframe');
            frame.className = 'nops-embed__pdfframe';
            frame.setAttribute('data-testid', 'pdf-frame');
            frame.title = name;
            frame.src = size ? `${url}#view=FitH` : url;
            if (size?.height) frame.style.height = `${size.height}px`;
            dom.append(frame);
          } else if (frame) {
            frame.hidden = !open;
          }
        });
        head.append(chip(FILE_ICON.pdf!, name, t('editor.embed.openInApp', { path }), () => host.open(path)), toggle);
        dom.append(head);
      } else {
        dom.append(chip(FILE_ICON[kind] ?? FILE_ICON.file!, name, t('editor.embed.open', { path }), () => host.open(path)));
      }
    };

    /** 블록 임베드 편집: 원본 마크다운을 텍스트 상자로 고치고 저장하면 원본 노트의 그 블록이 바뀐다 */
    async function startEdit(box: HTMLElement, body: HTMLElement, edit: HTMLElement) {
      const { target, heading, block } = current.attrs as { target: string; heading: string | null; block: string | null };
      const link = { target, heading, block };
      const src = await peek?.source?.(link);
      if (src === null || src === undefined) return;
      editing = true;
      edit.hidden = true;
      const ta = document.createElement('textarea');
      ta.className = 'nops-embed__note-input';
      ta.setAttribute('data-testid', 'note-embed-input');
      ta.value = src;
      ta.rows = Math.min(12, Math.max(2, src.split('\n').length));
      body.replaceWith(ta);
      ta.focus();
      let done = false;
      const finish = async (save: boolean) => {
        if (done) return;
        done = true;
        editing = false;
        if (save && ta.value.trimEnd() !== src.trimEnd()) await peek?.save?.(link, ta.value);
        if (box.isConnected) render(current);
      };
      ta.addEventListener('mousedown', (e) => e.stopPropagation());
      ta.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Escape') {
          e.preventDefault();
          void finish(false);
        } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          void finish(true);
        }
      });
      ta.addEventListener('blur', () => void finish(true));
    }

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
    // 원본 노트가 바뀌면(다른 창·탭·밖에서) 임베드를 다시 그린다. 고치는 중에는 건드리지 않는다.
    offChange = peek?.onChange?.(() => {
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => {
        if (!editing && dom.isConnected) render(current);
      }, 350);
    });
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
      stopEvent: (e) => (e.target instanceof HTMLElement && e.target.closest('textarea, .nops-embed__note-edit') !== null) || e.target === handle || (e.target instanceof HTMLElement && e.target.closest('audio, video') !== null),
      ignoreMutation: () => true,
      destroy() {
        dragAbort?.abort();
        offChange?.();
        clearTimeout(refreshTimer);
      },
    };
  };
}
