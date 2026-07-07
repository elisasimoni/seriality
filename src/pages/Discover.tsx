import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, normTitle, nowIso } from '../db';
import { Empty, Poster, nav, toast } from '../components';
import { searchShows, tmShowToLocal, enrichShow } from '../tvmaze';
import { findTvByTvdb, hasTmdb, searchMovies, posterUrl, tvExternalIds } from '../tmdb';
import { getRecommendations, type Rec, type RecSection } from '../recommend';
import AiPanel from '../AiPanel';
import { hasGemini } from '../ai';

interface ShowResult {
  id: number; name: string; poster?: string; premiered?: string;
  network?: string; genres?: string[]; localId: number;
}
interface MovieResult {
  tmdbId: number; name: string; poster?: string; year?: string; overview?: string;
}

export default function Discover() {
  const [kind, setKind] = useState<'ai' | 'series' | 'movie'>(hasGemini() ? 'ai' : 'series');
  const [q, setQ] = useState('');
  const [shows, setShows] = useState<ShowResult[] | null>(null);
  const [movies, setMovies] = useState<MovieResult[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [recs, setRecs] = useState<RecSection[] | null>(null);
  const [recsLoading, setRecsLoading] = useState(false);
  const [added, setAdded] = useState<Set<string>>(new Set());
  const followedIds = useLiveQuery(async () => new Set((await db.shows.toArray()).map((s) => s.id)));
  const showNames = useLiveQuery(async () =>
    new Set((await db.shows.toArray()).map((s) => normTitle(s.name))));
  const movieKeys = useLiveQuery(async () => {
    const all = await db.movies.toArray();
    return new Set(all.map((m) => m.tmdbId).filter(Boolean));
  });

  const loadRecs = async (force = false) => {
    if (!hasTmdb()) return;
    setRecsLoading(true);
    try { setRecs(await getRecommendations(force)); }
    catch { toast('Errore di rete nel calcolo dei consigli'); }
    finally { setRecsLoading(false); }
  };
  useEffect(() => { void loadRecs(); }, []);

  const search = async () => {
    if (!q.trim()) return;
    setBusy(true);
    try {
      if (kind === 'series') {
        const found = await searchShows(q.trim());
        setShows(found.map((tm) => {
          const local = tmShowToLocal(tm);
          return {
            id: tm.id, name: tm.name, poster: local.poster, premiered: local.premiered,
            network: local.network, genres: local.genres, localId: local.id,
          };
        }));
      } else {
        const found = await searchMovies(q.trim());
        setMovies(found.map((m) => ({
          tmdbId: m.id, name: m.title, poster: posterUrl(m.poster_path),
          year: m.release_date?.slice(0, 4), overview: m.overview,
        })));
      }
    } catch {
      toast('Errore di rete durante la ricerca');
    } finally {
      setBusy(false);
    }
  };

  const followShow = async (r: ShowResult) => {
    if (await db.shows.get(r.localId)) { toast('Già nella tua libreria!'); return; }
    await db.shows.put({
      id: r.localId, name: r.name, poster: r.poster, premiered: r.premiered,
      network: r.network, genres: r.genres, tvmazeId: r.id,
      followedAt: nowIso(), addedAt: nowIso(),
    });
    toast(`➕ ${r.name} aggiunta alla libreria`);
    const show = await db.shows.get(r.localId);
    if (show) void enrichShow(show).catch(() => {});
  };

  // Segui una serie consigliata (TMDB → id TVDB → libreria, fallback ricerca TVmaze per nome)
  const followRec = async (r: Rec) => {
    const ext = await tvExternalIds(r.tmdbId);
    let localId = ext.tvdb_id ?? undefined;
    if (!localId) {
      try {
        const found = await searchShows(r.name);
        if (found[0]) localId = tmShowToLocal(found[0]).id;
      } catch { /* rete */ }
    }
    if (!localId) { toast('Non riesco ad agganciare questa serie, prova dalla ricerca'); return; }
    if (await db.shows.get(localId)) { toast('Già nella tua libreria!'); return; }
    await db.shows.put({
      id: localId, name: r.name, poster: r.poster,
      premiered: r.year ? `${r.year}-01-01` : undefined,
      followedAt: nowIso(), addedAt: nowIso(),
    });
    setAdded((prev) => new Set(prev).add(`tv:${r.tmdbId}`));
    toast(`➕ ${r.name} aggiunta alla libreria`);
    const show = await db.shows.get(localId);
    if (show) void enrichShow(show).catch(() => {});
  };

  const addRecMovie = async (r: Rec, watched: boolean) => {
    await addMovie({ tmdbId: r.tmdbId, name: r.name, poster: r.poster, year: r.year, overview: r.overview }, watched);
    setAdded((prev) => new Set(prev).add(`movie:${r.tmdbId}`));
  };

  const addMovie = async (r: MovieResult, watched: boolean) => {
    const key = `tmdb:${r.tmdbId}`;
    const existing = await db.movies.get(key);
    if (existing) {
      await db.movies.update(key, { watched: watched ? 1 : existing.watched, watchedAt: watched ? nowIso() : existing.watchedAt });
    } else {
      await db.movies.put({
        key, name: r.name, tmdbId: r.tmdbId, poster: r.poster, overview: r.overview,
        releaseDate: r.year ? `${r.year}-01-01` : undefined,
        watched: watched ? 1 : 0, watchedAt: watched ? nowIso() : undefined, followedAt: nowIso(),
      });
    }
    toast(watched ? `✓ ${r.name} segnato come visto` : `➕ ${r.name} in watchlist`);
  };

  return (
    <>
      <h1 className="page-title">Scopri</h1>
      <p className="page-sub">Consigli AI, oppure cerca serie e film per nome.</p>
      <div className="chip-row">
        <button className={`chip ${kind === 'ai' ? 'active' : ''}`} onClick={() => setKind('ai')}>🤖 AI</button>
        <button className={`chip ${kind === 'series' ? 'active' : ''}`} onClick={() => setKind('series')}>📺 Serie</button>
        <button className={`chip ${kind === 'movie' ? 'active' : ''}`} onClick={() => setKind('movie')}>🍿 Film</button>
      </div>

      {kind === 'ai' && <AiPanel />}

      {kind !== 'ai' && <div className="search-bar">
        <input
          type="search" placeholder={kind === 'series' ? 'Cerca una serie… (es. Severance)' : 'Cerca un film… (es. Parasite)'}
          value={q} onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void search()}
          autoFocus
        />
        <button className="btn primary" disabled={busy} onClick={() => void search()}>
          {busy ? '…' : '🔍 Cerca'}
        </button>
      </div>}

      {kind === 'movie' && !hasTmdb() && (
        <Empty icon="🔑" title="Chiave TMDB mancante">
          Aggiungi la chiave nelle <a href="#/settings" style={{ color: 'var(--accent)' }}>Impostazioni</a> per cercare i film.
        </Empty>
      )}

      {/* ✨ Consigliati per te — visibili quando non c'è una ricerca attiva */}
      {kind !== 'ai' && (kind === 'series' ? shows === null : movies === null) && hasTmdb() && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 6 }}>
            <h2 className="section-title" style={{ margin: 0 }}>✨ Consigliati per te</h2>
            <button className="btn" style={{ padding: '5px 12px', fontSize: 12 }}
              disabled={recsLoading} onClick={() => void loadRecs(true)}>
              {recsLoading ? '…' : '🔄 Rigenera'}
            </button>
          </div>
          <p className="page-sub" style={{ marginTop: 4 }}>
            In base ai tuoi preferiti, ai voti e a cosa hai guardato di recente. Si aggiornano ogni 12 ore.
          </p>
          {recsLoading && !recs?.length && <p style={{ color: 'var(--text-dim)' }}>Sto studiando i tuoi gusti… 🔮</p>}
          {recs?.map((sec) => (
            <div key={sec.title}>
              <h3 className="rec-title">{sec.title}</h3>
              <div className="rec-row">
                {sec.items.map((r) => {
                  const k = `${r.kind}:${r.tmdbId}`;
                  const inLib = added.has(k)
                    || (r.kind === 'movie' && movieKeys?.has(r.tmdbId))
                    || (r.kind === 'tv' && showNames?.has(normTitle(r.name)));
                  return (
                    <div className="poster-card" key={k} title={r.overview}
                      onClick={() => nav(`/preview/${r.kind}/${r.tmdbId}`)}>
                      <Poster src={r.poster} name={r.name} />
                      <div className="meta">
                        <div className="name" title={r.name}>{r.name}</div>
                        <div className="sub">
                          {r.kind === 'tv' ? '📺' : '🍿'} {r.year ?? ''}{r.vote ? ` · ★ ${r.vote.toFixed(1)}` : ''}
                        </div>
                        {inLib ? (
                          <button className="btn" disabled style={{ width: '100%', marginTop: 8, justifyContent: 'center', padding: '6px 0' }}>✓ In libreria</button>
                        ) : r.kind === 'tv' ? (
                          <button className="btn primary" style={{ width: '100%', marginTop: 8, justifyContent: 'center', padding: '6px 0' }}
                            onClick={(e) => { e.stopPropagation(); void followRec(r); }}>➕ Segui</button>
                        ) : (
                          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                            <button className="btn primary" style={{ flex: 1, justifyContent: 'center', padding: '6px 0' }}
                              title="Aggiungi alla watchlist" onClick={(e) => { e.stopPropagation(); void addRecMovie(r, false); }}>➕</button>
                            <button className="btn" style={{ flex: 1, justifyContent: 'center', padding: '6px 0' }}
                              title="Già visto" onClick={(e) => { e.stopPropagation(); void addRecMovie(r, true); }}>✓</button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
          {recs !== null && recs.length === 0 && !recsLoading && (
            <Empty icon="🌱" title="Ancora pochi dati">
              Vota o segna come preferite alcune serie/film e i consigli arriveranno!
            </Empty>
          )}
        </>
      )}

      {kind === 'series' && shows === null && !hasTmdb() && (
        <Empty icon="🔭" title="Cosa guardiamo adesso?">Scrivi un titolo e premi Invio.</Empty>
      )}

      {kind === 'series' && (
        shows === null ? null
        : shows.length === 0 ? <Empty icon="🤷‍♀️" title="Nessun risultato" />
        : (
          <div className="poster-grid">
            {shows.map((r) => {
              const followed = followedIds?.has(r.localId) || showNames?.has(normTitle(r.name));
              const openPreview = async () => {
                if (followed) { nav(`/show/${r.localId}`); return; }
                // risolvi tvdb → tmdb per l'anteprima
                const tm = r.localId < 1000000000 ? await findTvByTvdb(r.localId) : null;
                if (tm) nav(`/preview/tv/${tm.id}`);
                else toast('Anteprima non disponibile per questa serie');
              };
              return (
                <div className="poster-card" key={r.id} onClick={() => void openPreview()}>
                  <Poster src={r.poster} name={r.name} />
                  <div className="meta">
                    <div className="name">{r.name}</div>
                    <div className="sub">{[r.premiered?.slice(0, 4), r.network].filter(Boolean).join(' · ')}</div>
                    <button
                      className={`btn ${followed ? '' : 'primary'}`}
                      style={{ width: '100%', marginTop: 8, justifyContent: 'center', padding: '7px 0' }}
                      onClick={(e) => { e.stopPropagation(); if (!followed) void followShow(r); }}
                    >
                      {followed ? '✓ La segui' : '➕ Segui'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )
      )}

      {kind === 'movie' && hasTmdb() && (
        movies === null ? null
        : movies.length === 0 ? <Empty icon="🤷‍♀️" title="Nessun risultato" />
        : (
          <div className="poster-grid">
            {movies.map((r) => {
              const inLib = movieKeys?.has(r.tmdbId);
              return (
                <div className="poster-card" key={r.tmdbId} onClick={() => nav(`/preview/movie/${r.tmdbId}`)}>
                  <Poster src={r.poster} name={r.name} />
                  <div className="meta">
                    <div className="name">{r.name}</div>
                    <div className="sub">{r.year ?? ''}{inLib ? ' · in libreria ✓' : ''}</div>
                    <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                      <button className="btn primary" style={{ flex: 1, justifyContent: 'center', padding: '7px 0' }}
                        onClick={(e) => { e.stopPropagation(); void addMovie(r, false); }}>➕</button>
                      <button className="btn" style={{ flex: 1, justifyContent: 'center', padding: '7px 0' }}
                        title="Già visto" onClick={(e) => { e.stopPropagation(); void addMovie(r, true); }}>✓ Visto</button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )
      )}
    </>
  );
}
