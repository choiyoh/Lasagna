import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Node as PMNode } from 'prosemirror-model';
import { generateNote, randomGarbage } from '@nopsidian/core/testing';
import { nopsSchema } from '../src/nops/schema';
import { blockToMarkdown, parseDocument, serializeDocument } from '../src/nops/md';

const fixture = readFileSync(path.join(__dirname, '../../../fixtures/vaults/basic/클린 코드.md'), 'utf8');

const kids = (doc: PMNode) => {
  const out: PMNode[] = [];
  doc.forEach((c) => out.push(c));
  return out;
};
const types = (doc: PMNode) => kids(doc).map((n) => n.type.name);

describe('Markdown → PM', () => {
  const { doc } = parseDocument(fixture);

  it('블록 구조: 제목·문단·목록·콜아웃·열·표·코드·수식·문단', () => {
    expect(types(doc)).toEqual([
      'heading',
      'paragraph',
      'bullet_list',
      'callout',
      'columns',
      'table',
      'paragraph', // ^table1 (표 뒤 단독 블록 ID 줄은 일반 문단으로 보존)
      'code_block',
      'math_block',
      'paragraph',
    ]);
  });

  it('블록 ID는 문단 끝에서 떼어 속성으로 옮긴다', () => {
    const p = kids(doc)[1]!;
    expect(p.attrs.blockId).toBe('b7k2');
    expect(p.textContent).toBe('핵심은 읽기 쉬운 코드다.');
  });

  it('할 일 항목과 중첩 목록', () => {
    const list = kids(doc)[2]!;
    const item = list.child(0);
    expect(item.attrs.checked).toBe(false);
    expect(item.child(0).attrs.blockId).toBe('c91x');
    expect(item.child(1).type.name).toBe('bullet_list');
  });

  it('접힌 콜아웃은 토글/콜아웃 노드가 되고 위키링크 속성을 분해한다', () => {
    const callout = kids(doc)[3]!;
    expect(callout.type.name).toBe('callout');
    expect(callout.attrs).toMatchObject({ type: 'note', fold: '-' });
    expect(callout.child(0).textContent).toBe('접힌 콜아웃 제목');
    let link: PMNode | undefined;
    callout.descendants((n) => {
      if (n.type.name === 'wikilink') link = n;
    });
    expect(link?.attrs).toMatchObject({ target: '리팩터링', heading: '1장', alias: '1장' });
  });

  it('열: columns ⊃ column 2개, 임베드 크기는 alias', () => {
    const cols = kids(doc)[4]!;
    expect(cols.type.name).toBe('columns');
    expect(cols.childCount).toBe(2);
    let embed: PMNode | undefined;
    cols.descendants((n) => {
      if (n.type.name === 'embed') embed = n;
    });
    expect(embed?.attrs).toMatchObject({ target: 'diagram.png', alias: '400' });
  });

  it('코드 안의 대괄호는 위키링크가 되지 않는다', () => {
    let wikilinks = 0;
    doc.descendants((n) => {
      if (n.type.name === 'wikilink') wikilinks++;
    });
    expect(wikilinks).toBe(1);
    expect(kids(doc)[7]!.textContent).toContain('[[코드블록]]');
  });

  it('스키마 검증을 통과한다', () => {
    expect(() => doc.check()).not.toThrow();
  });

  it('문단 안에 이미지가 하나뿐이면 이미지 블록, 섞여 있으면 인라인 이미지', () => {
    expect(types(parseDocument('![a](a.png)\n').doc)).toEqual(['image']);
    const mixed = parseDocument('앞 ![a](a.png) 뒤\n').doc;
    expect(types(mixed)).toEqual(['paragraph']);
    expect(kids(mixed)[0]!.child(1).type.name).toBe('inline_image');
  });

  it('알 수 없는 HTML은 raw_block, 각주 정의는 footnote_def로 보존한다', () => {
    const { doc: d } = parseDocument('<div class="x">\n html\n</div>\n\n[^1]: 각주 정의\n');
    expect(types(d)).toEqual(['raw_block', 'footnote_def']);
    expect(kids(d)[1]!.attrs).toMatchObject({ identifier: '1', label: '1', source: '[^1]: 각주 정의' });
  });

  it('잘못된 열(1개뿐)은 일반 문단으로 남는다', () => {
    const { doc: d } = parseDocument(':::columns\n\n:::\n');
    expect(types(d)).not.toContain('columns');
  });
  it('mermaid 펜스는 코드 블록으로 읽고 원문을 그대로 저장한다', () => {
    const src = '```mermaid\nflowchart TD\n  A --> B\n```\n';
    const { doc, baseline } = parseDocument(src);
    expect(types(doc)).toEqual(['code_block']);
    expect(kids(doc)[0]!.attrs.language).toBe('mermaid');
    expect(serializeDocument(doc, baseline)).toBe(src);
  });
});

describe('바이트 보존: 열었다가 그대로 저장', () => {
  it('고정 픽스처', () => {
    const { doc, baseline } = parseDocument(fixture);
    expect(serializeDocument(doc, baseline)).toBe(fixture);
  });

  it('합성 노트 500개', () => {
    const bad: number[] = [];
    for (let seed = 1; seed <= 500; seed++) {
      const src = generateNote(seed);
      const { doc, baseline } = parseDocument(src);
      expect(() => doc.check(), `seed ${seed}`).not.toThrow();
      if (serializeDocument(doc, baseline) !== src) bad.push(seed);
    }
    expect(bad).toEqual([]);
  });
});

describe('깨진 입력 퍼즈', () => {
  it('3000개 모두 예외 없이 유효한 문서가 되고, 저장하면 원문 그대로다', () => {
    for (let seed = 1; seed <= 3000; seed++) {
      const src = randomGarbage(seed);
      let parsed;
      try {
        parsed = parseDocument(src);
        parsed.doc.check();
      } catch (e) {
        throw new Error(`seed ${seed} ${JSON.stringify(src)}: ${e instanceof Error ? e.message : e}`);
      }
      expect(serializeDocument(parsed.doc, parsed.baseline), `seed ${seed} ${JSON.stringify(src)}`).toBe(src);
    }
  });

  it('새로 직렬화해도 예외가 없고 다시 읽을 수 있다', () => {
    for (let seed = 1; seed <= 1500; seed++) {
      const src = randomGarbage(seed);
      const md = serializeDocument(parseDocument(src).doc, null);
      expect(() => parseDocument(md).doc.check(), `seed ${seed} ${JSON.stringify(src)}`).not.toThrow();
    }
  });
});

describe('일부만 편집하면 그 블록만 바뀐다', () => {
  const src = '---\nid: X\n---\n\n# 제목   \n\n첫 문단  \n\n둘째 문단\n\n- a\n- b\n';

  const editParagraph = (index: number, text: string) => {
    const { doc, baseline } = parseDocument(src);
    const children = kids(doc);
    children[index] = nopsSchema.nodes.paragraph!.create(null, nopsSchema.text(text));
    return serializeDocument(nopsSchema.nodes.doc!.create(null, children), baseline);
  };

  it('문단 하나를 고치면 나머지(공백·줄끝 공백 포함)는 원문 그대로', () => {
    expect(editParagraph(2, '수정됨')).toBe(src.replace('둘째 문단', '수정됨'));
  });

  it('블록을 지우면 사이 공백이 정리되고 이웃은 보존된다', () => {
    const { doc, baseline } = parseDocument(src);
    const children = kids(doc).filter((_, i) => i !== 1);
    expect(serializeDocument(nopsSchema.nodes.doc!.create(null, children), baseline)).toBe(
      '---\nid: X\n---\n\n# 제목   \n\n둘째 문단\n\n- a\n- b\n',
    );
  });

  it('블록을 끝에 추가하면 빈 줄을 두고 붙는다', () => {
    const { doc, baseline } = parseDocument(src);
    const children = [...kids(doc), nopsSchema.nodes.paragraph!.create(null, nopsSchema.text('새 문단'))];
    expect(serializeDocument(nopsSchema.nodes.doc!.create(null, children), baseline)).toBe(src.replace(/\n$/, '') + '\n\n새 문단\n');
  });

  it('CRLF 문서를 편집해도 새 블록은 CRLF를 쓴다', () => {
    const crlf = '# 제목\r\n\r\n본문\r\n';
    const { doc, baseline } = parseDocument(crlf);
    const children = [...kids(doc), nopsSchema.nodes.bullet_list!.create(null, [
      nopsSchema.nodes.list_item!.create(null, nopsSchema.nodes.paragraph!.create(null, nopsSchema.text('a'))),
      nopsSchema.nodes.list_item!.create(null, nopsSchema.nodes.paragraph!.create(null, nopsSchema.text('b'))),
    ])];
    expect(serializeDocument(nopsSchema.nodes.doc!.create(null, children), baseline)).toBe(`${crlf}\r\n- a\r\n- b\r\n`);
  });
});

describe('새로 직렬화한 Markdown은 다시 읽으면 같은 문서가 된다', () => {
  const stable = (src: string) => {
    const a = parseDocument(src).doc;
    const md = serializeDocument(a, null);
    const b = parseDocument(md).doc;
    return { a, b, md };
  };

  it('고정 픽스처', () => {
    const { a, b, md } = stable(fixture);
    expect(b.toJSON(), md).toEqual(a.toJSON());
  });

  it('인라인 서식·링크·위키링크·하이라이트·수식', () => {
    const src = '**굵게** *기울임* ~~취소~~ `코드` ==형광== <u>밑줄</u> [링크](https://a.com "t") [[노트#제목|별칭]] ![[img.png|300]] $x^2$ 끝\n';
    const { a, b, md } = stable(src);
    expect(b.toJSON(), md).toEqual(a.toJSON());
    expect(md).toContain('[[노트#제목|별칭]]');
    expect(md).toContain('![[img.png|300]]');
  });

  it('특수문자는 이스케이프되어 일반 텍스트로 남는다', () => {
    const doc = nopsSchema.nodes.doc!.create(null, [
      nopsSchema.nodes.paragraph!.create(null, nopsSchema.text('1. not list * not em _x_ [not link](x) # not heading <b>')),
    ]);
    const md = serializeDocument(doc, null);
    expect(parseDocument(md).doc.toJSON(), md).toEqual(doc.toJSON());
  });

  it('사용자가 직접 친 `[[`는 위키링크 노드가 되지 않도록 이스케이프된다', () => {
    const doc = nopsSchema.nodes.doc!.create(null, [nopsSchema.nodes.paragraph!.create(null, nopsSchema.text('[[그냥 텍스트]]'))]);
    const md = serializeDocument(doc, null);
    expect(parseDocument(md).doc.toJSON(), md).toEqual(doc.toJSON());
  });

  it('콜아웃·토글·열을 마크다운 문법으로 쓴다', () => {
    const { md } = stable('> [!tip]+ 제목\n> 본문\n\n> [!toggle]- 접기\n> 숨김\n\n::::columns\n\n:::column\n\n왼쪽\n\n:::\n\n:::column\n\n오른쪽\n\n:::\n\n::::\n');
    expect(md).toContain('> [!tip]+ 제목');
    expect(md).toContain('> [!toggle]- 접기');
    expect(md).toContain('::::columns');
    expect(md).toContain(':::column');
  });

  it('합성 노트 500개 (의미 보존)', () => {
    const bad: { seed: number; src: string; md: string }[] = [];
    for (let seed = 1; seed <= 500; seed++) {
      const src = generateNote(seed);
      const { a, b, md } = stable(src);
      if (JSON.stringify(a.toJSON()) !== JSON.stringify(b.toJSON())) bad.push({ seed, src, md });
    }
    if (bad.length) {
      for (const x of bad.slice(0, 4)) {
        const a = parseDocument(x.src).doc;
        const b = parseDocument(x.md).doc;
        const ja = a.toJSON().content as unknown[];
        const jb = b.toJSON().content as unknown[];
        const i = ja.findIndex((v, k) => JSON.stringify(v) !== JSON.stringify(jb[k]));
        console.log(`seed ${x.seed} first diff @${i}\nA: ${JSON.stringify(ja[i])}\nB: ${JSON.stringify(jb[i])}\nSRC: ${JSON.stringify(x.src)}`);
      }
    }
    expect(bad.map((x) => x.seed)).toEqual([]);
  });
});

describe('blockToMarkdown', () => {
  it('빈 문단은 아무것도 쓰지 않는다', () => {
    expect(blockToMarkdown(nopsSchema.nodes.paragraph!.create())).toBe('');
  });
});


describe('각주', () => {
  it('참조·정의·인라인 각주를 노드로 만들고 원문을 바이트 그대로 저장한다', () => {
    const src = '본문[^1]과 [^이름] 그리고 ^[인라인]\n\n[^1]: 첫째\n    이어짐\n\n[^이름]: 둘째\n';
    const { doc, baseline } = parseDocument(src);
    expect(types(doc)).toEqual(['paragraph', 'footnote_def', 'footnote_def']);
    const refs: PMNode[] = [];
    doc.descendants((n) => {
      if (n.type.name === 'footnote_ref') refs.push(n);
    });
    expect(refs.map((n) => n.attrs)).toEqual([
      { identifier: '1', label: '1', inline: false, text: null },
      { identifier: '이름', label: '이름', inline: false, text: null },
      { identifier: null, label: null, inline: true, text: '인라인' },
    ]);
    expect(kids(doc)[1]!.attrs.source).toBe('[^1]: 첫째\n    이어짐');
    expect(serializeDocument(doc, baseline)).toBe(src);
  });

  it('정의 없는 참조·쓰이지 않는 정의·중복 정의·코드 안 각주를 잃지 않는다', () => {
    const src = '없는 참조[^없음]\n\n[^안씀]: 쓰이지 않음\n\n[^dup]: 하나\n\n[^dup]: 둘\n\n```\n[^코드]\n```\n\n`[^인라인코드]`\n\n본문 ^abc\n';
    const { doc, baseline } = parseDocument(src);
    expect(types(doc)).toEqual(['paragraph', 'footnote_def', 'footnote_def', 'footnote_def', 'code_block', 'paragraph', 'paragraph']);
    expect(serializeDocument(doc, baseline)).toBe(src);
  });

  it('정의가 문서 중간에 있어도 위치·순서를 유지한다', () => {
    const src = '앞[^a]\n\n[^a]: 중간 정의\n    계속 줄\n\n뒤\n';
    const { doc, baseline } = parseDocument(src);
    expect(types(doc)).toEqual(['paragraph', 'footnote_def', 'paragraph']);
    expect(serializeDocument(doc, baseline)).toBe(src);
  });
});
