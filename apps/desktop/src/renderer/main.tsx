import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';
import { applyTheme, loadTheme } from './theme';
import { applyPrefs, loadPrefs } from './prefs';

applyTheme(loadTheme());
applyPrefs(loadPrefs(), false);
document.documentElement.dataset.platform = /Mac/i.test(navigator.userAgent) ? 'mac' : 'other';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
