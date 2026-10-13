import { dropCursor } from 'prosemirror-dropcursor';
import { keymap } from 'prosemirror-keymap';
import { type EditorState, NodeSelection, Plugin, PluginKey, TextSelection } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import {
  type BlockRef,
  type DragSource,
  TURN_INTO_LABELS,
  type TurnIntoKind,
  blockAt,
  canTurnInto,
  deleteBlock,
  deleteBlocks,
  dropToColumns,
  duplicateBlock,
  duplicateBlocks,
  ensureBlockId,
  moveBlock,
  moveBlocks,
  normalizeColumns,
  selectedBlocks,
  turnInto,
} from './blocks';

const SIDE_DROP_EDGE_PX = 36;
const HANDLE_OFFSET_X = 54;

/** 마우스 위치의 블록. 핸들과 좌우 드롭이 같은 규칙을 쓴다. */
function blockAtCoords(view: EditorView, x: number, y: number): BlockRef | null {
  const rect = view.dom.getBoundingClientRect();
  const left = Math.min(Math.max(x, rect.left + 24), rect.right - 24);
  const hit = view.posAtCoords({ left, top: y });
  if (!hit) return null;
  if (hit.inside >= 0) {
    const node = view.state.doc.nodeAt(hit.inside);
    // 이미지·구분선·원문 블록처럼 내용이 없는 블록은 위치 자체가 블록이다
    if (node && node.isLeaf && node.isBlock) {
      const $in = view.state.doc.resolve(hit.inside);
      return { pos: hit.inside, node, depth: $in.depth + 1 };
    }
    return blockAt(view.state.doc.resolve(hit.inside + 1 <= view.state.doc.content.size ? hit.inside + 1 : hit.inside));
  }
  return blockAt(view.state.doc.resolve(hit.pos));
}

function domOf(view: EditorView, ref: BlockRef): HTMLElement | null {
  const dom = view.nodeDOM(ref.pos);
  return dom instanceof HTMLElement ? dom : null;
}

const TURN_ORDER: TurnIntoKind[] = ['paragraph', 'h1', 'h2', 'h3', 'bullet', 'ordered', 'todo', 'quote', 'code', 'callout', 'toggle'];

export const blockHandleKey = new PluginKey('nopsBlockHandle');

class BlockHandleView {
  private readonly root = document.createElement('div');
  private readonly add = document.createElement('button');
  private readonly grip = document.createElement('span');
  private readonly indicator = document.createElement('div');
  private readonly host: HTMLElement;
  private menu: HTMLElement | null = null;
  private current: BlockRef | null = null;
  private hideTimer: ReturnType<typeof setTimeout> | undefined;
  private frame = 0;
  private dragging = false;

  constructor(
    private readonly view: EditorView,
    private readonly setDragSource: (s: DragSource | null) => void,
    private readonly blockLink?: BlockLinkOptions,
  ) {
    this.host = (view.dom.closest('.oh-editor') as HTMLElement | null) ?? view.dom.parentElement ?? document.body;

    this.root.className = 'nops-handle';
    this.root.hidden = true;
    this.root.contentEditable = 'false';
    this.add.type = 'button';
    this.add.className = 'nops-handle__add';
    this.add.textContent = '+';
    this.add.title = '아래에 블록 추가';
    this.add.tabIndex = -1;
    this.grip.className = 'nops-handle__grip';
    this.grip.textContent = '⋮⋮';
    this.grip.draggable = true;
    this.grip.title = '끌어서 이동 · 클릭해서 메뉴';
    this.root.append(this.add, this.grip);
    this.indicator.className = 'nops-drop-side';
    this.indicator.hidden = true;
    document.body.append(this.root, this.indicator);

    this.host.addEventListener('mousemove', this.onMove);
    this.host.addEventListener('mouseleave', this.scheduleHide);
    this.root.addEventListener('mouseenter', () => clearTimeout(this.hideTimer));
    this.root.addEventListener('mouseleave', this.scheduleHide);
    this.add.addEventListener('mousedown', (e) => e.preventDefault());
    this.add.addEventListener('click', this.onAdd);
    this.grip.addEventListener('click', this.onGripClick);
    this.grip.addEventListener('dragstart', this.onDragStart);
    this.grip.addEventListener('dragend', this.onDragEnd);
    document.addEventListener('mousedown', this.onDocMouseDown, true);
    document.addEventListener('keydown', this.onKeyDown, true);
    window.addEventListener('scroll', this.hide, true);
  }

  update() {
    // 문서가 바뀌면 위치가 달라졌을 수 있으므로 핸들을 숨기고 다음 마우스 이동에서 다시 찾는다
    if (this.current && !this.dragging) {
      const node = this.view.state.doc.nodeAt(this.current.pos);
      if (!node || node !== this.current.node) this.hide();
    }
  }

  destroy() {
    cancelAnimationFrame(this.frame);
    clearTimeout(this.hideTimer);
    this.host.removeEventListener('mousemove', this.onMove);
    this.host.removeEventListener('mouseleave', this.scheduleHide);
    document.removeEventListener('mousedown', this.onDocMouseDown, true);
    document.removeEventListener('keydown', this.onKeyDown, true);
    window.removeEventListener('scroll', this.hide, true);
    this.closeMenu();
    this.root.remove();
    this.indicator.remove();
  }

  // ── 핸들 위치 ──
  private readonly onMove = (e: MouseEvent) => {
    if (this.menu || this.dragging) return;
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => {
      if (!this.view.editable) return this.hide();
      const ref = blockAtCoords(this.view, e.clientX, e.clientY);
      if (!ref) return this.scheduleHide();
      clearTimeout(this.hideTimer);
      this.show(ref);
    });
  };

  private show(ref: BlockRef) {
    const dom = domOf(this.view, ref);
    if (!dom) return this.hide();
    this.current = ref;
    const rect = dom.getBoundingClientRect();
    this.root.hidden = false;
    this.root.style.left = `${Math.max(4, rect.left - HANDLE_OFFSET_X)}px`;
    this.root.style.top = `${rect.top + 2}px`;
  }

  private readonly hide = () => {
    if (this.menu || this.dragging) return;
    this.root.hidden = true;
    this.current = null;
  };

  private readonly scheduleHide = () => {
    clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(this.hide, 250);
  };

  // ── + 버튼: 아래에 빈 블록을 만들고 슬래시 메뉴를 연다 ──
  private readonly onAdd = () => {
    const ref = this.current;
    if (!ref) return;
    const { schema } = this.view.state;
    const slash = schema.text('/');
    const para = schema.nodes.paragraph!.create(null, slash);
    const node =
      ref.node.type.name === 'list_item'
        ? schema.nodes.list_item!.create({ checked: ref.node.attrs.checked === null ? null : false }, para)
        : para;
    const at = ref.pos + ref.node.nodeSize;
    const tr = this.view.state.tr.insert(at, node);
    const textEnd = at + (ref.node.type.name === 'list_item' ? 2 : 1) + 1;
    tr.setSelection(TextSelection.create(tr.doc, textEnd));
    this.view.dispatch(tr.scrollIntoView());
    this.view.focus();
    this.hide();
  };

  // ── 드래그 ──
  private readonly onDragStart = (e: DragEvent) => {
    const ref = this.current;
    if (!ref || !e.dataTransfer) return e.preventDefault();
    this.closeMenu();
    const sel = NodeSelection.create(this.view.state.doc, ref.pos);
    this.view.dispatch(this.view.state.tr.setSelection(sel));
    this.view.dragging = { slice: sel.content(), move: true };
    this.setDragSource({ from: ref.pos, to: ref.pos + ref.node.nodeSize });
    e.dataTransfer.effectAllowed = 'copyMove';
    e.dataTransfer.setData('text/plain', ref.node.textContent || ' ');
    const dom = domOf(this.view, ref);
    if (dom) e.dataTransfer.setDragImage(dom, 0, 0);
    this.dragging = true;
    this.root.classList.add('is-dragging');
  };

  private readonly onDragEnd = () => {
    this.dragging = false;
    this.view.dragging = null;
    this.setDragSource(null);
    this.root.classList.remove('is-dragging');
    this.showSideIndicator(null);
    this.hide();
  };

  /** 좌우 드롭 표시선(세로) */
  showSideIndicator(target: { ref: BlockRef; side: 'left' | 'right' } | null) {
    this.view.dom.classList.toggle('nops-side-drop', Boolean(target));
    if (!target) {
      this.indicator.hidden = true;
      return;
    }
    const dom = domOf(this.view, target.ref);
    if (!dom) return;
    const rect = dom.getBoundingClientRect();
    this.indicator.hidden = false;
    this.indicator.style.left = `${(target.side === 'left' ? rect.left : rect.right) - 2}px`;
    this.indicator.style.top = `${rect.top}px`;
    this.indicator.style.height = `${rect.height}px`;
  }

  // ── 블록 메뉴 ──
  private readonly onGripClick = () => {
    if (this.menu) return this.closeMenu();
    const ref = this.current;
    if (!ref) return;
    this.openMenu(ref);
  };

  private openMenu(ref: BlockRef, keyboard = false) {
    const menu = document.createElement('div');
    menu.className = 'nops-block-menu';
    menu.setAttribute('role', 'menu');
    menu.addEventListener('mousedown', (e) => e.preventDefault());

    const run = (fn: (state: EditorState, ref: BlockRef) => import('prosemirror-state').Transaction | null) => {
      this.closeMenu();
      const fresh = this.refreshRef(ref);
      if (!fresh) return;
      const tr = fn(this.view.state, fresh);
      if (tr) this.view.dispatch(tr);
      this.view.focus();
    };

    // 여러 블록에 걸친 선택이고 이 블록이 그 안에 있으면 선택한 블록 전체를 다룬다
    const multi = selectedBlocks(this.view.state)?.filter((b) => b.pos === ref.pos).length ? selectedBlocks(this.view.state) : null;
    if (multi) {
      const title = document.createElement('div');
      title.className = 'nops-block-menu__title';
      title.textContent = `블록 ${multi.length}개 선택됨`;
      menu.append(title);
      const runMulti = (fn: (state: EditorState, refs: BlockRef[]) => import('prosemirror-state').Transaction | null) => {
        this.closeMenu();
        const refs = selectedBlocks(this.view.state);
        if (!refs) return;
        const tr = fn(this.view.state, refs);
        if (tr) this.view.dispatch(tr);
        this.view.focus();
      };
      menu.append(
        this.menuButton('복제', () => runMulti((s, r) => duplicateBlocks(s, r)), '⌘D'),
        this.menuButton('위로 이동', () => runMulti((s, r) => moveBlocks(s, r, -1)), '⌘⇧↑'),
        this.menuButton('아래로 이동', () => runMulti((s, r) => moveBlocks(s, r, 1)), '⌘⇧↓'),
        this.menuButton('삭제', () => runMulti((s, r) => deleteBlocks(s, r)), '', true),
      );
      this.mountMenu(menu, keyboard ? this.blockRect(ref) : undefined, keyboard);
      return;
    }

    const kinds = TURN_ORDER.filter((k) => canTurnInto(ref, k));
    if (kinds.length) {
      const title = document.createElement('div');
      title.className = 'nops-block-menu__title';
      title.textContent = '블록 변환';
      menu.append(title);
      const grid = document.createElement('div');
      grid.className = 'nops-block-menu__grid';
      for (const kind of kinds) {
        const b = this.menuButton(TURN_INTO_LABELS[kind], () => run((s, r) => turnInto(s, r, kind)));
        grid.append(b);
      }
      menu.append(grid);
      const hr = document.createElement('div');
      hr.className = 'nops-block-menu__sep';
      menu.append(hr);
    }
    if (this.blockLink) {
      menu.append(
        this.menuButton('블록 링크 복사', () => {
          this.closeMenu();
          const fresh = this.refreshRef(ref);
          if (!fresh) return;
          const { id, tr } = ensureBlockId(this.view.state, fresh);
          if (tr) this.view.dispatch(tr);
          this.blockLink!.copy(`[[${this.blockLink!.noteName()}#^${id}]]`);
          this.view.focus();
        }),
      );
    }
    menu.append(
      this.menuButton('복제', () => run((s, r) => duplicateBlock(s, r)), '⌘D'),
      this.menuButton('위로 이동', () => run((s, r) => moveBlock(s, r, -1)), '⌘⇧↑'),
      this.menuButton('아래로 이동', () => run((s, r) => moveBlock(s, r, 1)), '⌘⇧↓'),
      this.menuButton('삭제', () => run((s, r) => deleteBlock(s, r)), '', true),
    );

    this.mountMenu(menu, keyboard ? this.blockRect(ref) : undefined, keyboard);
  }

  private blockRect(ref: BlockRef): DOMRect {
    return (domOf(this.view, ref) ?? this.view.dom).getBoundingClientRect();
  }

  /** 메뉴를 화면에 붙이고 위치를 잡는다. `anchor` 가 없으면 핸들 아래. 키보드로 열면 첫 항목에 포커스를 둔다. */
  private mountMenu(menu: HTMLElement, anchor?: DOMRect, keyboard = false) {
    document.body.append(menu);
    const rect = anchor ?? this.grip.getBoundingClientRect();
    menu.style.left = `${rect.left}px`;
    menu.style.top = `${rect.bottom + 6}px`;
    const mr = menu.getBoundingClientRect();
    if (mr.bottom > window.innerHeight - 8) menu.style.top = `${Math.max(8, window.innerHeight - mr.height - 8)}px`;
    this.menu = menu;
    this.root.classList.add('is-menu-open');
    if (keyboard) this.menuItems()[0]?.focus();
  }

  private menuItems(): HTMLButtonElement[] {
    return this.menu ? [...this.menu.querySelectorAll<HTMLButtonElement>('button.nops-block-menu__item')] : [];
  }

  /** 키보드(⌘/)로 커서가 있는 블록(또는 선택한 여러 블록)의 메뉴를 연다. */
  openMenuAtSelection(): boolean {
    if (this.menu) {
      this.closeMenu();
      return true;
    }
    const ref = blockAt(this.view.state.selection.$from);
    if (!ref) return false;
    this.current = ref;
    this.openMenu(ref, true);
    return true;
  }

  private menuButton(label: string, onClick: () => void, hint = '', danger = false) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'nops-block-menu__item' + (danger ? ' is-danger' : '');
    b.setAttribute('role', 'menuitem');
    const l = document.createElement('span');
    l.textContent = label;
    b.append(l);
    if (hint) {
      const h = document.createElement('kbd');
      h.textContent = hint;
      b.append(h);
    }
    b.addEventListener('click', onClick);
    return b;
  }

  /** 메뉴를 여는 동안 문서가 바뀌었을 수 있으니 같은 위치의 블록을 다시 확인한다 */
  private refreshRef(ref: BlockRef): BlockRef | null {
    const node = this.view.state.doc.nodeAt(ref.pos);
    if (!node) return null;
    return blockAt(this.view.state.doc.resolve(Math.min(ref.pos + 1, this.view.state.doc.content.size))) ?? null;
  }

  private closeMenu() {
    this.menu?.remove();
    this.menu = null;
    this.root.classList.remove('is-menu-open');
  }

  private readonly onDocMouseDown = (e: MouseEvent) => {
    if (!this.menu) return;
    const t = e.target as Node;
    if (this.menu.contains(t) || this.grip.contains(t)) return;
    this.closeMenu();
    this.hide();
  };

  private readonly onKeyDown = (e: KeyboardEvent) => {
    if (!this.menu) return;
    if (e.key === 'Escape') {
      this.closeMenu();
      this.view.focus();
      return;
    }
    // 메뉴 안 키보드 이동: ↑↓ · Home/End · Tab(순환). Enter/Space 는 단추의 기본 동작(클릭)이 처리한다.
    const items = this.menuItems();
    if (!items.length) return;
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    let next = -1;
    if (e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey)) next = at < 0 ? 0 : (at + 1) % items.length;
    else if (e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey)) next = at <= 0 ? items.length - 1 : at - 1;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = items.length - 1;
    if (next >= 0) {
      e.preventDefault();
      e.stopPropagation();
      items[next]!.focus();
    }
  };
}

/** 마우스가 가리키는 블록의 좌/우 가장자리인지 판정한다(열 만들기). */
function sideTarget(view: EditorView, event: DragEvent): { ref: BlockRef; side: 'left' | 'right' } | null {
  const ref = blockAtCoords(view, event.clientX, event.clientY);
  if (!ref) return null;
  const dom = domOf(view, ref);
  if (!dom) return null;
  const rect = dom.getBoundingClientRect();
  const edge = Math.min(SIDE_DROP_EDGE_PX, rect.width * 0.12);
  if (event.clientX <= rect.left + edge) return { ref, side: 'left' };
  if (event.clientX >= rect.right - edge) return { ref, side: 'right' };
  return null;
}

/**
 * 블록 핸들(+ 버튼, 끌어서 이동, 블록 메뉴), 좌우 드롭으로 열 만들기, 이동 뒤 빈 열 정리.
 * 위/아래 드롭은 ProseMirror 기본 드롭(dropcursor 표시선 포함)을 그대로 쓴다.
 */
export interface BlockLinkOptions {
  /** 이 노트를 가리킬 때 쓰는 이름(파일 이름 또는 경로, 확장자 제외) */
  noteName: () => string;
  /** 클립보드에 쓴다 */
  copy: (text: string) => void;
}

export function createBlockHandlePlugin(blockLink?: BlockLinkOptions): Plugin[] {
  let dragSource: DragSource | null = null;
  let handle: BlockHandleView | null = null;

  const main = new Plugin({
    key: blockHandleKey,
    view(view) {
      handle = new BlockHandleView(view, (s) => (dragSource = s), blockLink);
      return {
        update: () => handle?.update(),
        destroy: () => {
          handle?.destroy();
          handle = null;
        },
      };
    },
    props: {
      handleKeyDown(_view, event) {
        // ⌘/ (Ctrl+/): 커서가 있는 블록의 메뉴를 키보드로 연다
        if ((event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && event.key === '/') {
          event.preventDefault();
          return handle?.openMenuAtSelection() ?? false;
        }
        return false;
      },
      handleDrop(view, event, _slice, moved) {
        if (!dragSource || !moved) return false;
        const target = sideTarget(view, event as DragEvent);
        handle?.showSideIndicator(null);
        if (!target) return false;
        const tr = dropToColumns(view.state, dragSource, target.ref, target.side);
        if (!tr) return false;
        view.dispatch(tr.setMeta('uiEvent', 'drop'));
        view.focus();
        return true;
      },
      handleDOMEvents: {
        dragover(view, event) {
          if (dragSource) handle?.showSideIndicator(sideTarget(view, event as DragEvent));
          return false;
        },
        dragleave(view, event) {
          if (dragSource && !view.dom.contains((event as DragEvent).relatedTarget as Node | null)) handle?.showSideIndicator(null);
          return false;
        },
        drop() {
          // 표시선은 handleDrop에서 지우지만, 기본 드롭으로 처리되는 경우에도 지운다
          handle?.showSideIndicator(null);
          return false;
        },
      },
    },
    // 블록을 열 밖으로 옮기거나 지워서 비게 된 열을 정리한다
    appendTransaction(trs, _old, state) {
      if (!trs.some((t) => t.docChanged && (t.getMeta('nopsMove') || t.getMeta('uiEvent') === 'drop'))) return null;
      return normalizeColumns(state);
    },
  });

  return [main, dropCursor({ color: 'var(--oh-editor-primary, #5b5bd6)', width: 3 })];
}

/** ⌘D 복제, ⌘⇧↑/↓ 이동. 기본 키맵보다 먼저 등록한다. */
export function createBlockKeymapPlugin(): Plugin {
  const current = (state: EditorState) => blockAt(state.selection.$from);
  return keymap({
    'Mod-d': (state, dispatch) => {
      const many = selectedBlocks(state);
      if (many) {
        if (dispatch) dispatch(duplicateBlocks(state, many));
        return true;
      }
      const ref = current(state);
      if (!ref) return false;
      if (dispatch) dispatch(duplicateBlock(state, ref));
      return true;
    },
    'Mod-Shift-ArrowUp': (state, dispatch) => {
      const many = selectedBlocks(state);
      if (many) {
        const tr = moveBlocks(state, many, -1);
        if (tr && dispatch) dispatch(tr);
        return true;
      }
      const ref = current(state);
      const tr = ref && moveBlock(state, ref, -1);
      if (!tr) return false;
      if (dispatch) dispatch(tr);
      return true;
    },
    'Mod-Shift-ArrowDown': (state, dispatch) => {
      const many = selectedBlocks(state);
      if (many) {
        const tr = moveBlocks(state, many, 1);
        if (tr && dispatch) dispatch(tr);
        return true;
      }
      const ref = current(state);
      const tr = ref && moveBlock(state, ref, 1);
      if (!tr) return false;
      if (dispatch) dispatch(tr);
      return true;
    },
  });
}
