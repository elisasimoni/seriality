import Dexie, { type Table } from 'dexie';
import type { Show, Episode, Movie } from './types';

class SerialityDB extends Dexie {
  shows!: Table<Show, number>;
  episodes!: Table<Episode, string>;
  movies!: Table<Movie, string>;
  kv!: Table<{ key: string; value: unknown }, string>;

  constructor() {
    super('seriality');
    this.version(1).stores({
      shows: 'id,name,lastActivityAt',
      episodes: 'key,showId,airDate,watched,[showId+watched]',
      movies: 'key,name,watched,watchedAt',
      kv: 'key',
    });
  }
}

export const db = new SerialityDB();

export const epKey = (showId: number, season: number, number: number) =>
  `${showId}:${season}:${number}`;

export const nowIso = () => new Date().toISOString();

/**
 * Normalizza un titolo per il confronto "stesso show/film" tra fonti diverse.
 * Usa \p{L}/\p{N} (non a-z0-9) perché molti titoli sono in coreano/giapponese/ecc.:
 * scartare tutto ciò che non è ASCII collasserebbe titoli non latini diversi
 * nella stessa stringa vuota, facendoli combaciare a caso tra loro.
 */
export const normTitle = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

/**
 * Indice nome→anni per il fallback "stesso titolo" quando manca un id esterno
 * (tmdbId/tvdbId). Il solo nome NON basta: titoli generici (es. "Christmas
 * Carol") sono condivisi da produzioni diverse, quindi serve confrontare
 * anche l'anno per non far combaciare a caso opere non correlate.
 */
export function buildNameYearIndex(items: { name: string; year?: string }[]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const it of items) {
    const key = normTitle(it.name);
    if (!map.has(key)) map.set(key, new Set());
    map.get(key)!.add(it.year ?? '');
  }
  return map;
}

/** Vero se l'indice contiene lo stesso nome con un anno compatibile (±1) o senza dati sufficienti per escluderlo. */
export function nameYearMatch(index: Map<string, Set<string>>, name: string, year?: string): boolean {
  const years = index.get(normTitle(name));
  if (!years) return false;
  if (!year || years.has('')) return true;
  for (const y of years) if (y && Math.abs(Number(y) - Number(year)) <= 1) return true;
  return false;
}

/** Confronto diretto stesso-titolo tra due elementi (senza indice), stessa tolleranza di nameYearMatch. */
export function sameTitle(nameA: string, yearA: string | undefined, nameB: string, yearB: string | undefined): boolean {
  if (normTitle(nameA) !== normTitle(nameB)) return false;
  if (!yearA || !yearB) return true;
  return Math.abs(Number(yearA) - Number(yearB)) <= 1;
}

/**
 * Indice "già in libreria" per le card di ricerca/consigli: id TMDB quando c'è,
 * più il fallback titolo+anno perché le voci importate (TV Time ecc.) spesso
 * non hanno tmdbId e senza fallback tornerebbero a mostrare "➕".
 */
export interface LibIndex {
  tvTmdb: Set<number>;
  tvNames: Map<string, Set<string>>;
  movieTmdb: Set<number>;
  movieNames: Map<string, Set<string>>;
}

export function buildLibIndexFrom(shows: Show[], movies: Movie[]): LibIndex {
  return {
    tvTmdb: new Set(shows.map((s) => s.tmdbId).filter((x): x is number => !!x)),
    tvNames: buildNameYearIndex(shows.map((s) => ({ name: s.name, year: s.premiered?.slice(0, 4) }))),
    movieTmdb: new Set(movies.map((m) => m.tmdbId).filter((x): x is number => !!x)),
    movieNames: buildNameYearIndex(movies.map((m) => ({ name: m.name, year: m.releaseDate?.slice(0, 4) }))),
  };
}

export async function buildLibIndex(): Promise<LibIndex> {
  const [shows, movies] = await Promise.all([db.shows.toArray(), db.movies.toArray()]);
  return buildLibIndexFrom(shows, movies);
}

/** Vero se un titolo TMDB risulta già in libreria (per id o per nome+anno). */
export function inLibrary(ix: LibIndex | undefined, kind: 'tv' | 'movie', tmdbId: number, name: string, year?: string): boolean {
  if (!ix) return false;
  return kind === 'tv'
    ? ix.tvTmdb.has(tmdbId) || nameYearMatch(ix.tvNames, name, year)
    : ix.movieTmdb.has(tmdbId) || nameYearMatch(ix.movieNames, name, year);
}

/** Cerca un film già in libreria: prima per tmdbId, poi per titolo+anno (voci importate senza id). */
export async function findLibMovie(tmdbId: number | undefined, name: string, year?: string): Promise<Movie | undefined> {
  const all = await db.movies.toArray();
  return (tmdbId ? all.find((m) => m.tmdbId === tmdbId) : undefined)
    ?? all.find((m) => sameTitle(m.name, m.releaseDate?.slice(0, 4), name, year));
}

/** Cerca una serie già in libreria: prima per tmdbId, poi per titolo+anno. */
export async function findLibShow(tmdbId: number | undefined, name: string, year?: string): Promise<Show | undefined> {
  const all = await db.shows.toArray();
  return (tmdbId ? all.find((s) => s.tmdbId === tmdbId) : undefined)
    ?? all.find((s) => sameTitle(s.name, s.premiered?.slice(0, 4), name, year));
}

export async function setEpisodeWatched(ep: Episode, watched: boolean) {
  await db.episodes.update(ep.key, {
    watched: watched ? 1 : 0,
    watchedAt: watched ? nowIso() : undefined,
    timesWatched: watched ? Math.max(1, ep.timesWatched ?? 0) : 0,
  });
  await db.shows.update(ep.showId, { lastActivityAt: nowIso() });
}

/** Episodi precedenti a `ep` (stessa serie) già andati in onda ma non ancora visti. */
export async function previousUnwatched(ep: Episode): Promise<Episode[]> {
  const today = new Date().toISOString().slice(0, 10);
  const eps = await db.episodes.where('showId').equals(ep.showId).toArray();
  return eps
    .filter((e) =>
      !e.special && e.season > 0 && !e.watched
      && e.airDate && e.airDate <= today
      && (e.season < ep.season || (e.season === ep.season && e.number < ep.number)))
    .sort((a, b) => a.season - b.season || a.number - b.number);
}

/** Segna come visti un blocco di episodi (usato per "anche i precedenti"). */
export async function markWatchedBulk(eps: Episode[]) {
  if (!eps.length) return;
  await db.episodes.bulkPut(eps.map((e) => ({
    ...e,
    watched: 1,
    watchedAt: e.watchedAt ?? nowIso(),
    timesWatched: Math.max(1, e.timesWatched ?? 0),
  })));
  await db.shows.update(eps[0].showId, { lastActivityAt: nowIso() });
}

export async function setSeasonWatched(showId: number, season: number, watched: boolean) {
  const eps = await db.episodes.where('showId').equals(showId).toArray();
  const today = new Date().toISOString().slice(0, 10);
  const targets = eps.filter(
    (e) => e.season === season && (!watched || (e.airDate && e.airDate <= today)),
  );
  await db.episodes.bulkPut(
    targets.map((e) => ({
      ...e,
      watched: watched ? 1 : 0,
      watchedAt: watched ? (e.watchedAt ?? nowIso()) : undefined,
      timesWatched: watched ? Math.max(1, e.timesWatched ?? 0) : 0,
    })),
  );
  await db.shows.update(showId, { lastActivityAt: nowIso() });
}

export interface ShowProgress {
  aired: number;
  watched: number;
  total: number;
  nextEp?: Episode;
  status: 'watching' | 'uptodate' | 'finished' | 'notstarted' | 'stopped';
}

export function computeProgress(show: Show, eps: Episode[]): ShowProgress {
  const today = new Date().toISOString().slice(0, 10);
  const regular = eps.filter((e) => !e.special && e.season > 0);
  const airedEps = regular.filter((e) => e.airDate && e.airDate <= today);
  const watchedCount = regular.filter((e) => e.watched).length;
  const unwatchedAired = airedEps
    .filter((e) => !e.watched)
    .sort((a, b) => a.season - b.season || a.number - b.number);
  const nextEp = unwatchedAired[0];

  let status: ShowProgress['status'];
  if (show.archived) status = 'stopped';
  else if (watchedCount === 0) status = 'notstarted';
  else if (unwatchedAired.length === 0) status = show.ended ? 'finished' : 'uptodate';
  else status = 'watching';

  return { aired: airedEps.length, watched: watchedCount, total: regular.length, nextEp, status };
}

/** Minuti guardati totali (serie + film). */
export function minutesOf(eps: Episode[], shows: Map<number, Show>, movies: Movie[]) {
  let min = 0;
  for (const e of eps) {
    if (!e.watched) continue;
    min += (e.runtime || shows.get(e.showId)?.runtime || 40) * (e.timesWatched || 1);
  }
  for (const m of movies) if (m.watched) min += m.runtime || 110;
  return min;
}

// ---- Backup nativo Seriality ----

export async function exportBackup(): Promise<string> {
  const [shows, episodes, movies] = await Promise.all([
    db.shows.toArray(),
    db.episodes.toArray(),
    db.movies.toArray(),
  ]);
  return JSON.stringify(
    { seriality: 1, exportedAt: nowIso(), shows, episodes, movies },
    null,
    1,
  );
}

export async function wipeAll() {
  await Promise.all([db.shows.clear(), db.episodes.clear(), db.movies.clear()]);
}
