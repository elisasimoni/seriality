// Motore di ingestion: accetta QUALSIASI salvataggio TV Time e lo normalizza.
//
// Formati riconosciuti (auto-rilevati dal contenuto, non solo dal nome file):
//  1. Export GDPR nuovo (2026): zip di cartelle con file .json ("tracking records":
//     oggetti { type, entity_type, uuid, watched_at, filter, meta:{...} })
//  2. Export GDPR 2023-2025: tracking-prod-records.csv / tracking-prod-records-v2.csv
//  3. Export legacy: seen_episode.csv, followed_tv_show.csv, favorite_tv_show.csv, ...
//  4. JSON dell'API live (api2/msapi, come il tool tvtime-mcp o tools/export_from_api.py)
//  5. Backup nativi di Seriality ({ seriality: 1, ... })
//  6. Export film di CineTrak / Letterboxd / CSV generici con colonne
//     titolo + (tmdb_id | imdb_id | anno | data visione | voto)
//  7. Export Trakt (usato anche da CineTrak): watched-movies-*.json,
//     watched-shows.json, watched-history-*.json, ratings-*.json, lists-*.json

import JSZip from 'jszip';
import Papa from 'papaparse';
import type {
  EpisodeWatch, ImportResult, ImportedMovie, ImportedShow,
} from './types';
import type { Episode, Movie, Show } from './types';
import { db, epKey, nowIso } from './db';

interface NamedText { name: string; text: string }

export interface NativeBackup { shows: Show[]; episodes: Episode[]; movies: Movie[] }

export interface ParseOutput extends ImportResult { native?: NativeBackup }

// ---------- entry point ----------

export async function parseFiles(files: { name: string; data: ArrayBuffer }[]): Promise<ParseOutput> {
  const out: ParseOutput = { shows: [], episodeWatches: [], movies: [], report: [] };
  const texts: NamedText[] = [];

  for (const f of files) {
    if (/\.zip$/i.test(f.name)) {
      try {
        const zip = await JSZip.loadAsync(f.data);
        const entries = Object.values(zip.files).filter((e) => !e.dir);
        out.report.push(`📦 ${f.name}: ${entries.length} file nello zip`);
        for (const e of entries) {
          if (/\.(csv|json|txt)$/i.test(e.name)) {
            texts.push({ name: e.name, text: await e.async('text') });
          }
        }
      } catch {
        out.report.push(`⚠️ ${f.name}: zip non leggibile, ignorato`);
      }
    } else if (/\.(csv|json|txt)$/i.test(f.name)) {
      texts.push({ name: f.name, text: new TextDecoder().decode(f.data) });
    } else {
      out.report.push(`⏭️ ${f.name}: formato non supportato, ignorato`);
    }
  }

  for (const t of texts) parseText(t, out);

  dedupe(out);
  return out;
}

// File degli export Trakt/CineTrak che NON vanno importati: contengono
// suggerimenti nascosti, progressi di riproduzione parziali, commenti, note…
// importarli creerebbe serie/film mai seguiti davvero.
const SKIP_FILES = /hidden-|watched-playback|comments-|notes-|network-|user-settings|user-profile|user-stats|lists-lists|lists-collaborations/i;

function parseText(t: NamedText, out: ParseOutput) {
  const base = t.name.split('/').pop() ?? t.name;
  if (SKIP_FILES.test(base)) {
    out.report.push(`⏭️ ${base}: ignorato (dati non di tracking)`);
    return;
  }
  const trimmed = t.text.trim();
  if (!trimmed) return;
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const json = JSON.parse(trimmed);
      parseJson(t.name, json, out);
      return;
    } catch {
      /* magari è un csv che inizia con { in un campo — prova csv */
    }
  }
  parseCsv(t, out);
}

// ---------- CSV (export GDPR vecchi e legacy) ----------

function parseCsv(t: NamedText, out: ParseOutput) {
  const res = Papa.parse<Record<string, string>>(t.text, {
    header: true, skipEmptyLines: true, transformHeader: (h) => h.trim().toLowerCase(),
  });
  const rows = res.data;
  if (!rows.length) return;
  const cols = Object.keys(rows[0]);
  const has = (...names: string[]) => names.some((n) => cols.includes(n));
  const before = counts(out);

  if (has('entity_type') || has('series_id', 'series_name') || has('movie_id', 'movie_name')) {
    // tracking-prod-records*.csv — colonne variabili tra versioni
    for (const r of rows) trackingCsvRow(r, out);
    out.report.push(`📄 ${t.name}: formato "tracking records" (${rows.length} righe) → ${delta(before, out)}`);
  } else if (has('episode_id') && has('tv_show_id')) {
    // seen_episode.csv (legacy): non c'è stagione/numero → conteggio da rimappare
    for (const r of rows) {
      const showId = num(r['tv_show_id']);
      if (!showId) continue;
      out.episodeWatches.push({
        tvdbShowId: showId,
        tvdbEpisodeId: num(r['episode_id']),
        watchedAt: iso(r['created_at'] || r['updated_at']),
      });
    }
    out.report.push(`📄 ${t.name}: seen_episode legacy (${rows.length} righe) → ${delta(before, out)}`);
  } else if (has('tv_show_id')) {
    // followed_tv_show.csv / favorite_tv_show.csv / rating legacy
    const fav = /favou?rite/i.test(t.name);
    for (const r of rows) {
      const showId = num(r['tv_show_id']);
      if (!showId) continue;
      out.shows.push({
        tvdbId: showId,
        name: r['tv_show_name'] || r['name'] || undefined,
        followedAt: iso(r['created_at']),
        archived: bool(r['archived']) || undefined,
        favorite: fav || bool(r['is_favorite']) || undefined,
        rating: num(r['rating']) || undefined,
      });
    }
    out.report.push(`📄 ${t.name}: elenco serie legacy (${rows.length} righe) → ${delta(before, out)}`);
  } else if (
    has('title', 'name', 'show', 'series', 'titolo')
    && has('season', 'season_number', 'season number')
    && has('episode', 'episode_number', 'episode number', 'number')
  ) {
    // CSV episodi generico (CineTrak serie, Trakt, ...): titolo + stagione + episodio
    let n = 0;
    for (const r of rows) {
      const showName = r['show'] || r['series'] || r['title'] || r['name'] || r['titolo'];
      const season = num(r['season'] ?? r['season_number'] ?? r['season number']);
      const episode = num(r['episode'] ?? r['episode_number'] ?? r['episode number'] ?? r['number']);
      if (!showName || season == null || episode == null) continue;
      out.episodeWatches.push({
        showName,
        season,
        number: episode,
        watchedAt: iso(r['watched_at'] || r['watched date'] || r['watched_date'] || r['date'] || r['created_at']),
        rating: num(r['rating'] ?? r['voto']) || undefined,
      });
      out.shows.push({ name: showName });
      n++;
    }
    out.report.push(`📄 ${t.name}: episodi (${n} righe, CSV generico) → ${delta(before, out)}`);
  } else if (has('movie_name', 'movie_id', 'title', 'name', 'titolo')) {
    // CSV film generico: CineTrak, Letterboxd, IMDb, TV Time movies…
    // colonne rilevate per nome tra i tanti alias usati dalle varie app
    const watchlistFile = /watchlist|da.?vedere|to.?watch/i.test(t.name);
    let n = 0;
    for (const r of rows) {
      const name = r['movie_name'] || r['title'] || r['name'] || r['titolo'] || r['original title'];
      if (!name) continue;
      const tmdbId = num(r['tmdb_id'] ?? r['tmdbid'] ?? r['tmdb']);
      const imdbRaw = r['imdb_id'] || r['imdbid'] || r['imdb'] || r['const'];
      const imdbId = imdbRaw && /^tt\d+/.test(imdbRaw) ? imdbRaw : undefined;
      const watchedAt = iso(r['watched_at'] || r['watched date'] || r['watched_date'] || r['watcheddate'] || r['date'] || r['data'] || r['created_at']);
      const year = (r['year'] || r['anno'] || '').trim();
      // voto: CineTrak/IMDb 0-10, Letterboxd 0-5 (scala ×2)
      let rating = num(r['rating'] ?? r['your rating'] ?? r['voto'] ?? r['vote']);
      if (rating != null && rating > 0 && rating <= 5 && has('letterboxd uri')) rating *= 2;
      const inWatchlist = has('watchlist') ? bool(r['watchlist']) : watchlistFile;
      const watched = r['watched'] != null
        ? bool(r['watched'])
        : (!!watchedAt || !inWatchlist);
      out.movies.push({
        name,
        tmdbId: tmdbId || undefined,
        imdbId,
        watched,
        watchedAt,
        rating: rating || undefined,
        releaseDate: year && /^\d{4}$/.test(year) ? `${year}-01-01` : iso(r['release date'] || r['release_date'])?.slice(0, 10),
        favorite: bool(r['favorite'] ?? r['is_favorite'] ?? r['preferito']) || undefined,
      });
      n++;
    }
    out.report.push(`🍿 ${t.name}: film (${n} righe, formato CineTrak/generico) → ${delta(before, out)}`);
  } else {
    out.report.push(`⏭️ ${t.name}: colonne CSV non riconosciute (${cols.slice(0, 6).join(', ')}…)`);
  }
}

function trackingCsvRow(r: Record<string, string>, out: ParseOutput) {
  const entity = (r['entity_type'] || r['type'] || '').toLowerCase();
  const seriesId = num(r['series_id'] || r['tv_show_id'] || r['show_id']);
  const seriesName = r['series_name'] || r['show_name'] || r['tv_show_name'];
  const season = num(r['season_number'] ?? r['season']);
  const episode = num(r['episode_number'] ?? r['episode'] ?? r['number']);
  const watchedAt = iso(r['watched_at'] || r['seen_date'] || r['updated_at'] || r['created_at']);
  const rating = num(r['rating']);

  const isEpisode = entity === 'episode' || (episode != null && (seriesId != null || !!seriesName));
  if (isEpisode) {
    // TV Time segna "watched=FALSE" per gli episodi in watchlist non visti
    const watchedFlag = r['watched'] != null ? bool(r['watched']) : !!r['watched_at'];
    out.episodeWatches.push({
      tvdbShowId: seriesId ?? undefined,
      showName: seriesName || undefined,
      season: season ?? undefined,
      number: episode ?? undefined,
      watchedAt,
      rating: rating || undefined,
      timesWatched: num(r['nb_times_watched'] ?? r['times_watched']) || undefined,
      special: bool(r['special'] ?? r['special_episode']) || undefined,
      episodeName: r['episode_name'] || undefined,
      ...(watchedFlag ? {} : { watchedAt: undefined, notWatched: true } as object),
    } as EpisodeWatch & { notWatched?: boolean });
    if (seriesId || seriesName) {
      out.shows.push({ tvdbId: seriesId ?? undefined, name: seriesName || undefined });
    }
    return;
  }
  if (entity === 'series' || (seriesId != null || seriesName)) {
    out.shows.push({
      tvdbId: seriesId ?? undefined,
      name: seriesName || undefined,
      followedAt: iso(r['created_at']) || watchedAt,
      archived: bool(r['archived'] ?? r['stopped']) || undefined,
      favorite: bool(r['favorite'] ?? r['is_favorite']) || undefined,
      rating: rating || undefined,
    });
    return;
  }
  if (entity === 'movie' || r['movie_name'] || r['movie_id']) {
    const name = r['movie_name'] || r['name'] || r['title'] || r['series_name'];
    if (!name && !r['movie_id']) return;
    out.movies.push({
      name: name || `Film ${r['movie_id']}`,
      tvdbId: num(r['movie_id']) || undefined,
      watched: r['watched'] != null ? bool(r['watched']) : !!watchedAt,
      watchedAt,
      followedAt: iso(r['created_at']),
      rating: rating || undefined,
      favorite: bool(r['favorite'] ?? r['is_favorite']) || undefined,
    });
  }
}

// ---------- JSON (export GDPR nuovo, API live, backup Seriality) ----------

function parseJson(name: string, json: unknown, out: ParseOutput) {
  // Backup nativo Seriality
  if (isObj(json) && json['seriality'] && Array.isArray(json['shows'])) {
    out.native = {
      shows: (json['shows'] as Show[]) || [],
      episodes: (json['episodes'] as Episode[]) || [],
      movies: (json['movies'] as Movie[]) || [],
    };
    out.report.push(`💾 ${name}: backup Seriality (${out.native.shows.length} serie, ${out.native.episodes.length} episodi, ${out.native.movies.length} film)`);
    return;
  }
  const base = name.split('/').pop() ?? name;
  const ctx: JsonCtx = {
    favorite: /favorite/i.test(base),
    watchlist: /watchlist/i.test(base),
  };
  const before = counts(out);
  walk(json, out, 0, ctx);
  out.report.push(`📄 ${name}: JSON → ${delta(before, out)}`);
}

interface JsonCtx { favorite?: boolean; watchlist?: boolean }

function walk(node: unknown, out: ParseOutput, depth: number, ctx: JsonCtx) {
  if (depth > 12 || node == null) return;
  if (Array.isArray(node)) { for (const item of node) walk(item, out, depth + 1, ctx); return; }
  if (!isObj(node)) return;
  if (classify(node, out, ctx)) return; // oggetto riconosciuto: non scendere nei figli
  for (const v of Object.values(node)) walk(v, out, depth + 1, ctx);
}

/** Prova a riconoscere un oggetto JSON come record TV Time / Trakt / CineTrak. */
function classify(o: Record<string, unknown>, out: ParseOutput, ctx: JsonCtx = {}): boolean {
  if (classifyTrakt(o, out, ctx)) return true;
  // --- formato api2: episodio visto / da vedere ({id, number, season_number, show:{...}}) ---
  if (o['season_number'] != null && o['number'] != null && isObj(o['show'])) {
    const show = o['show'] as Record<string, unknown>;
    const showId = num(show['id']);
    if (showId) {
      out.shows.push({
        tvdbId: showId,
        name: str(show['name']),
        poster: firstImage(show['all_images'], 'poster'),
        fanart: firstImage(show['all_images'], 'fanart'),
        ended: typeof show['is_ended'] === 'boolean' ? (show['is_ended'] as boolean) : undefined,
        runtime: secToMin(num(show['runtime'])),
      });
      const seen = o['seen'] === true || o['is_watched'] === true || !!o['seen_date'];
      if (seen) {
        out.episodeWatches.push({
          tvdbShowId: showId,
          showName: str(show['name']),
          season: num(o['season_number'])!,
          number: num(o['number'])!,
          episodeName: str(o['name']),
          watchedAt: iso(str(o['seen_date'])),
          timesWatched: num(o['nb_times_watched']) || undefined,
          special: o['is_special'] === true || undefined,
        });
      }
      return true;
    }
  }

  // --- formato msapi/GDPR nuovo: tracking record { entity_type, meta, watched_at, filter } ---
  const entity = str(o['entity_type'])?.toLowerCase();
  if (entity && ['movie', 'series', 'show', 'episode'].includes(entity)) {
    const meta = isObj(o['meta']) ? (o['meta'] as Record<string, unknown>) : {};
    const filter = Array.isArray(o['filter']) ? (o['filter'] as unknown[]).map(String) : [];
    // per le serie msapi l'id TVDB è in meta.id; per i film è in external_sources
    const tvdbId = extSource(meta, 'tvdb') ?? extSource(o, 'tvdb') ?? num(meta['id']) ?? num(o['entity_id']);
    const watchedAt = iso(str(o['watched_at'])) || undefined;

    if (entity === 'movie') {
      const name = str(meta['name']) || str(o['name']) || (tvdbId ? `Film ${tvdbId}` : '');
      if (!name) return true;
      out.movies.push({
        uuid: str(o['uuid']) || str(meta['uuid']),
        name,
        tvdbId: tvdbId ?? undefined,
        imdbId: str(meta['imdb_id']) || undefined,
        watched: filter.includes('watched') || !!watchedAt,
        watchedAt,
        followedAt: iso(str(o['created_at'])),
        rating: num(o['rating']) || undefined,
        favorite: filter.includes('favorite') || undefined,
        runtime: secToMin(num(meta['runtime'])),
        poster: deepFirstUrl(meta['posters']) || deepFirstUrl(meta['poster']),
        fanart: deepFirstUrl(meta['fanart']) || deepFirstUrl(meta['backdrops']),
        genres: strArr(meta['genres']),
        overview: str(meta['overview']) || undefined,
        releaseDate: str(meta['first_release_date']) || undefined,
      });
      return true;
    }

    if (entity === 'series' || entity === 'show') {
      out.shows.push({
        tvdbId: tvdbId ?? undefined,
        name: str(meta['name']) || str(o['name']) || undefined,
        followedAt: iso(str(o['created_at'])),
        archived: filter.some((f) => f.startsWith('stopped') || f === 'archived') || undefined,
        favorite: filter.some((f) => f.startsWith('favorite')) || undefined,
        rating: num(o['rating']) || undefined,
        poster: typedImage(meta['images'], 'poster') || deepFirstUrl(meta['posters']) || deepFirstUrl(meta['poster']),
        fanart: typedImage(meta['images'], 'fanart') || deepFirstUrl(meta['fanart']) || deepFirstUrl(meta['backdrops']),
        genres: strArr(meta['genres']),
        overview: str(meta['overview']) || undefined,
        runtime: secToMin(num(meta['runtime'])),
        ended: meta['is_ended'] === true ? true : undefined,
      });
      return true;
    }

    // entity === 'episode'
    const series = isObj(meta['series']) ? (meta['series'] as Record<string, unknown>) : {};
    const showId = extSource(series, 'tvdb') ?? num(series['id']) ?? num(meta['series_id']) ?? tvdbId;
    const season = num(meta['season_number'] ?? meta['season'] ?? o['season_number']);
    const number = num(meta['number'] ?? meta['episode_number'] ?? o['number']);
    out.episodeWatches.push({
      tvdbShowId: showId ?? undefined,
      showName: str(series['name']) || str(meta['series_name']) || undefined,
      season: season ?? undefined,
      number: number ?? undefined,
      tvdbEpisodeId: season == null ? num(o['entity_id']) ?? undefined : undefined,
      episodeName: str(meta['name']) || undefined,
      watchedAt,
      rating: num(o['rating']) || undefined,
    });
    return true;
  }

  // --- JSON film generico (backup CineTrak & simili): titolo + id tmdb/imdb ---
  const jTitle = str(o['title']) || str(o['name']) || str(o['movieTitle']);
  const jTmdb = num(o['tmdbId'] ?? o['tmdb_id'] ?? o['tmdb']);
  const jImdbRaw = str(o['imdbId']) || str(o['imdb_id']) || str(o['imdb']);
  const jType = (str(o['type']) || str(o['mediaType']) || str(o['media_type']) || '').toLowerCase();
  if (jTitle && (jTmdb || jImdbRaw) && o['season'] == null && o['episode'] == null
      && (jType === '' || jType === 'movie' || jType === 'film')) {
    const watchedAt = iso(str(o['watchedAt']) || str(o['watched_at']) || str(o['watchedDate']) || str(o['watched_date']) || str(o['date']));
    out.movies.push({
      name: jTitle,
      tmdbId: jTmdb ?? undefined,
      imdbId: jImdbRaw && /^tt\d+/.test(jImdbRaw) ? jImdbRaw : undefined,
      watched: o['watched'] === true || o['isWatched'] === true || !!watchedAt,
      watchedAt,
      rating: num(o['rating'] ?? o['userRating'] ?? o['vote']) || undefined,
      favorite: o['favorite'] === true || o['isFavorite'] === true || undefined,
      releaseDate: str(o['releaseDate']) || str(o['release_date']) || (num(o['year']) ? `${num(o['year'])}-01-01` : undefined),
      poster: deepFirstUrl(o['poster'] ?? o['posterUrl'])
        ?? (str(o['poster_path'])?.startsWith('/') ? `https://image.tmdb.org/t/p/w342${o['poster_path']}` : undefined),
      overview: str(o['overview']) || undefined,
    });
    return true;
  }

  // --- legacy json: { tv_show_id, episode_id } (TV Time) ---
  if (o['tv_show_id'] != null && o['episode_id'] != null) {
    const showId = num(o['tv_show_id']);
    if (showId) {
      out.episodeWatches.push({
        tvdbShowId: showId,
        tvdbEpisodeId: num(o['episode_id']) ?? undefined,
        watchedAt: iso(str(o['created_at'])),
      });
    }
    return true;
  }
  return false;
}

/**
 * Record Trakt / CineTrak: oggetti con `movie` / `show` (+ `episode`) annidati,
 * ciascuno con `ids: {trakt, tmdb, imdb, tvdb?}`, `title`, `year`.
 * Coprono watched-movies, watched-shows, watched-history, ratings-*, lists-*.
 */
function classifyTrakt(o: Record<string, unknown>, out: ParseOutput, ctx: JsonCtx): boolean {
  const tMovie = isObj(o['movie']) ? (o['movie'] as Record<string, unknown>) : undefined;
  const tShow = isObj(o['show']) ? (o['show'] as Record<string, unknown>) : undefined;
  const tEp = isObj(o['episode']) ? (o['episode'] as Record<string, unknown>) : undefined;
  const idsOf = (x?: Record<string, unknown>) =>
    x && isObj(x['ids']) ? (x['ids'] as Record<string, unknown>) : {};

  if (tMovie && str(tMovie['title']) && isObj(tMovie['ids'])) {
    const ids = idsOf(tMovie);
    const watchedAt = iso(str(o['watched_at']) || str(o['last_watched_at']));
    const isRating = num(o['rating']) != null && !!o['rated_at'];
    const watched = !ctx.watchlist && (!!watchedAt || (num(o['plays']) ?? 0) > 0 || isRating);
    out.movies.push({
      name: str(tMovie['title'])!,
      tmdbId: num(ids['tmdb']) ?? undefined,
      imdbId: str(ids['imdb']) || undefined,
      watched,
      watchedAt,
      followedAt: iso(str(o['listed_at'])),
      rating: (isRating ? num(o['rating']) : num(o['my_rating'])) || undefined,
      releaseDate: num(tMovie['year']) ? `${num(tMovie['year'])}-01-01` : undefined,
      favorite: ctx.favorite || undefined,
    });
    return true;
  }

  if (tShow && str(tShow['title']) && isObj(tShow['ids'])) {
    const ids = idsOf(tShow);
    const tvdbId = num(ids['tvdb']);
    const showName = str(tShow['title']);

    if (tEp && num(tEp['season']) != null && num(tEp['number']) != null) {
      // evento di cronologia o voto su un singolo episodio
      const isRating = num(o['rating']) != null && !!o['rated_at'];
      if (!isRating || num(tEp['season'])! >= 0) {
        out.episodeWatches.push({
          tvdbShowId: tvdbId ?? undefined,
          showName,
          season: num(tEp['season'])!,
          number: num(tEp['number'])!,
          episodeName: str(tEp['title']) || undefined,
          watchedAt: iso(str(o['watched_at'])),
          rating: isRating ? num(o['rating']) : undefined,
          ...(isRating && !o['watched_at'] ? ({ notWatched: true } as object) : {}),
        } as EpisodeWatch);
      }
      out.shows.push({ tvdbId: tvdbId ?? undefined, name: showName });
      return true;
    }

    // watched-shows / ratings-shows / watchlist / collection
    out.shows.push({
      tvdbId: tvdbId ?? undefined,
      name: showName,
      followedAt: iso(str(o['listed_at']) || str(o['last_watched_at'])),
      rating: num(o['rating']) != null && !!o['rated_at'] ? num(o['rating']) : undefined,
      favorite: ctx.favorite || undefined,
    });
    // eventuale progresso aggregato per stagione (se presente nell'export)
    if (Array.isArray(o['seasons'])) {
      for (const s of o['seasons'] as unknown[]) {
        if (!isObj(s) || num(s['number']) == null || !Array.isArray(s['episodes'])) continue;
        for (const e of s['episodes'] as unknown[]) {
          if (!isObj(e) || num(e['number']) == null) continue;
          out.episodeWatches.push({
            tvdbShowId: tvdbId ?? undefined,
            showName,
            season: num(s['number'])!,
            number: num(e['number'])!,
            watchedAt: iso(str(e['last_watched_at'])),
            timesWatched: num(e['plays']) || undefined,
          });
        }
      }
    }
    return true;
  }
  return false;
}

// ---------- dedup ----------

function dedupe(out: ParseOutput) {
  // serie: fondi per tvdbId (o nome) tenendo il dato più ricco
  const byKey = new Map<string, ImportedShow>();
  for (const s of out.shows) {
    const k = s.tvdbId ? `id:${s.tvdbId}` : s.name ? `nm:${s.name.toLowerCase()}` : '';
    if (!k) continue;
    const prev = byKey.get(k);
    byKey.set(k, prev ? mergeDefined(prev, s) : s);
  }
  out.shows = [...byKey.values()];

  const mSeen = new Map<string, ImportedMovie>();
  for (const m of out.movies) {
    const k = m.uuid || (m.imdbId && `imdb:${m.imdbId}`) || (m.tmdbId && `tmdb:${m.tmdbId}`) || (m.tvdbId && `tvdb:${m.tvdbId}`) || `nm:${m.name.toLowerCase()}`;
    const prev = mSeen.get(k);
    if (prev) {
      const merged = mergeDefined(prev, m);
      merged.watched = prev.watched || m.watched; // "visto" non deve regredire
      mSeen.set(k, merged);
    } else {
      mSeen.set(k, m);
    }
  }
  out.movies = [...mSeen.values()];

  const eSeen = new Map<string, EpisodeWatch>();
  const legacy: EpisodeWatch[] = [];
  for (const w of out.episodeWatches) {
    if (w.season == null || w.number == null) { legacy.push(w); continue; }
    const k = `${w.tvdbShowId ?? w.showName}:${w.season}:${w.number}`;
    const prev = eSeen.get(k);
    eSeen.set(k, prev ? mergeDefined(prev, w) : w);
  }
  // legacy: dedup per episode_id
  const lSeen = new Map<string, EpisodeWatch>();
  for (const w of legacy) lSeen.set(`${w.tvdbShowId}:${w.tvdbEpisodeId}`, w);
  out.episodeWatches = [...eSeen.values(), ...lSeen.values()];
}

// ---------- scrittura su db ----------

export interface ApplyStats { shows: number; episodes: number; movies: number; legacy: number }

export async function applyImport(parsed: ParseOutput): Promise<ApplyStats> {
  const stats: ApplyStats = { shows: 0, episodes: 0, movies: 0, legacy: 0 };

  if (parsed.native) {
    await db.transaction('rw', db.shows, db.episodes, db.movies, async () => {
      await db.shows.bulkPut(parsed.native!.shows);
      await db.episodes.bulkPut(parsed.native!.episodes);
      await db.movies.bulkPut(parsed.native!.movies);
    });
    stats.shows = parsed.native.shows.length;
    stats.episodes = parsed.native.episodes.length;
    stats.movies = parsed.native.movies.length;
  }

  const nameToId = new Map<string, number>();
  const ensureShowId = (s: { tvdbId?: number; name?: string }) => {
    if (s.tvdbId) return s.tvdbId;
    const key = (s.name || '').toLowerCase();
    if (!key) return undefined;
    if (!nameToId.has(key)) nameToId.set(key, 1500000000 + (hash(key) % 400000000));
    return nameToId.get(key);
  };

  await db.transaction('rw', db.shows, db.episodes, db.movies, async () => {
    for (const s of parsed.shows) {
      const id = ensureShowId(s);
      if (!id) continue;
      const existing = await db.shows.get(id);
      const merged: Show = mergeDefined(
        existing ?? { id, name: s.name || `Serie ${id}`, addedAt: nowIso() },
        {
          name: s.name, poster: s.poster, fanart: s.fanart, genres: s.genres,
          overview: s.overview, runtime: s.runtime, ended: s.ended,
          followedAt: s.followedAt, archived: s.archived, favorite: s.favorite,
          rating: s.rating, tvmazeId: s.tvmazeId,
        } as Partial<Show>,
      ) as Show;
      await db.shows.put(merged);
      stats.shows++;
    }

    for (const w of parsed.episodeWatches) {
      const id = w.tvdbShowId ?? ensureShowId({ name: w.showName });
      if (!id) continue;
      let show = await db.shows.get(id);
      if (!show) {
        show = { id, name: w.showName || `Serie ${id}`, addedAt: nowIso() };
        await db.shows.put(show);
        stats.shows++;
      }
      if (w.season == null || w.number == null) {
        // legacy: solo conteggio, verrà mappato dopo l'enrichment TVmaze
        await db.shows.update(id, {
          legacyWatchCount: (show.legacyWatchCount ?? 0) + 1,
          legacyWatchDates: [...(show.legacyWatchDates ?? []), w.watchedAt ?? ''].slice(0, 5000),
        });
        stats.legacy++;
        continue;
      }
      const key = epKey(id, w.season, w.number);
      const existing = await db.episodes.get(key);
      const notWatched = (w as EpisodeWatch & { notWatched?: boolean }).notWatched === true;
      await db.episodes.put(mergeDefined(
        existing ?? {
          key, showId: id, season: w.season, number: w.number, watched: 0,
        },
        {
          name: w.episodeName,
          watched: notWatched ? undefined : 1,
          watchedAt: notWatched ? undefined : (w.watchedAt || nowIso()),
          timesWatched: notWatched ? undefined : (w.timesWatched ?? 1),
          rating: w.rating,
          special: w.special,
        } as Partial<Episode>,
      ) as Episode);
      if (!notWatched) {
        const last = w.watchedAt || '';
        if (!show.lastActivityAt || last > show.lastActivityAt) {
          await db.shows.update(id, { lastActivityAt: last || nowIso() });
        }
        stats.episodes++;
      }
    }

    // dedup film cross-formato: stesso film da TV Time (uuid) e CineTrak (imdb/tmdb/nome)
    const allMovies = await db.movies.toArray();
    const byImdb = new Map(allMovies.filter((m) => m.imdbId).map((m) => [m.imdbId!, m.key]));
    const byTmdb = new Map(allMovies.filter((m) => m.tmdbId).map((m) => [m.tmdbId!, m.key]));
    const byName = new Map(allMovies.map((m) => [slug(m.name), m.key]));

    for (const m of parsed.movies) {
      let key: string | undefined;
      if (m.uuid && (await db.movies.get(m.uuid))) key = m.uuid;
      if (!key && m.imdbId) key = byImdb.get(m.imdbId);
      if (!key && m.tmdbId) key = byTmdb.get(m.tmdbId);
      if (!key) key = byName.get(slug(m.name));
      if (!key) {
        key = m.uuid
          ?? (m.imdbId ? `imdb:${m.imdbId}` : m.tmdbId ? `tmdb:${m.tmdbId}` : m.tvdbId ? `tvdb:${m.tvdbId}` : `name:${slug(m.name)}`);
      }
      const existing = await db.movies.get(key);
      await db.movies.put(mergeDefined(
        existing ?? { key, name: m.name, watched: 0 },
        {
          name: m.name, watched: m.watched ? 1 : existing?.watched, watchedAt: m.watchedAt,
          followedAt: m.followedAt, rating: m.rating, favorite: m.favorite,
          runtime: m.runtime, poster: m.poster, fanart: m.fanart, genres: m.genres,
          overview: m.overview, releaseDate: m.releaseDate, imdbId: m.imdbId, tvdbId: m.tvdbId, tmdbId: m.tmdbId,
        } as Partial<Movie>,
      ) as Movie);
      if (m.imdbId) byImdb.set(m.imdbId, key);
      if (m.tmdbId) byTmdb.set(m.tmdbId, key);
      byName.set(slug(m.name), key);
      stats.movies++;
    }
  });

  return stats;
}

// ---------- helpers ----------

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function num(v: unknown): number | undefined {
  if (v == null || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}
const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);
const bool = (v: unknown): boolean =>
  v === true || v === 1 || (typeof v === 'string' && ['true', '1', 'yes', 'y'].includes(v.toLowerCase()));

function iso(v: unknown): string | undefined {
  if (typeof v !== 'string' || !v) return undefined;
  const d = new Date(v.includes('T') || v.includes('-') ? v : Number(v) * 1000);
  return isNaN(d.getTime()) ? undefined : d.toISOString();
}

/** runtime TV Time è in secondi; converte in minuti se plausibile */
function secToMin(v?: number): number | undefined {
  if (!v) return undefined;
  return v > 600 ? Math.round(v / 60) : v;
}

function strArr(v: unknown): string[] | undefined {
  return Array.isArray(v) && v.length && v.every((x) => typeof x === 'string')
    ? (v as string[]) : undefined;
}

/** meta.external_sources: [{source:'tvdb', id:'123'}] */
function extSource(o: Record<string, unknown>, source: string): number | undefined {
  const arr = o['external_sources'];
  if (!Array.isArray(arr)) return undefined;
  for (const e of arr) {
    if (isObj(e) && e['source'] === source) return num(e['id']);
  }
  return undefined;
}

/** immagini msapi serie: meta.images = [{type:'poster'|'fanart', url, ...}] */
function typedImage(images: unknown, kind: string): string | undefined {
  if (!Array.isArray(images)) return undefined;
  for (const img of images) {
    if (isObj(img) && img['type'] === kind) {
      const u = deepFirstUrl(img['url']) ?? deepFirstUrl(img);
      if (u) return u;
    }
  }
  return undefined;
}

/** immagini api2: all_images.poster["0"] ecc. */
function firstImage(allImages: unknown, kind: string): string | undefined {
  if (!isObj(allImages)) return undefined;
  return deepFirstUrl(allImages[kind]);
}

/** trova la prima URL http in una struttura arbitraria (array/oggetti annidati) */
function deepFirstUrl(v: unknown, depth = 0): string | undefined {
  if (depth > 4 || v == null) return undefined;
  if (typeof v === 'string') return /^https?:\/\//.test(v) && !/default-images/.test(v) ? v : undefined;
  if (Array.isArray(v)) { for (const x of v) { const u = deepFirstUrl(x, depth + 1); if (u) return u; } return undefined; }
  if (isObj(v)) { for (const x of Object.values(v)) { const u = deepFirstUrl(x, depth + 1); if (u) return u; } }
  return undefined;
}

/** fonde b dentro a, ignorando i campi undefined/null di b */
function mergeDefined<T extends object>(a: T, b: Partial<T>): T {
  const r: Record<string, unknown> = { ...(a as Record<string, unknown>) };
  for (const [k, v] of Object.entries(b)) if (v !== undefined && v !== null) r[k] = v;
  return r as T;
}

function hash(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h;
}
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60);

const counts = (o: ImportResult) => ({ s: o.shows.length, e: o.episodeWatches.length, m: o.movies.length });
function delta(before: { s: number; e: number; m: number }, o: ImportResult) {
  const parts: string[] = [];
  const ds = o.shows.length - before.s, de = o.episodeWatches.length - before.e, dm = o.movies.length - before.m;
  if (ds) parts.push(`${ds} serie`);
  if (de) parts.push(`${de} episodi`);
  if (dm) parts.push(`${dm} film`);
  return parts.length ? parts.join(', ') : 'nessun dato riconosciuto';
}
