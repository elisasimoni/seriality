import { useEffect, useState } from 'react';
import { Toaster, useRoute } from './components';
import { enrichAll, onEnrichProgress, type EnrichProgress } from './tvmaze';
import { enrichMovies, onMovieEnrichProgress, type MovieEnrichProgress } from './tmdb';
import { db, nowIso } from './db';
import WatchNext from './pages/WatchNext';
import Upcoming from './pages/Upcoming';
import Library from './pages/Library';
import Movies from './pages/Movies';
import ShowDetail from './pages/ShowDetail';
import MovieDetail from './pages/MovieDetail';
import PersonPage from './pages/PersonPage';
import Preview from './pages/Preview';
import { LockScreen, lockActive } from './lock';
import Stats from './pages/Stats';
import ImportPage from './pages/ImportPage';
import Discover from './pages/Discover';
import Settings from './pages/Settings';

const NAV = [
  { to: '/', ico: '▶️', label: 'Guarda', full: 'Da guardare', bottom: true },
  { to: '/upcoming', ico: '📅', label: 'In arrivo', full: 'In arrivo', bottom: true },
  { to: '/shows', ico: '📺', label: 'Serie', full: 'Le mie serie', bottom: true },
  { to: '/movies', ico: '🍿', label: 'Film', full: 'Film', bottom: true },
  { to: '/discover', ico: '🔭', label: 'Scopri', full: 'Scopri', bottom: true },
  { to: '/stats', ico: '📊', label: 'Stats', full: 'Statistiche', bottom: false },
  { to: '/import', ico: '📤', label: 'Importa', full: 'Importa', bottom: false },
  { to: '/settings', ico: '⚙️', label: 'Opzioni', full: 'Impostazioni', bottom: false },
];

export default function App() {
  const route = useRoute();
  const [locked, setLocked] = useState(lockActive());
  const [enrich, setEnrich] = useState<EnrichProgress>({ done: 0, total: 0, running: false });
  const [mEnrich, setMEnrich] = useState<MovieEnrichProgress>({ done: 0, total: 0, running: false });
  useEffect(() => onEnrichProgress(setEnrich), []);
  useEffect(() => onMovieEnrichProgress(setMEnrich), []);

  // Aggiornamenti automatici: all'avvio (e ogni 30 min finché l'app è aperta)
  // controlla se sono passate 12h dall'ultimo refresh; se sì aggiorna le serie
  // non concluse (nuovi episodi/date) e completa i film senza poster.
  useEffect(() => {
    const check = async () => {
      const last = (await db.kv.get('lastAutoRefresh'))?.value as string | undefined;
      if (last && Date.now() - new Date(last).getTime() < 12 * 3600 * 1000) return;
      if ((await db.shows.count()) === 0 && (await db.movies.count()) === 0) return;
      await db.kv.put({ key: 'lastAutoRefresh', value: nowIso() });
      void enrichAll('auto');
      void enrichMovies();
    };
    void check();
    const t = setInterval(check, 30 * 60 * 1000);
    return () => clearInterval(t);
  }, []);

  if (locked) return <LockScreen onUnlock={() => setLocked(false)} />;

  let page: React.ReactNode;
  const showMatch = route.match(/^\/show\/(\d+)/);
  const movieMatch = route.match(/^\/movie\/(.+)/);
  const personMatch = route.match(/^\/person\/(\d+)/);
  const previewMatch = route.match(/^\/preview\/(tv|movie)\/(\d+)/);
  if (showMatch) page = <ShowDetail id={Number(showMatch[1])} />;
  else if (movieMatch) page = <MovieDetail movieKey={decodeURIComponent(movieMatch[1])} />;
  else if (personMatch) page = <PersonPage personId={Number(personMatch[1])} />;
  else if (previewMatch) page = <Preview kind={previewMatch[1] as 'tv' | 'movie'} tmdbId={Number(previewMatch[2])} />;
  else if (route === '/upcoming') page = <Upcoming />;
  else if (route === '/shows') page = <Library />;
  else if (route === '/movies') page = <Movies />;
  else if (route === '/stats') page = <Stats />;
  else if (route === '/discover') page = <Discover />;
  else if (route === '/import') page = <ImportPage />;
  else if (route === '/settings') page = <Settings />;
  else page = <WatchNext />;

  return (
    <div className="app">
      <aside className="sidebar">
        <a className="brand" href="#/">Seriality<small>il tuo tracker, per sempre</small></a>
        {NAV.map((n) => (
          <a
            key={n.to} href={`#${n.to}`}
            className={`nav-item ${n.bottom ? 'in-bottom' : ''} ${route === n.to || (n.to === '/' && route === '') ? 'active' : ''}`}
          >
            <span className="ico">{n.ico}</span><span className="txt">{n.full}</span>
          </a>
        ))}
        <div className="nav-spacer" />
        {enrich.running && (
          <div className="enrich-pill">
            📡 Aggiorno serie… {enrich.done}/{enrich.total}
            <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{enrich.current}</div>
            <div className="bar"><div style={{ width: `${(enrich.done / Math.max(1, enrich.total)) * 100}%` }} /></div>
          </div>
        )}
        {mEnrich.running && (
          <div className="enrich-pill">
            🍿 Completo film… {mEnrich.done}/{mEnrich.total}
            <div className="bar"><div style={{ width: `${(mEnrich.done / Math.max(1, mEnrich.total)) * 100}%` }} /></div>
          </div>
        )}
      </aside>
      <main className="main">{page}</main>
      <nav className="bottom-nav">
        {NAV.filter((n) => n.bottom).map((n) => (
          <a
            key={n.to} href={`#${n.to}`}
            className={`bn-item ${route === n.to || (n.to === '/' && route === '') ? 'active' : ''}`}
          >
            <span className="bn-ico">{n.ico}</span>
            <span className="bn-txt">{n.label}</span>
          </a>
        ))}
      </nav>
      <Toaster />
    </div>
  );
}
