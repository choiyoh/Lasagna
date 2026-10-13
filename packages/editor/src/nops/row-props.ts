import { Plugin } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';

/** 데이터베이스 행 노트의 속성 패널을 그리는 호스트(앱이 React 로 그린다) */
export interface NopsRowPropsHost {
  /** `hasTitle`: 노트 본문이 `# 제목` 으로 시작하는가(없으면 패널이 파일 이름을 제목으로 보여 줄 수 있다) */
  mount(container: HTMLElement, opts: { hasTitle: boolean }): { destroy(): void };
}

/**
 * 첫 번째 `# 제목` 바로 아래에 속성 패널 자리를 만든다(제목이 없으면 맨 위).
 * 위젯 DOM 은 한 번만 만들고 계속 같은 것을 돌려줘 React 루트가 유지된다.
 */
export function createRowPropsPlugin(host: NopsRowPropsHost): Plugin {
  // 위젯 DOM 의 생명주기는 위젯 자신(`destroy`)에 묶는다. 플러그인 뷰에 묶으면 에디터가 상태를 다시 만들 때
  // (문서 다시 불러오기) 뷰가 파괴돼 React 루트가 사라지는데, ProseMirror 는 같은 키의 위젯 DOM 을 재사용하므로 다시 안 그려진다.
  const handles = new WeakMap<Node, { destroy(): void }>();
  return new Plugin({
    props: {
      decorations(state) {
        const first = state.doc.firstChild;
        const hasTitle = !!first && first.type.name === 'heading' && first.attrs.level === 1;
        const pos = hasTitle ? first!.nodeSize : 0;
        return DecorationSet.create(state.doc, [
          Decoration.widget(
            pos,
            () => {
              const el = document.createElement('div');
              el.className = 'nops-rowprops';
              el.contentEditable = 'false';
              el.setAttribute('data-testid', 'row-props');
              handles.set(el, host.mount(el, { hasTitle }));
              return el;
            },
            {
              key: 'nops-row-props',
              side: -1,
              stopEvent: () => true,
              ignoreSelection: true,
              destroy: (node) => {
                const h = handles.get(node);
                handles.delete(node);
                if (h) setTimeout(() => h.destroy(), 0);
              },
            },
          ),
        ]);
      },
    },
  });
}
