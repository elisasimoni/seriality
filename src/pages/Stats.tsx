import { useLiveQuery } from 'dexie-react-hooks';
import { db, computeProgress, minutesOf } from '../db';
import { Empty, fmtMinutes } from '../components';
import Heatmap from '../Heatmap';

const WEEKDAYS = ['Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato', 'Domenica'];

export default function Stats() {
  const data = useLiveQuery(async () => {
    const [shows, eps, movies] = await Promise.all([
      db.shows.toArray(), db.episodes.toArray(), db.movies.toArray(),
    ]);
    return { shows, eps, movies };
  });
  if (!data) return null;
  const { shows, eps, movies } = data;
  if (!shows.length && !movies.length) {
    return (
      <>
        <h1 className="page-title">Statistiche</h1>
        <Empty icon="📊" title="Ancora nessun dato">Importa il tuo storico TV Time per vedere le statistiche.</Empty>
      </>
    );
  }

  const showMap = new Map(shows.map((s) => [s.id, s]));
  const watchedEps = eps.filter((e) => e.watched);
  const minutes = minutesOf(eps, showMap, movies);
  const moviesWatched = movies.filter((m) => m.watched);

  const byShow = new Map<number, typeof eps>();
  for (const e of eps) {
    if (!byShow.has(e.showId)) byShow.set(e.showId, []);
    byShow.get(e.showId)!.push(e);
  }
  const statuses = shows.map((s) => computeProgress(s, byShow.get(s.id) ?? []).status);
  const finished = statuses.filter((s) => s === 'finished').length;

  // generi più guardati (per episodi visti)
  const genreMin = new Map<string, number>();
  for (const e of watchedEps) {
    const show = showMap.get(e.showId);
    for (const g of show?.genres ?? []) {
      genreMin.set(g, (genreMin.get(g) ?? 0) + (e.runtime || show?.runtime || 40));
    }
  }
  for (const m of moviesWatched) {
    for (const g of m.genres ?? []) genreMin.set(g, (genreMin.get(g) ?? 0) + (m.runtime || 110));
  }
  const topGenres = [...genreMin.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  const maxGenre = topGenres[0]?.[1] ?? 1;

  // serie con più tempo speso
  const showMin = new Map<number, number>();
  for (const e of watchedEps) {
    showMin.set(e.showId, (showMin.get(e.showId) ?? 0) + (e.runtime || showMap.get(e.showId)?.runtime || 40) * (e.timesWatched || 1));
  }
  const topShows = [...showMin.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  const maxShow = topShows[0]?.[1] ?? 1;

  // episodi per anno
  const byYear = new Map<string, number>();
  for (const e of watchedEps) {
    if (!e.watchedAt) continue;
    const y = e.watchedAt.slice(0, 4);
    if (y > '2000') byYear.set(y, (byYear.get(y) ?? 0) + 1);
  }
  const years = [...byYear.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-8);
  const maxYear = Math.max(1, ...years.map(([, n]) => n));

  // ---- heatmap + statistiche divertenti (per giorno di visione) ----
  const dayCounts = new Map<string, number>();
  const addDay = (iso?: string) => {
    if (!iso) return;
    const d = iso.slice(0, 10);
    if (d > '2000') dayCounts.set(d, (dayCounts.get(d) ?? 0) + 1);
  };
  for (const e of watchedEps) addDay(e.watchedAt);
  for (const m of moviesWatched) addDay(m.watchedAt);

  const heatYears = [...new Set([...dayCounts.keys()].map((d) => Number(d.slice(0, 4))))].sort((a, b) => a - b);

  // giorno record
  let recordDay = ''; let recordN = 0;
  for (const [d, n] of dayCounts) if (n > recordN) { recordN = n; recordDay = d; }

  // giorno della settimana preferito
  const weekdayCount = new Array(7).fill(0);
  for (const [d, n] of dayCounts) weekdayCount[(new Date(d).getUTCDay() + 6) % 7] += n;
  const favWeekday = weekdayCount.indexOf(Math.max(...weekdayCount));

  // streak più lungo (giorni consecutivi con almeno una visione)
  const sortedDays = [...dayCounts.keys()].sort();
  let longest = sortedDays.length ? 1 : 0; let cur = sortedDays.length ? 1 : 0;
  for (let i = 1; i < sortedDays.length; i++) {
    const diff = (Date.parse(sortedDays[i]) - Date.parse(sortedDays[i - 1])) / 86400000;
    cur = diff === 1 ? cur + 1 : 1;
    if (cur > longest) longest = cur;
  }
  const fmtRecord = recordDay
    ? new Date(recordDay).toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' })
    : '—';

  return (
    <>
      <h1 className="page-title">Statistiche</h1>
      <p className="page-sub">Tutto il tempo che hai (bene!) speso davanti allo schermo.</p>
      <div className="stats-hero">
        <div className="stat-card"><div className="n">{fmtMinutes(minutes)}</div><div className="l">di visione totale</div></div>
        <div className="stat-card"><div className="n">{watchedEps.length.toLocaleString('it')}</div><div className="l">episodi visti</div></div>
        <div className="stat-card"><div className="n">{shows.length}</div><div className="l">serie seguite</div></div>
        <div className="stat-card"><div className="n">{finished}</div><div className="l">serie completate</div></div>
        <div className="stat-card"><div className="n">{moviesWatched.length}</div><div className="l">film visti</div></div>
      </div>

      {heatYears.length > 0 && (
        <>
          <h2 className="section-title">📅 Il tuo calendario di visioni</h2>
          <Heatmap counts={dayCounts} years={heatYears} />
          <div className="stats-hero" style={{ marginTop: 18 }}>
            <div className="stat-card"><div className="n">{longest}</div><div className="l">giorni di fila 🔥</div></div>
            <div className="stat-card"><div className="n" style={{ fontSize: 22 }}>{WEEKDAYS[favWeekday]}</div><div className="l">il tuo giorno preferito</div></div>
            <div className="stat-card"><div className="n">{recordN}</div><div className="l">record in un giorno<br /><span style={{ fontSize: 11 }}>({fmtRecord})</span></div></div>
          </div>
        </>
      )}

      {topShows.length > 0 && (
        <>
          <h2 className="section-title">⏱ Le serie dove hai passato più tempo</h2>
          {topShows.map(([id, min]) => (
            <div className="bar-row" key={id}>
              <span className="lbl">{showMap.get(id)?.name ?? id}</span>
              <div className="bar"><div style={{ width: `${(min / maxShow) * 100}%` }}>{Math.round(min / 60)}h</div></div>
            </div>
          ))}
        </>
      )}

      {topGenres.length > 0 && (
        <>
          <h2 className="section-title">🎭 I tuoi generi</h2>
          {topGenres.map(([g, min]) => (
            <div className="bar-row" key={g}>
              <span className="lbl">{g}</span>
              <div className="bar"><div style={{ width: `${(min / maxGenre) * 100}%` }}>{Math.round(min / 60)}h</div></div>
            </div>
          ))}
        </>
      )}

      {years.length > 1 && (
        <>
          <h2 className="section-title">📆 Episodi per anno</h2>
          {years.map(([y, n]) => (
            <div className="bar-row" key={y}>
              <span className="lbl">{y}</span>
              <div className="bar"><div style={{ width: `${(n / maxYear) * 100}%` }}>{n}</div></div>
            </div>
          ))}
        </>
      )}
    </>
  );
}
