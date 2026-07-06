import { useEffect, useState } from 'react';
import { ConfirmHost, Toaster, useRoute, useScrollRestoration } from './components';
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
import { NAV_ICONS } from './icons';

interface NavDef {
  to: string; ico?: string; icon?: keyof typeof NAV_ICONS;
  label: string; full: string;
}

// Icone principali (sidebar + bottom bar)
const NAV: NavDef[] = [
  { to: '/', icon: 'watch', label: 'Guarda', full: 'Da guardare' },
  { to: '/upcoming', icon: 'upcoming', label: 'In arrivo', full: 'In arrivo' },
  { to: '/shows', icon: 'shows', label: 'Serie', full: 'Le mie serie' },
  { to: '/movies', icon: 'movies', label: 'Film', full: 'Film' },
  { to: '/discover', icon: 'plus', label: 'Scopri', full: 'Scopri' },
  { to: '/stats', ico: '📊', label: 'Stats', full: 'Statistiche' },
  { to: '/import', ico: '📤', label: 'Importa', full: 'Importa' },
  { to: '/settings', ico: '⚙️', label: 'Opzioni', full: 'Impostazioni' },
];

// Bottom bar: ordine con Scopri (+) al centro come pulsante d'azione
const BOTTOM_ORDER = ['/', '/upcoming', '/discover', '/shows', '/movies'];
const BOTTOM: NavDef[] = BOTTOM_ORDER.map((to) => NAV.find((n) => n.to === to)!);
const isActive = (route: string, to: string) => route === to || (to === '/' && route === '');

export default function App() {
  const route = useRoute();
  useScrollRestoration(route);
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
        {NAV.map((n) => {
          const Ico = n.icon ? NAV_ICONS[n.icon] : null;
          return (
            <a
              key={n.to} href={`#${n.to}`}
              className={`nav-item ${n.icon ? 'in-bottom' : ''} ${isActive(route, n.to) ? 'active' : ''}`}
            >
              <span className="ico">{Ico ? <Ico size={20} /> : n.ico}</span>
              <span className="txt">{n.full}</span>
            </a>
          );
        })}
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
        {BOTTOM.map((n) => {
          const Ico = NAV_ICONS[n.icon!];
          const fab = n.to === '/discover';
          return (
            <a
              key={n.to} href={`#${n.to}`}
              className={`bn-item ${fab ? 'bn-fab-item' : ''} ${isActive(route, n.to) ? 'active' : ''}`}
              aria-label={n.full}
            >
              {fab ? (
                <span className="bn-fab"><Ico size={26} /></span>
              ) : (
                <span className="bn-ico"><Ico size={23} /></span>
              )}
              <span className="bn-txt">{n.label}</span>
            </a>
          );
        })}
      </nav>
      <Toaster />
      <ConfirmHost />
    </div>
  );
}
