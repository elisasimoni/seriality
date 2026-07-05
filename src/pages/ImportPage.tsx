import { useRef, useState } from 'react';
import { parseFiles, applyImport, type ApplyStats, type ParseOutput } from '../ingest';
import { enrichAll } from '../tvmaze';
import { enrichMovies } from '../tmdb';

type Phase = 'idle' | 'parsing' | 'done';

export default function ImportPage() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [over, setOver] = useState(false);
  const [parsed, setParsed] = useState<ParseOutput | null>(null);
  const [stats, setStats] = useState<ApplyStats | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = async (list: FileList | File[]) => {
    const files = await Promise.all(
      [...list].map(async (f) => ({ name: f.name, data: await f.arrayBuffer() })),
    );
    setPhase('parsing');
    try {
      const out = await parseFiles(files);
      setParsed(out);
      const st = await applyImport(out);
      setStats(st);
      setPhase('done');
      // in background: liste episodi (TVmaze) + poster/dati film mancanti (TMDB)
      void enrichAll();
      void enrichMovies();
    } catch (err) {
      setParsed({ shows: [], episodeWatches: [], movies: [], report: [`❌ Errore durante l'import: ${err}`] });
      setPhase('done');
    }
  };

  return (
    <>
      <h1 className="page-title">Importa da TV Time</h1>
      <p className="page-sub">
        Carica un salvataggio di <b>TV Time</b> (zip export GDPR, CSV, JSON dell'API),
        di <b>CineTrak</b> (CSV/JSON), di <b>Letterboxd</b> o un backup di Seriality.
        Riconosco il formato da sola. 💜
      </p>

      <div
        className={`dropzone ${over ? 'over' : ''}`}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); void handleFiles(e.dataTransfer.files); }}
      >
        <div className="icon">{phase === 'parsing' ? '⏳' : '📤'}</div>
        {phase === 'parsing' ? (
          <h3>Sto leggendo i tuoi dati…</h3>
        ) : (
          <>
            <h3 style={{ margin: '0 0 6px' }}>Trascina qui il tuo export TV Time</h3>
            <div style={{ color: 'var(--text-dim)' }}>oppure clicca per scegliere i file (.zip, .csv, .json)</div>
          </>
        )}
        <input
          ref={inputRef} type="file" multiple hidden
          accept=".zip,.csv,.json,.txt"
          onChange={(e) => e.target.files?.length && void handleFiles(e.target.files)}
        />
      </div>

      {phase === 'done' && parsed && (
        <div className="report">
          <b>Report import</b>
          <ul>{parsed.report.map((r, i) => <li key={i}>{r}</li>)}</ul>
          {stats && (stats.shows + stats.episodes + stats.movies + stats.legacy > 0) && (
            <>
              <div className="stat-pills">
                <div className="stat-pill"><b>{stats.shows}</b><span>serie</span></div>
                <div className="stat-pill"><b>{stats.episodes}</b><span>episodi visti</span></div>
                <div className="stat-pill"><b>{stats.movies}</b><span>film</span></div>
                {stats.legacy > 0 && <div className="stat-pill"><b>{stats.legacy}</b><span>visioni legacy da mappare</span></div>}
              </div>
              <p style={{ color: 'var(--text-dim)', marginBottom: 0 }}>
                ✨ Sto scaricando poster e liste episodi in background (vedi barra nella sidebar).
                {stats.legacy > 0 && ' Le visioni "legacy" verranno assegnate agli episodi in ordine di messa in onda appena i dati arrivano.'}
                {' '}<a href="#/" style={{ color: 'var(--accent)' }}>Vai a "Da guardare" →</a>
              </p>
            </>
          )}
        </div>
      )}

      <div className="report" style={{ marginTop: 30 }}>
        <b>Come ottenere i tuoi dati</b>
        <ul style={{ listStyle: 'disc', paddingLeft: 20 }}>
          <li><b>TV Time</b>: app → Profilo → Impostazioni → <i>Request my data</i>: riceverai uno zip via email. Caricalo qui così com'è.</li>
          <li><b>TV Time (più veloce, finché i server rispondono)</b>: esegui <code>python3 tools/export_from_api.py</code> in questo progetto — usa il token del tuo tvtime-mcp e genera <code>seriality-export.json</code> completo.</li>
          <li><b>CineTrak</b>: app → Profilo → ⚙️ Impostazioni → <i>Esporta dati / Backup</i> → CSV (o JSON). Carica qui i file esportati (film e, se ci sono, serie): poster e durate mancanti arrivano poi da TMDB in automatico.</li>
        </ul>
      </div>
    </>
  );
}
