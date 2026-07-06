import { useState } from 'react';
import { Empty, Poster, nav } from './components';
import { hasGemini, recommendMoviesAI, recommendShowsAI, type AiPick } from './ai';
import { hasTmdb } from './tmdb';

const QUICK: Record<'tv' | 'movie', string[]> = {
  tv: [
    'Un thriller coreano corto e teso',
    'Qualcosa di leggero per staccare',
    'Un fantasy epico da bingeare',
    'Una commedia romantica che fa stare bene',
  ],
  movie: [
    'Un film che fa piangere ma bene',
    'Un thriller col colpo di scena finale',
    'Una commedia romantica leggera',
    'Un capolavoro visivo da vedere assolutamente',
  ],
};

const scoreColor = (s: number) => (s >= 85 ? 'var(--green)' : s >= 70 ? 'var(--gold)' : 'var(--text-dim)');

export default function AiPanel() {
  const [target, setTarget] = useState<'tv' | 'movie'>('tv');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [picks, setPicks] = useState<AiPick[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const switchTarget = (t: 'tv' | 'movie') => {
    if (t === target) return;
    setTarget(t);
    setPicks(null);
    setError(null);
  };

  const ask = async (text: string) => {
    const query = text.trim();
    if (!query) return;
    setQ(query);
    setBusy(true);
    setError(null);
    try {
      const res = target === 'tv' ? await recommendShowsAI(query) : await recommendMoviesAI(query);
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
      <div className="chip-row" style={{ marginBottom: 12 }}>
        <button className={`chip ${target === 'tv' ? 'active' : ''}`} onClick={() => switchTarget('tv')}>📺 Serie</button>
        <button className={`chip ${target === 'movie' ? 'active' : ''}`} onClick={() => switchTarget('movie')}>🍿 Film</button>
      </div>
      <div className="search-bar">
        <input
          type="search" placeholder={target === 'tv' ? 'Che serie ti va di guardare?…' : 'Che film ti va di vedere?…'}
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
            {QUICK[target].map((s) => (
              <button key={s} className="chip" onClick={() => void ask(s)}>{s}</button>
            ))}
          </div>
          <Empty icon={target === 'tv' ? '📺' : '🍿'} title="Cosa guardo stasera?">
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
            <div className="ai-card" key={p.id} onClick={() => nav(`/preview/${target}/${p.id}`)}>
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
