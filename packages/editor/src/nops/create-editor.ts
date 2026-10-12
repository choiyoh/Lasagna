import { createEditor } from '../editor';
import { messagesKo } from '../i18n';
import { createNotionSupport } from '../notion';
import { createTableSupport } from '../table';
import type { Editor, EditorOptions, SlashItemSpec } from '../types';
import { createBlockHandlePlugin, createBlockKeymapPlugin } from './block-handle';
import { insertCallout, insertColumns, insertMathBlock, insertToggle } from './commands';
import { nopsNodeViews } from './node-views';
import { createInteractionPlugin, createNopsInputRules, createTitleKeymapPlugin, type WikiLinkTarget } from './plugins';
import { nopsSchema } from './schema';

import './style.css';

export interface NopsEditorOptions {
  placeholder?: string;
  readOnly?: boolean;
  /** 위키링크·임베드 클릭 */
  onOpenLink?: (link: WikiLinkTarget) => void;
  /** 이미지 업로드(볼트 첨부 저장). 없으면 이미지 삽입 UI를 숨긴다 */
  image?: EditorOptions['image'];
  /** 추가 슬래시 항목 (예: DB 뷰) */
  slashItems?: SlashItemSpec[];
}

const NOTE_ICON = '✎';

/** Nopsidian 슬래시 항목. 키워드에 한글을 넣어 초성 검색(`ㅋㅇㅇ` → 콜아웃)이 된다. */
export const nopsSlashItems: SlashItemSpec[] = [
  { icon: NOTE_ICON, label: '콜아웃', description: '강조할 내용을 상자로 감싸요', category: 'advanced', keywords: ['callout', '콜아웃', '알림', '메모', '강조', 'note'], run: (v) => insertCallout('note')(v.state, v.dispatch) },
  { icon: '💡', label: '팁 콜아웃', description: '팁·힌트용 콜아웃', category: 'advanced', keywords: ['tip', '팁', '힌트', 'callout', '콜아웃'], run: (v) => insertCallout('tip')(v.state, v.dispatch) },
  { icon: '⚠', label: '경고 콜아웃', description: '주의할 내용', category: 'advanced', keywords: ['warning', '경고', '주의', 'callout', '콜아웃'], run: (v) => insertCallout('warning')(v.state, v.dispatch) },
  { icon: '▸', label: '토글', description: '접었다 펼 수 있는 블록', category: 'advanced', keywords: ['toggle', '토글', '접기', '펼치기', '접이식'], run: (v) => insertToggle()(v.state, v.dispatch) },
  { icon: '▥', label: '2열', description: '나란히 두 열로 배치', category: 'advanced', keywords: ['columns', '열', '컬럼', '2열', '두열', '레이아웃'], run: (v) => insertColumns(2)(v.state, v.dispatch) },
  { icon: '▥', label: '3열', description: '나란히 세 열로 배치', category: 'advanced', keywords: ['columns', '열', '컬럼', '3열', '세열', '레이아웃'], run: (v) => insertColumns(3)(v.state, v.dispatch) },
  { icon: '∑', label: '수식 블록', description: 'LaTeX 수식', category: 'advanced', keywords: ['math', 'latex', '수식', '공식', 'katex'], run: (v) => insertMathBlock()(v.state, v.dispatch) },
];

/** Nopsidian 스키마·노드 뷰·입력 규칙·슬래시 항목을 갖춘 에디터를 만든다. */
export function createNopsEditor(host: HTMLElement, options: NopsEditorOptions = {}): Editor {
  const table = createTableSupport();
  return createEditor(host, {
    schema: nopsSchema,
    table: { ...table, schema: nopsSchema },
    toolbar: createNotionSupport({ slashItems: [...nopsSlashItems, ...(options.slashItems ?? [])] }),
    style: 'notion',
    messages: messagesKo,
    placeholder: options.placeholder ?? "'/'를 눌러 블록을 추가하세요",
    readOnly: options.readOnly,
    image: options.image,
    nodeViews: nopsNodeViews,
    priorityPlugins: [createTitleKeymapPlugin(), createBlockKeymapPlugin()],
    plugins: [
      createNopsInputRules(nopsSchema),
      createInteractionPlugin({ onOpenLink: options.onOpenLink }),
      ...createBlockHandlePlugin(),
    ],
  });
}
