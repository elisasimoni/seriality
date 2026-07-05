import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { Empty, epCode, nav } from '../components';

export default function Upcoming() {
  const groups = useLiveQuery(async () => {
    const today = new Date().toISOString().slice(0, 10);
    const horizon = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10);
    const eps = await db.episodes
      .where('airDate').between(today, horizon, true, true)
      .toArray();
    const shows = new Map((await db.shows.toArray()).map((s) => [s.id, s]));
    const rows = eps
      .filter((e) => {
        const s = shows.get(e.showId);
        return !e.watched && s && !s.archived && !s.muted;
      })
      .sort((a, b) => (a.airDate! + (a.airTime ?? '')).localeCompare(b.airDate! + (b.airTime ?? '')));
    const byDay = new Map<string, typeof rows>();
    for (const e of rows) {
      if (!byDay.has(e.airDate!)) byDay.set(e.airDate!, []);
      byDay.get(e.airDate!)!.push(e);
    }
    return { byDay: [...byDay.entries()], shows };
  });

  if (!groups) return null;
  const dayLabel = (d: string) => {
    const today = new Date().toISOString().slice(0, 10);
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    if (d === today) return 'Oggi';
    if (d === tomorrow) return 'Domani';
    return new Date(d).toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
  };

  return (
    <>
      <h1 className="page-title">In arrivo</h1>
      <p className="page-sub">Gli episodi delle tue serie nei prossimi 90 giorni.</p>
      {groups.byDay.length === 0 ? (
        <Empty icon="📅" title="Nessun episodio in arrivo">
          Le tue serie sono in pausa… tempo di scoprirne di nuove!
        </Empty>
      ) : (
        groups.byDay.map(([day, eps]) => (
          <div className="day-group" key={day}>
            <h3>{dayLabel(day)}</h3>
            {eps.map((e) => {
              const show = groups.shows.get(e.showId)!;
              return (
                <div className="up-row" key={e.key} onClick={() => nav(`/show/${show.id}`)}>
                  {show.poster
                    ? <img src={show.poster} alt="" loading="lazy" />
                    : <div style={{ width: 40, height: 58, borderRadius: 8, background: 'var(--grad)', opacity: 0.4 }} />}
                  <div className="t">
                    <div className="s">{show.name}</div>
                    <div className="e">{epCode(e.season, e.number)} · {e.name || 'Episodio ' + e.number}</div>
                  </div>
                  <span className="badge">{show.network || e.airTime || ''}</span>
                </div>
              );
            })}
          </div>
        ))
      )}
    </>
  );
}
