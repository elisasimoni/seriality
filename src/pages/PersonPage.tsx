import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { buildNameYearIndex, db, nameYearMatch } from '../db';
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
    return {
      showIndex: buildNameYearIndex(shows.map((s) => ({ name: s.name, year: s.premiered?.slice(0, 4) }))),
      movieTmdb: new Set(movies.map((m) => m.tmdbId).filter(Boolean)),
      movieIndex: buildNameYearIndex(movies.map((m) => ({ name: m.name, year: m.releaseDate?.slice(0, 4) }))),
    };
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
  const inLib = (r: Rec) =>
    r.kind === 'tv' ? !!lib && nameYearMatch(lib.showIndex, r.name, r.year)
      : lib?.movieTmdb.has(r.tmdbId) || (!!lib && nameYearMatch(lib.movieIndex, r.name, r.year));

  const tv = credits.filter((c) => c.media_type === 'tv' && (c.episode_count ?? 99) > 2).map(toRec);
  const movies = credits.filter((c) => c.media_type === 'movie').map(toRec);
  const known = [...tv, ...movies].filter(inLib);
  const charOf = new Map(credits.map((c) => [`${c.media_type}:${c.id}`, c.character]));
  const sub = (r: Rec) => {
    const ch = charOf.get(`${r.kind}:${r.tmdbId}`);
    return ch ? `${r.kind === 'tv' ? '📺' : '🍿'} ${ch}` : undefined;
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

      {known.length > 0 && <TitleRow title={`Già nella tua libreria (${known.length})`} items={known} subOf={sub} openOnly />}
      <TitleRow title={`Serie TV (${tv.length})`} items={tv.slice(0, 16)} subOf={sub} />
      <TitleRow title={`Film (${movies.length})`} items={movies.slice(0, 16)} subOf={sub} />
    </>
  );
}
