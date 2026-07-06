// Set di icone SVG disegnate a tema per Seriality (niente emoji).
// Stroke = currentColor, così ereditano il colore/gradiente dello stato attivo.

type IconProps = { size?: number; className?: string };

const base = (size: number, className?: string) => ({
  width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
  stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const, className,
});

/** Da guardare: play dentro uno schermo (guarda il prossimo episodio). */
export const IconWatch = ({ size = 24, className }: IconProps) => (
  <svg {...base(size, className)}>
    <rect x="2.5" y="4.5" width="19" height="14" rx="2.5" />
    <path d="M10 9.2v5.1l4.3-2.55z" fill="currentColor" stroke="none" />
    <path d="M8 21.5h8" />
  </svg>
);

/** In arrivo: calendario con un pallino sul giorno. */
export const IconUpcoming = ({ size = 24, className }: IconProps) => (
  <svg {...base(size, className)}>
    <rect x="3" y="4.8" width="18" height="16.2" rx="2.4" />
    <path d="M3 9.3h18" />
    <path d="M8 3v3.4M16 3v3.4" />
    <circle cx="12" cy="14.5" r="1.5" fill="currentColor" stroke="none" />
  </svg>
);

/** Scopri: il "+" (aggiungi nuove serie/film). */
export const IconPlus = ({ size = 24, className }: IconProps) => (
  <svg {...base(size, className)} strokeWidth={2.4}>
    <path d="M12 5.5v13M5.5 12h13" />
  </svg>
);

/** Le mie serie: TV con antenna. */
export const IconShows = ({ size = 24, className }: IconProps) => (
  <svg {...base(size, className)}>
    <rect x="2.5" y="7.5" width="19" height="12.5" rx="2.3" />
    <path d="M8 3.2l4 4.3 4-4.3" />
    <path d="M6.5 12.2v3.6" />
  </svg>
);

/** Film: ciak da cinema. */
export const IconMovies = ({ size = 24, className }: IconProps) => (
  <svg {...base(size, className)}>
    <rect x="3" y="8.2" width="18" height="12.3" rx="2" />
    <path d="M3.4 8.4l16.9-2.6-.5-2.3L3 6.1z" fill="currentColor" stroke="none" />
    <path d="M8.2 4.9l1.6 3.1M13 4.1l1.6 3.1" stroke="var(--bg)" strokeWidth="1.3" />
  </svg>
);

export const NAV_ICONS: Record<string, (p: IconProps) => JSX.Element> = {
  watch: IconWatch,
  upcoming: IconUpcoming,
  plus: IconPlus,
  shows: IconShows,
  movies: IconMovies,
};
