import { useEffect, useState } from 'react';
import {
  cloudConfigured, hasPassphrase, lastCloudSync, listVersions,
  pushBackup, restoreFromCloud, setPassphrase, type CloudVersion,
} from './cloud';
import { askConfirm, fmtDate, toast } from './components';
import { enrichAll } from './tvmaze';
import { enrichMovies } from './tmdb';

const fmtBytes = (b: number) => `${(b / 1024 / 1024).toFixed(1)} MB`;
const fmtWhen = (iso?: string) => (iso ? `${fmtDate(iso.slice(0, 10))}, ore ${iso.slice(11, 16)}` : 'mai');

export default function CloudBackup() {
  const [pass, setPass] = useState(hasPassphrase());
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState('');
  const [sync, setSync] = useState<string | undefined>();
  const [versions, setVersions] = useState<CloudVersion[] | null>(null);

  useEffect(() => { void lastCloudSync().then(setSync); }, [busy]);

  if (!cloudConfigured()) {
    return (
      <p style={{ color: 'var(--text-dim)' }}>
        Questa build non ha un progetto Supabase configurato: mancano
        <code> VITE_SUPABASE_URL</code> e <code> VITE_SUPABASE_KEY</code> in <code>.env.local</code>.
        Funziona tutto il resto, ma il backup automatico è spento.
      </p>
    );
  }

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    try {
      await fn();
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy('');
    }
  };

  return (
    <>
      <p style={{ color: 'var(--text-dim)' }}>
        L'archivio viene caricato <b>cifrato</b> a ogni apertura dell'app, se è cambiato qualcosa.
        La passphrase non lascia mai il telefono: è lei a cifrare i dati, quindi
        <b> se la dimentichi il backup non è recuperabile</b>. Scrivila da qualche parte.
      </p>

      <div className="search-bar" style={{ maxWidth: 560 }}>
        <input
          type="password" value={draft} onChange={(e) => setDraft(e.target.value)}
          placeholder={pass ? '••••••••  (scrivi per sostituirla)' : 'La tua passphrase (min. 8 caratteri)'}
        />
        <button
          className="btn primary" disabled={draft.trim().length < 8}
          onClick={() => {
            setPassphrase(draft.trim());
            setDraft('');
            setPass(true);
            setVersions(null);
            toast('Passphrase salvata 🔐');
          }}
        >Salva</button>
      </div>
      <p style={{ color: 'var(--text-dim)', fontSize: 13, margin: '8px 0 14px' }}>
        {pass ? `🔐 Attiva · ultimo caricamento: ${fmtWhen(sync)}` : 'Senza passphrase il backup automatico resta spento.'}
      </p>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <button
          className="btn primary" disabled={!pass || !!busy}
          onClick={() => run('push', async () => {
            const { versions: n, bytes } = await pushBackup();
            toast(`Caricato ☁️ ${fmtBytes(bytes)} · ${n} versioni online`);
          })}
        >{busy === 'push' ? 'Carico…' : '☁️ Sincronizza adesso'}</button>

        <button
          className="btn" disabled={!pass || !!busy}
          onClick={() => run('list', async () => setVersions(await listVersions()))}
        >{busy === 'list' ? 'Cerco…' : '🕓 Versioni online'}</button>

        {pass && (
          <button
            className="btn" disabled={!!busy}
            onClick={() => { setPassphrase(''); setPass(false); setVersions(null); toast('Passphrase rimossa'); }}
          >Dimentica passphrase</button>
        )}
      </div>

      {versions && (
        <div className="report" style={{ marginTop: 16 }}>
          <b>Backup online</b>
          {versions.length === 0 ? (
            <p style={{ color: 'var(--text-dim)', margin: '8px 0 0' }}>
              Nessun backup per questa passphrase. Se ne avevi uno, hai scritto una passphrase diversa.
            </p>
          ) : (
            <ul>
              {versions.map((v) => (
                <li key={v.created_at} style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ flex: 1, minWidth: 200 }}>
                    <b style={{ color: 'var(--text)' }}>{fmtWhen(v.created_at)}</b>
                    {' — '}{v.meta.shows} serie · {v.meta.watched} episodi visti · {v.meta.movies} film
                    {' '}<span style={{ opacity: 0.6 }}>({fmtBytes(v.bytes)})</span>
                  </span>
                  <button
                    className="btn" disabled={!!busy}
                    onClick={() => run('restore', async () => {
                      const ok = await askConfirm({
                        title: 'Ripristinare questa versione?',
                        body: 'I titoli presenti qui verranno riportati allo stato del backup. '
                          + 'Quello che hai segnato dopo quella data va perso.',
                        yes: 'Ripristina',
                      });
                      if (!ok) return;
                      const data = await restoreFromCloud(v.created_at);
                      toast(`Ripristinate ${data.shows.length} serie e ${data.movies.length} film 💜`);
                      void enrichAll();
                      void enrichMovies();
                    })}
                  >Ripristina</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <details style={{ marginTop: 16, color: 'var(--text-dim)' }}>
        <summary style={{ cursor: 'pointer' }}>Il sync dice che è bloccato?</summary>
        <p style={{ marginBottom: 8 }}>
          Succede quando l'archivio locale è vuoto o molto più povero di quello online: è la
          protezione che impedisce a una libreria appena cancellata di sovrascrivere il backup buono.
          Se hai svuotato la libreria apposta e vuoi che il cloud rispecchi questo stato, forza il caricamento.
        </p>
        <button
          className="btn danger" disabled={!pass || !!busy}
          onClick={() => run('force', async () => {
            const ok = await askConfirm({
              title: 'Forzare il caricamento?',
              body: 'Carico lo stato attuale anche se è più povero di quello online. '
                + 'Le versioni precedenti restano disponibili qui sopra.',
              yes: 'Forza',
            });
            if (!ok) return;
            const { versions: n } = await pushBackup(true);
            toast(`Caricato ☁️ · ${n} versioni online`);
          })}
        >Forza caricamento</button>
      </details>
    </>
  );
}
