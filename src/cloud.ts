/**
 * Backup automatico su Supabase.
 *
 * L'archivio parte dal telefono GIÀ cifrato: la chiave anon del progetto è
 * pubblica dentro il bundle su GitHub Pages, quindi chiunque legga il sorgente
 * può parlare col database. È la passphrase — che non esce mai da qui — a
 * rendere il blob illeggibile: da lei derivano sia l'id dello slot sia la
 * chiave AES-GCM, e il server vede solo bytes opachi.
 *
 * L'unica cosa in chiaro sono i conteggi (quante serie/episodi/film) e la data:
 * servono a mostrare l'elenco delle versioni prima di scaricarne una da ~1 MB.
 */
import { db, exportBackup, nowIso } from './db';
import { applyImport, type NativeBackup } from './ingest';

// non chiamarlo URL: ombreggerebbe la classe globale dentro tutto il modulo
const API = import.meta.env.VITE_SUPABASE_URL?.replace(/\/$/, '');
const KEY = import.meta.env.VITE_SUPABASE_KEY;

/** Vero se questa build sa a quale progetto Supabase parlare. */
export const cloudConfigured = () => !!(API && KEY);

// ---- passphrase ----

const LS_PASS = 'seriality-cloud-pass';
export const getPassphrase = () => localStorage.getItem(LS_PASS)?.trim() || '';
export const hasPassphrase = () => !!getPassphrase();
export function setPassphrase(p: string) {
  const v = p.trim();
  if (v) localStorage.setItem(LS_PASS, v);
  else localStorage.removeItem(LS_PASS);
  derived = null; // le chiavi in cache appartengono alla passphrase vecchia
}

// ---- crittografia ----

const enc = new TextEncoder();

async function deriveBits(pass: string, salt: string, iterations: number) {
  const base = await crypto.subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: enc.encode(salt), iterations, hash: 'SHA-256' }, base, 256,
  );
  return new Uint8Array(bits) as Bytes;
}

const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');

// WebCrypto vuole buffer non condivisi: fissiamo ArrayBuffer invece di ArrayBufferLike
type Bytes = Uint8Array<ArrayBuffer>;

/**
 * Slot e chiave derivano dalla stessa passphrase ma con sali diversi, entrambi
 * con PBKDF2 pesante: l'id salvato sul server non dà quindi una scorciatoia per
 * indovinare la passphrase più veloce che attaccare la cifratura.
 * La derivazione costa ~1s su iPhone, per questo la teniamo in cache.
 */
let derived: { pass: string; slot: string; key: CryptoKey } | null = null;

async function keys(): Promise<{ slot: string; key: CryptoKey }> {
  const pass = getPassphrase();
  if (!pass) throw new Error('Nessuna passphrase impostata');
  if (derived?.pass === pass) return derived;
  const [slotBits, keyBits] = await Promise.all([
    deriveBits(pass, 'seriality-slot-v1', 120_000),
    deriveBits(pass, 'seriality-key-v1', 210_000),
  ]);
  const key = await crypto.subtle.importKey('raw', keyBits, 'AES-GCM', false, ['encrypt', 'decrypt']);
  derived = { pass, slot: hex(slotBits), key };
  return derived;
}

// base64 a blocchi: fromCharCode(...) su un array da 1 MB fa esplodere lo stack
function toB64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function fromB64(s: string): Bytes {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const canZip = () => typeof CompressionStream !== 'undefined';

async function gzip(text: string): Promise<Bytes> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
async function gunzip(bytes: Bytes): Promise<string> {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}

interface Envelope { v: 1; z: 0 | 1; iv: string; data: string }

async function seal(json: string): Promise<string> {
  const { key } = await keys();
  const z = canZip();
  const raw: Bytes = z ? await gzip(json) : (enc.encode(json) as Bytes);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, raw);
  const env: Envelope = { v: 1, z: z ? 1 : 0, iv: toB64(iv), data: toB64(new Uint8Array(ct)) };
  return JSON.stringify(env);
}

async function open(payload: string): Promise<string> {
  const env = JSON.parse(payload) as Envelope;
  const { key } = await keys();
  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(env.iv) }, key, fromB64(env.data));
  } catch {
    // AES-GCM autentica anche il contenuto: o la passphrase è cambiata dopo il
    // caricamento, o il blob è arrivato danneggiato
    throw new Error('Non riesco a decifrare questo backup: passphrase diversa da quella con cui è stato creato, o file danneggiato.');
  }
  const bytes = new Uint8Array(plain) as Bytes;
  return env.z ? gunzip(bytes) : new TextDecoder().decode(bytes);
}

// ---- rete ----

async function rpc<T>(fn: string, body: Record<string, unknown>): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { apikey: KEY!, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    // progetto in pausa, offline, DNS…: al chiamante interessa solo "non c'è"
    throw new Error('Cloud irraggiungibile (offline, o progetto Supabase in pausa).');
  }
  if (!res.ok) throw new Error(`Cloud: errore ${res.status} — ${(await res.text()).slice(0, 200)}`);
  return res.json() as Promise<T>;
}

// ---- stato locale ----

export interface CloudMeta { shows: number; episodes: number; movies: number; watched: number }
export interface CloudVersion { created_at: string; bytes: number; meta: CloudMeta }

const kvGet = async (k: string) => (await db.kv.get(k))?.value as string | undefined;
const kvSet = (k: string, v: string) => db.kv.put({ key: k, value: v });

export const lastCloudSync = () => kvGet('cloudLastSync');

/**
 * Impronta economica dello stato locale: tutti campi indicizzati, così il
 * controllo "è cambiato qualcosa?" a ogni avvio non scorre 28.000 episodi.
 */
async function fingerprint(): Promise<{ fp: string; meta: CloudMeta }> {
  const [shows, episodes, movies, watched] = await Promise.all([
    db.shows.count(), db.episodes.count(), db.movies.count(),
    db.episodes.where('watched').equals(1).count(),
  ]);
  const lastShow = await db.shows.orderBy('lastActivityAt').last();
  const lastMovie = await db.movies.orderBy('watchedAt').last();
  return {
    fp: `${shows}:${episodes}:${movies}:${watched}:${lastShow?.lastActivityAt ?? ''}:${lastMovie?.watchedAt ?? ''}`,
    meta: { shows, episodes, movies, watched },
  };
}

// ---- push ----

export class CloudGuard extends Error {}

/**
 * Carica l'archivio cifrato. Rifiuta di farlo se l'archivio locale è vuoto o
 * molto più povero dell'ultima copia online: è esattamente lo scenario "ho
 * cancellato i dati di navigazione, riapro l'app e il vuoto si sincronizza
 * sopra il backup buono". Con `force` si scavalca (serve solo se hai davvero
 * ripulito la libreria di proposito).
 */
export async function pushBackup(force = false): Promise<{ versions: number; bytes: number }> {
  const { slot } = await keys();
  const { fp, meta } = await fingerprint();

  if (!force) {
    if (meta.shows + meta.movies === 0) {
      throw new CloudGuard('Archivio locale vuoto: non lo carico sopra il backup online.');
    }
    const online = await listVersions().catch(() => [] as CloudVersion[]);
    const prev = online[0]?.meta;
    if (prev && meta.watched < prev.watched * 0.5 && prev.watched > 20) {
      throw new CloudGuard(
        `Online ci sono ${prev.watched} episodi visti, qui solo ${meta.watched}: `
        + 'sync sospeso per non sovrascrivere. Se è voluto, forza dalle Impostazioni.',
      );
    }
  }

  const payload = await seal(await exportBackup());
  const out = await rpc<{ versions: number }>('backup_push', {
    p_slot: slot, p_payload: payload, p_meta: { ...meta, at: nowIso() },
  });
  await kvSet('cloudLastSync', nowIso());
  await kvSet('cloudLastFingerprint', fp);
  return { versions: out.versions, bytes: payload.length };
}

// ---- lista / restore ----

export async function listVersions(): Promise<CloudVersion[]> {
  const { slot } = await keys();
  return rpc<CloudVersion[]>('backup_list', { p_slot: slot });
}

/** Scarica una versione (default: la più recente) e la riversa nel database locale. */
export async function restoreFromCloud(createdAt?: string): Promise<NativeBackup> {
  const { slot } = await keys();
  const payload = await rpc<string | null>('backup_pull', { p_slot: slot, p_at: createdAt ?? null });
  if (!payload) throw new Error('Nessun backup trovato per questa passphrase.');
  const parsed = JSON.parse(await open(payload)) as NativeBackup;
  await applyImport({ shows: [], episodeWatches: [], movies: [], report: [], native: parsed });
  const { fp } = await fingerprint();
  await kvSet('cloudLastFingerprint', fp);
  await kvSet('cloudLastSync', nowIso());
  return parsed;
}

// ---- sync automatico ----

/**
 * Chiamato all'avvio e ogni 15 minuti: carica solo se la passphrase c'è e se
 * qualcosa è cambiato dall'ultimo invio. Silenzioso per definizione — un
 * backup che interrompe con un errore a ogni apertura verrebbe solo ignorato.
 */
export async function autoSync(): Promise<'skipped' | 'synced' | 'unchanged' | 'blocked'> {
  if (!cloudConfigured() || !hasPassphrase()) return 'skipped';
  const { fp, meta } = await fingerprint();
  if (meta.shows + meta.movies === 0) return 'skipped';
  if (fp === (await kvGet('cloudLastFingerprint'))) return 'unchanged';
  try {
    await pushBackup();
    return 'synced';
  } catch (err) {
    if (err instanceof CloudGuard) {
      console.warn('[seriality] sync bloccato:', err.message);
      return 'blocked';
    }
    console.warn('[seriality] sync fallito:', err);
    return 'skipped';
  }
}
