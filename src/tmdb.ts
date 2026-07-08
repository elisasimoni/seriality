// TMDB (The Movie Database) — usato per i FILM: ricerca, poster, runtime, generi.
// La chiave arriva da .env.local (VITE_TMDB_KEY, riusata dal progetto TvChoicer)
// o può essere sovrascritta dalle Impostazioni (localStorage).
// Supporta sia API Key v3 sia Read Access Token v4 (Bearer), come in TvChoicer.

import { db } from './db';
import type { Movie } from './types';

const BASE = 'https://api.themoviedb.org/3';
const IMG = 'https://image.tmdb.org/t/p';
const LANG = 'it-IT';

export function tmdbKey(): string {
  return localStorage.getItem('seriality-tmdb-key')?.trim()
    || (import.meta.env.VITE_TMDB_KEY as string | undefined)?.trim()
    || '';
}
export const hasTmdb = () => !!tmdbKey();

let lastCall = 0;
async function tmdb(path: string, params: Record<string, string> = {}): Promise<unknown> {
  const key = tmdbKey();
  if (!key) throw new Error('Chiave TMDB mancante');
  const wait = Math.max(0, lastCall + 120 - Date.now());
  if (wait) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();

  const isV4 = key.split('.').length === 3 || key.length > 60;
  const url = new URL(BASE + path);
  url.searchParams.set('language', LANG);
  for (const [k, v] of Object.entries(params)) if (v) url.searchParams.set(k, v);
  if (!isV4) url.searchParams.set('api_key', key);

  const headers: Record<string, string> = { accept: 'application/json' };
  if (isV4) headers.Authorization = `Bearer ${key}`;
  const res = await fetch(url, { headers });
  if (res.status === 429) {
    await new Promise((r) => setTimeout(r, 2000));
    return tmdb(path, params);
  }
  if (!res.ok) throw new Error(`TMDB ${res.status}`);
  return res.json();
}

export const posterUrl = (path?: string | null, size = 'w342') =>
  path ? `${IMG}/${size}${path}` : undefined;

export interface TmdbMovie {
  id: number; title: string; original_title?: string; overview?: string;
  poster_path?: string | null; backdrop_path?: string | null;
  release_date?: string; runtime?: number; vote_average?: number;
  genres?: { name: string }[]; genre_ids?: number[]; imdb_id?: string;
}

export interface TmdbTv {
  id: number; name: string; overview?: string;
  poster_path?: string | null; backdrop_path?: string | null;
  first_air_date?: string; vote_average?: number;
}

export async function searchMovies(query: string): Promise<TmdbMovie[]> {
  const data = (await tmdb('/search/movie', { query })) as { results?: TmdbMovie[] };
  return data.results ?? [];
}

async function movieDetails(id: number): Promise<TmdbMovie | null> {
  try { return (await tmdb(`/movie/${id}`)) as TmdbMovie; } catch { return null; }
}

async function findByImdb(imdbId: string): Promise<TmdbMovie | null> {
  try {
    const data = (await tmdb(`/find/${imdbId}`, { external_source: 'imdb_id' })) as { movie_results?: TmdbMovie[] };
    return data.movie_results?.[0] ?? null;
  } catch { return null; }
}

/** Trova la serie TMDB corrispondente a un id TVDB (gli id che usa Seriality). */
export async function findTvByTvdb(tvdbId: number): Promise<TmdbTv | null> {
  try {
    const data = (await tmdb(`/find/${tvdbId}`, { external_source: 'tvdb_id' })) as { tv_results?: TmdbTv[] };
    return data.tv_results?.[0] ?? null;
  } catch { return null; }
}

export async function tvRecommendations(tmdbTvId: number): Promise<TmdbTv[]> {
  try {
    const data = (await tmdb(`/tv/${tmdbTvId}/recommendations`)) as { results?: TmdbTv[] };
    return data.results ?? [];
  } catch { return []; }
}

export async function movieRecommendations(tmdbMovieId: number): Promise<TmdbMovie[]> {
  try {
    const data = (await tmdb(`/movie/${tmdbMovieId}/recommendations`)) as { results?: TmdbMovie[] };
    return data.results ?? [];
  } catch { return []; }
}

export async function trendingWeek(): Promise<Array<(TmdbTv & TmdbMovie) & { media_type: string }>> {
  try {
    const data = (await tmdb('/trending/all/week')) as { results?: Array<(TmdbTv & TmdbMovie) & { media_type: string }> };
    return data.results ?? [];
  } catch { return []; }
}

// ---- cast, persone, trailer, provider (per le pagine di dettaglio) ----

export interface TmdbCastMember {
  id: number; name: string; profile_path?: string | null; character?: string;
}

/** Cast di una serie (aggregate = tutti i ruoli su tutte le stagioni). */
export async function tvCredits(tmdbTvId: number): Promise<TmdbCastMember[]> {
  try {
    const data = (await tmdb(`/tv/${tmdbTvId}/aggregate_credits`)) as {
      cast?: Array<{ id: number; name: string; profile_path?: string | null; roles?: { character: string }[] }>;
    };
    return (data.cast ?? []).slice(0, 20).map((c) => ({
      id: c.id, name: c.name, profile_path: c.profile_path, character: c.roles?.[0]?.character,
    }));
  } catch { return []; }
}

export async function movieCredits(tmdbMovieId: number): Promise<TmdbCastMember[]> {
  try {
    const data = (await tmdb(`/movie/${tmdbMovieId}/credits`)) as {
      cast?: Array<{ id: number; name: string; profile_path?: string | null; character?: string }>;
    };
    return (data.cast ?? []).slice(0, 20);
  } catch { return []; }
}

export interface TmdbPerson {
  id: number; name: string; biography?: string; birthday?: string | null;
  deathday?: string | null; place_of_birth?: string | null;
  profile_path?: string | null; known_for_department?: string;
  also_known_as?: string[]; homepage?: string | null; imdb_id?: string | null;
}

export async function personDetails(personId: number): Promise<TmdbPerson | null> {
  try { return (await tmdb(`/person/${personId}`)) as TmdbPerson; } catch { return null; }
}

export interface TmdbCredit {
  media_type: 'tv' | 'movie'; id: number; title?: string; name?: string;
  poster_path?: string | null; character?: string; vote_average?: number;
  release_date?: string; first_air_date?: string; episode_count?: number; popularity?: number;
}

/** Filmografia completa (serie + film) di una persona. */
export async function personCombinedCredits(personId: number): Promise<TmdbCredit[]> {
  try {
    const data = (await tmdb(`/person/${personId}/combined_credits`)) as { cast?: TmdbCredit[] };
    const seen = new Set<string>();
    return (data.cast ?? [])
      .filter((c) => {
        const k = `${c.media_type}:${c.id}`;
        if (seen.has(k) || (c.media_type !== 'tv' && c.media_type !== 'movie')) return false;
        seen.add(k);
        return true;
      })
      .sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0));
  } catch { return []; }
}

/** URL YouTube del trailer (preferisce trailer ufficiali). */
export async function trailerUrl(kind: 'tv' | 'movie', id: number): Promise<string | undefined> {
  try {
    const data = (await tmdb(`/${kind}/${id}/videos`, { include_video_language: 'it,en' })) as {
      results?: Array<{ site: string; type: string; key: string; official?: boolean }>;
    };
    const vids = (data.results ?? []).filter((v) => v.site === 'YouTube');
    const best = vids.find((v) => v.type === 'Trailer' && v.official)
      ?? vids.find((v) => v.type === 'Trailer') ?? vids[0];
    return best ? `https://www.youtube.com/watch?v=${best.key}` : undefined;
  } catch { return undefined; }
}

export interface WatchProvider { provider_name: string; logo_path?: string | null }

/** Piattaforme streaming in Italia (dati JustWatch via TMDB). */
export async function watchProviders(kind: 'tv' | 'movie', id: number): Promise<{ flatrate: WatchProvider[]; link?: string }> {
  try {
    const data = (await tmdb(`/${kind}/${id}/watch/providers`)) as {
      results?: Record<string, { link?: string; flatrate?: WatchProvider[]; ads?: WatchProvider[] }>;
    };
    const it = data.results?.['IT'];
    return { flatrate: [...(it?.flatrate ?? []), ...(it?.ads ?? [])].slice(0, 8), link: it?.link };
  } catch { return { flatrate: [] }; }
}

export interface TmdbTvDetails extends TmdbTv {
  genres?: { name: string }[];
  networks?: { name: string }[];
  number_of_seasons?: number;
  number_of_episodes?: number;
  status?: string;
  last_air_date?: string;
  episode_run_time?: number[];
  seasons?: { season_number: number; episode_count: number; name: string; air_date?: string | null }[];
}

export async function tvDetails(tmdbTvId: number): Promise<TmdbTvDetails | null> {
  try { return (await tmdb(`/tv/${tmdbTvId}`)) as TmdbTvDetails; } catch { return null; }
}

export interface TmdbSeasonEpisode {
  episode_number: number; season_number: number; name?: string;
  overview?: string; air_date?: string | null; still_path?: string | null;
  runtime?: number | null; vote_average?: number;
}

/** Episodi di una stagione, con sinossi (in italiano quando disponibile). */
export async function seasonDetails(tmdbTvId: number, season: number): Promise<TmdbSeasonEpisode[]> {
  try {
    const data = (await tmdb(`/tv/${tmdbTvId}/season/${season}`)) as { episodes?: TmdbSeasonEpisode[] };
    return data.episodes ?? [];
  } catch { return []; }
}

export async function searchTv(query: string): Promise<TmdbTv[]> {
  try {
    const data = (await tmdb('/search/tv', { query })) as { results?: TmdbTv[] };
    return data.results ?? [];
  } catch { return []; }
}

// ---- per i consigli AI (porting da TvChoicer): generi TV, discover, ricerca ----

export interface RawTv {
  id: number; name?: string; original_name?: string; overview?: string;
  first_air_date?: string; vote_average?: number; vote_count?: number;
  genre_ids?: number[]; origin_country?: string[]; popularity?: number;
  poster_path?: string | null;
}

let _tvGenres: Map<number, string> | null = null;
export async function tvGenreMap(): Promise<Map<number, string>> {
  if (_tvGenres) return _tvGenres;
  const data = (await tmdb('/genre/tv/list')) as { genres?: { id: number; name: string }[] };
  _tvGenres = new Map((data.genres ?? []).map((g) => [g.id, g.name]));
  return _tvGenres;
}

export async function discoverTvRaw(params: Record<string, string>): Promise<RawTv[]> {
  try {
    const data = (await tmdb('/discover/tv', params)) as { results?: RawTv[] };
    return data.results ?? [];
  } catch { return []; }
}

export async function searchTvRaw(query: string): Promise<RawTv[]> {
  try {
    const data = (await tmdb('/search/tv', { query, include_adult: 'false' })) as { results?: RawTv[] };
    return data.results ?? [];
  } catch { return []; }
}

export interface RawMovie {
  id: number; title?: string; original_title?: string; overview?: string;
  release_date?: string; vote_average?: number; vote_count?: number;
  genre_ids?: number[]; original_language?: string; popularity?: number;
  poster_path?: string | null;
}

let _movieGenres: Map<number, string> | null = null;
export async function movieGenreMap(): Promise<Map<number, string>> {
  if (_movieGenres) return _movieGenres;
  const data = (await tmdb('/genre/movie/list')) as { genres?: { id: number; name: string }[] };
  _movieGenres = new Map((data.genres ?? []).map((g) => [g.id, g.name]));
  return _movieGenres;
}

export async function discoverMovieRaw(params: Record<string, string>): Promise<RawMovie[]> {
  try {
    const data = (await tmdb('/discover/movie', params)) as { results?: RawMovie[] };
    return data.results ?? [];
  } catch { return []; }
}

export async function searchMovieRaw(query: string): Promise<RawMovie[]> {
  try {
    const data = (await tmdb('/search/movie', { query, include_adult: 'false' })) as { results?: RawMovie[] };
    return data.results ?? [];
  } catch { return []; }
}

export async function movieDetailsById(id: number): Promise<TmdbMovie | null> {
  return movieDetails(id);
}

/** Id esterni (tvdb/imdb) di una serie TMDB — serve per seguirla in Seriality. */
export async function tvExternalIds(tmdbTvId: number): Promise<{ tvdb_id?: number | null; imdb_id?: string | null }> {
  try {
    return (await tmdb(`/tv/${tmdbTvId}/external_ids`)) as { tvdb_id?: number | null; imdb_id?: string | null };
  } catch { return {}; }
}

function applyDetails(m: Movie, d: TmdbMovie): Partial<Movie> {
  return {
    tmdbId: d.id,
    poster: m.poster || posterUrl(d.poster_path),
    fanart: m.fanart || posterUrl(d.backdrop_path, 'w780'),
    overview: m.overview || d.overview || undefined,
    runtime: m.runtime || d.runtime || undefined,
    releaseDate: m.releaseDate || d.release_date || undefined,
    genres: m.genres?.length ? m.genres : d.genres?.map((g) => g.name),
    imdbId: m.imdbId || d.imdb_id || undefined,
  };
}

export interface MovieEnrichProgress { done: number; total: number; running: boolean }
const listeners = new Set<(p: MovieEnrichProgress) => void>();
let progress: MovieEnrichProgress = { done: 0, total: 0, running: false };
let running = false;

export function onMovieEnrichProgress(fn: (p: MovieEnrichProgress) => void) {
  listeners.add(fn);
  fn(progress);
  return () => { listeners.delete(fn); };
}
const emit = (p: MovieEnrichProgress) => { progress = p; listeners.forEach((f) => f(p)); };

/** Completa i film senza poster/runtime (es. import CineTrak) usando TMDB. */
export async function enrichMovies() {
  if (running || !hasTmdb()) return;
  running = true;
  try {
    const movies = await db.movies.toArray();
    const todo = movies.filter((m) => !m.poster || !m.runtime || !m.tmdbId);
    emit({ done: 0, total: todo.length, running: true });
    let done = 0;
    for (const m of todo) {
      try {
        let d: TmdbMovie | null = null;
        if (m.tmdbId) d = await movieDetails(m.tmdbId);
        if (!d && m.imdbId) {
          const found = await findByImdb(m.imdbId);
          if (found) d = (await movieDetails(found.id)) ?? found;
        }
        if (!d) {
          const year = m.releaseDate?.slice(0, 4);
          const results = (await tmdb('/search/movie', {
            query: m.name, ...(year ? { year } : {}),
          })) as { results?: TmdbMovie[] };
          const hit = results.results?.[0];
          if (hit) d = (await movieDetails(hit.id)) ?? hit;
        }
        if (d) await db.movies.update(m.key, applyDetails(m, d));
      } catch { /* rete: riproveremo al prossimo giro */ }
      emit({ done: ++done, total: todo.length, running: true });
    }
    emit({ done, total: todo.length, running: false });
  } finally {
    running = false;
  }
}
