import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, sameTitle } from '../db';
import { fmtDate } from '../components';
import {
  personCombinedCredits, personDetails, posterUrl,
  type TmdbCredit, type TmdbPerson,
} from '../tmdb';
import { TitleRow } from '../extras';
import { pickLatinName } from '../korean';
import type { Rec } from '../recommend';

export default function PersonPage({ personId }: { personId: number }) {
  const [person, setPerson] = useState<TmdbPerson | null | undefined>(undefined);
  const [credits, setCredits] = useState<TmdbCredit[]>([]);
  const [bioOpen, setBioOpen] = useState(false);
  const lib = useLiveQuery(async () => {
    const [shows, movies] = await Promise.all([db.shows.toArray(), db.movies.toArray()]);
    return { shows, movies };
  });

  useEffect(() => {
    setPerson(undefined);
    setCredits([]);
    let cancelled = false;
    (async () => {
      const [p, c] = await Promise.all([personDetails(personId), personCombinedCredits(personId)]);
      if (cancelled) return;
      setPerson(p);
      setCredits(c);
    })().catch(() => setPerson(null));
    return () => { cancelled = true; };
  }, [personId]);

  if (person === undefined) return <p style={{ color: 'var(--text-dim)' }}>Carico la scheda… 🎭</p>;
  if (person === null) return <p>Persona non trovata.</p>;

  const toRec = (c: TmdbCredit): Rec => ({
    kind: c.media_type,
    tmdbId: c.id,
    name: (c.media_type === 'tv' ? c.name : c.title) ?? '?',
    poster: posterUrl(c.poster_path),
    year: (c.media_type === 'tv' ? c.first_air_date : c.release_date)?.slice(0, 4),
    vote: c.vote_average,
    overview: c.character ? `Interpreta ${c.character}` : undefined,
  });
  // Match libreria per id TMDB (robusto ai titoli localizzati: TMDB restituisce
  // il titolo it-IT/originale, mentre in libreria il nome arriva da TVDB/TVmaze
  // e può essere in un'altra lingua). Fallback su titolo tradotto e originale.
  // Ritorna la voce di libreria che ha combaciato, per mostrare nella card
  // "In libreria: <nome>" — così un match sbagliato è visibile e rintracciabile.
  const libMatch = (c: TmdbCredit): { name: string; via: 'id' | 'nome' } | undefined => {
    if (!lib) return undefined;
    const year = (c.media_type === 'tv' ? c.first_air_date : c.release_date)?.slice(0, 4);
    const titles = (c.media_type === 'tv' ? [c.name, c.original_name] : [c.title, c.original_title])
      .filter(Boolean) as string[];
    if (c.media_type === 'tv') {
      const byId = lib.shows.find((s) => s.tmdbId != null && s.tmdbId === c.id);
      if (byId) return { name: byId.name, via: 'id' };
      const byName = lib.shows.find((s) => titles.some((t) => sameTitle(s.name, s.premiered?.slice(0, 4), t, year)));
      return byName && { name: byName.name, via: 'nome' };
    }
    const byId = lib.movies.find((m) => m.tmdbId != null && m.tmdbId === c.id);
    if (byId) return { name: byId.name, via: 'id' };
    const byName = lib.movies.find((m) => titles.some((t) => sameTitle(m.name, m.releaseDate?.slice(0, 4), t, year)));
    return byName && { name: byName.name, via: 'nome' };
  };

  const tv = credits.filter((c) => c.media_type === 'tv' && (c.episode_count ?? 99) > 2).map(toRec);
  const movies = credits.filter((c) => c.media_type === 'movie').map(toRec);
  // "Già in libreria" da tutti i credits: un titolo posseduto non va nascosto
  // dal filtro sugli episodi (ruoli guest con ≤2 episodi restano visibili).
  const matches = credits
    .map((c) => ({ c, m: libMatch(c) }))
    .filter((x): x is { c: TmdbCredit; m: { name: string; via: 'id' | 'nome' } } => !!x.m);
  const known = matches.map((x) => toRec(x.c));
  const matchOf = new Map(matches.map((x) => [`${x.c.media_type}:${x.c.id}`, x.m]));
  const charOf = new Map(credits.map((c) => [`${c.media_type}:${c.id}`, c.character]));
  const sub = (r: Rec) => {
    const ch = charOf.get(`${r.kind}:${r.tmdbId}`);
    return ch ? `${r.kind === 'tv' ? '📺' : '🍿'} ${ch}` : undefined;
  };
  // Nelle card "già in libreria" mostra la voce combaciata: se il nome è
  // diverso dal titolo TMDB (o il match è solo per nome) si vede subito.
  const subKnown = (r: Rec) => {
    const m = matchOf.get(`${r.kind}:${r.tmdbId}`);
    return m ? `📚 ${m.name}${m.via === 'nome' ? ' (match per nome)' : ''}` : sub(r);
  };

  const bio = person.biography?.trim();
  const akaList = [...new Set((person.also_known_as ?? []).filter((a) => a && a !== person.name))].slice(0, 4);
  return (
    <>
      <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start', marginBottom: 10, flexWrap: 'wrap' }}>
        {person.profile_path
          ? <img src={posterUrl(person.profile_path)} alt="" style={{ width: 150, borderRadius: 16, border: '1px solid var(--border)' }} />
          : <div style={{ width: 150, height: 220, borderRadius: 16, background: 'var(--grad)', opacity: 0.35, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 50 }}>🎭</div>}
        <div style={{ flex: 1, minWidth: 260 }}>
          <h1 className="page-title" style={{ marginBottom: 6 }}>{pickLatinName(person.name, person.also_known_as)}</h1>
          <div className="facts" style={{ color: 'var(--text-dim)', fontSize: 13.5, display: 'flex', gap: 14, flexWrap: 'wrap' }}>
            {person.known_for_department && <span>{person.known_for_department === 'Acting' ? 'Attore/Attrice' : person.known_for_department}</span>}
            {person.birthday && <span>🎂 {fmtDate(person.birthday)}{person.deathday ? ` – ✝ ${fmtDate(person.deathday)}` : ''}</span>}
            {person.place_of_birth && <span>📍 {person.place_of_birth}</span>}
            <span>🎬 {credits.length} titoli</span>
            {person.imdb_id && (
              <a href={`https://www.imdb.com/name/${person.imdb_id}/`} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>
                IMDb ↗
              </a>
            )}
            {person.homepage && (
              <a href={person.homepage} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>
                Sito ↗
              </a>
            )}
          </div>
          {akaList.length > 0 && (
            <p style={{ color: 'var(--text-dim)', fontSize: 12.5, marginTop: 4 }}>
              Conosciuta/o anche come: {akaList.join(', ')}
            </p>
          )}
          {bio && (
            <p style={{ color: 'var(--text-dim)', maxWidth: 720, fontSize: 14 }}>
              {bioOpen || bio.length <= 340 ? bio : bio.slice(0, 340) + '… '}
              {bio.length > 340 && (
                <a style={{ color: 'var(--accent)', cursor: 'pointer' }} onClick={() => setBioOpen(!bioOpen)}>
                  {bioOpen ? ' meno' : 'leggi tutto'}
                </a>
              )}
            </p>
          )}
        </div>
      </div>

      {known.length > 0 && <TitleRow title={`Già nella tua libreria (${known.length})`} items={known} subOf={subKnown} openOnly />}
      <TitleRow title={`Serie TV (${tv.length})`} items={tv.slice(0, 16)} subOf={sub} />
      <TitleRow title={`Film (${movies.length})`} items={movies.slice(0, 16)} subOf={sub} />
    </>
  );
}
