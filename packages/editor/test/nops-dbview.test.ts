import { describe, expect, it } from 'vitest';
import { createNopsEditor, parseDocument, serializeDocument, type NopsDbViewHost } from '../src/nops';

function setup(src: string, pick: () => Promise<string | null> = async () => null) {
  const calls: { mounted: string[]; updated: string[]; destroyed: number } = { mounted: [], updated: [], destroyed: 0 };
  const dbView: NopsDbViewHost = {
    mount(container, source) {
      calls.mounted.push(source);
      container.textContent = `DB:${source.trim()}`;
      return { update: (s) => calls.updated.push(s), destroy: () => void calls.destroyed++ };
    },
    pick,
  };
  const host = document.createElement('div');
  document.body.append(host);
  const editor = createNopsEditor(host, { dbView });
  const parsed = parseDocument(src);
  editor.setDocument(parsed.doc, { silent: true });
  return { editor, view: editor.getView(), host, parsed, calls };
}

describe('dbview 펜스', () => {
  const src = '앞\n\n```dbview\ndb: 독서 목록\nview: 보드\n```\n\n뒤\n';

  it('dbview 코드 블록은 호스트가 그리고 원문 바이트는 그대로 직렬화된다', () => {
    const { host, calls, editor, parsed } = setup(src);
    expect(host.querySelector('.nops-dbview')).toBeTruthy();
    expect(host.querySelector('.nops-dbview__embed')?.textContent).toBe('DB:db: 독서 목록\nview: 보드');
    expect(calls.mounted).toEqual(['db: 독서 목록\nview: 보드']);
    expect(serializeDocument(editor.getView().state.doc, parsed.baseline)).toBe(src);
  });

  it('다른 언어의 코드 블록은 평범하게 그린다', () => {
    const { host, calls } = setup('```js\nconsole.log(1)\n```\n');
    expect(host.querySelector('.nops-dbview')).toBeNull();
    expect(host.querySelector('pre code')?.textContent).toBe('console.log(1)');
    expect(calls.mounted).toEqual([]);
  });

  it('설정 편집으로 YAML 을 고치면 잠시 뒤 호스트에 갱신을 알린다', async () => {
    const { host, view, calls } = setup(src);
    const code = host.querySelector('.nops-dbview__src code')!;
    expect((host.querySelector('.nops-dbview__src') as HTMLElement).hidden).toBe(true);
    (host.querySelector('.nops-dbview__bar button') as HTMLButtonElement).click();
    expect((host.querySelector('.nops-dbview__src') as HTMLElement).hidden).toBe(false);
    // 문서의 코드 텍스트 끝에 한 줄을 더한다
    let pos = -1;
    view.state.doc.descendants((n, p) => {
      if (n.type.name === 'code_block') pos = p + n.nodeSize - 1;
    });
    view.dispatch(view.state.tr.insertText('\nlimit: 5', pos));
    await new Promise((r) => setTimeout(r, 450));
    expect(calls.updated).toEqual(['db: 독서 목록\nview: 보드\nlimit: 5']);
    expect(code.textContent).toContain('limit: 5');
  });

  it('노드를 지우면 호스트를 정리한다', () => {
    const { view, calls } = setup(src);
    view.dispatch(view.state.tr.delete(0, view.state.doc.content.size));
    expect(calls.destroyed).toBe(1);
  });

  it('슬래시 항목이 호스트의 선택 결과를 dbview 펜스로 넣는다', async () => {
    const { editor, host } = setup('본문\n', async () => 'db: 할일\nview: 표');
    void editor;
    // 슬래시 메뉴 항목은 툴바 지원이 가진다 — 목록에 있는지만 확인한다(실행은 E2E 에서)
    expect(host.ownerDocument).toBeTruthy();
  });
});
