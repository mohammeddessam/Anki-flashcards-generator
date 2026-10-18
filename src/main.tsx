import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Console helpers for manually exercising the browser-only export paths.
// Tree-shaken out of production builds.
if (import.meta.env.DEV) {
  void import('./devtools').then(m => m.installDevTools());
}
