import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './db';

const fmt = (n: number) => n.toLocaleString('it-IT');

/** Converte minuti in "Xg Yh" o "Yh" o "Zm" per il sottotitolo. */
function humanTime(min: number): string {
  const days = Math.floor(min / (60 * 24));
  const hours = Math.floor((min % (60 * 24)) / 60);
  if (days > 0) return `${fmt(days)}g ${hours}h`;
  if (hours > 0) return `${hours}h ${Math.round(min % 60)}m`;
  return `${Math.round(min)}m`;
}

/** Riepilogo in alto (stile TV Time): ore serie/film, episodi, film. */
export default function SummaryBar() {
  const data = useLiveQuery(async () => {
    const [shows, eps, movies] = await Promise.all([
      db.shows.toArray(), db.episodes.toArray(), db.movies.toArray(),
    ]);
    const runtimeOf = new Map(shows.map((s) => [s.id, s.runtime]));
    let seriesMin = 0;
    let watchedEps = 0;
    for (const e of eps) {
      if (!e.watched) continue;
      watchedEps += 1;
      seriesMin += (e.runtime || runtimeOf.get(e.showId) || 40) * (e.timesWatched || 1);
    }
    let movieMin = 0;
    let watchedMovies = 0;
    for (const m of movies) {
      if (!m.watched) continue;
      watchedMovies += 1;
      movieMin += m.runtime || 110;
    }
    return { seriesMin, movieMin, watchedEps, watchedMovies };
  });

  if (!data) return null;

  const cards = [
    { n: fmt(Math.round(data.seriesMin / 60)), unit: 'ore', sub: `di serie · ${humanTime(data.seriesMin)}`, ico: '📺' },
    { n: fmt(Math.round(data.movieMin / 60)), unit: 'ore', sub: `di film · ${humanTime(data.movieMin)}`, ico: '🍿' },
    { n: fmt(data.watchedEps), unit: '', sub: 'episodi visti', ico: '🎬' },
    { n: fmt(data.watchedMovies), unit: '', sub: 'film visti', ico: '🎞️' },
  ];

  return (
    <div className="summary-bar">
      {cards.map((c) => (
        <div className="summary-card" key={c.sub}>
          <div className="s-ico">{c.ico}</div>
          <div className="s-body">
            <div className="s-num">{c.n}{c.unit && <span className="s-unit"> {c.unit}</span>}</div>
            <div className="s-sub">{c.sub}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
