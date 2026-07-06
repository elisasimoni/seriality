import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, computeProgress, type ShowProgress } from '../db';
import { Empty, ShowCard } from '../components';
import type { Show } from '../types';

interface Row { show: Show; prog: ShowProgress }

const TABS: { key: ShowProgress['status'] | 'all' | 'favorites'; label: string }[] = [
  { key: 'watching', label: 'In corso' },
  { key: 'uptodate', label: 'In pari' },
  { key: 'finished', label: 'Finite' },
  { key: 'notstarted', label: '🕐 Watchlist' },
  { key: 'stopped', label: 'Abbandonate' },
  { key: 'favorites', label: '❤️ Preferite' },
  { key: 'all', label: 'Tutte' },
];

type SortKey = 'recent' | 'az' | 'rating' | 'progress' | 'added';
const SORTS: { key: SortKey; label: string }[] = [
  { key: 'recent', label: 'Visione recente' },
  { key: 'az', label: 'Nome (A-Z)' },
  { key: 'rating', label: 'Voto più alto' },
  { key: 'progress', label: 'Progresso' },
  { key: 'added', label: 'Aggiunte di recente' },
];

export default function Library() {
  const [tab, setTab] = useState<string>('watching');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<SortKey>('recent');
  const [genre, setGenre] = useState('');

  const data = useLiveQuery(async () => {
    const shows = await db.shows.toArray();
    const eps = await db.episodes.toArray();
    const byShow = new Map<number, typeof eps>();
    for (const e of eps) {
      if (!byShow.has(e.showId)) byShow.set(e.showId, []);
      byShow.get(e.showId)!.push(e);
    }
    return shows.map((s) => ({ show: s, prog: computeProgress(s, byShow.get(s.id) ?? []) }));
  });

  const genres = useMemo(() => {
    const set = new Set<string>();
    for (const d of data ?? []) for (const g of d.show.genres ?? []) set.add(g);
    return [...set].sort((a, b) => a.localeCompare(b, 'it'));
  }, [data]);

  if (!data) return null;
  const count = (key: string) =>
    key === 'all' ? data.length
      : key === 'favorites' ? data.filter((d) => d.show.favorite).length
      : data.filter((d) => d.prog.status === key).length;

  const sorters: Record<SortKey, (a: Row, b: Row) => number> = {
    recent: (a, b) => (b.show.lastActivityAt ?? '').localeCompare(a.show.lastActivityAt ?? '') || a.show.name.localeCompare(b.show.name, 'it'),
    az: (a, b) => a.show.name.localeCompare(b.show.name, 'it'),
    rating: (a, b) => (b.show.rating ?? -1) - (a.show.rating ?? -1) || a.show.name.localeCompare(b.show.name, 'it'),
    progress: (a, b) => (b.prog.watched / Math.max(1, b.prog.total)) - (a.prog.watched / Math.max(1, a.prog.total)),
    added: (a, b) => (b.show.followedAt ?? b.show.addedAt ?? '').localeCompare(a.show.followedAt ?? a.show.addedAt ?? ''),
  };

  const visible = data
    .filter((d) => {
      if (q && !d.show.name.toLowerCase().includes(q.toLowerCase())) return false;
      if (genre && !(d.show.genres ?? []).includes(genre)) return false;
      if (tab === 'all') return true;
      if (tab === 'favorites') return !!d.show.favorite;
      return d.prog.status === tab;
    })
    .sort(sorters[sort]);

  return (
    <>
      <h1 className="page-title">Le mie serie</h1>
      <p className="page-sub">{data.length} serie nella tua libreria.</p>
      <div className="search-bar">
        <input type="search" placeholder="Cerca tra le tue serie…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="lib-filters">
        <label>
          Ordina
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
            {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </label>
        <label>
          Genere
          <select value={genre} onChange={(e) => setGenre(e.target.value)}>
            <option value="">Tutti i generi</option>
            {genres.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
        </label>
      </div>
      <div className="chip-row">
        {TABS.map((t) => (
          <button key={t.key} className={`chip ${tab === t.key ? 'active' : ''}`} onClick={() => setTab(t.key)}>
            {t.label}<span className="count">{count(t.key)}</span>
          </button>
        ))}
      </div>
      {visible.length === 0 ? (
        <Empty icon="📺" title="Nessuna serie qui">
          {data.length === 0 ? <>Importa i tuoi dati TV Time dalla pagina <a href="#/import" style={{ color: 'var(--accent)' }}>Importa</a>.</> : 'Prova un altro filtro.'}
        </Empty>
      ) : (
        <div className="poster-grid">
          {visible.map(({ show, prog }) => <ShowCard key={show.id} show={show} progress={prog} />)}
        </div>
      )}
    </>
  );
}
