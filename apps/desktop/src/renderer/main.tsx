import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ErrorBoundary } from './ErrorBoundary';
import './styles.css';
import { applyTheme, loadTheme } from './theme';
import { applyPrefs, loadPrefs } from './prefs';
import { initLanguage, watchLanguage } from './language';

applyTheme(loadTheme());
applyPrefs(loadPrefs(), false);
document.documentElement.dataset.platform = /Mac/i.test(navigator.userAgent) ? 'mac' : 'other';

// 언어를 먼저 정하고 첫 렌더를 그린다(한국어로 그렸다가 영어로 바뀌는 깜빡임 방지).
void (async () => {
  await initLanguage();
  watchLanguage();
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </StrictMode>,
  );
})();
