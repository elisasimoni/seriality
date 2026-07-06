import { useState } from 'react';

const MONTHS = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'];
const LEVEL_COLORS = [
  'rgba(255,255,255,0.05)',
  'rgba(139,92,246,0.40)',
  'rgba(139,92,246,0.70)',
  'rgba(214,80,150,0.85)',
  '#ff5c8a',
];

const iso = (d: Date) => d.toISOString().slice(0, 10);
const weekdayMon = (d: Date) => (d.getUTCDay() + 6) % 7; // 0 = lunedì

/** Heatmap annuale delle visioni (stile GitHub). `counts` = giorno ISO → n. */
export default function Heatmap({ counts, years }: { counts: Map<string, number>; years: number[] }) {
  const latest = years[years.length - 1] ?? new Date().getUTCFullYear();
  const [year, setYear] = useState(latest);

  // livello colore: cap al 90° percentile dei giorni non-vuoti (l'outlier import non appiattisce)
  const nonZero = [...counts.values()].filter((n) => n > 0).sort((a, b) => a - b);
  const cap = Math.max(4, nonZero[Math.floor(nonZero.length * 0.9)] ?? 4);
  const level = (n: number) => (n <= 0 ? 0 : Math.min(4, Math.ceil((n / cap) * 4)));

  // celle dell'anno selezionato
  const jan1 = new Date(Date.UTC(year, 0, 1));
  const firstOffset = weekdayMon(jan1);
  const cells: { date: string; count: number; row: number; col: number; month: number }[] = [];
  const monthFirstCol = new Map<number, number>();
  for (let d = new Date(jan1); d.getUTCFullYear() === year; d.setUTCDate(d.getUTCDate() + 1)) {
    const dayIndex = Math.floor((d.getTime() - jan1.getTime()) / 86400000);
    const col = Math.floor((dayIndex + firstOffset) / 7);
    const month = d.getUTCMonth();
    if (!monthFirstCol.has(month)) monthFirstCol.set(month, col);
    cells.push({ date: iso(d), count: counts.get(iso(d)) ?? 0, row: weekdayMon(d), col, month });
  }
  const totalYear = cells.reduce((s, c) => s + c.count, 0);
  const activeDays = cells.filter((c) => c.count > 0).length;
  const cols = (cells[cells.length - 1]?.col ?? 0) + 1;

  const fmtIt = (isoDate: string) =>
    new Date(isoDate).toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' });

  return (
    <div className="heatmap">
      <div className="hm-head">
        <div className="hm-nav">
          <button className="btn" style={{ padding: '4px 10px' }} disabled={!years.includes(year - 1)} onClick={() => setYear(year - 1)}>‹</button>
          <b>{year}</b>
          <button className="btn" style={{ padding: '4px 10px' }} disabled={!years.includes(year + 1)} onClick={() => setYear(year + 1)}>›</button>
        </div>
        <span style={{ color: 'var(--text-dim)', fontSize: 13 }}>
          {totalYear.toLocaleString('it')} episodi in {activeDays} giorni
        </span>
      </div>
      <div className="hm-scroll">
        <div className="hm-grid" style={{ gridTemplateColumns: `repeat(${cols}, 13px)` }}>
          {[...monthFirstCol.entries()].map(([m, col]) => (
            <div key={m} className="hm-month" style={{ gridColumn: col + 1, gridRow: 1 }}>{MONTHS[m]}</div>
          ))}
          {cells.map((c) => (
            <div
              key={c.date}
              className="hm-cell"
              style={{ gridColumn: c.col + 1, gridRow: c.row + 2, background: LEVEL_COLORS[level(c.count)] }}
              title={c.count ? `${fmtIt(c.date)} · ${c.count} episodi` : fmtIt(c.date)}
            />
          ))}
        </div>
      </div>
      <div className="hm-legend">
        <span>meno</span>
        {LEVEL_COLORS.map((col, i) => <span key={i} className="hm-cell" style={{ background: col }} />)}
        <span>più</span>
      </div>
    </div>
  );
}
