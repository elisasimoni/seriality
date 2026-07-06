import { useState } from 'react';
import { db, exportBackup, wipeAll } from '../db';
import { toast } from '../components';
import { enrichAll } from '../tvmaze';
import { enrichMovies, hasTmdb } from '../tmdb';
import { hasGemini } from '../ai';

// Paesi selezionabili come "focus" (come TvChoicer)
const COUNTRIES = [
  { code: 'KR', name: 'Corea del Sud' }, { code: 'JP', name: 'Giappone' },
  { code: 'CN', name: 'Cina' }, { code: 'TW', name: 'Taiwan' }, { code: 'TH', name: 'Thailandia' },
  { code: 'US', name: 'Stati Uniti' }, { code: 'GB', name: 'Regno Unito' }, { code: 'IT', name: 'Italia' },
  { code: 'ES', name: 'Spagna' }, { code: 'FR', name: 'Francia' }, { code: 'DE', name: 'Germania' },
  { code: 'IN', name: 'India' }, { code: 'BR', name: 'Brasile' }, { code: 'TR', name: 'Turchia' },
];

export default function Settings() {
  const [busy, setBusy] = useState(false);
  const [, setTick] = useState(0); // forza re-render dopo salvataggio chiavi

  const download = async () => {
    setBusy(true);
    const json = await exportBackup();
    const blob = new Blob([json], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `seriality-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    setBusy(false);
    toast('Backup scaricato 💾');
  };

  return (
    <>
      <h1 className="page-title">Impostazioni</h1>
      <p className="page-sub">I tuoi dati vivono solo qui, nel browser. Niente account, niente cloud.</p>

      <h2 className="section-title">💾 Backup</h2>
      <p style={{ color: 'var(--text-dim)' }}>
        Scarica tutto il tuo archivio come JSON. Puoi ricaricarlo dalla pagina Importa
        (anche su un altro computer): è il tuo salvataggio, per sempre.
      </p>
      <button className="btn primary" disabled={busy} onClick={() => void download()}>⬇️ Scarica backup completo</button>

      <h2 className="section-title">🔄 Aggiornamenti</h2>
      <p style={{ color: 'var(--text-dim)' }}>
        <b style={{ color: 'var(--green)' }}>✓ Automatici:</b> a ogni avvio (e ogni 12 ore se l'app resta aperta)
        Seriality aggiorna da sola le serie in corso — nuovi episodi e date compaiono in
        "In arrivo" senza fare nulla. Qui sotto i comandi manuali, se vuoi forzare.
      </p>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <button className="btn" onClick={() => { void enrichAll('auto'); toast('Aggiornamento avviato (serie in corso + nuove)'); }}>
          Aggiorna adesso
        </button>
        <button className="btn" onClick={() => { void enrichAll(true); toast('Aggiornamento completo avviato'); }}>
          Riaggiorna tutte le serie
        </button>
        <button className="btn" disabled={!hasTmdb()} onClick={() => { void enrichMovies(); toast('Completamento film avviato'); }}>
          Completa dati film (TMDB)
        </button>
      </div>

      <h2 className="section-title">🎬 TMDB (film)</h2>
      <p style={{ color: 'var(--text-dim)' }}>
        {hasTmdb()
          ? <>Chiave attiva ({localStorage.getItem('seriality-tmdb-key') ? 'personalizzata' : 'riusata dal progetto TvChoicer'}). Serve per cercare film e completare poster/durate degli import CineTrak.</>
          : <>Nessuna chiave: la ricerca film e il completamento dati sono disattivati. Prendine una gratis su themoviedb.org/settings/api.</>}
      </p>
      <div className="search-bar" style={{ maxWidth: 560 }}>
        <input
          type="password" placeholder={hasTmdb() ? '••••••••  (incolla per sostituire)' : 'Incolla qui la chiave TMDB (v3 o v4)'}
          onChange={(e) => {
            const v = e.target.value.trim();
            if (v) { localStorage.setItem('seriality-tmdb-key', v); toast('Chiave TMDB salvata ✓'); }
          }}
        />
        {localStorage.getItem('seriality-tmdb-key') && (
          <button className="btn" onClick={() => { localStorage.removeItem('seriality-tmdb-key'); toast('Torno alla chiave di TvChoicer'); }}>
            Ripristina
          </button>
        )}
      </div>

      <h2 className="section-title">🤖 Consigli AI (Gemini)</h2>
      <p style={{ color: 'var(--text-dim)' }}>
        Attiva il "cosa guardo?" intelligente in Scopri: descrivi cosa ti va e l'AI
        sceglie serie con motivazione, tenendo conto dei tuoi gusti ed escludendo ciò che hai già.
        {hasGemini()
          ? <> <b style={{ color: 'var(--green)' }}>✓ Chiave attiva.</b></>
          : <> Serve una chiave <b>gratuita</b>: creala su aistudio.google.com/apikey e incollala qui.</>}
      </p>
      <div className="search-bar" style={{ maxWidth: 560 }}>
        <input
          type="password" placeholder={hasGemini() ? '••••••••  (incolla per sostituire)' : 'Incolla qui la chiave Gemini (gratuita)'}
          onChange={(e) => {
            const v = e.target.value.trim();
            if (v) { localStorage.setItem('seriality-gemini-key', v); toast('Chiave Gemini salvata ✓'); setTick((t) => t + 1); }
          }}
        />
        {hasGemini() && (
          <button className="btn" onClick={() => { localStorage.removeItem('seriality-gemini-key'); toast('Chiave rimossa'); setTick((t) => t + 1); }}>
            Rimuovi
          </button>
        )}
      </div>
      <div style={{ display: 'grid', gap: 10, maxWidth: 560, marginTop: 12 }}>
        <label style={{ fontSize: 13, color: 'var(--text-dim)' }}>
          Nota sui tuoi gusti (opzionale, aiuta i consigli)
          <input
            type="text" defaultValue={localStorage.getItem('seriality-taste') ?? ''}
            placeholder="es. Adoro i k-drama romantici e i thriller lenti, odio l'horror"
            onChange={(e) => localStorage.setItem('seriality-taste', e.target.value)}
            style={{ marginTop: 5, width: '100%' }}
          />
        </label>
        <label style={{ fontSize: 13, color: 'var(--text-dim)' }}>
          Paese preferito (in primo piano a parità di pertinenza)
          <select
            defaultValue={localStorage.getItem('seriality-country') ?? ''}
            onChange={(e) => localStorage.setItem('seriality-country', e.target.value)}
            style={{ marginTop: 5, width: '100%', background: 'var(--panel)', border: '1px solid var(--border)', color: 'var(--text)', padding: '11px 14px', borderRadius: 12 }}
          >
            <option value="">Automatico (dalla tua libreria)</option>
            {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
          </select>
        </label>
      </div>

      <h2 className="section-title">🧨 Zona pericolosa</h2>
      <button
        className="btn danger"
        onClick={async () => {
          if (!confirm('Cancellare TUTTI i dati di Seriality da questo browser? (fai prima un backup!)')) return;
          await wipeAll();
          await db.kv.clear();
          toast('Tutto cancellato');
        }}
      >🗑 Cancella tutti i dati</button>
    </>
  );
}
