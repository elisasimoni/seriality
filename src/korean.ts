// Romanizzazione approssimata dell'hangul (Revised Romanization semplificata,
// senza le regole di assimilazione tra sillabe): serve solo a rendere leggibili
// i titoli/nomi coreani che TMDB non ha tradotto, non è un motore linguistico.

const CHO = ['g', 'kk', 'n', 'd', 'tt', 'r', 'm', 'b', 'pp', 's', 'ss', '', 'j', 'jj', 'ch', 'k', 't', 'p', 'h'];
const JUNG = ['a', 'ae', 'ya', 'yae', 'eo', 'e', 'yeo', 'ye', 'o', 'wa', 'wae', 'oe', 'yo', 'u', 'wo', 'we', 'wi', 'yu', 'eu', 'ui', 'i'];
const JONG = ['', 'k', 'k', 'k', 'n', 'n', 'n', 't', 'l', 'k', 'm', 'l', 'l', 'l', 'p', 'l', 'm', 'p', 'p', 't', 't', 'ng', 't', 't', 'k', 't', 'p', 'h'];

const HANGUL_RE = /[가-힣]/;
const SBASE = 0xac00;

export const hasHangul = (s: string): boolean => HANGUL_RE.test(s);

/** Traslittera i blocchi hangul in latino, lasciando invariato il resto (spazi, numeri, punteggiatura). */
export function romanizeHangul(s: string): string {
  let out = '';
  let atWordStart = true;
  for (const ch of s) {
    const code = ch.codePointAt(0)!;
    if (code >= SBASE && code <= 0xd7a3) {
      const i = code - SBASE;
      let syll = CHO[Math.floor(i / (21 * 28))] + JUNG[Math.floor((i % (21 * 28)) / 28)] + JONG[i % 28];
      if (atWordStart) syll = syll.charAt(0).toUpperCase() + syll.slice(1);
      out += syll;
      atWordStart = false;
    } else {
      out += ch;
      atWordStart = /[^\p{L}\p{N}]/u.test(ch);
    }
  }
  return out;
}

/** "타이틀" → "타이틀 (Tail)"; se non c'è hangul ritorna la stringa invariata. */
export function displayTitle(name: string): string {
  if (!hasHangul(name)) return name;
  return `${name} (${romanizeHangul(name)})`;
}

/** Preferisce un alias già in caratteri latini (es. "Kim Go-eun" da also_known_as di TMDB); fallback alla romanizzazione algoritmica. */
export function pickLatinName(name: string, akas: string[] = []): string {
  if (!hasHangul(name)) return name;
  const latin = akas.find((a) => a && /[a-zA-Z]/.test(a) && !hasHangul(a));
  return `${name} (${latin ?? romanizeHangul(name)})`;
}
