import { t } from '@nopsidian/i18n';
import { Plugin } from 'prosemirror-state';
import type { NopsPeekHost } from './peek-host';

const DELAY = 350;

/** 위키링크 위에 마우스를 잠시 올리면 대상 노트(제목·블록)의 발췌를 말풍선으로 보여 준다. */
export function createLinkPreviewPlugin(host: NopsPeekHost): Plugin {
  return new Plugin({
    view(view) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      let card: HTMLElement | null = null;
      let current: HTMLElement | null = null;
      const cache = new Map<string, { at: number; value: Awaited<ReturnType<NopsPeekHost['peek']>> }>();

      const hide = () => {
        clearTimeout(timer);
        timer = undefined;
        current = null;
        card?.remove();
        card = null;
      };

      const show = async (el: HTMLElement) => {
        const target = el.getAttribute('data-wikilink') ?? '';
        const heading = el.getAttribute('data-heading');
        const block = el.getAttribute('data-block');
        const key = `${target}\u0000${heading ?? ''}\u0000${block ?? ''}`;
        let hit = cache.get(key);
        if (!hit || Date.now() - hit.at > 30_000) {
          hit = { at: Date.now(), value: await host.peek({ target, heading, block }) };
          cache.set(key, hit);
        }
        if (current !== el || !hit.value) return;
        card = document.createElement('div');
        card.className = 'nops-preview';
        card.setAttribute('data-testid', 'link-preview');
        const title = document.createElement('div');
        title.className = 'nops-preview__title';
        title.textContent = hit.value.title + (heading ? ` › ${heading}` : block ? ` › ^${block}` : '');
        const body = document.createElement('div');
        body.className = 'nops-preview__body';
        body.textContent = hit.value.text || t('editor.embed.empty');
        card.append(title, body);
        document.body.append(card);
        const r = el.getBoundingClientRect();
        const w = card.offsetWidth;
        card.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - w - 8))}px`;
        const below = r.bottom + 6;
        card.style.top = below + card.offsetHeight > window.innerHeight ? `${Math.max(8, r.top - card.offsetHeight - 6)}px` : `${below}px`;
      };

      const over = (e: MouseEvent) => {
        const el = e.target instanceof HTMLElement ? e.target.closest<HTMLElement>('.nops-wikilink') : null;
        if (el === current) return;
        hide();
        if (!el || !view.dom.contains(el)) return;
        current = el;
        timer = setTimeout(() => void show(el), DELAY);
      };
      view.dom.addEventListener('mouseover', over);
      view.dom.addEventListener('mouseleave', hide);
      view.dom.addEventListener('mousedown', hide);
      return {
        update: () => {
          if (current && !current.isConnected) hide();
        },
        destroy: () => {
          hide();
          view.dom.removeEventListener('mouseover', over);
          view.dom.removeEventListener('mouseleave', hide);
          view.dom.removeEventListener('mousedown', hide);
        },
      };
    },
  });
}
