import { Plugin } from 'prosemirror-state';
import type { Node as PMNode } from 'prosemirror-model';
import type { EditorView, NodeView } from 'prosemirror-view';
import type { SlashItemSpec } from '@oh-new-editor/core';
import { t } from '@nopsidian/i18n';
import { lazySlashItem } from './slash-item';
import { insertMarkdown } from './commands';

/**
 * ```` ```dbview ```` 펜스를 데이터베이스 뷰로 그리는 호스트. 에디터는 YAML 원문만 다루고,
 * 실제 화면(React 등)은 호스트가 컨테이너에 그린다 — 에디터 패키지는 UI 프레임워크를 모른다.
 */
export interface NopsDbViewHost {
  mount(container: HTMLElement, source: string): { update(source: string): void; destroy(): void };
  /** 슬래시 "데이터베이스 보기": 데이터베이스·보기를 고르게 하고 펜스 안의 YAML 을 돌려준다(취소하면 null) */
  pick(): Promise<string | null>;
  /** 슬래시 "새 데이터베이스": 이름을 묻고 데이터베이스를 만든 뒤 그 보기를 가리키는 YAML 을 돌려준다(취소하면 null) */
  create?(): Promise<string | null>;
}

export const DBVIEW_LANG = 'dbview';

/** `code_block` 노드 뷰: 언어가 `dbview` 일 때만 화면을 그리고, 나머지는 기본 렌더링을 쓴다. */
export function createDbViewNodeView(host: NopsDbViewHost) {
  return (node: PMNode, view: EditorView): NodeView => {
    // 돌려주는 값이 비어 있으면 ProseMirror 가 스키마의 toDOM(기본 코드 블록)으로 그린다
    if (node.attrs.language !== DBVIEW_LANG) return undefined as unknown as NodeView;

    const dom = document.createElement('div');
    dom.className = 'nops-dbview';
    const bar = document.createElement('div');
    bar.className = 'nops-dbview__bar';
    bar.contentEditable = 'false';
    const label = document.createElement('span');
    label.textContent = `🗂 ${t('editor.dbview.label')}`;
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.textContent = t('editor.dbview.edit');
    toggle.setAttribute('aria-expanded', 'false');
    bar.append(label, toggle);
    const embed = document.createElement('div');
    embed.className = 'nops-dbview__embed';
    embed.contentEditable = 'false';
    const pre = document.createElement('pre');
    pre.className = 'nops-dbview__src';
    pre.hidden = true;
    const code = document.createElement('code');
    pre.append(code);
    dom.append(bar, embed, pre);

    toggle.addEventListener('click', (e) => {
      e.preventDefault();
      pre.hidden = !pre.hidden;
      toggle.setAttribute('aria-expanded', String(!pre.hidden));
      toggle.textContent = pre.hidden ? t('editor.dbview.edit') : t('editor.dbview.close');
      if (!pre.hidden) view.focus();
    });

    let source = node.textContent;
    const handle = host.mount(embed, source);
    let timer: ReturnType<typeof setTimeout> | undefined;

    return {
      dom,
      contentDOM: code,
      update(next: PMNode) {
        if (next.type !== node.type || next.attrs.language !== DBVIEW_LANG) return false;
        const text = next.textContent;
        if (text !== source) {
          source = text;
          clearTimeout(timer);
          timer = setTimeout(() => handle.update(source), 350);
        }
        return true;
      },
      // 표·버튼 같은 호스트 UI 안의 이벤트는 에디터가 가로채지 않는다
      stopEvent: (e) => embed.contains(e.target as Node) || bar.contains(e.target as Node),
      // 호스트가 embed 안에서 바꾸는 DOM 은 문서 변경이 아니다
      ignoreMutation: (m) => (m.type === 'selection' ? false : !code.contains(m.target as Node)),
      destroy() {
        clearTimeout(timer);
        handle.destroy();
      },
    };
  };
}

export function dbViewSlashItem(host: NopsDbViewHost): SlashItemSpec {
  return lazySlashItem(
    {
    icon: '🗂',
    category: 'advanced',
    keywords: ['database', 'db', 'dbview', '데이터베이스', '디비', '표', '보드', '링크된 보기'],
    run: (v) => {
      void host.pick().then((src) => {
        if (src) insertMarkdown(v, `\`\`\`${DBVIEW_LANG}\n${src.replace(/\n+$/, '')}\n\`\`\`\n`);
      });
    } },
    'editor.dbview.label',
    'editor.dbview.desc',
  );
}

export function newDbSlashItem(host: NopsDbViewHost): SlashItemSpec {
  return lazySlashItem(
    {
    icon: '▦',
    category: 'advanced',
    keywords: ['database', 'db', 'table', 'board', 'new', '데이터베이스', '디비', '표', '테이블', '보드', '칸반', '새'],
    run: (v) => {
      void host.create?.().then((src) => {
        if (src) insertMarkdown(v, `\`\`\`${DBVIEW_LANG}\n${src.replace(/\n+$/, '')}\n\`\`\`\n`);
      });
    } },
    'editor.newdb.label',
    'editor.newdb.desc',
  );
}

/** 업스트림이 코드 블록 안에 커서가 있으면 띄우는 "언어" 선택 칩은 dbview 에서는 의미가 없어 숨긴다. */
export function createHideCodeChipPlugin(): Plugin {
  return new Plugin({
    view: (view) => ({
      update: (v) => {
        const { $from } = v.state.selection;
        if ($from.parent.type.name !== 'code_block' || $from.parent.attrs.language !== DBVIEW_LANG) return;
        // 업스트림의 같은 갱신이 끝난 뒤에 숨긴다
        requestAnimationFrame(() => {
          const chip = view.dom.closest('.oh-editor')?.querySelector<HTMLElement>('.oh-editor__code-language-chip');
          if (chip) chip.hidden = true;
        });
      },
    }),
  });
}
