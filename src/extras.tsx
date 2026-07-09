// Sezioni condivise delle pagine di dettaglio (serie e film):
// cast, "dove guardarlo", titoli simili. Dati TMDB.

import { useState } from 'react';
import { db, normTitle, nowIso } from './db';
import { Poster, nav, toast } from './components';
import { displayTitle } from './korean';
import { enrichShow, searchShows, tmShowToLocal } from './tvmaze';
import { posterUrl, tvExternalIds, type TmdbCastMember, type WatchProvider } from './tmdb';
import type { Rec } from './recommend';

/**
 * Segue una serie partendo dal suo id TMDB: risolve l'id TVDB (lo schema id di
 * Seriality), la crea se manca e avvia l'enrichment. Ritorna l'id locale.
 */
export async function followTvByTmdb(r: Rec): Promise<number | undefined> {
  const ext = await tvExternalIds(r.tmdbId);
  let localId = ext.tvdb_id ?? undefined;
  if (!localId) {
    try {
      const found = await searchShows(r.name);
      if (found[0]) localId = tmShowToLocal(found[0]).id;
    } catch { /* rete */ }
  }
  if (!localId) return undefined;
  const existing = await db.shows.get(localId);
  if (!existing) {
    await db.shows.put({
      id: localId, name: r.name, poster: r.poster, tmdbId: r.tmdbId,
      premiered: r.year ? `${r.year}-01-01` : undefined,
      followedAt: nowIso(), addedAt: nowIso(),
    });
    const show = await db.shows.get(localId);
    if (show) void enrichShow(show).catch(() => {});
  }
  return localId;
}

/** Aggiunge (o aggiorna) un film in libreria a partire da un consiglio TMDB. */
export async function addMovieByTmdb(r: Rec, watched: boolean): Promise<string> {
  const key = `tmdb:${r.tmdbId}`;
  const existing = (await db.movies.get(key))
    ?? (await db.movies.toArray()).find((m) => m.tmdbId === r.tmdbId);
  if (existing) {
    await db.movies.update(existing.key, {
      watched: watched ? 1 : existing.watched,
      watchedAt: watched ? nowIso() : existing.watchedAt,
    });
    return existing.key;
  }
  await db.movies.put({
    key, name: r.name, tmdbId: r.tmdbId, poster: r.poster, overview: r.overview,
    releaseDate: r.year ? `${r.year}-01-01` : undefined,
    watched: watched ? 1 : 0, watchedAt: watched ? nowIso() : undefined, followedAt: nowIso(),
  });
  return key;
}

export function CastRow({ cast }: { cast: TmdbCastMember[] }) {
  if (!cast.length) return null;
  return (
    <>
      <h3 className="rec-title">Cast</h3>
      <div className="rec-row cast-row">
        {cast.map((c) => (
          <div className="person-card" key={c.id} onClick={() => nav(`/person/${c.id}`)}>
            {c.profile_path
              ? <img src={posterUrl(c.profile_path, 'w185')} alt={c.name} loading="lazy" />
              : <div className="person-ph">🎭</div>}
            <div className="p-name">{c.name}</div>
            {c.character && <div className="p-role">{c.character}</div>}
          </div>
        ))}
      </div>
    </>
  );
}

export function ProvidersRow({ providers, link }: { providers: WatchProvider[]; link?: string }) {
  if (!providers.length) return null;
  return (
    <>
      <h3 className="rec-title">Dove guardarlo in streaming (IT)</h3>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        {providers.map((p) => (
          link ? (
            <a className="provider" key={p.provider_name} title={p.provider_name}
              href={link} target="_blank" rel="noreferrer" style={{ color: 'inherit', textDecoration: 'none' }}>
              {p.logo_path && <img src={posterUrl(p.logo_path, 'w45')} alt="" />}
              {p.provider_name}
            </a>
          ) : (
            <span className="provider" key={p.provider_name} title={p.provider_name}>
              {p.logo_path && <img src={posterUrl(p.logo_path, 'w45')} alt="" />}
              {p.provider_name}
            </span>
          )
        ))}
        {link && <a className="btn" style={{ padding: '6px 12px', fontSize: 12 }} href={link} target="_blank" rel="noreferrer">tutte le opzioni ↗</a>}
      </div>
    </>
  );
}

/** Riga di titoli simili / filmografia, con azioni per aggiungerli alla libreria. */
export function TitleRow({ title, items, subOf, openOnly }: {
  title: string;
  items: Rec[];
  subOf?: (r: Rec) => string | undefined;
  /** true per titoli già in libreria: il bottone apre invece di aggiungere */
  openOnly?: boolean;
}) {
  const [added, setAdded] = useState<Set<string>>(new Set());
  if (!items.length) return null;

  const followTv = async (r: Rec) => {
    const localId = await followTvByTmdb(r);
    if (!localId) { toast('Non riesco ad agganciare questa serie, prova dalla ricerca'); return; }
    setAdded((p) => new Set(p).add(`tv:${r.tmdbId}`));
    toast(`➕ ${r.name} aggiunta alla libreria`);
    nav(`/show/${localId}`);
  };

  const addMovie = async (r: Rec, watched: boolean) => {
    await addMovieByTmdb(r, watched);
    setAdded((p) => new Set(p).add(`movie:${r.tmdbId}`));
    toast(watched ? `✓ ${r.name} segnato come visto` : `➕ ${r.name} in watchlist`);
  };

  const openInLibrary = async (r: Rec) => {
    if (r.kind === 'movie') {
      const all = await db.movies.toArray();
      const hit = all.find((m) => m.tmdbId === r.tmdbId) ?? all.find((m) => normTitle(m.name) === normTitle(r.name));
      if (hit) { nav(`/movie/${encodeURIComponent(hit.key)}`); return; }
    } else {
      const hit = (await db.shows.toArray()).find((s) => normTitle(s.name) === normTitle(r.name));
      if (hit) { nav(`/show/${hit.id}`); return; }
    }
    toast('Non lo trovo in libreria 🤔');
  };

  return (
    <>
      <h3 className="rec-title">{title}</h3>
      <div className="rec-row">
        {items.map((r) => {
          const k = `${r.kind}:${r.tmdbId}`;
          const isAdded = added.has(k);
          return (
            <div
              className="poster-card" key={k} title={r.overview}
              onClick={() => (openOnly ? void openInLibrary(r) : nav(`/preview/${r.kind}/${r.tmdbId}`))}
            >
              <Poster src={r.poster} name={r.name} />
              <div className="meta">
                <div className="name" title={r.name}>{displayTitle(r.name)}</div>
                <div className="sub">
                  {subOf?.(r) ?? `${r.kind === 'tv' ? '📺' : '🍿'} ${r.year ?? ''}${r.vote ? ` · ★ ${r.vote.toFixed(1)}` : ''}`}
                </div>
                {openOnly ? (
                  <button className="btn" style={{ width: '100%', marginTop: 8, justifyContent: 'center', padding: '6px 0' }}
                    onClick={(e) => { e.stopPropagation(); void openInLibrary(r); }}>Apri →</button>
                ) : isAdded ? (
                  <button className="btn" disabled style={{ width: '100%', marginTop: 8, justifyContent: 'center', padding: '6px 0' }}>✓</button>
                ) : r.kind === 'tv' ? (
                  <button className="btn primary" style={{ width: '100%', marginTop: 8, justifyContent: 'center', padding: '6px 0' }}
                    onClick={(e) => { e.stopPropagation(); void followTv(r); }}>➕ Segui</button>
                ) : (
                  <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                    <button className="btn primary" style={{ flex: 1, justifyContent: 'center', padding: '6px 0' }}
                      title="In watchlist" onClick={(e) => { e.stopPropagation(); void addMovie(r, false); }}>➕</button>
                    <button className="btn" style={{ flex: 1, justifyContent: 'center', padding: '6px 0' }}
                      title="Già visto" onClick={(e) => { e.stopPropagation(); void addMovie(r, true); }}>✓</button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
