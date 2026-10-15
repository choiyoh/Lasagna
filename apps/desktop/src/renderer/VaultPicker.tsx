import { useEffect, useState } from 'react';
import type { VaultInfo } from '@nopsidian/ipc-contract';
import { Logo } from './Logo';
import { applyTheme, loadTheme, nextTheme, THEME_ICON, THEME_LABEL, type ThemeChoice } from './theme';

export function VaultPicker({ onOpen }: { onOpen: (v: VaultInfo) => void }) {
  const [recent, setRecent] = useState<VaultInfo[]>([]);
  const [error, setError] = useState('');
  const [theme, setTheme] = useState<ThemeChoice>(() => loadTheme());
  useEffect(() => {
    void window.nops.vault.listRecent().then(setRecent);
  }, []);

  const run = async (fn: () => Promise<VaultInfo | null>) => {
    try {
      const v = await fn();
      if (v) onOpen(v);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <main className="start">
      <div className="start__drag drag" />
      <button
        className="start__theme"
        title={`테마: ${THEME_LABEL[theme]} (눌러서 바꾸기)`}
        aria-label={`테마 ${THEME_LABEL[theme]}`}
        onClick={() => {
          const next = nextTheme(theme);
          applyTheme(next);
          setTheme(next);
        }}
      >
        {THEME_ICON[theme]}
      </button>
      <div className="start__card">
        <Logo size={88} />
        <h1>Nopsidian</h1>
        <p className="start__tagline">내 컴퓨터의 Markdown 폴더가 곧 노트가 됩니다.</p>
        <button className="primary start__cta" onClick={() => run(() => window.nops.vault.pick())}>
          폴더 열기 / 만들기
        </button>
        <p className="start__hint">기존 Obsidian 볼트나 Markdown 폴더도 그대로 열 수 있어요. 파일을 옮기거나 복사하지 않아요.</p>
        {error && <p className="error">{error}</p>}
        {recent.length > 0 ? (
          <section className="start__recent" aria-label="최근 볼트">
            <h2>최근 볼트</h2>
            <ul className="recent">
              {recent.map((v) => (
                <li key={v.id}>
                  <button onClick={() => run(() => window.nops.vault.open({ id: v.id }))}>
                    <span className="recent__icon" aria-hidden>📁</span>
                    <span className="recent__text">
                      <strong>{v.name}</strong>
                      <span className="muted recent__path" title={v.path}>{v.path}</span>
                    </span>
                    <span className="recent__go" aria-hidden>열기 →</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : (
          <ul className="start__features" aria-label="주요 기능">
            <li><strong>블록 편집기</strong><span>슬래시(/)로 제목·표·콜아웃·수식을 바로 넣어요</span></li>
            <li><strong>링크와 그래프</strong><span>[[위키링크]]와 백링크, 노트가 서로 이어진 모습을 그래프로 보여 줘요</span></li>
            <li><strong>데이터베이스</strong><span>속성이 있는 노트를 표·보드·캘린더로 한눈에 봐요</span></li>
          </ul>
        )}
      </div>
    </main>
  );
}
