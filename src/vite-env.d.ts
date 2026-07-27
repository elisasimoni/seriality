/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_TMDB_KEY?: string;
  /** Progetto Supabase usato per il backup cifrato (vedi README). */
  readonly VITE_SUPABASE_URL?: string;
  /** Chiave anon/publishable: pubblica per definizione, i dati li protegge la passphrase. */
  readonly VITE_SUPABASE_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
