import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Show } from './types';
import type { ShowProgress } from './db';

export function nav(to: string) {
  location.hash = to;
}

export function useRoute(): string {
  const [h, setH] = useState(location.hash.slice(1) || '/');
  useEffect(() => {
    const f = () => setH(location.hash.slice(1) || '/');
    window.addEventListener('hashchange', f);
    return () => window.removeEventListener('hashchange', f);
  }, []);
  return h;
}

/**
 * Ripristina la posizione di scroll per ogni route (per rotta = per pagina/dettaglio).
 * Aprendo un titolo e tornando indietro la lista resta dov'era, invece di risalire.
 * Riprova per qualche frame perché le liste caricano i dati in modo asincrono
 * (la pagina cresce dopo il primo render) e senza retry lo scrollTo verrebbe ignorato.
 */
export function useScrollRestoration(route: string) {
  const positions = useRef<Record<string, number>>({});
  const restoring = useRef(false);

  useEffect(() => {
    const onScroll = () => {
      if (!restoring.current) positions.current[route] = window.scrollY;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [route]);

  useLayoutEffect(() => {
    const target = positions.current[route] ?? 0;
    restoring.current = true;
    let raf = 0;
    let tries = 0;
    const step = () => {
      window.scrollTo(0, target);
      tries += 1;
      if (Math.abs(window.scrollY - target) > 2 && tries < 45) {
        raf = requestAnimationFrame(step);
      } else {
        restoring.current = false;
      }
    };
    step();
    return () => { cancelAnimationFrame(raf); restoring.current = false; };
  }, [route]);
}

/**
 * Naviga tra schede adiacenti (serie o film): swipe orizzontale su touch,
 * frecce ‹ › ai bordi (anche da desktop/click) e tasti freccia della tastiera.
 * Lo swipe ignora i caroselli orizzontali (cast, simili) e i controlli.
 */
export function AdjacentNav({ prevHref, nextHref }: { prevHref?: string; nextHref?: string }) {
  useEffect(() => {
    let x0 = 0;
    let y0 = 0;
    let active = false;
    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) { active = false; return; }
      const t = e.target as HTMLElement;
      // non intercettare swipe su caroselli orizzontali o controlli
      if (t?.closest?.('.rec-row, .stars, input, textarea, .confirm-box')) { active = false; return; }
      x0 = e.touches[0].clientX;
      y0 = e.touches[0].clientY;
      active = true;
    };
    const onEnd = (e: TouchEvent) => {
      if (!active) return;
      active = false;
      const t = e.changedTouches[0];
      const dx = t.clientX - x0;
      const dy = t.clientY - y0;
      if (Math.abs(dx) > 90 && Math.abs(dx) > Math.abs(dy) * 2) {
        const href = dx < 0 ? nextHref : prevHref;
        if (href) location.hash = href;
      }
    };
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el?.closest?.('input, textarea')) return;
      if (e.key === 'ArrowRight' && nextHref) location.hash = nextHref;
      if (e.key === 'ArrowLeft' && prevHref) location.hash = prevHref;
    };
    window.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchend', onEnd, { passive: true });
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('touchstart', onStart);
      window.removeEventListener('touchend', onEnd);
      window.removeEventListener('keydown', onKey);
    };
  }, [prevHref, nextHref]);

  return (
    <>
      {prevHref && <a className="edge-nav left" href={`#${prevHref}`} aria-label="Precedente">‹</a>}
      {nextHref && <a className="edge-nav right" href={`#${nextHref}`} aria-label="Successivo">›</a>}
    </>
  );
}

let toastFn: ((msg: string) => void) | null = null;
export function Toaster() {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    toastFn = (m) => {
      setMsg(m);
      clearTimeout(t);
      t = setTimeout(() => setMsg(null), 2600);
    };
    return () => { toastFn = null; };
  }, []);
  return msg ? <div className="toast">{msg}</div> : null;
}
export const toast = (msg: string) => toastFn?.(msg);

interface ConfirmReq {
  title: string;
  body?: string;
  yes: string;
  no: string;
  resolve: (v: boolean) => void;
}
let confirmFn: ((req: ConfirmReq) => void) | null = null;

/** Dialog di conferma sì/no (promise-based). Ritorna true se l'utente conferma. */
export function askConfirm(opts: { title: string; body?: string; yes?: string; no?: string }): Promise<boolean> {
  return new Promise((resolve) => {
    if (!confirmFn) { resolve(false); return; }
    confirmFn({ title: opts.title, body: opts.body, yes: opts.yes ?? 'Sì', no: opts.no ?? 'No', resolve });
  });
}

export function ConfirmHost() {
  const [req, setReq] = useState<ConfirmReq | null>(null);
  useEffect(() => {
    confirmFn = (r) => setReq(r);
    return () => { confirmFn = null; };
  }, []);
  if (!req) return null;
  const close = (v: boolean) => { req.resolve(v); setReq(null); };
  return (
    <div className="confirm-overlay" onClick={() => close(false)}>
      <div className="confirm-box" onClick={(e) => e.stopPropagation()}>
        <div className="confirm-title">{req.title}</div>
        {req.body && <div className="confirm-body">{req.body}</div>}
        <div className="confirm-actions">
          <button className="btn" onClick={() => close(false)}>{req.no}</button>
          <button className="btn primary" onClick={() => close(true)} autoFocus>{req.yes}</button>
        </div>
      </div>
    </div>
  );
}

export function Poster({ src, name }: { src?: string; name: string }) {
  const [err, setErr] = useState(false);
  if (!src || err) return <div className="ph">{name}</div>;
  return <img className="img" src={src} alt={name} loading="lazy" onError={() => setErr(true)} />;
}

export function ShowCard({ show, progress, sub }: { show: Show; progress?: ShowProgress; sub?: string }) {
  return (
    <div className="poster-card" onClick={() => nav(`/show/${show.id}`)}>
      <Poster src={show.poster} name={show.name} />
      {show.favorite && <div className="fav">❤️</div>}
      <div className="meta">
        <div className="name">{show.name}</div>
        <div className="sub">
          {sub ?? (progress ? `${progress.watched}/${progress.total || '?'} episodi` : '')}
        </div>
        {progress && progress.total > 0 && (
          <div className="progress">
            <div style={{ width: `${Math.min(100, (progress.watched / progress.total) * 100)}%` }} />
          </div>
        )}
      </div>
    </div>
  );
}

export function Stars({ value, onChange }: { value?: number; onChange: (v: number) => void }) {
  // voto 0-10 mostrato come 5 stelle
  const stars = Math.round((value ?? 0) / 2);
  return (
    <span className="stars" title={value ? `${value}/10` : 'Vota'}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span
          key={i}
          className={`s ${i <= stars ? 'on' : ''}`}
          onClick={(e) => { e.stopPropagation(); onChange(i * 2 === value ? 0 : i * 2); }}
        >⭐</span>
      ))}
    </span>
  );
}

export function Empty({ icon, title, children }: { icon: string; title: string; children?: React.ReactNode }) {
  return (
    <div className="empty">
      <div className="big">{icon}</div>
      <h3>{title}</h3>
      <div>{children}</div>
    </div>
  );
}

export const fmtDate = (d?: string) => {
  if (!d) return '—';
  const dt = new Date(d);
  return isNaN(dt.getTime()) ? '—' : dt.toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' });
};

export function fmtMinutes(min: number): string {
  const months = Math.floor(min / (60 * 24 * 30));
  const days = Math.floor((min % (60 * 24 * 30)) / (60 * 24));
  const hours = Math.floor((min % (60 * 24)) / 60);
  const parts: string[] = [];
  if (months) parts.push(`${months} mes${months === 1 ? 'e' : 'i'}`);
  if (days) parts.push(`${days} giorn${days === 1 ? 'o' : 'i'}`);
  if (hours && !months) parts.push(`${hours} or${hours === 1 ? 'a' : 'e'}`);
  if (!parts.length) parts.push(`${Math.round(min % 60)} minuti`);
  return parts.join(', ');
}

export const epCode = (s: number, n: number) =>
  `S${String(s).padStart(2, '0')}E${String(n).padStart(2, '0')}`;
