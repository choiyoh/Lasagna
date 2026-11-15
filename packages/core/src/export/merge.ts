/**
 * 원고 합본 내보내기 — 여러 회차를 .docx / .txt 한 파일로.
 * 변환 규칙은 복사용 내보내기(platformText)와 같은 본문을 받는다(마크다운·색 span 은 이미 걷어 낸 텍스트).
 */

export type MergeSeparator = 'page' | 'blank' | 'rule';

export interface MergePart {
  title: string;
  /** platformText 로 변환한 본문(줄바꿈 \n) */
  body: string;
}

export interface MergeTextOptions {
  includeTitles: boolean;
  separator: MergeSeparator;
  /** 맨 앞에 넣을 요약(없으면 null) */
  summary: string | null;
}

/** 제네릭 텍스트 합본(줄바꿈 \n). .txt 는 여기에 BOM·CRLF 를 씌운다. */
export function mergePlainText(parts: readonly MergePart[], opts: MergeTextOptions): string {
  const blocks: string[] = [];
  if (opts.summary) blocks.push(opts.summary);
  parts.forEach((part, i) => {
    if (i > 0) {
      if (opts.separator === 'rule') blocks.push('---');
      else if (opts.separator === 'page') blocks.push('\f');
      else blocks.push('');
    }
    if (opts.includeTitles) blocks.push(part.title);
    const body = part.body.replace(/\n+$/, '');
    if (body) blocks.push(body);
  });
  return `${blocks.join('\n\n').replace(/\n{3,}/g, '\n\n')}\n`;
}

/** .txt 저장용 바이트: UTF-8 BOM + CRLF(Windows 메모장·한글). */
export function mergeTxtBytes(text: string): Uint8Array {
  const crlf = text.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n');
  return new TextEncoder().encode(`\uFEFF${crlf}`);
}

/** XML 1.0 에 못 쓰는 제어문자를 지우고 엔티티를 이스케이프한다. */
export function escapeXml(value: string): string {
  let cleaned = '';
  for (const char of value) {
    // XML 1.0 이 못 쓰는 제어문자(탭 제외)를 지운다.
    if ((char.codePointAt(0) ?? 0) >= 0x20 || char === '\t') cleaned += char;
  }
  return cleaned
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const paragraph = (inner: string): string => `<w:p>${inner}</w:p>`;
const run = (text: string, bold = false): string =>
  `<w:r>${bold ? '<w:rPr><w:b/></w:rPr>' : ''}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`;
const styledParagraph = (text: string, style: string): string => `<w:p><w:pPr><w:pStyle w:val="${style}"/></w:pPr>${run(text)}</w:p>`;
const emptyParagraph = (): string => '<w:p/>';
const pageBreak = (): string => '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
const divider = (): string =>
  '<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="999999"/></w:pBdr></w:pPr></w:p>';

function bodyParagraphs(text: string): string[] {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/\n+$/, '')
    .split('\n')
    .map((line) => (line.trim() === '' ? emptyParagraph() : paragraph(run(line))));
}

const HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

/** 최소 OOXML 파트 — zip 은 호출자(main)가 fflate 로 만든다. */
export function buildMergeDocxParts(opts: {
  title: string;
  summary: string | null;
  parts: readonly MergePart[];
  includeTitles: boolean;
  separator: MergeSeparator;
}): Record<string, Uint8Array> {
  const body: string[] = [];
  body.push(styledParagraph(opts.title, 'Title'));
  if (opts.summary) body.push(...bodyParagraphs(opts.summary));
  opts.parts.forEach((part, i) => {
    if (i > 0) {
      if (opts.separator === 'page') body.push(pageBreak());
      else if (opts.separator === 'rule') body.push(divider());
      else body.push(emptyParagraph());
    }
    if (opts.includeTitles) body.push(styledParagraph(part.title, 'Heading1'));
    body.push(...bodyParagraphs(part.body));
  });

  const documentXml =
    HEADER +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    `<w:body>${body.join('')}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1418" w:right="1418" w:bottom="1418" w:left="1418" w:header="851" w:footer="992" w:gutter="0"/></w:sectPr></w:body>` +
    '</w:document>';

  const stylesXml =
    HEADER +
    '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Malgun Gothic" w:hAnsi="Malgun Gothic" w:eastAsia="Malgun Gothic" w:cs="Malgun Gothic"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="360" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:pPr><w:jc w:val="center"/><w:spacing w:after="240"/></w:pPr><w:rPr><w:b/><w:sz w:val="36"/><w:szCs w:val="36"/></w:rPr></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr></w:style>' +
    '</w:styles>';

  const contentTypes =
    HEADER +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
    '</Types>';

  const rootRels =
    HEADER +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
    '</Relationships>';

  const documentRels =
    HEADER +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
    '</Relationships>';

  const enc = (text: string) => new TextEncoder().encode(text);
  return {
    '[Content_Types].xml': enc(contentTypes),
    '_rels/.rels': enc(rootRels),
    'word/document.xml': enc(documentXml),
    'word/styles.xml': enc(stylesXml),
    'word/_rels/document.xml.rels': enc(documentRels),
  };
}
