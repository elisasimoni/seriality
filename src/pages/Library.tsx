import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, computeProgress, type ShowProgress } from '../db';
import { Empty, ShowCard } from '../components';

const TABS: { key: ShowProgress['status'] | 'all' | 'favorites'; label: string }[] = [
  { key: 'watching', label: 'In corso' },
  { key: 'uptodate', label: 'In pari' },
  { key: 'finished', label: 'Finite' },
  { key: 'notstarted', label: 'Da iniziare' },
  { key: 'stopped', label: 'Abbandonate' },
  { key: 'favorites', label: '❤️ Preferite' },
  { key: 'all', label: 'Tutte' },
];

export default function Library() {
  const [tab, setTab] = useState<string>('watching');
  const [q, setQ] = useState('');

  const data = useLiveQuery(async () => {
    const shows = await db.shows.toArray();
    const eps = await db.episodes.toArray();
    const byShow = new Map<number, typeof eps>();
    for (const e of eps) {
      if (!byShow.has(e.showId)) byShow.set(e.showId, []);
      byShow.get(e.showId)!.push(e);
    }
    return shows
      .map((s) => ({ show: s, prog: computeProgress(s, byShow.get(s.id) ?? []) }))
      .sort((a, b) => a.show.name.localeCompare(b.show.name));
  });

  if (!data) return null;
  const count = (key: string) =>
    key === 'all' ? data.length
      : key === 'favorites' ? data.filter((d) => d.show.favorite).length
      : data.filter((d) => d.prog.status === key).length;

  const visible = data.filter((d) => {
    if (q && !d.show.name.toLowerCase().includes(q.toLowerCase())) return false;
    if (tab === 'all') return true;
    if (tab === 'favorites') return !!d.show.favorite;
    return d.prog.status === tab;
  });

  return (
    <>
      <h1 className="page-title">Le mie serie</h1>
      <p className="page-sub">{data.length} serie nella tua libreria.</p>
      <div className="search-bar">
        <input type="search" placeholder="Cerca tra le tue serie…" value={q} onChange={(e) => setQ(e.target.value)} />
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
