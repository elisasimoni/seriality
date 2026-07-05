import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  db, computeProgress, markWatchedBulk, nowIso, previousUnwatched,
  setEpisodeWatched, setSeasonWatched,
} from '../db';
import { Stars, askConfirm, epCode, fmtDate, nav, toast } from '../components';
import type { Episode } from '../types';
import { enrichShow, tvmazeEpisode } from '../tvmaze';
import {
  findTvByTvdb, hasTmdb, posterUrl, searchTv, trailerUrl, tvCredits,
  tvRecommendations, watchProviders,
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

export default function ShowDetail({ id }: { id: number }) {
  const [openSeason, setOpenSeason] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [extras, setExtras] = useState<Extras | null>(null);
  const [openEp, setOpenEp] = useState<string | null>(null);
  const [epLoading, setEpLoading] = useState<string | null>(null);

  const data = useLiveQuery(async () => {
    const show = await db.shows.get(id);
    if (!show) return null;
    const eps = await db.episodes.where('showId').equals(id).toArray();
    return { show, eps, prog: computeProgress(show, eps) };
  }, [id]);

  // cast/trailer/streaming/simili via TMDB (id risolto dal TVDB id e salvato)
  useEffect(() => {
    setExtras(null);
    if (!hasTmdb()) return;
    let cancelled = false;
    (async () => {
      const show = await db.shows.get(id);
      if (!show) return;
      let tmdbId = show.tmdbId;
      if (!tmdbId && id < 1000000000) tmdbId = (await findTvByTvdb(id))?.id;
      if (!tmdbId) {
        const hits = await searchTv(show.name);
        tmdbId = hits[0]?.id;
      }
      if (!tmdbId || cancelled) return;
      if (tmdbId !== show.tmdbId) await db.shows.update(id, { tmdbId });
      const [cast, prov, trailer, recs] = await Promise.all([
        tvCredits(tmdbId),
        watchProviders('tv', tmdbId),
        trailerUrl('tv', tmdbId),
        tvRecommendations(tmdbId),
      ]);
      if (cancelled) return;
      setExtras({
        cast,
        providers: prov.flatrate,
        providersLink: prov.link,
        trailer,
        similar: recs.slice(0, 12).map((r): Rec => ({
          kind: 'tv', tmdbId: r.id, name: r.name, poster: posterUrl(r.poster_path),
          year: r.first_air_date?.slice(0, 4), vote: r.vote_average, overview: r.overview,
        })),
      });
    })().catch(() => {});
    return () => { cancelled = true; };
  }, [id]);

  if (data === undefined) return null;
  if (data === null) return <p>Serie non trovata. <a href="#/shows" style={{ color: 'var(--accent)' }}>Torna alla libreria</a></p>;
  const { show, eps, prog } = data;

  // countdown al prossimo episodio non ancora andato in onda
  const todayStr = new Date().toISOString().slice(0, 10);
  const nextAiring = eps
    .filter((e) => e.airDate && e.airDate > todayStr && !e.special)
    .sort((a, b) => a.airDate!.localeCompare(b.airDate!))[0];
  const daysTo = nextAiring
    ? Math.ceil((Date.parse(nextAiring.airDate!) - Date.now()) / 86400000)
    : null;

  const seasons = [...new Set(eps.map((e) => e.season))].sort((a, b) => (a || 99) - (b || 99));
  const bySeason = (s: number) => eps.filter((e) => e.season === s).sort((a, b) => a.number - b.number);
  const today = new Date().toISOString().slice(0, 10);

  // segna un episodio come visto; se ci sono precedenti non visti chiede
  // se marcare anche quelli (come faceva TV Time)
  const watchEpisode = async (e: Episode) => {
    if (e.watched) { await setEpisodeWatched(e, false); return; }
    await setEpisodeWatched(e, true);
    const prev = await previousUnwatched(e);
    if (prev.length === 0) {
      toast(`✓ ${epCode(e.season, e.number)} visto!`);
      return;
    }
    const ok = await askConfirm({
      title: `Segnare anche i ${prev.length} episodi precedenti?`,
      body: `Non hai ancora visto ${prev.length} episodi prima di ${epCode(e.season, e.number)}. Vuoi segnarli tutti come visti?`,
      yes: `Sì, segna tutti (${prev.length + 1})`,
      no: 'Solo questo',
    });
    if (ok) {
      await markWatchedBulk(prev);
      toast(`✓ ${prev.length + 1} episodi segnati come visti!`);
    }
  };

  // click su un episodio → apre/chiude la sinossi (scaricata al primo click)
  const toggleEpisode = async (epKey: string) => {
    if (openEp === epKey) { setOpenEp(null); return; }
    setOpenEp(epKey);
    const e = eps.find((x) => x.key === epKey);
    if (!e || e.summary !== undefined || !show.tvmazeId) return;
    setEpLoading(epKey);
    try {
      const info = e.season > 0
        ? await tvmazeEpisode(show.tvmazeId, e.season, e.number)
        : null;
      await db.episodes.update(epKey, {
        summary: info?.summary ?? '',   // '' = già cercata, nessuna sinossi
        image: info?.image,
      });
    } catch { /* rete: riproverà al prossimo click */ }
    finally { setEpLoading(null); }
  };

  const refresh = async () => {
    setRefreshing(true);
    const ok = await enrichShow(show).catch(() => false);
    setRefreshing(false);
    toast(ok ? 'Dati aggiornati da TVmaze ✓' : 'Nessuna corrispondenza trovata su TVmaze');
  };

  const statusLabel = {
    watching: '📺 In corso', uptodate: '✨ In pari', finished: '🏁 Finita',
    notstarted: '🌱 Da iniziare', stopped: '💤 Abbandonata',
  }[prog.status];

  return (
    <>
      <div className="hero" style={{ backgroundImage: `url(${show.fanart || ''})`, backgroundColor: 'var(--bg-soft)' }}>
        <div className="shade" />
        <div className="inner">
          {show.poster && <img className="poster" src={show.poster} alt="" />}
          <div style={{ flex: 1, minWidth: 0 }}>
            <h1>{show.name}</h1>
            <div className="facts">
              <span>{statusLabel}</span>
              {show.network && <span>{show.network}{show.country ? ` (${show.country})` : ''}</span>}
              {show.premiered && <span>dal {show.premiered.slice(0, 4)}</span>}
              {show.genres?.length ? <span>{show.genres.slice(0, 3).join(' · ')}</span> : null}
              <span>{prog.watched}/{prog.total} episodi visti</span>
              {nextAiring && daysTo != null && (
                <span style={{ color: 'var(--gold)' }}>
                  ⏳ {epCode(nextAiring.season, nextAiring.number)} {daysTo === 0 ? 'oggi!' : daysTo === 1 ? 'domani' : `tra ${daysTo} giorni`}
                </span>
              )}
            </div>
            <div className="progress" style={{ maxWidth: 420 }}>
              <div style={{ width: `${(prog.watched / Math.max(1, prog.total)) * 100}%` }} />
            </div>
            <div className="actions">
              {prog.nextEp && (
                <button className="btn primary" onClick={() => {
                  setEpisodeWatched(prog.nextEp!, true);
                  toast(`✓ ${epCode(prog.nextEp!.season, prog.nextEp!.number)} visto!`);
                }}>
                  ✓ Visto {epCode(prog.nextEp.season, prog.nextEp.number)}
                </button>
              )}
              <button className="btn" onClick={() => db.shows.update(id, { favorite: !show.favorite })}>
                {show.favorite ? '❤️ Preferita' : '🤍 Preferita'}
              </button>
              <button className="btn" onClick={() => db.shows.update(id, { archived: !show.archived })}>
                {show.archived ? '▶️ Riprendi' : '💤 Abbandona'}
              </button>
              <button
                className="btn"
                title="Se attivo, la serie resta in libreria ma sparisce da «Da guardare» e «In arrivo»"
                onClick={() => {
                  db.shows.update(id, { muted: !show.muted });
                  toast(show.muted ? '🔔 Avvisi riattivati' : '🔕 Non te la proporrò più');
                }}
              >
                {show.muted ? '🔔 Riattiva avvisi' : '🔕 Non seguire più'}
              </button>
              {extras?.trailer && (
                <a className="btn" href={extras.trailer} target="_blank" rel="noreferrer">▶️ Trailer</a>
              )}
              <button className="btn" disabled={refreshing} onClick={refresh}>
                {refreshing ? '…' : '🔄 Aggiorna dati'}
              </button>
              <button className="btn danger" onClick={async () => {
                if (!confirm(`Rimuovere "${show.name}" e tutto il suo storico?`)) return;
                await db.episodes.where('showId').equals(id).delete();
                await db.shows.delete(id);
                nav('/shows');
              }}>🗑</button>
              <span style={{ alignSelf: 'center' }}>
                <Stars value={show.rating} onChange={(v) => db.shows.update(id, { rating: v || undefined })} />
              </span>
            </div>
          </div>
        </div>
      </div>

      {show.overview && <p style={{ color: 'var(--text-dim)', maxWidth: 780, marginTop: 0 }}>{show.overview}</p>}

      {extras && (
        <>
          <ProvidersRow providers={extras.providers} link={extras.providersLink} />
          <CastRow cast={extras.cast} />
        </>
      )}

      {seasons.length === 0 && (
        <p style={{ color: 'var(--text-dim)' }}>
          Nessun episodio in archivio: premi «🔄 Aggiorna dati» per scaricare la lista episodi.
        </p>
      )}

      {seasons.map((s) => {
        const list = bySeason(s);
        const seen = list.filter((e) => e.watched).length;
        const open = openSeason === s || seasons.length === 1;
        return (
          <div className="season" key={s}>
            <div className="season-head" onClick={() => setOpenSeason(open ? -1 : s)}>
              <h3>{s === 0 ? 'Speciali' : `Stagione ${s}`}</h3>
              <span className="mini">{seen}/{list.length}</span>
              <div className="progress" style={{ width: 90, marginTop: 0 }}>
                <div style={{ width: `${(seen / Math.max(1, list.length)) * 100}%` }} />
              </div>
              <button
                className={`check-btn small ${seen === list.length ? '' : 'off'}`}
                title={seen === list.length ? 'Segna tutta la stagione come non vista' : 'Segna tutta la stagione come vista'}
                onClick={(e) => { e.stopPropagation(); setSeasonWatched(id, s, seen !== list.length); }}
              >✓</button>
              <span style={{ color: 'var(--text-dim)' }}>{open ? '▾' : '▸'}</span>
            </div>
            {open && list.map((e) => {
              const future = e.airDate && e.airDate > today;
              const expanded = openEp === e.key;
              return (
                <div key={e.key}>
                  <div className="ep-row" style={{ cursor: 'pointer' }} onClick={() => void toggleEpisode(e.key)}>
                    <span className="code">{epCode(e.season, e.number)}</span>
                    <span className={`nm ${e.watched ? 'seen' : ''}`} style={future ? { opacity: 0.5 } : undefined}>
                      {expanded ? '▾ ' : ''}{e.name || `Episodio ${e.number}`}{future ? ' 🔜' : ''}
                    </span>
                    <Stars value={e.rating} onChange={(v) => db.episodes.update(e.key, { rating: v || undefined })} />
                    {e.watched ? (
                      <button
                        className="btn" style={{ padding: '2px 8px', fontSize: 11 }}
                        title="Rivisto un'altra volta"
                        onClick={(ev) => {
                          ev.stopPropagation();
                          db.episodes.update(e.key, { timesWatched: (e.timesWatched ?? 1) + 1, watchedAt: nowIso() });
                          toast(`↻ Rewatch segnato (${(e.timesWatched ?? 1) + 1}×)`);
                        }}
                      >↻{(e.timesWatched ?? 1) > 1 ? ` ${e.timesWatched}×` : ''}</button>
                    ) : null}
                    <span className="date">{e.watched ? fmtDate(e.watchedAt) : (e.airDate ? fmtDate(e.airDate) : '')}</span>
                    <button
                      className={`check-btn small ${e.watched ? '' : 'off'}`}
                      onClick={(ev) => { ev.stopPropagation(); void watchEpisode(e); }}
                      disabled={!!future && !e.watched}
                      title={e.watched ? 'Segna come non visto' : 'Segna come visto'}
                    >✓</button>
                  </div>
                  {expanded && (
                    <div className="ep-synopsis">
                      {epLoading === e.key ? (
                        <span style={{ color: 'var(--text-dim)' }}>Carico la sinossi… 📖</span>
                      ) : (
                        <>
                          {e.image && <img src={e.image} alt="" loading="lazy" />}
                          <p>{e.summary || (e.summary === '' ? 'Nessuna sinossi disponibile per questo episodio.' : 'Sinossi non ancora scaricata — riclicca per riprovare.')}</p>
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}

      {extras && <TitleRow title="Serie simili" items={extras.similar} />}
    </>
  );
}
