// Anteprima di una serie/film NON (ancora) in libreria: si apre da qualsiasi
// card (consigli, ricerca, simili, filmografie). Mostra tutto — info, cast,
// streaming, trailer, stagioni con sinossi episodi — e da qui si può seguire.

import { useEffect, useState } from 'react';
import { db, nowIso } from '../db';
import { Poster, epCode, fmtDate, nav, toast } from '../components';
import { displayTitle } from '../korean';
import {
  movieCredits, movieDetailsById, movieRecommendations, posterUrl,
  seasonDetails, trailerUrl, tvCredits, tvDetails, tvExternalIds,
  tvRecommendations, watchProviders,
  type TmdbCastMember, type TmdbSeasonEpisode, type WatchProvider,
} from '../tmdb';
import { CastRow, ProvidersRow, TitleRow, addMovieByTmdb, followTvByTmdb } from '../extras';
import type { Rec } from '../recommend';

interface Info {
  name: string;
  poster?: string;
  fanart?: string;
  overview?: string;
  facts: string[];
  seasons?: { season_number: number; episode_count: number; name: string }[];
}
interface Extras {
  cast: TmdbCastMember[];
  providers: WatchProvider[];
  providersLink?: string;
  trailer?: string;
  similar: Rec[];
}

const STATUS_IT: Record<string, string> = {
  'Returning Series': 'In corso', Ended: 'Conclusa', Canceled: 'Cancellata',
  'In Production': 'In produzione', Planned: 'Annunciata',
};

export default function Preview({ kind, tmdbId }: { kind: 'tv' | 'movie'; tmdbId: number }) {
  const [info, setInfo] = useState<Info | null | undefined>(undefined);
  const [extras, setExtras] = useState<Extras | null>(null);
  const [libTarget, setLibTarget] = useState<string | null>(null); // rotta se già in libreria
  const [busy, setBusy] = useState(false);
  const [openSeason, setOpenSeason] = useState<number | null>(null);
  const [seasonEps, setSeasonEps] = useState<Record<number, TmdbSeasonEpisode[]>>({});
  const [openEp, setOpenEp] = useState<string | null>(null);

  useEffect(() => {
    setInfo(undefined); setExtras(null); setLibTarget(null);
    setOpenSeason(null); setSeasonEps({}); setOpenEp(null);
    let cancelled = false;
    (async () => {
      if (kind === 'tv') {
        const d = await tvDetails(tmdbId);
        if (!d || cancelled) { setInfo(d ? undefined : null); return; }
        const years = `${d.first_air_date?.slice(0, 4) ?? '?'}${d.last_air_date && d.status === 'Ended' ? `–${d.last_air_date.slice(0, 4)}` : ''}`;
        setInfo({
          name: d.name,
          poster: posterUrl(d.poster_path),
          fanart: posterUrl(d.backdrop_path, 'w780'),
          overview: d.overview,
          facts: [
            `📺 ${years}`,
            d.status ? (STATUS_IT[d.status] ?? d.status) : '',
            d.networks?.[0]?.name ?? '',
            d.genres?.slice(0, 3).map((g) => g.name).join(' · ') ?? '',
            d.number_of_seasons ? `${d.number_of_seasons} stagioni · ${d.number_of_episodes} episodi` : '',
            d.vote_average ? `★ ${d.vote_average.toFixed(1)}` : '',
          ].filter(Boolean),
          seasons: (d.seasons ?? []).filter((s) => s.season_number > 0 && s.episode_count > 0),
        });
        // già in libreria? (via id TVDB)
        const ext = await tvExternalIds(tmdbId);
        if (ext.tvdb_id && (await db.shows.get(ext.tvdb_id)) && !cancelled) {
          setLibTarget(`/show/${ext.tvdb_id}`);
        }
        const [cast, prov, trailer, recs] = await Promise.all([
          tvCredits(tmdbId), watchProviders('tv', tmdbId), trailerUrl('tv', tmdbId), tvRecommendations(tmdbId),
        ]);
        if (cancelled) return;
        setExtras({
          cast, providers: prov.flatrate, providersLink: prov.link, trailer,
          similar: recs.slice(0, 12).map((r): Rec => ({
            kind: 'tv', tmdbId: r.id, name: r.name, poster: posterUrl(r.poster_path),
            year: r.first_air_date?.slice(0, 4), vote: r.vote_average, overview: r.overview,
          })),
        });
      } else {
        const d = await movieDetailsById(tmdbId);
        if (!d || cancelled) { setInfo(d ? undefined : null); return; }
        setInfo({
          name: d.title,
          poster: posterUrl(d.poster_path),
          fanart: posterUrl(d.backdrop_path, 'w780'),
          overview: d.overview,
          facts: [
            `🍿 ${d.release_date?.slice(0, 4) ?? '?'}`,
            d.runtime ? `${Math.floor(d.runtime / 60)}h ${d.runtime % 60}min` : '',
            d.genres?.slice(0, 3).map((g) => g.name).join(' · ') ?? '',
            d.vote_average ? `★ ${d.vote_average.toFixed(1)}` : '',
          ].filter(Boolean),
        });
        const inLib = (await db.movies.toArray()).find((m) => m.tmdbId === tmdbId);
        if (inLib && !cancelled) setLibTarget(`/movie/${encodeURIComponent(inLib.key)}`);
        const [cast, prov, trailer, recs] = await Promise.all([
          movieCredits(tmdbId), watchProviders('movie', tmdbId), trailerUrl('movie', tmdbId), movieRecommendations(tmdbId),
        ]);
        if (cancelled) return;
        setExtras({
          cast, providers: prov.flatrate, providersLink: prov.link, trailer,
          similar: recs.slice(0, 12).map((r): Rec => ({
            kind: 'movie', tmdbId: r.id, name: r.title, poster: posterUrl(r.poster_path),
            year: r.release_date?.slice(0, 4), vote: r.vote_average, overview: r.overview,
          })),
        });
      }
    })().catch(() => setInfo(null));
    return () => { cancelled = true; };
  }, [kind, tmdbId]);

  const toggleSeason = async (n: number) => {
    if (openSeason === n) { setOpenSeason(null); return; }
    setOpenSeason(n);
    if (!seasonEps[n]) {
      const eps = await seasonDetails(tmdbId, n);
      setSeasonEps((prev) => ({ ...prev, [n]: eps }));
    }
  };

  const asRec = (): Rec => ({
    kind, tmdbId, name: info!.name, poster: info!.poster,
    year: info!.facts[0]?.replace(/\D/g, '').slice(0, 4) || undefined, overview: info!.overview,
  });

  const follow = async () => {
    setBusy(true);
    try {
      const localId = await followTvByTmdb(asRec());
      if (!localId) { toast('Non riesco ad agganciare questa serie 😕'); return; }
      toast(`➕ ${info!.name} aggiunta alla libreria`);
      nav(`/show/${localId}`);
    } finally { setBusy(false); }
  };

  const addMovie = async (watched: boolean) => {
    setBusy(true);
    try {
      const key = await addMovieByTmdb(asRec(), watched);
      toast(watched ? `✓ ${info!.name} segnato come visto` : `➕ ${info!.name} in watchlist`);
      nav(`/movie/${encodeURIComponent(key)}`);
    } finally { setBusy(false); }
  };

  if (info === undefined) return <p style={{ color: 'var(--text-dim)' }}>Carico l'anteprima… 🔭</p>;
  if (info === null) return <p>Titolo non trovato su TMDB.</p>;

  return (
    <>
      <div className="hero" style={{ backgroundImage: `url(${info.fanart || ''})`, backgroundColor: 'var(--bg-soft)' }}>
        <div className="shade" />
        <div className="inner">
          {info.poster && <img className="poster" src={info.poster} alt="" />}
          <div style={{ flex: 1, minWidth: 0 }}>
            <h1>{displayTitle(info.name)}</h1>
            <div className="facts">{info.facts.map((f) => <span key={f}>{f}</span>)}</div>
            <div className="actions">
              {libTarget ? (
                <button className="btn primary" onClick={() => nav(libTarget)}>✓ In libreria — Apri</button>
              ) : kind === 'tv' ? (
                <button className="btn primary" disabled={busy} onClick={() => void follow()}>➕ Segui questa serie</button>
              ) : (
                <>
                  <button className="btn primary" disabled={busy} onClick={() => void addMovie(false)}>➕ In watchlist</button>
                  <button className="btn" disabled={busy} onClick={() => void addMovie(true)}>✓ Già visto</button>
                </>
              )}
              {extras?.trailer && <a className="btn" href={extras.trailer} target="_blank" rel="noreferrer">▶️ Trailer</a>}
            </div>
          </div>
        </div>
      </div>

      {info.overview && <p style={{ color: 'var(--text-dim)', maxWidth: 780, marginTop: 0 }}>{info.overview}</p>}

      {extras && (
        <>
          <ProvidersRow providers={extras.providers} link={extras.providersLink} />
          <CastRow cast={extras.cast} />
        </>
      )}

      {kind === 'tv' && (info.seasons?.length ?? 0) > 0 && (
        <>
          <h3 className="rec-title">Stagioni ed episodi</h3>
          {info.seasons!.map((s) => {
            const open = openSeason === s.season_number;
            const eps = seasonEps[s.season_number];
            return (
              <div className="season" key={s.season_number}>
                <div className="season-head" onClick={() => void toggleSeason(s.season_number)}>
                  <h3>{s.name || `Stagione ${s.season_number}`}</h3>
                  <span className="mini">{s.episode_count} episodi</span>
                  <span style={{ color: 'var(--text-dim)' }}>{open ? '▾' : '▸'}</span>
                </div>
                {open && (eps === undefined
                  ? <div className="ep-row" style={{ color: 'var(--text-dim)' }}>Carico gli episodi… 📖</div>
                  : eps.map((e) => {
                    const k = `${e.season_number}:${e.episode_number}`;
                    const expanded = openEp === k;
                    return (
                      <div key={k}>
                        <div className="ep-row" style={{ cursor: 'pointer' }} onClick={() => setOpenEp(expanded ? null : k)}>
                          <span className="code">{epCode(e.season_number, e.episode_number)}</span>
                          <span className="nm">{expanded ? '▾ ' : ''}{e.name || `Episodio ${e.episode_number}`}</span>
                          <span className="date">{e.air_date ? fmtDate(e.air_date) : ''}</span>
                        </div>
                        {expanded && (
                          <div className="ep-synopsis">
                            {e.still_path && <img src={posterUrl(e.still_path, 'w300')} alt="" loading="lazy" />}
                            <p>{e.overview || 'Nessuna sinossi disponibile per questo episodio.'}</p>
                          </div>
                        )}
                      </div>
                    );
                  }))}
              </div>
            );
          })}
        </>
      )}

      {extras && <TitleRow title={kind === 'tv' ? 'Serie simili' : 'Film simili'} items={extras.similar} />}
    </>
  );
}
