export type LinkKind = 'wikilink' | 'embed' | 'md' | 'relation';

export interface ParsedLink {
  kind: LinkKind;
  /** 링크 대상 원문(노트 이름/경로). 같은 노트 안의 `[[#제목]]`이면 빈 문자열 */
  target: string;
  heading?: string;
  block?: string;
  /** `|` 뒤의 표시 텍스트(임베드에서는 크기 등) */
  alias?: string;
  /** 1부터 시작하는 줄 번호 (파일 전체 기준) */
  line: number;
}

export interface ParsedHeading {
  level: number;
  text: string;
  slug: string;
  line: number;
}

export interface ParsedTag {
  tag: string;
  source: 'inline' | 'frontmatter';
}

export interface ParsedBlockId {
  id: string;
  /** 이 ID가 붙은 최상위 블록의 인덱스 */
  blockIndex: number;
}

export type BlockKind =
  | 'paragraph'
  | 'heading'
  | 'list'
  | 'code'
  | 'quote'
  | 'callout'
  | 'table'
  | 'thematicBreak'
  | 'math'
  | 'html'
  | 'fence-open'
  | 'fence-close'
  | 'other';

export interface Block {
  index: number;
  kind: BlockKind;
  /** 원문 안에서의 [start, end) 오프셋. 블록 사이 공백/빈 줄은 포함하지 않는다. */
  start: number;
  end: number;
  source: string;
  /** 1부터 시작하는 시작·끝 줄 */
  lineStart: number;
  lineEnd: number;
  headingLevel?: number;
  /** 블록 끝에 붙은 `^id` */
  blockId?: string;
  callout?: Callout;
  /** `:::name` 펜스의 이름·중첩 깊이(콜론 개수) */
  fence?: { name: string; colons: number };
  /** 검색/미리보기용 일반 텍스트 */
  text: string;
}

export interface Callout {
  type: string;
  /** '+' 펼침, '-' 접힘, 없으면 undefined */
  fold?: '+' | '-';
  title: string;
}

export interface Frontmatter {
  raw: string;
  data: Record<string, unknown>;
  /** 프런트매터가 끝나는 오프셋(닫는 --- 줄과 줄바꿈 포함) */
  end: number;
  error?: string;
}

export interface NoteMeta {
  id?: string;
  title: string;
  aliases: string[];
  tags: ParsedTag[];
  headings: ParsedHeading[];
  links: ParsedLink[];
  blockIds: ParsedBlockId[];
}

export interface ParsedNote {
  source: string;
  frontmatter: Frontmatter | null;
  blocks: Block[];
  meta: NoteMeta;
}
