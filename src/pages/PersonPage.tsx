import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { fmtDate } from '../components';
import {
  personCombinedCredits, personDetails, posterUrl,
  type TmdbCredit, type TmdbPerson,
} from '../tmdb';
import { TitleRow } from '../extras';
import type { Rec } from '../recommend';

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

export default function PersonPage({ personId }: { personId: number }) {
  const [person, setPerson] = useState<TmdbPerson | null | undefined>(undefined);
  const [credits, setCredits] = useState<TmdbCredit[]>([]);
  const [bioOpen, setBioOpen] = useState(false);
  const lib = useLiveQuery(async () => {
    const [shows, movies] = await Promise.all([db.shows.toArray(), db.movies.toArray()]);
    return {
      showNames: new Set(shows.map((s) => slug(s.name))),
      movieTmdb: new Set(movies.map((m) => m.tmdbId).filter(Boolean)),
      movieNames: new Set(movies.map((m) => slug(m.name))),
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
    r.kind === 'tv' ? lib?.showNames.has(slug(r.name))
      : lib?.movieTmdb.has(r.tmdbId) || lib?.movieNames.has(slug(r.name));

  const tv = credits.filter((c) => c.media_type === 'tv' && (c.episode_count ?? 99) > 2).map(toRec);
  const movies = credits.filter((c) => c.media_type === 'movie').map(toRec);
  const known = [...tv, ...movies].filter(inLib);
  const charOf = new Map(credits.map((c) => [`${c.media_type}:${c.id}`, c.character]));
  const sub = (r: Rec) => {
    const ch = charOf.get(`${r.kind}:${r.tmdbId}`);
    return ch ? `${r.kind === 'tv' ? '📺' : '🍿'} ${ch}` : undefined;
  };

  const bio = person.biography?.trim();
  return (
    <>
      <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start', marginBottom: 10, flexWrap: 'wrap' }}>
        {person.profile_path
          ? <img src={posterUrl(person.profile_path)} alt="" style={{ width: 150, borderRadius: 16, border: '1px solid var(--border)' }} />
          : <div style={{ width: 150, height: 220, borderRadius: 16, background: 'var(--grad)', opacity: 0.35, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 50 }}>🎭</div>}
        <div style={{ flex: 1, minWidth: 260 }}>
          <h1 className="page-title" style={{ marginBottom: 6 }}>{person.name}</h1>
          <div className="facts" style={{ color: 'var(--text-dim)', fontSize: 13.5, display: 'flex', gap: 14, flexWrap: 'wrap' }}>
            {person.known_for_department && <span>{person.known_for_department === 'Acting' ? 'Attore/Attrice' : person.known_for_department}</span>}
            {person.birthday && <span>🎂 {fmtDate(person.birthday)}{person.deathday ? ` – ✝ ${fmtDate(person.deathday)}` : ''}</span>}
            {person.place_of_birth && <span>📍 {person.place_of_birth}</span>}
            <span>🎬 {credits.length} titoli</span>
          </div>
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

      {known.length > 0 && <TitleRow title={`Già nella tua libreria (${known.length})`} items={known.slice(0, 12)} subOf={sub} openOnly />}
      <TitleRow title={`Serie TV (${tv.length})`} items={tv.slice(0, 16)} subOf={sub} />
      <TitleRow title={`Film (${movies.length})`} items={movies.slice(0, 16)} subOf={sub} />
    </>
  );
}
