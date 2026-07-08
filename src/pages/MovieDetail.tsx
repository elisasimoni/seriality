import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, nowIso } from '../db';
import { AdjacentNav, Stars, fmtDate, nav, toast } from '../components';
import { displayTitle } from '../korean';
import {
  hasTmdb, movieCredits, movieDetailsById, movieRecommendations, posterUrl,
  searchMovies, trailerUrl, watchProviders,
  type TmdbCastMember, type WatchProvider,
} from '../tmdb';
import { CastRow, ProvidersRow, TitleRow } from '../extras';
import type { Rec } from '../recommend';

interface Extras {
  cast: TmdbCastMember[];
  providers: WatchProvider[];
  providersLink?: string;
  trailer?: string;
  similar: Rec[];
}

export default function MovieDetail({ movieKey }: { movieKey: string }) {
  const movie = useLiveQuery(() => db.movies.get(movieKey), [movieKey]);
  const [extras, setExtras] = useState<Extras | null>(null);

  // film precedente/successivo in ordine di visione (ultimo visto prima) per swipe/frecce
  const adj = useLiveQuery(async () => {
    const movies = await db.movies.toArray();
    movies.sort((a, b) =>
      (b.watchedAt ?? '').localeCompare(a.watchedAt ?? '')
      || a.name.localeCompare(b.name, 'it'));
    const i = movies.findIndex((m) => m.key === movieKey);
    const href = (m?: { key: string }) => (m ? `/movie/${encodeURIComponent(m.key)}` : undefined);
    return {
      prev: i > 0 ? href(movies[i - 1]) : undefined,
      next: i >= 0 && i < movies.length - 1 ? href(movies[i + 1]) : undefined,
    };
  }, [movieKey]);

  useEffect(() => {
    setExtras(null);
    if (!movie || !hasTmdb()) return;
    let cancelled = false;
    (async () => {
      // risolvi l'id TMDB se manca (import TV Time: c'è solo l'imdb o il nome)
      let tmdbId = movie.tmdbId;
      if (!tmdbId) {
        const hits = await searchMovies(movie.name).catch(() => []);
        const year = movie.releaseDate?.slice(0, 4);
        const hit = hits.find((h) => !year || h.release_date?.startsWith(year)) ?? hits[0];
        if (hit) {
          tmdbId = hit.id;
          await db.movies.update(movieKey, { tmdbId });
        }
      }
      if (!tmdbId || cancelled) return;
      // completa runtime/generi se mancanti
      if (!movie.runtime || !movie.genres?.length || !movie.fanart) {
        const d = await movieDetailsById(tmdbId);
        if (d && !cancelled) {
          await db.movies.update(movieKey, {
            runtime: movie.runtime || d.runtime || undefined,
            genres: movie.genres?.length ? movie.genres : d.genres?.map((g) => g.name),
            overview: movie.overview || d.overview || undefined,
            fanart: movie.fanart || posterUrl(d.backdrop_path, 'w780'),
            poster: movie.poster || posterUrl(d.poster_path),
          });
        }
      }
      const [cast, prov, trailer, recs] = await Promise.all([
        movieCredits(tmdbId),
        watchProviders('movie', tmdbId),
        trailerUrl('movie', tmdbId),
        movieRecommendations(tmdbId),
      ]);
      if (cancelled) return;
      setExtras({
        cast,
        providers: prov.flatrate,
        providersLink: prov.link,
        trailer,
        similar: recs.slice(0, 12).map((r): Rec => ({
          kind: 'movie', tmdbId: r.id, name: r.title, poster: posterUrl(r.poster_path),
          year: r.release_date?.slice(0, 4), vote: r.vote_average, overview: r.overview,
        })),
      });
    })().catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [movieKey, movie?.tmdbId]);

  if (movie === undefined) return null;
  if (movie === null) return <p>Film non trovato. <a href="#/movies" style={{ color: 'var(--accent)' }}>Torna ai film</a></p>;

  const toggleWatched = async () => {
    await db.movies.update(movieKey, {
      watched: movie.watched ? 0 : 1,
      watchedAt: movie.watched ? undefined : nowIso(),
    });
    toast(movie.watched ? 'Rimesso in watchlist' : `✓ ${movie.name} visto!`);
  };

  return (
    <>
      <AdjacentNav prevHref={adj?.prev} nextHref={adj?.next} />
      <div className="hero" style={{ backgroundImage: `url(${movie.fanart || ''})`, backgroundColor: 'var(--bg-soft)' }}>
        <div className="shade" />
        <div className="inner">
          {movie.poster && <img className="poster" src={movie.poster} alt="" />}
          <div style={{ flex: 1, minWidth: 0 }}>
            <h1>{displayTitle(movie.name)}</h1>
            <div className="facts">
              <span>{movie.watched ? `✓ Visto ${fmtDate(movie.watchedAt)}` : '🕐 In watchlist'}</span>
              {movie.releaseDate && <span>{movie.releaseDate.slice(0, 4)}</span>}
              {movie.runtime ? <span>{Math.floor(movie.runtime / 60)}h {movie.runtime % 60}min</span> : null}
              {movie.genres?.length ? <span>{movie.genres.slice(0, 3).join(' · ')}</span> : null}
            </div>
            <div className="actions">
              <button className={`btn ${movie.watched ? '' : 'primary'}`} onClick={() => void toggleWatched()}>
                {movie.watched ? '↩️ Non visto' : '✓ Segna come visto'}
              </button>
              <button className="btn" onClick={() => db.movies.update(movieKey, { favorite: !movie.favorite })}>
                {movie.favorite ? '❤️ Preferito' : '🤍 Preferito'}
              </button>
              {extras?.trailer && (
                <a className="btn" href={extras.trailer} target="_blank" rel="noreferrer">▶️ Trailer</a>
              )}
              <button className="btn danger" onClick={async () => {
                if (!confirm(`Rimuovere "${movie.name}" dalla libreria?`)) return;
                await db.movies.delete(movieKey);
                nav('/movies');
              }}>🗑</button>
              <span style={{ alignSelf: 'center' }}>
                <Stars value={movie.rating} onChange={(v) => db.movies.update(movieKey, { rating: v || undefined })} />
              </span>
            </div>
          </div>
        </div>
      </div>

      {movie.overview && <p style={{ color: 'var(--text-dim)', maxWidth: 780, marginTop: 0 }}>{movie.overview}</p>}

      {!hasTmdb() && <p style={{ color: 'var(--text-dim)' }}>Aggiungi una chiave TMDB nelle Impostazioni per cast, trailer e streaming.</p>}
      {extras === null && hasTmdb() && <p style={{ color: 'var(--text-dim)' }}>Carico cast e dettagli… 🎬</p>}
      {extras && (
        <>
          <ProvidersRow providers={extras.providers} link={extras.providersLink} />
          <CastRow cast={extras.cast} />
          <TitleRow title="Film simili" items={extras.similar} />
        </>
      )}
    </>
  );
}
