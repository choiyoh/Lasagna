import { useEffect } from 'react';
import { keys } from './keys';

const GROUPS: { title: string; items: [string, string][] }[] = [
  {
    title: '이동',
    items: [
      ['⌘O', '노트 찾기'],
      ['⌘P', '명령 팔레트'],
      ['⌘⌥D', '오늘의 노트'],
      ['⌘⇧G', '그래프'],
      ['⌘W', '현재 탭 닫기'],
      ['⌘ 클릭', '새 탭에서 열기'],
    ],
  },
  {
    title: '노트',
    items: [
      ['F2', '이름 바꾸기'],
      ['⌘F', '노트 안에서 찾기·바꾸기'],
      ['⌘E', '편집 모드 ↔ 소스 모드'],
      ['⌘⇧B', '북마크 추가·해제'],
    ],
  },
  {
    title: '편집',
    items: [
      ['/', '블록 추가(슬래시 메뉴)'],
      ['[[', '노트 링크'],
      ['⌘/', '블록 메뉴'],
      ['⌘D', '블록 복제'],
      ['⌘⇧↑ / ⌘⇧↓', '블록 위·아래로 이동'],
      ['⌘Z / ⌘⇧Z', '되돌리기 / 다시 하기'],
    ],
  },
];

/** 단축키 목록(F1). 운영체제에 맞게 ⌘ 또는 Ctrl 로 보인다. */
export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog shortcuts" role="dialog" aria-modal="true" aria-label="단축키">
        <h2>단축키</h2>
        <div className="shortcuts__grid">
          {GROUPS.map((g) => (
            <section key={g.title}>
              <h3>{g.title}</h3>
              <dl>
                {g.items.map(([k, label]) => (
                  <div key={k}>
                    <dt>
                      <kbd>{keys(k)}</kbd>
                    </dt>
                    <dd>{label}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
        <div className="dialog__actions">
          <button className="primary" onClick={onClose}>
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}
