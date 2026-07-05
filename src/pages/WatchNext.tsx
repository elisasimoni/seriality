import { useLiveQuery } from 'dexie-react-hooks';
import { db, computeProgress, setEpisodeWatched } from '../db';
import { Empty, epCode, nav, toast } from '../components';

export default function WatchNext() {
  const data = useLiveQuery(async () => {
    const shows = await db.shows.toArray();
    const allEps = await db.episodes.toArray();
    const byShow = new Map<number, typeof allEps>();
    for (const e of allEps) {
      if (!byShow.has(e.showId)) byShow.set(e.showId, []);
      byShow.get(e.showId)!.push(e);
    }
    return shows
      .filter((s) => !s.archived && !s.muted)
      .map((s) => ({ show: s, prog: computeProgress(s, byShow.get(s.id) ?? []) }))
      .filter((x) => x.prog.status === 'watching' && x.prog.nextEp)
      .sort((a, b) => (b.show.lastActivityAt ?? '').localeCompare(a.show.lastActivityAt ?? ''));
  });

  if (!data) return null;
  return (
    <>
      <h1 className="page-title">Da guardare</h1>
      <p className="page-sub">Il prossimo episodio di ogni serie che stai seguendo.</p>
      {data.length === 0 ? (
        <Empty icon="🎬" title="Niente in coda!">
          Sei in pari con tutto — oppure{' '}
          <a href="#/import" style={{ color: 'var(--accent)' }}>importa i tuoi dati TV Time</a>{' '}
          per iniziare.
        </Empty>
      ) : (
        <div className="wn-grid">
          {data.map(({ show, prog }) => {
            const ep = prog.nextEp!;
            const remaining = prog.aired - prog.watched;
            return (
              <div
                key={show.id}
                className="wn-card"
                style={{ backgroundImage: `url(${show.fanart || show.poster || ''})` }}
                onClick={() => nav(`/show/${show.id}`)}
              >
                <div className="shade" />
                <div className="content">
                  <div className="info">
                    <div className="ep-code">
                      {epCode(ep.season, ep.number)}
                      {remaining > 1 && <span style={{ color: 'var(--text-dim)', fontWeight: 500 }}> · +{remaining - 1} da vedere</span>}
                    </div>
                    <div className="show-name">{show.name}</div>
                    <div className="ep-name">{ep.name || 'Episodio ' + ep.number}</div>
                    <div className="progress" style={{ width: '85%' }}>
                      <div style={{ width: `${(prog.watched / Math.max(1, prog.total)) * 100}%` }} />
                    </div>
                  </div>
                  <button
                    className="check-btn small off"
                    title="Non seguire più (nascondi da qui e da In arrivo)"
                    onClick={(e) => {
                      e.stopPropagation();
                      db.shows.update(show.id, { muted: true });
                      toast(`🔕 ${show.name}: non te la proporrò più (riattivala dalla sua pagina)`);
                    }}
                  >🔕</button>
                  <button
                    className="check-btn"
                    title="Segna come visto"
                    onClick={(e) => {
                      e.stopPropagation();
                      setEpisodeWatched(ep, true);
                      toast(`✓ ${show.name} ${epCode(ep.season, ep.number)} visto!`);
                    }}
                  >✓</button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
