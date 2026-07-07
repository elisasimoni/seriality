// "Consigliati per te": raccomandazioni personali costruite dalla libreria.
//
// Come funziona:
//  1. sceglie i "semi" del gusto: le serie/film con voto alto o preferiti,
//     altrimenti quelli guardati più di recente
//  2. per ogni seme chiede a TMDB le recommendations → una riga "Perché ti è piaciuto X"
//  3. aggiunge le tendenze della settimana
//  4. esclude tutto ciò che è già in libreria; cache 12h in IndexedDB (kv)

import { db, normTitle } from './db';
import {
  findTvByTvdb, hasTmdb, movieRecommendations, posterUrl,
  trendingWeek, tvRecommendations,
} from './tmdb';
import type { Show } from './types';

export interface Rec {
  kind: 'tv' | 'movie';
  tmdbId: number;
  name: string;
  poster?: string;
  year?: string;
  vote?: number;
  overview?: string;
}

export interface RecSection { title: string; items: Rec[] }

const CACHE_KEY = 'recs-v1';
const CACHE_TTL = 12 * 3600 * 1000;

export async function getRecommendations(force = false): Promise<RecSection[]> {
  if (!hasTmdb()) return [];
  if (!force) {
    const cached = (await db.kv.get(CACHE_KEY))?.value as { builtAt: number; sections: RecSection[] } | undefined;
    if (cached && Date.now() - cached.builtAt < CACHE_TTL) return cached.sections;
  }
  const sections = await build();
  await db.kv.put({ key: CACHE_KEY, value: { builtAt: Date.now(), sections } });
  return sections;
}

async function build(): Promise<RecSection[]> {
  const [shows, movies] = await Promise.all([db.shows.toArray(), db.movies.toArray()]);

  // già in libreria → da escludere dai consigli
  const libShowNames = new Set(shows.map((s) => normTitle(s.name)));
  const libMovieTmdb = new Set(movies.map((m) => m.tmdbId).filter(Boolean));
  const libMovieNames = new Set(movies.map((m) => normTitle(m.name)));
  const isKnown = (r: Rec) =>
    r.kind === 'tv' ? libShowNames.has(normTitle(r.name))
      : libMovieTmdb.has(r.tmdbId) || libMovieNames.has(normTitle(r.name));

  // semi: preferiti e voti alti prima, poi attività recente
  const score = (fav?: boolean, rating?: number, recent?: string) =>
    (fav ? 100 : 0) + (rating ?? 0) * 5 + (recent ? Math.min(10, (Date.parse(recent) || 0) / 1e12) : 0);
  const seedShows = shows
    .filter((s) => !s.archived && !s.muted && s.id < 1000000000)
    .sort((a, b) => score(b.favorite, b.rating, b.lastActivityAt) - score(a.favorite, a.rating, a.lastActivityAt))
    .slice(0, 4);
  const seedMovies = movies
    .filter((m) => m.watched && m.tmdbId)
    .sort((a, b) => score(b.favorite, b.rating, b.watchedAt) - score(a.favorite, a.rating, a.watchedAt))
    .slice(0, 4);

  const sections: RecSection[] = [];
  const seen = new Set<string>(); // dedupe cross-sezione

  const pick = (items: Rec[], n = 10) => {
    const out: Rec[] = [];
    for (const r of items) {
      const k = `${r.kind}:${r.tmdbId}`;
      if (isKnown(r) || seen.has(k)) continue;
      seen.add(k);
      out.push(r);
      if (out.length >= n) break;
    }
    return out;
  };

  // mappa tvdb→tmdb per i semi serie (cache persistente: costa una chiamata l'una)
  const tvdb2tmdb = ((await db.kv.get('tvdb2tmdb'))?.value ?? {}) as Record<string, number>;

  const showRows: RecSection[] = [];
  for (const s of seedShows) {
    let tmdbId = tvdb2tmdb[s.id];
    if (!tmdbId) {
      const found = await findTvByTvdb(s.id);
      if (found) { tmdbId = found.id; tvdb2tmdb[s.id] = found.id; }
    }
    if (!tmdbId) continue;
    const recs = (await tvRecommendations(tmdbId)).map((r): Rec => ({
      kind: 'tv', tmdbId: r.id, name: r.name, poster: posterUrl(r.poster_path),
      year: r.first_air_date?.slice(0, 4), vote: r.vote_average, overview: r.overview,
    }));
    const items = pick(recs, 8);
    if (items.length >= 3) showRows.push({ title: `Perché segui «${s.name}»`, items });
  }
  await db.kv.put({ key: 'tvdb2tmdb', value: tvdb2tmdb });

  const movieRows: RecSection[] = [];
  for (const m of seedMovies) {
    const recs = (await movieRecommendations(m.tmdbId!)).map((r): Rec => ({
      kind: 'movie', tmdbId: r.id, name: r.title, poster: posterUrl(r.poster_path),
      year: r.release_date?.slice(0, 4), vote: r.vote_average, overview: r.overview,
    }));
    const items = pick(recs, 8);
    if (items.length >= 3) {
      movieRows.push({ title: `Perché hai visto «${m.name}»${m.rating ? ` (${m.rating}/10)` : ''}`, items });
    }
  }

  // alterna righe serie/film per varietà
  const maxLen = Math.max(showRows.length, movieRows.length);
  for (let i = 0; i < maxLen; i++) {
    if (showRows[i]) sections.push(showRows[i]);
    if (movieRows[i]) sections.push(movieRows[i]);
  }

  const trending = (await trendingWeek())
    .filter((t) => t.media_type === 'tv' || t.media_type === 'movie')
    .map((t): Rec => (t.media_type === 'tv'
      ? { kind: 'tv', tmdbId: t.id, name: t.name, poster: posterUrl(t.poster_path), year: t.first_air_date?.slice(0, 4), vote: t.vote_average, overview: t.overview }
      : { kind: 'movie', tmdbId: t.id, name: t.title, poster: posterUrl(t.poster_path), year: t.release_date?.slice(0, 4), vote: t.vote_average, overview: t.overview }));
  const trendItems = pick(trending, 12);
  if (trendItems.length) sections.push({ title: '🔥 Di tendenza questa settimana', items: trendItems });

  return sections;
}

/** Serie usate come semi (per il sottotitolo della pagina). */
export function tasteSummary(shows: Show[]): string {
  const genres = new Map<string, number>();
  for (const s of shows) for (const g of s.genres ?? []) genres.set(g, (genres.get(g) ?? 0) + 1);
  return [...genres.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([g]) => g).join(', ');
}
