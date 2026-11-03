// The hero's pixel skyline from mockups/home.html: a night city in the dark theme (stars, moon,
// lit windows, a van's headlight) and a daytime one in light (sun, pale windows). Every colour is
// a hero role, so the theme swaps the scene; night-only and day-only parts fade with the theme.

const STARS: readonly (readonly [number, number])[] = [
  [40, 22], [120, 48], [210, 18], [300, 40], [380, 14], [460, 36], [560, 20], [640, 44], [700, 16], [88, 70], [520, 62],
];

const BUILDINGS: readonly (readonly [number, number, number, number])[] = [
  [0, 120, 60, 110], [62, 96, 46, 134], [72, 84, 18, 12], [112, 132, 70, 98], [186, 108, 40, 122], [194, 98, 14, 10],
  [430, 104, 54, 126], [440, 92, 16, 12], [488, 128, 80, 102], [572, 100, 44, 130], [620, 138, 108, 92], [660, 122, 22, 16],
  [296, 126, 4, 70],
];

const WINDOWS: readonly (readonly [number, number])[] = [
  [70, 110], [92, 126], [124, 146], [160, 160], [198, 122], [444, 118], [466, 150], [500, 142], [540, 160], [584, 116], [640, 152], [690, 166],
];

const CLOUDS: readonly (readonly [number, number, number, number])[] = [
  [80, 58, 120, 10], [100, 50, 70, 8], [330, 72, 150, 10], [360, 64, 80, 8], [520, 90, 110, 8],
];

const night = "opacity-0 transition-opacity duration-(--dur-theme) dark:opacity-100";
const day = "opacity-100 transition-opacity duration-(--dur-theme) dark:opacity-0";

export function HeroSkyline() {
  return (
    <svg aria-hidden viewBox="0 0 728 230" preserveAspectRatio="xMidYMid slice" className="block size-full">
      <defs>
        <linearGradient id="hero-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" className="[stop-color:var(--hero-sky-top)]" />
          <stop offset=".6" className="[stop-color:var(--hero-sky-mid)]" />
          <stop offset="1" className="[stop-color:var(--surface-canvas)]" />
        </linearGradient>
        <pattern id="hero-dither" width="4" height="4" patternUnits="userSpaceOnUse">
          <rect width="1.4" height="1.4" className="fill-(--hero-dither)" />
        </pattern>
        <linearGradient id="hero-fade" x1="0" y1="0" x2="0" y2="1">
          <stop offset=".55" className="[stop-color:var(--surface-canvas)] [stop-opacity:0]" />
          <stop offset="1" className="[stop-color:var(--surface-canvas)]" />
        </linearGradient>
        <linearGradient id="hero-beam" x1="0" x2="1">
          <stop offset="0" className="[stop-color:var(--hero-beam)] [stop-opacity:.55]" />
          <stop offset="1" className="[stop-color:var(--hero-beam)] [stop-opacity:0]" />
        </linearGradient>
      </defs>
      <rect width="728" height="230" fill="url(#hero-sky)" />
      <g className={`fill-(--hero-star) ${night}`}>
        {STARS.map(([x, y]) => (
          <rect key={`${x}-${y}`} x={x} y={y} width="2" height="2" />
        ))}
      </g>
      <g className={night}>
        <circle cx="610" cy="48" r="16" className="fill-(--hero-moon)" />
        <circle cx="617" cy="43" r="14" className="fill-(--hero-sky-top)" />
      </g>
      <g className={`fill-(--hero-sun) ${day}`}>
        <circle cx="610" cy="50" r="20" />
        <circle cx="610" cy="50" r="30" opacity=".25" />
      </g>
      <g className="fill-(--hero-cloud)" opacity=".6">
        {CLOUDS.map(([x, y, width, height]) => (
          <rect key={`${x}-${y}`} x={x} y={y} width={width} height={height} />
        ))}
      </g>
      <g className="fill-(--hero-building)">
        {BUILDINGS.map(([x, y, width, height]) => (
          <rect key={`${x}-${y}`} x={x} y={y} width={width} height={height} />
        ))}
        <path d="M298 128 l-26 8 l26-3 l-22 14 l22-9 l0 0 l24 12 l-20-15 l26 2 l-30-9z" />
      </g>
      <g className="fill-(--hero-window)">
        {WINDOWS.map(([x, y]) => (
          <rect key={`${x}-${y}`} x={x} y={y} width="5" height="5" />
        ))}
      </g>
      <rect x="0" y="196" width="728" height="34" className="fill-(--hero-road)" />
      <g transform="translate(150 176)">
        <rect width="46" height="20" rx="3" className="fill-(--hero-van)" />
        <rect x="30" y="3" width="13" height="8" className="fill-(--hero-van-glass)" />
        <circle cx="10" cy="21" r="4" className="fill-(--hero-tyre)" />
        <circle cx="36" cy="21" r="4" className="fill-(--hero-tyre)" />
        <rect x="44" y="12" width="3" height="3" className="fill-(--hero-beam)" />
      </g>
      <path d="M197 189 L320 176 L320 206 Z" fill="url(#hero-beam)" className={night} />
      <rect width="728" height="230" fill="url(#hero-dither)" />
      <rect width="728" height="230" fill="url(#hero-fade)" />
    </svg>
  );
}
