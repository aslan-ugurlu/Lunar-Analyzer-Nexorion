/**
 * §11.5 Public/educator card: "Dünya ve Ay'da Güneş neden farklı görünür?"
 * Static, sourced physical facts only. It takes no props and reads no analysis
 * state, so it cannot influence f_sun, DTE or GREEN/YELLOW/RED/GRAY decisions.
 * Sources checked 2026-11-14 (values quoted in EARTH_MOON_SOURCES).
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

const ROWS: { topic: string; earth: string; moon: string; note: string }[] = [
  {
    topic: 'Ortalama Güneş günü',
    earth: 'yaklaşık 24 saat',
    moon: 'yaklaşık 29,5 Dünya günü',
    note: 'Ay’ın yıldızlara göre bir dönüşü yaklaşık 27,3 gündür. Güneş’e göre gün daha uzundur, çünkü bu sürede Dünya–Ay sistemi Güneş etrafında ilerler. Yani “Ay 29,5 günde döner” demek doğru değildir; 29,5 gün, Güneş’in aynı konuma dönmesi için geçen süredir.',
  },
  {
    topic: 'Atmosferik kırılma',
    earth: 'Atmosfer ışığı büker; ufka yakın Güneş’in görünür yönü değişebilir.',
    moon: 'Anlamlı bir küresel atmosfer yok (gece yüzey basıncı ~3 × 10⁻¹⁵ bar); Dünya’dakine benzer kırılma beklenmez.',
    note: 'Bu yüzden bu araç ve JPL Horizons kontrolü “havasız (airless)” görünür konum kullanır.',
  },
  {
    topic: 'Eksen eğikliği ve kutupta Güneş',
    earth: 'yaklaşık 23,4°; kutuplarda Güneş mevsime göre ufkun belirgin şekilde üstüne çıkar.',
    moon: 'yaklaşık 1,5°; kutuplarda Güneş ufkun en fazla ~1,5° üstüne/altına çıkar ve ufku 360° dolanır.',
    note: 'Ay kutbunda birkaç yüz metrelik bir sırt bile Güneş’i saatlerce, hatta günlerce kapatabilir; bu yüzden yerel arazi ufku belirleyicidir. Basitleştirme: kutuptan uzaklaştıkça, yerel ufka ve mevsime göre değerler değişir; tek bir açı tüm noktaları temsil etmez.',
  },
];

export function EarthMoonCard() {
  return (
    <section className="panel space-y-3" aria-labelledby="earth-moon-title">
      <h2 id="earth-moon-title" className="panel-title">Dünya ve Ay’da Güneş neden farklı görünür?</h2>
      <p className="text-sm text-muted">
        Eğitim kartı: sabit fiziksel farklar, yaklaşık değerler. Bu kart hiçbir hesaba girmez ve analiz kararını etkilemez;
        gerçek zamanlı Dünya simülasyonu veya konum bilgisi kullanmaz.
      </p>
      <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Dünya–Ay karşılaştırma tablosu (yatay kaydırılabilir)">
        <table className="w-full min-w-[520px] text-left text-sm">
          <caption className="sr-only">Dünya ve Ay karşılaştırması</caption>
          <thead className="text-xs uppercase tracking-wider text-muted">
            <tr>
              <th scope="col" className="py-1 pr-3">Konu</th>
              <th scope="col" className="py-1 pr-3">Dünya</th>
              <th scope="col" className="py-1">Ay</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row) => (
              <tr key={row.topic} className="border-t border-line align-top">
                <th scope="row" className="py-2 pr-3 font-medium text-ink">{row.topic}</th>
                <td className="py-2 pr-3 text-ink">{row.earth}</td>
                <td className="py-2 text-ink">
                  {row.moon}
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
