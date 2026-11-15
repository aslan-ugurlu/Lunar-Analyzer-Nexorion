import { useId } from 'react';

/**
 * §11.5 Public/educator card: "Dünya ve Ay'da Güneş neden farklı görünür?"
 * Static, sourced physical facts only. It takes no props and reads no analysis
 * state, so it cannot influence f_sun, DTE or GREEN/YELLOW/RED/GRAY decisions.
 * Sources checked 2026-11-14 (values quoted in EARTH_MOON_SOURCES).
 * The illustration draws the two axial tilts at their sourced angles; body sizes are not to scale.
 */

export const EARTH_MOON_SOURCES = [
  {
    href: 'https://nssdc.gsfc.nasa.gov/planetary/factsheet/earthfact.html',
    label: 'NASA NSSDC — Earth Fact Sheet',
    quote: 'Length of day 24.0000 h; obliquity to orbit 23.44°',
  },
  {
    href: 'https://nssdc.gsfc.nasa.gov/planetary/factsheet/moonfact.html',
    label: 'NASA NSSDC — Moon Fact Sheet',
    quote: 'Synodic period 29.53 d; sidereal rotation 655.720 h (≈ 27.3 d); surface pressure (night) 3 × 10⁻¹⁵ bar',
  },
  {
    href: 'https://svs.gsfc.nasa.gov/5229/',
    label: 'NASA SVS — Moon Essentials: Seasons',
    quote: '“while the Earth is tilted 23.5°, the tilt of the Moon is a mere 1.5°”',
  },
  {
    href: 'https://science.nasa.gov/resource/shadows-near-the-moons-south-pole/',
    label: 'NASA Science — Shadows near the Moon’s South Pole',
    quote: '“At the Moon’s North and South Poles, the Sun is never more than 1.5° above or below the horizon.”',
  },
] as const;

const ROWS: { topic: string; earth: string; moon: string; note: string; visual: 'day' | 'air' | 'tilt' }[] = [
  {
    topic: 'Ortalama Güneş günü',
    earth: 'yaklaşık 24 saat',
    moon: 'yaklaşık 29,5 Dünya günü',
    note: 'Ay’ın yıldızlara göre bir dönüşü yaklaşık 27,3 gündür. Güneş’e göre gün daha uzundur, çünkü bu sürede Dünya–Ay sistemi Güneş etrafında ilerler. Yani “Ay 29,5 günde döner” demek doğru değildir; 29,5 gün, Güneş’in aynı konuma dönmesi için geçen süredir.',
    visual: 'day',
  },
  {
    topic: 'Atmosferik kırılma',
    earth: 'Atmosfer ışığı büker; ufka yakın Güneş’in görünür yönü değişebilir.',
    moon: 'Anlamlı bir küresel atmosfer yok (gece yüzey basıncı ~3 × 10⁻¹⁵ bar); Dünya’dakine benzer kırılma beklenmez.',
    note: 'Bu yüzden bu araç ve JPL Horizons kontrolü “havasız (airless)” görünür konum kullanır.',
    visual: 'air',
  },
  {
    topic: 'Eksen eğikliği ve kutupta Güneş',
    earth: 'yaklaşık 23,4°; kutuplarda Güneş mevsime göre ufkun belirgin şekilde üstüne çıkar.',
    moon: 'yaklaşık 1,5°; kutuplarda Güneş ufkun en fazla ~1,5° üstüne/altına çıkar ve ufku 360° dolanır.',
    note: 'Ay kutbunda birkaç yüz metrelik bir sırt bile Güneş’i saatlerce, hatta günlerce kapatabilir; bu yüzden yerel arazi ufku belirleyicidir. Basitleştirme: kutuptan uzaklaştıkça, yerel ufka ve mevsime göre değerler değişir; tek bir açı tüm noktaları temsil etmez.',
    visual: 'tilt',
  },
];

const EARTH_TILT_DEG = 23.44; // NSSDC Earth Fact Sheet, obliquity to orbit
// Moon's equator vs the ecliptic ≈ 1.5° (NASA SVS: "a mere 1.5°"); this, not the 6.68° tilt to the Moon's own
// orbit, sets how high the Sun can rise at the lunar poles.
const MOON_TILT_DEG = 1.5;
const DAY_RATIO = 24 / (29.53 * 24); // synodic day length ratio, NSSDC

/** Two bodies with their axes drawn at the sourced obliquities; sizes are NOT to scale. */
function Illustration() {
  const uid = `em${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const axis = (cx: number, cy: number, len: number, deg: number, color: string) => {
    const r = (deg * Math.PI) / 180;
    const dx = Math.sin(r) * len;
    const dy = Math.cos(r) * len;
    return (
      <>
        <line x1={cx} y1={cy - len} x2={cx} y2={cy + len} stroke="#a9b6d3" strokeOpacity="0.45" strokeDasharray="3 4" />
        <line x1={cx - dx} y1={cy + dy} x2={cx + dx} y2={cy - dy} stroke={color} strokeWidth="2.2" strokeLinecap="round" />
      </>
    );
  };
  return (
    <svg viewBox="0 0 640 230" className="h-auto w-full" role="img"
      aria-label="Çizim: Dünya’nın dönme ekseni yaklaşık 23,4°, Ay’ınki yaklaşık 1,5° eğiktir. Güneş soldan aydınlatır. Boyutlar ölçekli değildir.">
      <defs>
        <radialGradient id={`${uid}-earth`} cx="35%" cy="35%" r="75%">
          <stop offset="0%" stopColor="#9fd3ff" />
          <stop offset="45%" stopColor="#2f7be0" />
          <stop offset="100%" stopColor="#0b2a63" />
        </radialGradient>
        <radialGradient id={`${uid}-moon`} cx="35%" cy="35%" r="75%">
          <stop offset="0%" stopColor="#f1f4fa" />
          <stop offset="55%" stopColor="#a3acbf" />
          <stop offset="100%" stopColor="#4a5368" />
        </radialGradient>
        <linearGradient id={`${uid}-sun`} x1="0" x2="1">
          <stop offset="0%" stopColor="#ffcc4d" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#ffcc4d" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="230" height="230" fill={`url(#${uid}-sun)`} opacity="0.35" />
      {[50, 85, 120, 155, 190].map((y) => (
        <line key={y} x1="0" y1={y} x2="80" y2={y} stroke="#ffcc4d" strokeOpacity="0.55" strokeWidth="1.5" strokeDasharray="10 8" />
      ))}
      <text x="8" y="22" fill="#ffcc4d" fontSize="13" fontFamily="JetBrains Mono Variable, monospace">GÜNEŞ →</text>

      {/* Earth */}
      <circle cx="200" cy="112" r="66" fill="none" stroke="#5aa9ff" strokeOpacity="0.35" strokeWidth="6" />
      <circle cx="200" cy="112" r="58" fill={`url(#${uid}-earth)`} />
      {axis(200, 112, 82, EARTH_TILT_DEG, '#5aa9ff')}
      <text x="226" y="34" fill="#eaf0ff" fontSize="14" fontFamily="JetBrains Mono Variable, monospace">23,4°</text>
      <text x="200" y="212" fill="#a9b6d3" fontSize="13" textAnchor="middle">Dünya · atmosfer var</text>

      {/* Moon */}
      <circle cx="470" cy="112" r="44" fill={`url(#${uid}-moon)`} />
      <circle cx="456" cy="98" r="7" fill="#7d8699" fillOpacity="0.7" />
      <circle cx="484" cy="126" r="9" fill="#7d8699" fillOpacity="0.6" />
      <circle cx="472" cy="90" r="4" fill="#7d8699" fillOpacity="0.6" />
      {axis(470, 112, 72, MOON_TILT_DEG, '#eaf0ff')}
      <text x="486" y="44" fill="#eaf0ff" fontSize="14" fontFamily="JetBrains Mono Variable, monospace">1,5°</text>
      <text x="470" y="212" fill="#a9b6d3" fontSize="13" textAnchor="middle">Ay · atmosfer yok denecek kadar ince</text>
      <text x="632" y="224" fill="#a9b6d3" fontSize="10" textAnchor="end">boyutlar ölçekli değildir</text>
    </svg>
  );
}

/** Small per-row visual (decorative; the text in the row carries the information). */
function RowVisual({ kind }: { kind: 'day' | 'air' | 'tilt' }) {
  if (kind === 'day') {
    return (
      <span className="mt-2 block space-y-1" aria-hidden>
        <span className="flex items-center gap-2"><span className="w-10 font-mono text-[10px] text-earth">Dünya</span>
          <span className="h-1.5 rounded-full bg-earth" style={{ width: `${Math.max(DAY_RATIO * 100, 2)}%` }} /></span>
        <span className="flex items-center gap-2"><span className="w-10 font-mono text-[10px] text-ink">Ay</span>
          <span className="h-1.5 flex-1 rounded-full bg-[linear-gradient(90deg,#a3acbf,#eaf0ff)]" /></span>
      </span>
    );
  }
  if (kind === 'air') {
    return (
      <svg viewBox="0 0 120 34" className="mt-2 h-8 w-28" aria-hidden>
        <circle cx="20" cy="17" r="10" fill="#2f7be0" /><circle cx="20" cy="17" r="14" fill="none" stroke="#5aa9ff" strokeOpacity="0.5" strokeWidth="3" />
        <path d="M2 4 Q14 12 22 7" stroke="#ffcc4d" fill="none" strokeWidth="1.5" />
        <circle cx="86" cy="17" r="10" fill="#a3acbf" />
        <path d="M66 4 L88 9" stroke="#ffcc4d" fill="none" strokeWidth="1.5" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 120 34" className="mt-2 h-8 w-28" aria-hidden>
      <line x1="20" y1="2" x2="20" y2="32" stroke="#a9b6d3" strokeOpacity="0.4" strokeDasharray="2 3" />
      <line x1={20 - Math.sin((EARTH_TILT_DEG * Math.PI) / 180) * 15} y1={17 + Math.cos((EARTH_TILT_DEG * Math.PI) / 180) * 15}
        x2={20 + Math.sin((EARTH_TILT_DEG * Math.PI) / 180) * 15} y2={17 - Math.cos((EARTH_TILT_DEG * Math.PI) / 180) * 15} stroke="#5aa9ff" strokeWidth="2" />
      <line x1="86" y1="2" x2="86" y2="32" stroke="#a9b6d3" strokeOpacity="0.4" strokeDasharray="2 3" />
      <line x1={86 - Math.sin((MOON_TILT_DEG * Math.PI) / 180) * 15} y1={17 + Math.cos((MOON_TILT_DEG * Math.PI) / 180) * 15}
        x2={86 + Math.sin((MOON_TILT_DEG * Math.PI) / 180) * 15} y2={17 - Math.cos((MOON_TILT_DEG * Math.PI) / 180) * 15} stroke="#eaf0ff" strokeWidth="2" />
    </svg>
  );
}

export function EarthMoonCard() {
  return (
    <section className="panel space-y-4" aria-labelledby="earth-moon-title">
      <div>
        <p className="font-mono text-[11px] font-medium tracking-[0.18em] text-accent uppercase">Öğren · Dünya vs Ay</p>
        <h2 id="earth-moon-title" className="panel-title">Dünya ve Ay’da Güneş neden farklı görünür?</h2>
        <p className="mt-1 text-sm text-muted">
          Eğitim kartı: sabit fiziksel farklar, yaklaşık değerler. Bu kart hiçbir hesaba girmez ve analiz kararını etkilemez;
          gerçek zamanlı Dünya simülasyonu veya konum bilgisi kullanmaz.
        </p>
      </div>
      <div className="overflow-hidden rounded-xl border border-line bg-[rgb(3_8_24/0.55)]">
        <Illustration />
      </div>
      <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Dünya–Ay karşılaştırma tablosu (yatay kaydırılabilir)">
        <table className="w-full min-w-[520px] border-separate border-spacing-y-2 text-left text-sm">
          <caption className="sr-only">Dünya ve Ay karşılaştırması</caption>
          <thead className="text-xs tracking-wider text-muted">
            <tr>
              <th scope="col" className="px-3 py-1 font-medium">Konu</th>
              <th scope="col" className="px-3 py-1 font-medium"><span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-earth" aria-hidden />Dünya</span></th>
              <th scope="col" className="px-3 py-1 font-medium"><span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-[#a3acbf]" aria-hidden />Ay</span></th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row) => (
              <tr key={row.topic} className="align-top">
                <th scope="row" className="w-[28%] rounded-l-xl border-y border-l border-line bg-panel-2 px-3 py-2.5 font-display font-semibold text-ink">
                  <span className="block">{row.topic}</span>
                  <RowVisual kind={row.visual} />
                </th>
                <td className="border-y border-line bg-[rgb(31_98_224/0.12)] px-3 py-2.5 text-ink"><span>{row.earth}</span></td>
                <td className="rounded-r-xl border-y border-r border-line bg-panel-2 px-3 py-2.5 text-ink">
                  <span>{row.moon}</span>
                  <p className="mt-1 text-xs text-muted">{row.note}</p>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <details className="text-xs text-muted">
        <summary className="cursor-pointer font-medium text-ink">Kaynaklar (yaklaşık değerler; ölçüm hassasiyetine göre yuvarlandı)</summary>
        <ul className="mt-2 space-y-1">
          {EARTH_MOON_SOURCES.map((s) => (
            <li key={s.href}>
              <a className="link" href={s.href} target="_blank" rel="noopener noreferrer">{s.label}</a>
              <span className="block">{s.quote}</span>
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
