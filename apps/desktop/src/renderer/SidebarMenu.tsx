import { Fragment, useEffect, useRef } from 'react';

export interface SidebarMenuItem {
  id: string;
  label: string;
  /** 오른쪽에 보이는 단축키 힌트(이미 keys() 로 플랫폼에 맞춘 문자열) */
  hint?: string;
  /** 이 항목 앞에 구분선을 둔다 */
  separator?: boolean;
  onRun: () => void;
}

interface Props {
  anchor: { x: number; y: number };
  items: readonly SidebarMenuItem[];
  onClose: () => void;
}

/**
 * 사이드바 머리줄 `⋯` 메뉴.
 * ↑↓·Home/End 로 이동하고 Enter 로 실행, Esc 로 닫는다(초점은 연 버튼으로 돌려준다 — App 이 한다).
 */
export function SidebarMenu({ anchor, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return;
      const nodes = [...(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
      if (nodes.length === 0) return;
      const at = nodes.indexOf(document.activeElement as HTMLElement);
      let next = at;
      if (e.key === 'ArrowDown') next = at < 0 ? 0 : (at + 1) % nodes.length;
      else if (e.key === 'ArrowUp') next = at < 0 ? nodes.length - 1 : (at - 1 + nodes.length) % nodes.length;
      else if (e.key === 'Home') next = 0;
      else next = nodes.length - 1;
      e.preventDefault();
      nodes[next].focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="ctxmask" onMouseDown={onClose}>
      <div
        ref={ref}
        className="ctxmenu sidebar-menu"
        role="menu"
        style={{ left: Math.min(anchor.x, window.innerWidth - 220), top: Math.min(anchor.y, window.innerHeight - 300) }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {items.map((item) => (
          <Fragment key={item.id}>
            {item.separator && <hr />}
            <button
              role="menuitem"
              onClick={() => {
                onClose();
                item.onRun();
              }}
            >
              <span>{item.label}</span>
              {item.hint && <kbd>{item.hint}</kbd>}
            </button>
          </Fragment>
        ))}
      </div>
    </div>
  );
}
