import { useEffect, useState } from 'react';
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
