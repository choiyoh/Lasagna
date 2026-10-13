import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';
import { applyTheme, loadTheme } from './theme';

applyTheme(loadTheme());
document.documentElement.dataset.platform = /Mac/i.test(navigator.userAgent) ? 'mac' : 'other';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
