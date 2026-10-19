import { useCallback, useMemo, useRef } from 'react';
import { createLinkResolver } from '@nopsidian/core/links';
import { extractExcerpt, parseNote, replaceBlock } from '@nopsidian/core/markdown';
import type { NopsPeekHost, WikiLinkTarget } from '@nopsidian/editor/nops';
import type { NoteSummary } from '@nopsidian/ipc-contract';
import type { AssetStore } from './assets';
import { flushAll } from './flush';
import { createLinkHost } from './link-host';

/** 블록 원문 끝의 ` ^id` 를 뗀다 */
function stripBlockId(source: string, id: string): string {
  return source.replace(new RegExp(`[ \\t]*\\^${id}[ \\t]*(\\r?)$`), '$1').replace(/\s+$/, '');
}

interface Deps {
  notes: NoteSummary[];
  selected: string | null;
  assets: AssetStore;
  setSelected: (path: string) => void;
  setFocus: (focus: { heading: string | null; block: string | null } | null) => void;
}

/** 에디터가 위키링크를 풀고(열기·호버 미리보기·임베드·동기화 블록 편집) `[[` 자동완성을 하는 데 쓰는 호스트들 */
export function useLinkHosts({ notes, selected, assets, setSelected, setFocus }: Deps) {
  const resolver = useMemo(
    () =>
      createLinkResolver(
        notes.map((n, i) => ({ id: i, path: n.path, title: n.title })),
        notes.flatMap((n, i) => n.aliases.map((alias) => ({ pageId: i, alias }))),
      ),
    [notes],
  );

  const openLink = useCallback(
    (link: WikiLinkTarget) => {
      // `[[#제목]]` 처럼 노트 이름이 없는 링크는 지금 열려 있는 노트를 가리킨다(색인과 같은 규칙)
      const id = resolver(link.target || (selected ?? ''), selected ?? '');
      const note = id === undefined ? undefined : notes[id];
      if (note) {
        setFocus(link.heading || link.block ? { heading: link.heading, block: link.block } : null);
        setSelected(note.path);
      }
    },
    [resolver, notes, selected, setSelected, setFocus],
  );

  const peekHost = useMemo<NopsPeekHost>(
    () => {
      const findNote = (target: string) => {
        const id = resolver(target, selected ?? '');
        return id === undefined ? undefined : notes[id];
      };
      return {
      async peek({ target, heading, block }) {
        const note = findNote(target);
        if (!note) return null;
        const { content } = await window.nops.note.read({ path: note.path });
        return { title: note.title, ...extractExcerpt(content, { heading, block }) };
      },
      // 동기화 블록: `![[노트#^id]]` 를 그 자리에서 고치면 원본 노트의 블록이 바뀐다
      async source({ target, block }) {
        const note = findNote(target);
        if (!note || !block) return null;
        const { content } = await window.nops.note.read({ path: note.path });
        const parsed = parseNote(content);
        const b = parsed.blocks.find((x) => x.blockId === block);
        if (!b) return null;
        return stripBlockId(b.source, block);
      },
      async save({ target, block }, markdown) {
        const note = findNote(target);
        if (!note || !block) return false;
        await flushAll();
        const { content, hash } = await window.nops.note.read({ path: note.path });
        const parsed = parseNote(content);
        const b = parsed.blocks.find((x) => x.blockId === block);
        if (!b) return false;
        // `^id` 가 줄 끝에 붙어 있던 블록이면 새 원문 끝에도 붙이고, 아래 별도 줄이면 그 줄은 그대로 둔다
        const inline = new RegExp(`(?:^|\\s)\\^${block}[ \\t]*\\r?$`).test(b.source);
        const next = markdown.replace(/\s+$/, '');
        const source = inline ? `${next} ^${block}` : next;
        await window.nops.note.save({ path: note.path, content: replaceBlock(parsed, b.index, source), baseHash: hash });
        window.dispatchEvent(new CustomEvent('nops:reload-note', { detail: note.path }));
        return true;
      },
      onChange(cb) {
        return window.nops.on('note.changed', () => cb());
      },
      };
    },
    [resolver, notes, selected],
  );

  // `[[` 자동완성은 항상 최신 노트·첨부 목록을 봐야 하므로 ref로 읽는 안정적인 호스트를 하나만 만든다
  const live = useRef({ notes, selected, assets });
  live.current = { notes, selected, assets };
  const linkHost = useMemo(
    () =>
      createLinkHost({
        notes: () => live.current.notes,
        assets: () => assets.list(),
        currentPath: () => live.current.selected ?? '',
        headings: (path) => window.nops.link.headings({ path }),
        blocks: (path) => window.nops.link.blocks({ path }),
        ensureBlockId: async (path, line) => (await window.nops.link.ensureBlockId({ path, line })).id,
      }),
    [assets],
  );

  return { openLink, peekHost, linkHost, live };
}
