import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';
import { parseFiles, applyImport } from './ingest';
import { enrichAll } from './tvmaze';
import { db } from './db';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// PWA: service worker per l'uso offline (richiede https oppure localhost)
if ('serviceWorker' in navigator
  && (location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname))) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {});
  });
}

// Hook di sviluppo/test: permette di importare dati senza passare dal file picker
// (usato anche dai test end-to-end). Es: __seriality.importText('x.csv', '...')
declare global {
  interface Window {
    __seriality: {
      importText: (name: string, text: string) => Promise<unknown>;
      importBuffer: (name: string, data: ArrayBuffer) => Promise<unknown>;
      db: typeof db;
      enrichAll: typeof enrichAll;
    };
  }
}
window.__seriality = {
  importText: async (name: string, text: string) => {
    const parsed = await parseFiles([{ name, data: new TextEncoder().encode(text).buffer as ArrayBuffer }]);
    const stats = await applyImport(parsed);
    return { report: parsed.report, stats };
  },
  importBuffer: async (name: string, data: ArrayBuffer) => {
    const parsed = await parseFiles([{ name, data }]);
    const stats = await applyImport(parsed);
    return { report: parsed.report, stats };
  },
  db,
  enrichAll,
};
