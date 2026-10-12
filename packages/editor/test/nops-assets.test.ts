import { afterEach, describe, expect, it, vi } from 'vitest';
import { Selection } from 'prosemirror-state';
import { createAssetResolver, vaultUrl } from '@nopsidian/core/assets';
import { createNopsEditor, parseDocument, serializeDocument, showTextPrompt, type NopsAssetHost } from '../src/nops';
import { resolveImageSrc } from '../src/nops/asset-host';

function makeHost(paths: string[], overrides: Partial<NopsAssetHost> = {}) {
  const resolver = createAssetResolver(paths);
  const saved: File[] = [];
  const opened: string[] = [];
  const host: NopsAssetHost = {
    resolve: (t) => resolver(t, 'notes/노트.md'),
    url: (p) => vaultUrl('v1', p),
    save: async (file) => {
      saved.push(file);
      return `attachments/${file.name}`;
    },
    imageSrc: (p) => `../${p}`,
    embedTarget: (p) => p.slice(p.lastIndexOf('/') + 1),
    open: (p) => void opened.push(p),
    ...overrides,
  };
  return { host, saved, opened };
}

function setup(src: string, paths: string[], overrides: Partial<NopsAssetHost> = {}) {
  const el = document.createElement('div');
  document.body.append(el);
  const ctx = makeHost(paths, overrides);
  const editor = createNopsEditor(el, { assets: ctx.host });
  editor.setDocument(parseDocument(src).doc, { silent: true });
  return { editor, view: editor.getView(), el, ...ctx };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('이미지 크기 표기 라운드트립', () => {
  it('![alt|400](src) ↔ 이미지 블록의 width', () => {
    const { doc } = parseDocument('![설명|400](a.png)\n');
    const img = doc.child(0);
    expect(img.type.name).toBe('image');
    expect(img.attrs).toMatchObject({ src: 'a.png', alt: '설명', width: '400', height: null });
    expect(serializeDocument(doc, null)).toBe('![설명|400](a.png)\n');
  });

  it('너비×높이와 alt 없는 크기도 보존한다', () => {
    const { doc } = parseDocument('![|400x225](a.png)\n');
    expect(doc.child(0).attrs).toMatchObject({ alt: null, width: '400', height: '225' });
    expect(serializeDocument(doc, null)).toBe('![|400x225](a.png)\n');
  });

  it('숫자가 아닌 | 뒤는 크기가 아니라 alt의 일부', () => {
    const { doc } = parseDocument('![a|b](a.png)\n');
    expect(doc.child(0).attrs).toMatchObject({ alt: 'a|b', width: null });
  });

  it('공백이 든 경로는 <>로 감싸서 쓴다', () => {
    const { doc } = parseDocument('![x](<attachments/Pasted image 1.png>)\n');
    expect(doc.child(0).attrs.src).toBe('attachments/Pasted image 1.png');
    expect(serializeDocument(doc, null)).toContain('<attachments/Pasted image 1.png>');
  });
});

describe('resolveImageSrc', () => {
  const { host } = makeHost(['attachments/a b.png', 'notes/img/x.png']);
  it('외부 URL은 그대로, 상대 경로는 vault:// URL로', () => {
    expect(resolveImageSrc(host, 'https://example.com/a.png')).toBe('https://example.com/a.png');
    expect(resolveImageSrc(host, 'data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA');
    expect(resolveImageSrc(host, 'img/x.png')).toBe('vault://v1/notes/img/x.png');
    expect(resolveImageSrc(host, '../attachments/a%20b.png')).toBe('vault://v1/attachments/a%20b.png');
    expect(resolveImageSrc(host, 'nope.png')).toBe('nope.png');
  });
});

describe('임베드 노드 뷰', () => {
  it('이미지 임베드는 <img>로 보이고 |크기가 적용된다', () => {
    const { el } = setup('![[a.png|300]]\n', ['attachments/a.png']);
    const img = el.querySelector<HTMLImageElement>('img.nops-embed__img')!;
    expect(img.getAttribute('src')).toBe('vault://v1/attachments/a.png');
    expect(img.style.width).toBe('300px');
  });

  it('없는 파일은 경고 칩', () => {
    const { el } = setup('![[없음.png]]\n', ['attachments/a.png']);
    expect(el.querySelector('.nops-embed__chip.is-missing')?.textContent).toContain('없음.png');
  });

  it('오디오·비디오는 플레이어, PDF는 파일 칩(클릭하면 열기)', () => {
    const { el, opened } = setup('![[곡.mp3]] ![[영상.mp4|500]] ![[문서.pdf]]\n', ['곡.mp3', '영상.mp4', 'docs/문서.pdf']);
    expect(el.querySelector('audio')?.getAttribute('src')).toBe('vault://v1/%EA%B3%A1.mp3');
    expect(el.querySelector<HTMLVideoElement>('video')?.style.width).toBe('500px');
    const chip = el.querySelector<HTMLElement>('.nops-embed__chip')!;
    expect(chip.textContent).toContain('문서.pdf');
    chip.click();
    expect(opened).toEqual(['docs/문서.pdf']);
  });

  it('노트 임베드는 칩이고 클릭하면 링크 이동을 요청한다', () => {
    const el = document.createElement('div');
    document.body.append(el);
    const onOpenLink = vi.fn();
    const editor = createNopsEditor(el, { assets: makeHost([]).host, onOpenLink });
    editor.setDocument(parseDocument('![[다른 노트#제목]]\n').doc, { silent: true });
    el.querySelector<HTMLElement>('.nops-embed__chip')!.click();
    expect(onOpenLink).toHaveBeenCalledWith({ target: '다른 노트', heading: '제목', block: null, embed: true });
  });

  it('핸들을 끌면 |너비로 저장된다', () => {
    const { el, view } = setup('![[a.png]]\n', ['attachments/a.png']);
    const img = el.querySelector<HTMLImageElement>('img.nops-embed__img')!;
    img.getBoundingClientRect = () => ({ width: 200, height: 100 }) as DOMRect;
    Object.defineProperty(img, 'naturalWidth', { value: 800 });
    const handle = el.querySelector<HTMLElement>('.nops-embed__resize')!;
    handle.dispatchEvent(new MouseEvent('mousedown', { clientX: 100, bubbles: true, cancelable: true }));
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 250 }));
    window.dispatchEvent(new MouseEvent('mouseup'));
    expect(serializeDocument(view.state.doc, null)).toBe('![[a.png|350]]\n');
  });
});

describe('파일 붙여넣기·끌어놓기', () => {
  const clipboard = (files: File[]) => {
    const ev = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'clipboardData', { value: { files, getData: () => '' } });
    return ev;
  };

  it('PDF를 붙여넣으면 저장하고 ![[파일]] 임베드를 넣는다', async () => {
    const { view, saved } = setup('끝\n', []);
    view.dispatch(view.state.tr.setSelection(Selection.atEnd(view.state.doc)));
    const file = new File(['%PDF'], '보고서.pdf', { type: 'application/pdf' });
    const ev = clipboard([file]);
    view.dom.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(serializeDocument(view.state.doc, null)).toBe('끝![[보고서.pdf]]\n'));
    expect(saved).toHaveLength(1);
  });

  it('여러 파일은 공백으로 구분해 넣는다', async () => {
    const { view } = setup('\n', []);
    view.dom.dispatchEvent(clipboard([new File(['a'], 'a.zip'), new File(['b'], 'b.zip')]));
    await vi.waitFor(() => expect(serializeDocument(view.state.doc, null)).toBe('![[a.zip]] ![[b.zip]]\n'));
  });

  it('이미지만 있으면 임베드를 만들지 않는다(업스트림 업로드가 이미지 노드로 처리)', async () => {
    const { view } = setup('끝\n', []);
    view.dom.dispatchEvent(clipboard([new File(['x'], 'p.png', { type: 'image/png' })]));
    await new Promise((r) => setTimeout(r, 50));
    expect(serializeDocument(view.state.doc, null)).not.toContain('![[');
  });

  it('저장에 실패하면 onError로 알리고 문서는 그대로', async () => {
    const onError = vi.fn();
    const { view } = setup('끝\n', [], { save: async () => Promise.reject(new Error('디스크 가득')), onError });
    view.dom.dispatchEvent(clipboard([new File(['a'], 'a.zip')]));
    await vi.waitFor(() => expect(onError).toHaveBeenCalled());
    expect(onError.mock.calls[0]![0]).toContain('디스크 가득');
    expect(serializeDocument(view.state.doc, null)).toBe('끝\n');
  });
});

describe('이미지 업로드(업스트림 플러그인 연동)', () => {
  it('붙여넣은 이미지는 저장되고 현재 노트 기준 상대 경로의 이미지 노드가 된다', async () => {
    const { view, saved } = setup('끝\n', []);
    const ev = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'clipboardData', { value: { files: [new File(['x'], '사진.png', { type: 'image/png' })], getData: () => '' } });
    view.dom.dispatchEvent(ev);
    const findImage = () => {
      let found: import('prosemirror-model').Node | undefined;
      view.state.doc.descendants((n) => {
        if (n.type.name === 'image') found = n;
      });
      return found;
    };
    await vi.waitFor(() => expect(findImage()).toBeTruthy());
    expect(saved).toHaveLength(1);
    expect(findImage()?.attrs).toMatchObject({ src: '../attachments/사진.png', alt: '사진' });
    expect(serializeDocument(view.state.doc, null)).toContain('![사진](../attachments/사진.png)');
  });
});

describe('showTextPrompt', () => {
  it('확인하면 입력값, 취소·Esc면 null', async () => {
    const p1 = showTextPrompt('설명', '기본값');
    const input = document.querySelector<HTMLInputElement>('.nops-prompt input')!;
    expect(input.value).toBe('기본값');
    input.value = '새 설명';
    document.querySelector<HTMLFormElement>('.nops-prompt form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    expect(await p1).toBe('새 설명');
    expect(document.querySelector('.nops-prompt')).toBeNull();

    const p2 = showTextPrompt('설명');
    document.querySelector('.nops-prompt')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(await p2).toBeNull();
  });
});
