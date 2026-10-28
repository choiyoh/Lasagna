import { describe, expect, it } from 'vitest';
import type { EditorView } from 'prosemirror-view';
import { createNopsEditor, parseDocument, serializeDocument } from '../src/nops';
import { insertFootnote } from '../src/nops/footnotes';

function setup(src: string, readOnly = false) {
  const host = document.createElement('div');
  document.body.append(host);
  const editor = createNopsEditor(host, { onOpenLink: () => undefined, readOnly });
  const parsed = parseDocument(src);
  editor.setDocument(parsed.doc, { silent: true });
  return { editor, view: editor.getView() as EditorView, host, parsed };
}

describe('각주 편집기', () => {
  it('참조는 번호 위첨자, 정의는 아래 각주 영역에 보인다', () => {
    const { host } = setup('본문[^1]과 [^이름]\n\n[^1]: 첫째 내용\n    이어짐\n\n[^이름]: 둘째\n');
    const refs = [...host.querySelectorAll<HTMLElement>('.nops-footnote-ref')];
    expect(refs.map((r) => r.textContent)).toEqual(['1', '2']);
    expect(refs[0]!.title).toContain('첫째 내용');
    const panel = host.querySelector<HTMLElement>('[data-testid="footnotes"]')!;
    expect(panel.textContent).toContain('[^1]');
    expect(panel.querySelector<HTMLTextAreaElement>('.nops-footnotes__text')!.value).toContain('첫째 내용');
    expect([...panel.querySelectorAll<HTMLTextAreaElement>('.nops-footnotes__text')].map((a) => a.value).join('\n')).toContain('둘째');
    expect(host.querySelector<HTMLTextAreaElement>('.nops-footnotes__text')!.value).toContain('첫째 내용');
  });

  it('인라인 각주와 정의 없는 참조도 깨지지 않는다', () => {
    const { host } = setup('인라인 ^[내용]과 없는 참조[^없음]\n');
    const refs = [...host.querySelectorAll<HTMLElement>('.nops-footnote-ref')];
    expect(refs[0]!.title).toContain('내용');
    expect(refs[1]!.title).toContain('정의가 없는');
    expect(host.querySelector<HTMLElement>('[data-testid="footnotes"]')!.hidden).toBe(true);
  });

  it('각주 영역에서 내용을 고치면 원래 정의 위치를 유지한 채 저장된다', () => {
    const src = '앞 문단\n\n본문[^1]\n\n[^1]: 첫째\n    이어짐\n\n뒤 문단\n';
    const { view, host, parsed } = setup(src);
    const area = host.querySelector<HTMLTextAreaElement>('.nops-footnotes__text')!;
    area.value = '고친 내용\n    계속';
    area.dispatchEvent(new Event('change', { bubbles: true }));
    expect(serializeDocument(view.state.doc, parsed.baseline)).toBe('앞 문단\n\n본문[^1]\n\n[^1]: 고친 내용\n    계속\n\n뒤 문단\n');
  });

  it('문서가 바뀌어도 편집 중 textarea와 미커밋 입력을 유지하고 올바른 정의를 고친다', () => {
    const src = '앞\n\n본문[^1] [^2]\n\n[^1]: 하나\n\n[^2]: 둘\n';
    const { view, host, parsed } = setup(src);
    const first = host.querySelector<HTMLTextAreaElement>('.nops-footnotes__text')!;
    first.focus();
    first.value = '입력 중';
    first.dispatchEvent(new Event('input', { bubbles: true }));

    // 다른 위치에 글자를 넣어 모든 정의 위치를 한 칸씩 민다.
    view.dispatch(view.state.tr.insertText('X', 1));
    expect(host.querySelector<HTMLTextAreaElement>('.nops-footnotes__text')).toBe(first);
    expect(first.value).toBe('입력 중');
    expect(document.activeElement).toBe(first);

    first.dispatchEvent(new Event('change', { bubbles: true }));
    const text = serializeDocument(view.state.doc, parsed.baseline);
    expect(text).toContain('[^1]: 입력 중');
    expect(text).toContain('[^2]: 둘');
  });

  it('중복 정의는 내부 key로 구분해 올바른 정의만 고친다', () => {
    const src = '본문[^1]\n\n[^1]: 하나\n\n[^1]: 둘\n';
    const { view, host, parsed } = setup(src);
    const areas = [...host.querySelectorAll<HTMLTextAreaElement>('.nops-footnotes__text')];
    areas[1]!.value = '둘 고침';
    areas[1]!.dispatchEvent(new Event('change', { bubbles: true }));
    const text = serializeDocument(view.state.doc, parsed.baseline);
    expect(text).toContain('[^1]: 하나');
    expect(text).toContain('[^1]: 둘 고침');
  });

  it('읽기 전용이면 각주 내용 입력창이 비활성화된다', () => {
    const { host } = setup('본문[^1]\n\n[^1]: 읽기만\n', true);
    expect(host.querySelector<HTMLTextAreaElement>('.nops-footnotes__text')!.disabled).toBe(true);
  });

  it('각주 슬래시 명령은 참조와 빈 정의를 넣는다', () => {
    const { view } = setup('');
    expect(insertFootnote(view.state, view.dispatch)).toBe(true);
    expect(view.state.doc.child(0).type.name).toBe('paragraph');
    expect(view.state.doc.child(0).child(0).type.name).toBe('footnote_ref');
    expect(view.state.doc.child(1).type.name).toBe('footnote_def');
    expect(serializeDocument(view.state.doc, null)).toBe('[^1]\n\n[^1]: \n');
  });
});
