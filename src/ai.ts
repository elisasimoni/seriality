// Consigli AI — porting del motore di TvChoicer, adattato a Seriality:
//  1) parseQuery: richiesta libera → parametri di ricerca TMDB (keyword, generi)
//  2) buildCandidatePool: candidati TMDB con quote anti-esclusione (K-drama & co.)
//  3) rankShows: l'AI sceglie i migliori con motivazione + match score
//
// Novità rispetto a TvChoicer:
//  - i "gusti" sono derivati automaticamente dalla libreria (generi più visti,
//    preferite, voti alti) + eventuale nota manuale dalle Impostazioni;
//  - esclude i titoli che l'utente ha già in libreria (consiglia cose nuove).
//
// Provider: Google Gemini, chiamato direttamente dal browser (tier gratuito).
// La chiave sta in localStorage (Impostazioni), mai nel bundle pubblico.

import { db, normTitle } from './db';
import {
  discoverMovieRaw, discoverTvRaw, movieGenreMap, posterUrl, searchMovieRaw,
  searchTvRaw, tvGenreMap, type RawMovie, type RawTv,
} from './tmdb';

const GEMINI_MODEL = 'gemini-2.5-flash';

export function geminiKey(): string {
  return localStorage.getItem('seriality-gemini-key')?.trim() || '';
}
export const hasGemini = () => !!geminiKey();

// ---- chiamata Gemini con output JSON strutturato -------------------------

function toGeminiSchema(s: unknown): unknown {
  if (Array.isArray(s)) return s.map(toGeminiSchema);
  if (s && typeof s === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(s as Record<string, unknown>)) {
      if (k === 'type' && typeof v === 'string') out[k] = v.toUpperCase();
      else if (k === 'properties') {
        const props: Record<string, unknown> = {};
        for (const [pk, pv] of Object.entries(v as Record<string, unknown>)) props[pk] = toGeminiSchema(pv);
        out[k] = props;
      } else if (k === 'items') out[k] = toGeminiSchema(v);
      else out[k] = v;
    }
    return out;
  }
  return s;
}

async function geminiJSON<T>({ system, user, schema }: { system?: string; user: string; schema: unknown }): Promise<T> {
  const key = geminiKey();
  if (!key) throw new Error('Chiave Gemini mancante (Impostazioni)');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
  const body = {
    ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
    contents: [{ role: 'user', parts: [{ text: user }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: toGeminiSchema(schema),
      temperature: 0.6,
    },
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    if (res.status === 400 || res.status === 403) throw new Error('Chiave Gemini non valida o senza permessi');
    throw new Error(`Gemini ${res.status}: ${t.slice(0, 200)}`);
  }
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini: risposta vuota o bloccata');
  return JSON.parse(text) as T;
}

// ---- gusti derivati dalla libreria ---------------------------------------

const ASIAN = ['KR', 'JP', 'CN', 'TW', 'TH'];

/** Riassunto in linguaggio naturale dei gusti + paese preferito, dalla libreria. */
export async function tasteProfile(): Promise<{ preferences: string; preferredCountry: string }> {
  const [shows, eps] = await Promise.all([db.shows.toArray(), db.episodes.toArray()]);
  const watchedByShow = new Map<number, number>();
  for (const e of eps) if (e.watched) watchedByShow.set(e.showId, (watchedByShow.get(e.showId) ?? 0) + 1);

  const genreMin = new Map<string, number>();
  const countryCount = new Map<string, number>();
  const loved: string[] = [];
  for (const s of shows) {
    const w = watchedByShow.get(s.id) ?? 0;
    for (const g of s.genres ?? []) genreMin.set(g, (genreMin.get(g) ?? 0) + w);
    if (s.country && w > 0) countryCount.set(s.country, (countryCount.get(s.country) ?? 0) + w);
    if (s.favorite || (s.rating ?? 0) >= 8) loved.push(s.name);
  }
  const topGenres = [...genreMin.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([g]) => g);
  const manual = localStorage.getItem('seriality-taste')?.trim() || '';
  const setCountry = localStorage.getItem('seriality-country')?.trim() || '';
  const topCountry = [...countryCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '';

  const parts: string[] = [];
  if (topGenres.length) parts.push(`Generi preferiti: ${topGenres.join(', ')}.`);
  if (loved.length) parts.push(`Ama titoli come: ${loved.slice(0, 12).join(', ')}.`);
  if (manual) parts.push(manual);

  return {
    preferences: parts.join(' '),
    preferredCountry: setCountry || topCountry || 'KR',
  };
}

// ---- passo 1: richiesta → parametri --------------------------------------

interface SearchParams { keywords: string[]; genreIds: number[]; includeAsian: boolean }

async function parseQuery(userText: string, preferences: string, genreList: string, noun: string): Promise<SearchParams> {
  const prefsBlock = preferences ? `\n\nGusti generali dell'utente (da tenere presenti, senza ignorare la richiesta):\n"${preferences}"` : '';
  const schema = {
    type: 'object',
    properties: {
      keywords: { type: 'array', items: { type: 'string' } },
      genreIds: { type: 'array', items: { type: 'integer' } },
      includeAsian: { type: 'boolean' },
    },
    required: ['keywords', 'genreIds', 'includeAsian'],
  };
  const out = await geminiJSON<SearchParams>({
    schema,
    user: `Generi TMDB per ${noun} (id=nome): ${genreList}\n\nRichiesta dell'utente:\n"${userText}"${prefsBlock}\n\nEstrai i parametri di ricerca: 1-4 "keywords" IN INGLESE (temi/sottogeneri), "genreIds" pertinenti dalla lista, e "includeAsian" (true di default; false SOLO se l'utente esclude esplicitamente i contenuti asiatici). Rispondi SOLO con l'oggetto JSON.`,
  });
  return {
    keywords: Array.isArray(out.keywords) ? out.keywords : [],
    genreIds: Array.isArray(out.genreIds) ? out.genreIds : [],
    includeAsian: out.includeAsian !== false,
  };
}

// ---- candidati TMDB (con quote anti-esclusione) --------------------------

export interface Candidate {
  id: number; title: string; originalTitle: string; overview: string; year: string | null;
  rating: number | null; votes: number; country: string; genres: string[];
  poster?: string; popularity: number;
}

function normalize(s: RawTv, genreMap: Map<number, string>): Candidate {
  return {
    id: s.id,
    title: s.name || s.original_name || '?',
    originalTitle: s.original_name || s.name || '',
    overview: s.overview || '',
    year: (s.first_air_date || '').slice(0, 4) || null,
    rating: s.vote_average ? Math.round(s.vote_average * 10) / 10 : null,
    votes: s.vote_count || 0,
    country: (s.origin_country && s.origin_country[0]) || '',
    genres: (s.genre_ids || []).map((id) => genreMap.get(id)).filter(Boolean) as string[],
    poster: posterUrl(s.poster_path),
    popularity: s.popularity || 0,
  };
}

async function buildCandidatePool(p: SearchParams, preferredCountry: string): Promise<Candidate[]> {
  const genreMap = await tvGenreMap();
  const byId = new Map<number, Candidate>();
  const add = (results: RawTv[]) => {
    for (const r of results) {
      if (!r.overview && !r.name) continue;
      if (!byId.has(r.id)) byId.set(r.id, normalize(r, genreMap));
    }
  };
  const genreParam = p.genreIds.join(',');
  const tasks: Promise<void>[] = [];
  for (const kw of p.keywords.slice(0, 4)) tasks.push(searchTvRaw(kw).then(add));
  if (p.genreIds.length) {
    for (const page of ['1', '2']) {
      tasks.push(discoverTvRaw({ with_genres: genreParam, sort_by: 'popularity.desc', 'vote_count.gte': '50', include_adult: 'false', page }).then(add));
    }
  }
  if (p.includeAsian) {
    for (const origin of ASIAN) {
      tasks.push(discoverTvRaw({ with_origin_country: origin, ...(genreParam ? { with_genres: genreParam } : {}), sort_by: 'popularity.desc', 'vote_count.gte': '30', include_adult: 'false', page: '1' }).then(add));
    }
  }
  if (preferredCountry && !(p.includeAsian && ASIAN.includes(preferredCountry))) {
    tasks.push(discoverTvRaw({ with_origin_country: preferredCountry, ...(genreParam ? { with_genres: genreParam } : {}), sort_by: 'popularity.desc', 'vote_count.gte': '30', include_adult: 'false', page: '1' }).then(add));
  }
  await Promise.all(tasks);

  const sorted = [...byId.values()].filter((s) => s.overview).sort((a, b) => b.popularity - a.popularity);
  const MAX = 30;
  const focus = preferredCountry || 'KR';
  const picked = new Map<number, Candidate>();
  const take = (list: Candidate[], n: number) => {
    for (const s of list) {
      if (picked.size >= MAX || n <= 0) break;
      if (!picked.has(s.id)) { picked.set(s.id, s); n--; }
    }
  };
  if (p.includeAsian || !ASIAN.includes(focus)) take(sorted.filter((s) => s.country === focus), 6);
  if (p.includeAsian) {
    const already = [...picked.values()].filter((s) => ASIAN.includes(s.country)).length;
    take(sorted.filter((s) => ASIAN.includes(s.country)), 10 - already);
  }
  take(p.includeAsian ? sorted : sorted.filter((s) => !ASIAN.includes(s.country)), MAX);
  return [...picked.values()].sort((a, b) => b.popularity - a.popularity);
}

// ---- passo 2: classifica con motivazione ---------------------------------

export interface AiPick extends Candidate { reason: string; matchScore: number }

async function rankShows(userText: string, candidates: Candidate[], preferences: string, preferredCountry: string, noun = 'serie'): Promise<AiPick[]> {
  const compact = candidates.map((c, i) => ({
    i, title: c.title, year: c.year, country: c.country, rating: c.rating,
    votes: c.votes, genres: c.genres, overview: (c.overview || '').slice(0, 240),
  }));
  const schema = {
    type: 'object',
    properties: {
      picks: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            i: { type: 'integer' },
            reason: { type: 'string' },
            matchScore: { type: 'integer' },
          },
          required: ['i', 'reason', 'matchScore'],
        },
      },
    },
    required: ['picks'],
  };
  const prefsBlock = preferences ? `\n\nGusti dell'utente (pesano su scelta e ordine, ma la richiesta specifica viene PRIMA):\n"${preferences}"` : '';
  const countryBlock = preferredCountry ? `\n\nA parità di pertinenza, dai priorità ai titoli prodotti in ${preferredCountry}.` : '';
  const system = `Sei un esperto di ${noun === 'film' ? 'cinema' : 'serie TV'} con gusto internazionale. Consigli in base a MOOD, temi, tono e qualità, NON alla lingua o al paese. Tratti i titoli coreani, giapponesi e asiatici esattamente come quelli occidentali. Sii SEVERO e onesto sulla pertinenza: meglio pochi consigli azzeccati che tanti deboli. La 'reason' è 1-2 frasi in ITALIANO, concrete e senza spoiler. matchScore 0-100 calibrato: 90-100 = corrisponde a tutto (mood, temi, tono); 75-89 = forte ma manca qualcosa; 60-74 = parziale; sotto 60 = debole. Non gonfiare i punteggi.`;
  const out = await geminiJSON<{ picks: { i: number; reason: string; matchScore: number }[] }>({
    system,
    schema,
    user: `Richiesta:\n"${userText}"${prefsBlock}${countryBlock}\n\nCandidati (JSON):\n${JSON.stringify(compact)}\n\nScegli SOLO i ${noun} davvero pertinenti (max 8), dal più al meno pertinente, con l'indice "i". Se pochi sono pertinenti, restituiscine pochi. Rispondi SOLO con l'oggetto JSON.`,
  });
  const picks = Array.isArray(out.picks) ? out.picks : [];
  return picks
    .map((p) => {
      const c = candidates[p.i];
      return c ? { ...c, reason: p.reason, matchScore: p.matchScore } : null;
    })
    .filter((x): x is AiPick => !!x)
    .filter((s) => typeof s.matchScore !== 'number' || s.matchScore >= 55)
    .slice(0, 8);
}

// ---- entry point ----------------------------------------------------------

export interface AiResult { picks: AiPick[]; considered: number }

/** Consiglia serie in base a una richiesta libera, escludendo quelle già in libreria. */
export async function recommendShowsAI(userText: string): Promise<AiResult> {
  const { preferences, preferredCountry } = await tasteProfile();
  const genreList = [...(await tvGenreMap()).entries()].map(([id, name]) => `${id}=${name}`).join(', ');
  const params = await parseQuery(userText, preferences, genreList, 'serie');
  const pool = await buildCandidatePool(params, preferredCountry);

  // escludi ciò che l'utente ha già: per id TMDB (robusto ai titoli localizzati)
  // e per nome normalizzato (fallback per le serie senza tmdbId salvato)
  const shows = await db.shows.toArray();
  const ownedTmdb = new Set(shows.map((s) => s.tmdbId).filter(Boolean) as number[]);
  const ownedNames = new Set(shows.map((s) => normTitle(s.name)));
  const isOwned = (c: Candidate) =>
    ownedTmdb.has(c.id) || ownedNames.has(normTitle(c.title)) || (c.originalTitle && ownedNames.has(normTitle(c.originalTitle)));

  const fresh = pool.filter((c) => !isOwned(c));
  const candidates = fresh.length >= 5 ? fresh : pool; // se troppo pochi, non svuotare
  const picks = await rankShows(userText, candidates, preferences, preferredCountry, 'serie');
  const finalPicks = picks.filter((p) => !isOwned(p));
  return { picks: finalPicks.length ? finalPicks : picks, considered: candidates.length };
}

// ---- flusso film ---------------------------------------------------------

const LANG_TO_COUNTRY: Record<string, string> = { ko: 'KR', ja: 'JP', zh: 'CN', th: 'TH', cn: 'CN' };

function normalizeMovie(s: RawMovie, genreMap: Map<number, string>): Candidate {
  return {
    id: s.id,
    title: s.title || s.original_title || '?',
    originalTitle: s.original_title || s.title || '',
    overview: s.overview || '',
    year: (s.release_date || '').slice(0, 4) || null,
    rating: s.vote_average ? Math.round(s.vote_average * 10) / 10 : null,
    votes: s.vote_count || 0,
    country: LANG_TO_COUNTRY[s.original_language || ''] || '',
    genres: (s.genre_ids || []).map((id) => genreMap.get(id)).filter(Boolean) as string[],
    poster: posterUrl(s.poster_path),
    popularity: s.popularity || 0,
  };
}

async function buildMoviePool(p: SearchParams, preferredCountry: string): Promise<Candidate[]> {
  const genreMap = await movieGenreMap();
  const byId = new Map<number, Candidate>();
  const add = (results: RawMovie[]) => {
    for (const r of results) {
      if (!r.overview && !r.title) continue;
      if (!byId.has(r.id)) byId.set(r.id, normalizeMovie(r, genreMap));
    }
  };
  const genreParam = p.genreIds.join(',');
  const tasks: Promise<void>[] = [];
  for (const kw of p.keywords.slice(0, 4)) tasks.push(searchMovieRaw(kw).then(add));
  if (p.genreIds.length) {
    for (const page of ['1', '2']) {
      tasks.push(discoverMovieRaw({ with_genres: genreParam, sort_by: 'popularity.desc', 'vote_count.gte': '80', include_adult: 'false', page }).then(add));
    }
  }
  if (p.includeAsian) {
    for (const lang of ['ko', 'ja', 'zh', 'th']) {
      tasks.push(discoverMovieRaw({ with_original_language: lang, ...(genreParam ? { with_genres: genreParam } : {}), sort_by: 'popularity.desc', 'vote_count.gte': '40', include_adult: 'false', page: '1' }).then(add));
    }
  }
  if (preferredCountry && !(p.includeAsian && ASIAN.includes(preferredCountry))) {
    tasks.push(discoverMovieRaw({ with_origin_country: preferredCountry, ...(genreParam ? { with_genres: genreParam } : {}), sort_by: 'popularity.desc', 'vote_count.gte': '40', include_adult: 'false', page: '1' }).then(add));
  }
  await Promise.all(tasks);

  const sorted = [...byId.values()].filter((s) => s.overview).sort((a, b) => b.popularity - a.popularity);
  const MAX = 30;
  const focus = preferredCountry || 'KR';
  const picked = new Map<number, Candidate>();
  const take = (list: Candidate[], n: number) => {
    for (const s of list) {
      if (picked.size >= MAX || n <= 0) break;
      if (!picked.has(s.id)) { picked.set(s.id, s); n--; }
    }
  };
  if (p.includeAsian || !ASIAN.includes(focus)) take(sorted.filter((s) => s.country === focus), 6);
  if (p.includeAsian) {
    const already = [...picked.values()].filter((s) => ASIAN.includes(s.country)).length;
    take(sorted.filter((s) => ASIAN.includes(s.country)), 10 - already);
  }
  take(p.includeAsian ? sorted : sorted.filter((s) => !ASIAN.includes(s.country)), MAX);
  return [...picked.values()].sort((a, b) => b.popularity - a.popularity);
}

/** Consiglia film in base a una richiesta libera, escludendo quelli già in libreria. */
export async function recommendMoviesAI(userText: string): Promise<AiResult> {
  const { preferences, preferredCountry } = await tasteProfile();
  const genreList = [...(await movieGenreMap()).entries()].map(([id, name]) => `${id}=${name}`).join(', ');
  const params = await parseQuery(userText, preferences, genreList, 'film');
  const pool = await buildMoviePool(params, preferredCountry);

  const movies = await db.movies.toArray();
  const ownedTmdb = new Set(movies.map((m) => m.tmdbId).filter(Boolean) as number[]);
  const ownedNames = new Set(movies.map((m) => normTitle(m.name)));
  const isOwned = (c: Candidate) =>
    ownedTmdb.has(c.id) || ownedNames.has(normTitle(c.title)) || (c.originalTitle && ownedNames.has(normTitle(c.originalTitle)));

  const fresh = pool.filter((c) => !isOwned(c));
  const candidates = fresh.length >= 5 ? fresh : pool;
  const picks = await rankShows(userText, candidates, preferences, preferredCountry, 'film');
  const finalPicks = picks.filter((p) => !isOwned(p));
  return { picks: finalPicks.length ? finalPicks : picks, considered: candidates.length };
}
