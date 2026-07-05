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

export async function setEpisodeWatched(ep: Episode, watched: boolean) {
  await db.episodes.update(ep.key, {
    watched: watched ? 1 : 0,
    watchedAt: watched ? nowIso() : undefined,
    timesWatched: watched ? Math.max(1, ep.timesWatched ?? 0) : 0,
  });
  await db.shows.update(ep.showId, { lastActivityAt: nowIso() });
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
