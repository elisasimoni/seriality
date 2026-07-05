// Metadata via TVmaze (API pubblica, CORS aperto, nessuna chiave).
// Lookup per id TVDB (gli stessi id usati da TV Time) o ricerca per nome.
// Rate limit TVmaze: ~20 richieste / 10s → coda con spaziatura.

import { db, epKey, nowIso } from './db';
import type { Episode, Show } from './types';

const BASE = 'https://api.tvmaze.com';
let lastCall = 0;

async function tvmaze(path: string): Promise<unknown> {
  const wait = Math.max(0, lastCall + 550 - Date.now());
  if (wait) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();
  const res = await fetch(`${BASE}${path}`);
  if (res.status === 429) {
    await new Promise((r) => setTimeout(r, 5000));
    return tvmaze(path);
  }
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`TVmaze ${res.status}`);
  return res.json();
}

interface TmShow {
  id: number; name: string; genres: string[]; status: string; runtime: number | null;
  averageRuntime: number | null; premiered: string | null;
  network?: { name: string; country?: { code: string } } | null;
  webChannel?: { name: string; country?: { code: string } | null } | null;
  image?: { medium: string; original: string } | null;
  summary?: string | null;
  externals?: { thetvdb?: number | null; imdb?: string | null };
}

interface TmEpisode {
  id: number; name: string; season: number; number: number | null;
  type: string; airdate: string; airtime: string; runtime: number | null;
}

const stripHtml = (s?: string | null) => (s ? s.replace(/<[^>]+>/g, '').trim() : undefined);

/** Sinossi + screenshot di un singolo episodio (fetch on-demand al click). */
export async function tvmazeEpisode(
  tvmazeShowId: number, season: number, number: number,
): Promise<{ summary?: string; image?: string } | null> {
  const e = (await tvmaze(`/shows/${tvmazeShowId}/episodebynumber?season=${season}&number=${number}`)) as
    | { summary?: string | null; image?: { medium?: string; original?: string } | null }
    | null;
  if (!e) return null;
  return {
    summary: stripHtml(e.summary),
    image: e.image?.medium || e.image?.original || undefined,
  };
}

export async function searchShows(query: string): Promise<TmShow[]> {
  const res = (await tvmaze(`/search/shows?q=${encodeURIComponent(query)}`)) as { show: TmShow }[] | null;
  return (res ?? []).map((r) => r.show);
}

export function tmShowToLocal(tm: TmShow): Omit<Show, 'addedAt'> {
  return {
    id: tm.externals?.thetvdb || 1000000000 + tm.id,
    tvmazeId: tm.id,
    name: tm.name,
    poster: tm.image?.original || tm.image?.medium,
    overview: stripHtml(tm.summary),
    genres: tm.genres?.length ? tm.genres : undefined,
    network: tm.network?.name || tm.webChannel?.name,
    country: tm.network?.country?.code || tm.webChannel?.country?.code,
    runtime: tm.averageRuntime || tm.runtime || undefined,
    ended: tm.status === 'Ended',
    premiered: tm.premiered || undefined,
  };
}

/**
 * Arricchisce una serie: trova la corrispondenza TVmaze (per id TVDB o nome),
 * scarica la lista episodi e la fonde con lo stato visto locale. Applica
 * eventuali visioni "legacy" (import senza stagione/numero) in ordine di messa in onda.
 */
export async function enrichShow(show: Show): Promise<boolean> {
  let tm: TmShow | null = null;
  if (show.tvmazeId) {
    tm = (await tvmaze(`/shows/${show.tvmazeId}`)) as TmShow | null;
  }
  if (!tm && show.id < 1000000000) {
    tm = (await tvmaze(`/lookup/shows?thetvdb=${show.id}`)) as TmShow | null;
  }
  if (!tm && show.name && !show.name.startsWith('Serie ')) {
    tm = (await tvmaze(`/singlesearch/shows?q=${encodeURIComponent(show.name)}`)) as TmShow | null;
  }
  if (!tm) return false;

  const local = tmShowToLocal(tm);
  await db.shows.update(show.id, {
    tvmazeId: tm.id,
    name: show.name?.startsWith('Serie ') ? local.name : (show.name || local.name),
    poster: show.poster || local.poster,
    overview: local.overview ?? show.overview,
    genres: local.genres ?? show.genres,
    network: local.network ?? show.network,
    country: local.country ?? show.country,
    runtime: local.runtime ?? show.runtime,
    ended: local.ended,
    premiered: local.premiered ?? show.premiered,
    enrichedAt: nowIso(),
  });

  const eps = ((await tvmaze(`/shows/${tm.id}/episodes?specials=1`)) as TmEpisode[] | null) ?? [];
  const existing = new Map(
    (await db.episodes.where('showId').equals(show.id).toArray()).map((e) => [e.key, e]),
  );
  const rows: Episode[] = [];
  for (const e of eps) {
    if (e.number == null) continue;
    const season = e.type !== 'regular' ? 0 : e.season;
    const key = epKey(show.id, season, e.number);
    const prev = existing.get(key);
    rows.push({
      key,
      showId: show.id,
      season,
      number: e.number,
      name: e.name || prev?.name,
      airDate: e.airdate || prev?.airDate,
      airTime: e.airtime || undefined,
      runtime: e.runtime ?? prev?.runtime,
      special: season === 0 || undefined,
      watched: prev?.watched ?? 0,
      watchedAt: prev?.watchedAt,
      timesWatched: prev?.timesWatched,
      rating: prev?.rating,
    });
  }
  if (rows.length) await db.episodes.bulkPut(rows);

  // visioni legacy → marca i primi N episodi in ordine di messa in onda
  if (show.legacyWatchCount && rows.length) {
    const dates = (show.legacyWatchDates ?? []).filter(Boolean).sort();
    const ordered = rows
      .filter((e) => !e.special)
      .sort((a, b) => (a.airDate || '9999').localeCompare(b.airDate || '9999') || a.season - b.season || a.number - b.number);
    let n = 0;
    for (const e of ordered) {
      if (n >= show.legacyWatchCount) break;
      if (!e.watched) {
        e.watched = 1;
        e.watchedAt = dates[n] || nowIso();
        e.timesWatched = 1;
      }
      n++;
    }
    await db.episodes.bulkPut(ordered);
    await db.shows.update(show.id, { legacyWatchCount: 0, legacyWatchDates: [] });
  }
  return true;
}

export interface EnrichProgress { done: number; total: number; current?: string; running: boolean }
let enriching = false;
const listeners = new Set<(p: EnrichProgress) => void>();
let progress: EnrichProgress = { done: 0, total: 0, running: false };

export function onEnrichProgress(fn: (p: EnrichProgress) => void) {
  listeners.add(fn);
  fn(progress);
  return () => { listeners.delete(fn); };
}
function emit(p: EnrichProgress) { progress = p; listeners.forEach((f) => f(p)); }

/**
 * Arricchisce le serie.
 *  - default: solo quelle mai arricchite (post-import)
 *  - 'auto':  anche le serie non concluse con dati più vecchi di 24h
 *             (per scoprire nuovi episodi annunciati) — usato dagli aggiornamenti automatici
 *  - true:    tutte (refresh forzato)
 */
export async function enrichAll(mode: boolean | 'auto' = false) {
  if (enriching) return;
  enriching = true;
  const force = mode === true;
  const auto = mode === 'auto';
  const staleBefore = Date.now() - 24 * 3600 * 1000;
  try {
    const shows = await db.shows.toArray();
    const todo = shows.filter((s) =>
      force
      || !s.enrichedAt
      || (s.legacyWatchCount ?? 0) > 0
      || (auto && !s.ended && !s.archived && new Date(s.enrichedAt).getTime() < staleBefore));
    // le serie non concluse prima: sono quelle che servono per "in arrivo"
    todo.sort((a, b) => Number(a.ended ?? false) - Number(b.ended ?? false));
    emit({ done: 0, total: todo.length, running: true });
    let done = 0;
    for (const s of todo) {
      emit({ done, total: todo.length, current: s.name, running: true });
      try { await enrichShow(s); } catch { /* rete: riproveremo al prossimo giro */ }
      done++;
    }
    emit({ done, total: todo.length, running: false });
  } finally {
    enriching = false;
  }
}
