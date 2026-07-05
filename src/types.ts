// Modello dati di Seriality. Gli id delle serie sono id TVDB (come TV Time);
// le serie trovate solo su TVmaze usano id sintetici >= 1e9 per non collidere.

export interface Show {
  id: number;                 // TVDB id, oppure 1e9 + tvmazeId se TVDB manca
  name: string;
  poster?: string;
  fanart?: string;
  overview?: string;
  genres?: string[];
  network?: string;
  country?: string;
  runtime?: number;           // minuti per episodio
  ended?: boolean;
  premiered?: string;         // YYYY-MM-DD
  followedAt?: string;        // ISO
  archived?: boolean;         // "stopped watching" di TV Time
  muted?: boolean;            // "Non seguire più": nascosta da Da guardare / In arrivo
  favorite?: boolean;
  rating?: number;            // voto utente 0-10
  tvmazeId?: number;
  tmdbId?: number;            // per cast/trailer/provider/simili (risolto al primo uso)
  enrichedAt?: string;        // ultimo fetch metadata riuscito
  // Import legacy (seen_episode.csv non ha stagione/episodio): numero di
  // visioni da riassegnare in ordine di messa in onda dopo l'enrichment.
  legacyWatchCount?: number;
  legacyWatchDates?: string[];
  lastActivityAt?: string;
  addedAt: string;
}

export interface Episode {
  key: string;                // `${showId}:${season}:${number}`
  showId: number;
  season: number;
  number: number;
  name?: string;
  airDate?: string;           // YYYY-MM-DD
  airTime?: string;
  runtime?: number;           // minuti
  special?: boolean;
  watched: number;            // 0/1 (indicizzabile in Dexie)
  watchedAt?: string;
  timesWatched?: number;
  rating?: number;
  summary?: string;           // sinossi (fetch on-demand al click, poi cache)
  image?: string;             // screenshot episodio
}

export interface Movie {
  key: string;                // uuid TV Time, o imdb:<id>, o tvdb:<id>, o name:<slug>
  name: string;
  watched: number;            // 0/1
  watchedAt?: string;
  followedAt?: string;
  rating?: number;
  favorite?: boolean;
  runtime?: number;           // minuti
  poster?: string;
  fanart?: string;
  genres?: string[];
  overview?: string;
  releaseDate?: string;
  imdbId?: string;
  tvdbId?: number;
  tmdbId?: number;
}

// ---- Risultato normalizzato dell'ingestion (qualsiasi formato TV Time) ----

export interface ImportedShow {
  tvdbId?: number;
  tvmazeId?: number;
  name?: string;
  followedAt?: string;
  archived?: boolean;
  favorite?: boolean;
  rating?: number;
  poster?: string;
  fanart?: string;
  genres?: string[];
  overview?: string;
  runtime?: number;
  ended?: boolean;
}

export interface EpisodeWatch {
  tvdbShowId?: number;
  showName?: string;
  season?: number;
  number?: number;
  tvdbEpisodeId?: number;     // solo formato legacy: mappato per conteggio
  episodeName?: string;
  watchedAt?: string;
  timesWatched?: number;
  rating?: number;
  special?: boolean;
}

export interface ImportedMovie {
  uuid?: string;
  tvdbId?: number;
  tmdbId?: number;
  imdbId?: string;
  name: string;
  watched: boolean;
  watchedAt?: string;
  followedAt?: string;
  rating?: number;
  favorite?: boolean;
  runtime?: number;
  poster?: string;
  fanart?: string;
  genres?: string[];
  overview?: string;
  releaseDate?: string;
}

export interface ImportResult {
  shows: ImportedShow[];
  episodeWatches: EpisodeWatch[];
  movies: ImportedMovie[];
  report: string[];           // righe leggibili: cosa è stato riconosciuto e da dove
}
