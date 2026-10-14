import { Plugin } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import type { NopsAssetHost } from './asset-host';

/**
 * 이미지가 아닌 파일(PDF·오디오·문서 등)을 붙여넣거나 끌어다 놓으면 볼트에 저장하고 `![[파일]]` 임베드를 넣는다.
 * 이미지는 업스트림의 업로드 플러그인(진행 표시·재시도 포함)이 `![](…)`로 처리하므로 건드리지 않는다.
 */
export function createFilesPlugin(host: NopsAssetHost): Plugin {
  const nonImages = (files: FileList | File[] | null | undefined) => Array.from(files ?? []).filter((f) => !f.type.startsWith('image/'));

  async function insertFiles(view: EditorView, files: File[], pos: number) {
    const { schema } = view.state;
    const embed = schema.nodes.embed;
    if (!embed) return;
    const nodes = [];
    for (const file of files) {
      try {
        const path = await host.save(file);
        nodes.push(embed.create({ target: host.embedTarget(path), heading: null, block: null, alias: null }));
      } catch (e) {
        host.onError?.(`저장하지 못했어요: ${file.name} (${e instanceof Error ? e.message : String(e)})`);
      }
    }
    if (nodes.length === 0 || view.isDestroyed) return;
    // 여러 개면 공백으로 구분한다
    const inline = nodes.flatMap((n, i) => (i === 0 ? [n] : [schema.text(' '), n]));
    const safePos = Math.min(pos, view.state.doc.content.size);
    const $pos = view.state.doc.resolve(safePos);
    const tr = view.state.tr;
    if ($pos.parent.inlineContent) tr.insert(safePos, inline);
    else tr.insert(safePos, schema.nodes.paragraph!.create(null, inline));
    view.dispatch(tr.scrollIntoView());
  }

  return new Plugin({
    props: {
      handleDOMEvents: {
        paste(view, event) {
          const files = nonImages(event.clipboardData?.files);
          if (files.length === 0) return false;
          event.preventDefault();
          void insertFiles(view, files, view.state.selection.from);
          return true;
        },
        drop(view, event) {
          const all = Array.from(event.dataTransfer?.files ?? []);
          const files = nonImages(all);
          if (files.length === 0) return false;
          const coords = view.posAtCoords({ left: event.clientX, top: event.clientY });
          event.preventDefault();
          void insertFiles(view, files, coords?.pos ?? view.state.selection.from);
          // 이미지가 섞여 있으면 업스트림 업로드 플러그인이 이어서 처리한다
          return all.length === files.length;
        },
      },
    },
  });
}
