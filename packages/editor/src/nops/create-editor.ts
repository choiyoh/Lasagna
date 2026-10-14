import '@oh-new-editor/core/style.css';
import { createEditor, messagesKo, type Editor, type EditorOptions, type SlashItemSpec } from '@oh-new-editor/core';
import { createNotionSupport } from '@oh-new-editor/core/notion';
import { createTableSupport } from '@oh-new-editor/core/table';
import { createCodeHighlightPlugin } from './code-highlight';
import { type BlockLinkOptions, createBlockHandlePlugin, createBlockKeymapPlugin } from './block-handle';
import { insertCallout, insertColumns, insertMathBlock, insertToggle } from './commands';
import { type NopsAssetHost, resolveImageSrc } from './asset-host';
import { createDbViewNodeView, dbViewSlashItem, createHideCodeChipPlugin, newDbSlashItem, type NopsDbViewHost } from './db-view';
import { createEmbedView } from './embed-view';
import { createFilesPlugin } from './files-plugin';
import { createFlashPlugin } from './flash';
import { createTocPlugin, tocNodeView, tocSlashItem } from './toc';
import { createMathActivePlugin } from './math';
import { createRowPropsPlugin, type NopsRowPropsHost } from './row-props';
import { createToggleHeadingPlugin, toggleHeadingCommand } from './toggle-heading';
import { createLinkPreviewPlugin } from './link-preview';
import type { NopsPeekHost } from './peek-host';
import { createLinkSuggestPlugin, type NopsLinkHost } from './link-suggest';
import { nopsNodeViews } from './node-views';
import { showTextPrompt } from './prompt';
import { createFindPlugin } from './find';
import { createInteractionPlugin, createNopsInputRules, createTitleKeymapPlugin, type WikiLinkTarget } from './plugins';
import { nopsSchema } from './schema';

import './style.css';

export interface NopsEditorOptions {
  placeholder?: string;
  readOnly?: boolean;
  /** 위키링크·임베드 클릭 */
  onOpenLink?: (link: WikiLinkTarget) => void;
  /** `[[` 링크 자동완성. 없으면 자동완성이 꺼진다(직접 `[[노트]]`를 끝까지 치면 링크로 바뀐다) */
  links?: NopsLinkHost;
  /** 블록 메뉴의 "블록 링크 복사". 없으면 그 항목이 숨겨진다 */
  blockLink?: BlockLinkOptions;
  /** 첨부(이미지·파일) 저장·표시. 없으면 첨부 기능이 꺼진다 */
  assets?: NopsAssetHost;
  /** 위키링크 호버 미리보기·노트 임베드 발췌. 없으면 둘 다 꺼진다 */
  peek?: NopsPeekHost;
  /** 데이터베이스 행 노트의 속성 패널(제목 아래). 없으면 패널이 없다 */
  rowProps?: NopsRowPropsHost;
  /** 추가 슬래시 항목 (예: DB 뷰) */
  slashItems?: SlashItemSpec[];
  /** ```dbview 펜스를 데이터베이스 뷰로 그리는 호스트. 없으면 평범한 코드 블록으로 보인다 */
  dbView?: NopsDbViewHost;
}

const NOTE_ICON = '✎';

/** Nopsidian 슬래시 항목. 키워드에 한글을 넣어 초성 검색(`ㅋㅇㅇ` → 콜아웃)이 된다. */
export const nopsSlashItems: SlashItemSpec[] = [
  { icon: NOTE_ICON, label: '콜아웃', description: '강조할 내용을 상자로 감싸요', category: 'advanced', keywords: ['callout', '콜아웃', '알림', '메모', '강조', 'note'], run: (v) => insertCallout('note')(v.state, v.dispatch) },
  { icon: '💡', label: '팁 콜아웃', description: '팁·힌트용 콜아웃', category: 'advanced', keywords: ['tip', '팁', '힌트', 'callout', '콜아웃'], run: (v) => insertCallout('tip')(v.state, v.dispatch) },
  { icon: '⚠', label: '경고 콜아웃', description: '주의할 내용', category: 'advanced', keywords: ['warning', '경고', '주의', 'callout', '콜아웃'], run: (v) => insertCallout('warning')(v.state, v.dispatch) },
  { icon: '▸', label: '토글', description: '접었다 펼 수 있는 블록', category: 'advanced', keywords: ['toggle', '토글', '접기', '펼치기', '접이식'], run: (v) => insertToggle()(v.state, v.dispatch) },
  { icon: '▾', label: '토글 제목 1', description: '접었다 펼 수 있는 큰 제목', category: 'advanced', keywords: ['toggle', 'heading', '토글', '제목', '접기', 'h1', '토글제목1'], run: (v) => toggleHeadingCommand(1)(v.state, v.dispatch) },
  { icon: '▾', label: '토글 제목 2', description: '접었다 펼 수 있는 중간 제목', category: 'advanced', keywords: ['toggle', 'heading', '토글', '제목', '접기', 'h2', '토글제목2'], run: (v) => toggleHeadingCommand(2)(v.state, v.dispatch) },
  { icon: '▾', label: '토글 제목 3', description: '접었다 펼 수 있는 작은 제목', category: 'advanced', keywords: ['toggle', 'heading', '토글', '제목', '접기', 'h3', '토글제목3'], run: (v) => toggleHeadingCommand(3)(v.state, v.dispatch) },
  { icon: '▥', label: '2열', description: '두 열로 나란히 배치', category: 'advanced', keywords: ['columns', '열', '컬럼', '2열', '두열', '레이아웃'], run: (v) => insertColumns(2)(v.state, v.dispatch) },
  { icon: '▥', label: '3열', description: '세 열로 나란히 배치', category: 'advanced', keywords: ['columns', '열', '컬럼', '3열', '세열', '레이아웃'], run: (v) => insertColumns(3)(v.state, v.dispatch) },
  { icon: '∑', label: '수식 블록', description: 'LaTeX 수식', category: 'advanced', keywords: ['math', 'latex', '수식', '공식', 'katex'], run: (v) => insertMathBlock()(v.state, v.dispatch) },
];

/** Nopsidian 스키마·노드 뷰·입력 규칙·슬래시 항목을 갖춘 에디터를 만든다. */
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml', 'image/avif', 'image/bmp'];

export function createNopsEditor(host: HTMLElement, options: NopsEditorOptions = {}): Editor {
  const table = createTableSupport();
  const assets = options.assets;
  const dbViewNode = options.dbView ? createDbViewNodeView(options.dbView) : null;
  return createEditor(host, {
    schema: nopsSchema,
    table: { ...table, schema: nopsSchema },
    toolbar: createNotionSupport({ slashItems: [...nopsSlashItems, ...(options.dbView?.create ? [newDbSlashItem(options.dbView)] : []), tocSlashItem, ...(options.dbView ? [dbViewSlashItem(options.dbView)] : []), ...(options.slashItems ?? [])] }),
    style: 'notion',
    // 업스트림 한국어 문구 중 어색한 몇 곳만 다듬는다
    messages: {
      ...messagesKo,
      linkInvalid: '올바른 주소를 입력해 주세요. 예: example.com',
      uploadEmptyUrl: '업로드 함수가 URL을 돌려주지 않았어요',
      slashImageDescription: '내 기기에서 이미지를 올려요',
      slashTableDescription: '행과 열 수를 골라 표를 넣어요',
      slashDividerDescription: '가로 구분선을 넣어요',
      slashCodeBlockDescription: '코드 블록을 넣어요',
    },
    placeholder: options.placeholder ?? "'/'를 눌러 블록을 추가하세요",
    readOnly: options.readOnly,
    image: assets
      ? {
          upload: async (file) => assets.imageSrc(await assets.save(file)),
          accept: IMAGE_TYPES,
          maxSize: 50_000_000,
          altText: (file) => file.name.replace(/\.[^./\\]+$/, ''),
        }
      : undefined,
    resolveImageSrc: assets ? (src) => resolveImageSrc(assets, src) : undefined,
    prompt: showTextPrompt,
    nodeViews: {
      ...nopsNodeViews,
      ...(assets ? { embed: createEmbedView(assets, options.onOpenLink, options.peek) } : {}),
      // ```dbview → 데이터베이스 보기, ```toc → 자동 목차, 나머지 코드 블록은 기본 렌더링
      code_block: (node, view, getPos) => {
        const toc = tocNodeView(node, view);
        if (toc) return toc;
        return dbViewNode ? dbViewNode(node, view) : (undefined as never);
      },
    },
    // 자동완성은 Enter/Tab/방향키를 기본 키맵보다 먼저 받아야 한다
    priorityPlugins: [
      ...(options.links ? [createLinkSuggestPlugin(options.links)] : []),
      createTitleKeymapPlugin(),
      createBlockKeymapPlugin(),
      ...(assets ? [createFilesPlugin(assets)] : []),
    ],
    plugins: [
      createNopsInputRules(nopsSchema),
      createInteractionPlugin({ onOpenLink: options.onOpenLink }),
      ...createBlockHandlePlugin(options.blockLink),
      createCodeHighlightPlugin(),
      createFlashPlugin(),
      createFindPlugin(),
      createToggleHeadingPlugin(),
      createMathActivePlugin(),
      createTocPlugin(),
      ...(options.dbView ? [createHideCodeChipPlugin()] : []),
      ...(options.rowProps ? [createRowPropsPlugin(options.rowProps)] : []),
      ...(options.peek ? [createLinkPreviewPlugin(options.peek)] : []),
    ],
  });
}
