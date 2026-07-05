import { useState } from 'react';
import { db, exportBackup, wipeAll } from '../db';
import { toast } from '../components';
import { enrichAll } from '../tvmaze';
import { enrichMovies, hasTmdb, tmdbKey } from '../tmdb';

export default function Settings() {
  const [busy, setBusy] = useState(false);

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
