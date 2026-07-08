import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, nowIso } from '../db';
import { Empty, Poster, Stars, fmtDate, nav, toast } from '../components';
import { displayTitle } from '../korean';
import type { Movie } from '../types';

export default function Movies() {
  const [tab, setTab] = useState<'watchlist' | 'watched' | 'favorites'>('watchlist');
  const [q, setQ] = useState('');
  const movies = useLiveQuery(() => db.movies.toArray());
  if (!movies) return null;

  const filtered = movies
    .filter((m) => {
      if (q && !m.name.toLowerCase().includes(q.toLowerCase())) return false;
      if (tab === 'watched') return !!m.watched;
      if (tab === 'favorites') return !!m.favorite;
      return !m.watched;
    })
    .sort((a, b) =>
      tab === 'watched'
        ? (b.watchedAt ?? '').localeCompare(a.watchedAt ?? '')
        : a.name.localeCompare(b.name));

  const toggleWatched = async (m: Movie) => {
    await db.movies.update(m.key, {
      watched: m.watched ? 0 : 1,
      watchedAt: m.watched ? undefined : nowIso(),
    });
    toast(m.watched ? 'Rimesso in watchlist' : `✓ ${m.name} visto!`);
  };

  const counts = {
    watchlist: movies.filter((m) => !m.watched).length,
    watched: movies.filter((m) => m.watched).length,
    favorites: movies.filter((m) => m.favorite).length,
  };

  return (
    <>
      <h1 className="page-title">Film</h1>
      <p className="page-sub">{movies.length} film tracciati.</p>
      <div className="search-bar">
        <input type="search" placeholder="Cerca tra i tuoi film…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="chip-row">
        <button className={`chip ${tab === 'watchlist' ? 'active' : ''}`} onClick={() => setTab('watchlist')}>
          Da vedere<span className="count">{counts.watchlist}</span>
        </button>
        <button className={`chip ${tab === 'watched' ? 'active' : ''}`} onClick={() => setTab('watched')}>
          Visti<span className="count">{counts.watched}</span>
        </button>
        <button className={`chip ${tab === 'favorites' ? 'active' : ''}`} onClick={() => setTab('favorites')}>
          ❤️ Preferiti<span className="count">{counts.favorites}</span>
        </button>
      </div>
      {filtered.length === 0 ? (
        <Empty icon="🍿" title="Nessun film qui" />
      ) : (
        <div className="poster-grid">
          {filtered.map((m) => (
            <div className="poster-card" key={m.key} onClick={() => nav(`/movie/${encodeURIComponent(m.key)}`)}>
              <Poster src={m.poster} name={m.name} />
              {m.favorite && <div className="fav">❤️</div>}
              <div className="meta">
                <div className="name" title={m.name}>{displayTitle(m.name)}</div>
                <div className="sub">
                  {m.watched ? `Visto ${fmtDate(m.watchedAt)}` : (m.releaseDate?.slice(0, 4) ?? '')}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 7 }}>
                  <Stars value={m.rating} onChange={(v) => db.movies.update(m.key, { rating: v || undefined })} />
                  <button
                    className={`check-btn small ${m.watched ? '' : 'off'}`}
                    title={m.watched ? 'Visto' : 'Segna come visto'}
                    onClick={(e) => { e.stopPropagation(); void toggleWatched(m); }}
                  >✓</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
