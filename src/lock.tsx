// Schermata "codice di accesso" per la versione pubblica su GitHub Pages.
//
// È un lucchetto di cortesia lato client (i DATI non sono mai online: vivono
// solo in IndexedDB del dispositivo — su Pages c'è solo l'app vuota).
// Il codice non è nel sorgente: qui c'è solo il suo hash cyrb53.
// Per cambiarlo: node -e "<cyrb53>; console.log(cyrb53('seriality::NUOVOCODICE'))"
// e aggiorna LOCK_HASH.
//
// Attivo solo su *.github.io (in locale/LAN niente lucchetto); ?lock=1 per provarlo.

import { useState } from 'react';

const LOCK_HASH = '19qoduywacd';
const LOCK_SALT = 'seriality::';
const LS_KEY = 'seriality-unlock';

const cyrb53 = (str: string, seed = 0): string => {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
};

export function lockActive(): boolean {
  const forced = location.search.includes('lock=1');
  const isPublic = location.hostname.endsWith('github.io');
  if (!isPublic && !forced) return false;
  return localStorage.getItem(LS_KEY) !== LOCK_HASH;
}

export function LockScreen({ onUnlock }: { onUnlock: () => void }) {
  const [code, setCode] = useState('');
  const [wrong, setWrong] = useState(false);

  const tryUnlock = () => {
    if (cyrb53(LOCK_SALT + code.trim()) === LOCK_HASH) {
      localStorage.setItem(LS_KEY, LOCK_HASH);
      onUnlock();
    } else {
      setWrong(true);
      setCode('');
      setTimeout(() => setWrong(false), 1200);
    }
  };

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', gap: 18, padding: 24,
    }}>
      <div className="brand" style={{ fontSize: 42, padding: 0 }}>Seriality</div>
      <div style={{ color: 'var(--text-dim)', textAlign: 'center' }}>
        🔐 Inserisci il codice di accesso
      </div>
      <div style={{ display: 'flex', gap: 10, width: '100%', maxWidth: 320 }}>
        <input
          type="password" inputMode="numeric" autoFocus
          placeholder={wrong ? 'Codice errato 😅' : 'Codice'}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && tryUnlock()}
          style={wrong ? { borderColor: '#ff5c5c' } : undefined}
        />
        <button className="btn primary" onClick={tryUnlock}>Entra</button>
      </div>
      <div style={{ color: 'var(--text-dim)', fontSize: 12, maxWidth: 340, textAlign: 'center', opacity: 0.7 }}>
        I tuoi dati non sono su questo sito: vivono solo sul tuo dispositivo.
      </div>
    </div>
  );
}
