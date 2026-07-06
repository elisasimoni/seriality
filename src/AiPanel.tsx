import { useState } from 'react';
import { Empty, Poster, nav } from './components';
import { hasGemini, recommendShowsAI, type AiPick } from './ai';
import { hasTmdb } from './tmdb';

const QUICK = [
  'Un thriller coreano corto e teso',
  'Qualcosa di leggero per staccare',
  'Un fantasy epico da bingeare',
  'Una commedia romantica che fa stare bene',
  'Un mystery con un colpo di scena',
];

const scoreColor = (s: number) => (s >= 85 ? 'var(--green)' : s >= 70 ? 'var(--gold)' : 'var(--text-dim)');

export default function AiPanel() {
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [picks, setPicks] = useState<AiPick[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const ask = async (text: string) => {
    const query = text.trim();
    if (!query) return;
    setQ(query);
    setBusy(true);
    setError(null);
    try {
      const res = await recommendShowsAI(query);
      setPicks(res.picks);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Errore imprevisto');
      setPicks(null);
    } finally {
      setBusy(false);
    }
  };

  if (!hasGemini() || !hasTmdb()) {
    return (
      <Empty icon="🤖" title="Attiva i consigli AI">
        Serve una chiave <b>Gemini gratuita</b>{!hasTmdb() && ' e una chiave TMDB'}.
        Aggiungila nelle <a href="#/settings" style={{ color: 'var(--accent)' }}>Impostazioni</a>.
      </Empty>
    );
  }

  return (
    <>
      <div className="search-bar">
        <input
          type="search" placeholder="Descrivi cosa ti va di guardare…"
          value={q} onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void ask(q)}
          autoFocus
        />
        <button className="btn primary" disabled={busy} onClick={() => void ask(q)}>
          {busy ? '…' : '✨ Consiglia'}
        </button>
      </div>

      {picks === null && !busy && (
        <>
          <div className="chip-row">
            {QUICK.map((s) => (
              <button key={s} className="chip" onClick={() => void ask(s)}>{s}</button>
            ))}
          </div>
          <Empty icon="🍿" title="Cosa guardo stasera?">
            Scrivi un'idea (mood, tema, durata…) o tocca uno spunto qui sopra.
            Terrò conto dei tuoi gusti ed escluderò ciò che hai già visto.
          </Empty>
        </>
      )}

      {busy && <p style={{ color: 'var(--text-dim)' }}>Sto pensando ai consigli migliori per te… 🔮</p>}

      {error && (
        <Empty icon="⚠️" title="Qualcosa è andato storto">
          {error}. Controlla la chiave nelle <a href="#/settings" style={{ color: 'var(--accent)' }}>Impostazioni</a>.
        </Empty>
      )}

      {picks && picks.length === 0 && !busy && (
        <Empty icon="🤔" title="Nessun match convincente">Prova a riformulare la richiesta.</Empty>
      )}

      {picks && picks.length > 0 && (
        <div className="ai-list">
          {picks.map((p) => (
            <div className="ai-card" key={p.id} onClick={() => nav(`/preview/tv/${p.id}`)}>
              <div className="ai-poster"><Poster src={p.poster} name={p.title} /></div>
              <div className="ai-body">
                <div className="ai-head">
                  <span className="ai-title">{p.title}</span>
                  <span className="ai-score" style={{ color: scoreColor(p.matchScore) }}>{p.matchScore}%</span>
                </div>
                <div className="ai-meta">
                  {[p.year, p.genres.slice(0, 2).join(' · '), p.rating ? `★ ${p.rating}` : '']
                    .filter(Boolean).join('  ·  ')}
                </div>
                <p className="ai-reason">{p.reason}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
