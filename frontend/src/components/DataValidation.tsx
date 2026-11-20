import type { ApiError } from '../api/client';
import { explainError } from '../api/errors';
import type { Health, SitesResponse, ValidationStatus } from '../api/types';
import { useValidation } from '../hooks/useBackend';
import { unknownText } from '../lib/format';
import { formatUtc } from '../lib/utc';
import { defineStrings, useStrings } from '../i18n';
import { useApp } from '../state/AppState';
import { EarthMoonCard } from './EarthMoonCard';
import { ExternalLink, Icon, Notice } from './ui';

/**
 * Only the interface's own wording is translated. Fields that come from the backend validation
 * report (summary, note, evidence, source) are evidence and are shown verbatim in both languages.
 */
const STR = defineStrings({
  en: {
    testTitles: {
      'A-04': 'JPL Horizons comparison (Sun + Earth direction, ≤ 0.005°)',
      'V-01': 'Data sources and SPICE kernel coverage',
      'V-02': 'Frame / coordinate consistency (ME, sphere, raster CRS)',
      'V-03': 'UTC → ET conversion',
      'V-04': 'Horizons comparison',
      'V-05': 'Horizon 135 / 200 / 250 km range sensitivity (offline)',
      'V-06': 'Raster LOD and NoData',
      'V-07': 'Finite Sun-disk quadrature convergence',
      'V-08': 'ERR / DEM clone real uncertainty',
      'V-09': 'Constraint correctness',
      'V-10': 'Traceability (provenance)',
      'SLOPE-01': '5 m slope: cross-check against the official PGDA slope map + end-to-end slope constraint',
      'EFFRES-01': 'EFFRES effective-resolution maps: same grid as the DEM, valid values in the LOD bands',
      'CLONE-01': 'DEM clone ensemble (PGDA product 78): clone horizon profiles and consistency with the ERR band',
    },
    limitations: [
      'Sun visibility (f_sun) is the geometric disk fraction; it is not electrical power generation.',
      'DTE only means that the centre of the Earth is above the terrain horizon; it is not an RF link budget, antenna pattern or data rate.',
      'The slope constraint requires a DEM of ≤ 20 m; no safe-landing conclusion is drawn from the 240 m DEM (SLOPE_UNKNOWN → GRAY).',
      'ERR ±k is a sensitivity scenario; it is not a statistical confidence interval.',
      'DEM clone mode works only on the Site01 tile (100 PGDA clones) and at two precomputed coordinates; other locations return CLONE_NOT_PRECOMPUTED / GRAY. Only the observer’s 5 m tile is cloned; the 80 m / 240 m layers stay nominal.',
      'CLONE-01: the deviation of the Site01 clones from the surface is ≈ 8% larger than expected under the Gaussian assumption of the PGDA uncertainty map (toterr) (median |clone − surf| / toterr 0.726, expected 0.674). This is within the criterion; the clone spread is not a statistical confidence interval.',
      'The 200 km scan radius is a reference choice; it is not proof that more distant terrain has no effect.',
      'The time series is sampled; transition times are uncertain within the step (min) and are not certified.',
      'The horizon is sampled every 0.1° in azimuth; this alone does not guarantee 2% accuracy.',
      'This tool is not a landing certification or a NASA endorsement; it is screening / decision support.',
    ],
    healthTitle: 'Service and data status (GET /health, /sites)',
    status: 'Status: ',
    jobs: ' · pending/running jobs: ',
    readyBefore: '“ready” only says that the required files ',
    readyStrong: 'exist',
    readyAfter: '; it is not a checksum, kernel-coverage or scientific-accuracy validation. The scientific validation status is in the table below and comes only from real test runs.',
    kernels: 'NAIF SPICE kernel files',
    layers: 'NASA LOLA terrain layers',
    layerTable: 'LOLA layer table (scrolls horizontally)',
    layer: 'Layer',
    expectedFile: 'Expected file',
    present: 'present',
    downloadNeeded: 'download needed',
    none: 'none',
    notPublished: 'not published',
    notDownloaded: 'not downloaded',
    siteEffresNote: 'No EFFRES map is published for the PGDA product 78 site tiles; the quality indicator is the _toterr (ERR) layer.',
    downloadIntro: 'To download the 240 m reference DEM and the ERR layer safely (locked, atomic, verified) from the official PGDA address, run in the project root:',
    cloneComment: '# clone horizon profiles (offline precomputation)',
    sourcesBefore: '80 m and EFFRES: ',
    product90: 'PGDA product 90',
    sourcesMid: ' · 5 m sites (Site01, 04, 07, 11, 23) and DEM clones: ',
    product78: 'PGDA product 78',
    sourcesAfter: '; 20 m is not downloaded automatically. Empty pixels in the site `_surf` files were filled by interpolation (PGDA README). EFFRES is data-quality information only; it does not change the horizon or the decision.',
    cloneFiles: 'DEM clone files: ',
    profileSets: ' · precomputed profile set: ',
    cloneOnlyAt: ' — clone mode works only at these coordinates: ',
    limits: (workers: number, pending: number, perMinute: number, timeoutS: number) =>
      `Limits: ${workers} spawn workers · ${pending} pending/running jobs · ${perMinute} analyses/min per client (single instance, in memory) · job timeout ${timeoutS} s`,
    validationTitle: 'Scientific validation (GET /validation)',
    source: 'Source: ',
    noRun: 'no recorded run',
    generated: ' · generated ',
    honesty: 'Without a recorded real run the status is NOT_RUN. These results are the project team’s own tests with NASA data; they are not endorsed or certified by NASA.',
    evidence: 'Evidence',
    sourcesTitle: 'NASA data sources',
    pgda: ' — LOLA south-pole DEM, ERR and EFFRES products (Barker et al. 2023, PSJ 4:183; DOI 10.60903/gsfcpgda-lola-spole). Location: MOON_ME (DE421) polar stereographic, elevation in metres.',
    naif: ' — SPICE kernels: naif0012.tls, pck00011.tpc, de440s.bsp, moon_pa_de440_200625.bpc, moon_de440_250416.tf (frame MOON_ME_DE440_ME421).',
    moonTrek: ' — visual inspection of the location (centring on the coordinate is not guaranteed on every load).',
    quickMap: ' — visual inspection of the location; the site moved to quickmap.lroc.im-ldi.com and the links use the new address.',
    sha: 'Local SHA-256 values are for local traceability only; the publisher has not released checksums for the PGDA LOLA files.',
    limitationsTitle: 'Known scientific limitations',
  },
  tr: {
    testTitles: {
      'A-04': 'JPL Horizons karşılaştırması (Güneş + Dünya yönü, ≤ 0.005°)',
      'V-01': 'Veri kaynakları ve SPICE kernel kapsamı',
      'V-02': 'Frame / koordinat uyumu (ME, küre, raster CRS)',
      'V-03': 'UTC → ET dönüşümü',
      'V-04': 'Horizons karşılaştırması',
      'V-05': 'Ufuk 135 / 200 / 250 km menzil duyarlılığı (offline)',
      'V-06': 'Raster LOD ve NoData',
      'V-07': 'Sonlu Güneş diski quadrature yakınsaması',
      'V-08': 'ERR / DEM clone gerçek belirsizlik',
      'V-09': 'Kısıt doğruluğu',
      'V-10': 'İzlenebilirlik (provenance)',
      'SLOPE-01': '5 m eğim: resmi PGDA eğim haritasıyla çapraz kontrol + uçtan uca eğim kısıtı',
      'EFFRES-01': 'EFFRES etkin çözünürlük haritaları: DEM ile aynı ızgara, LOD bantlarında geçerli değer',
      'CLONE-01': 'DEM clone topluluğu (PGDA ürün 78): clone ufuk profilleri ve ERR bandıyla tutarlılık',
    },
    limitations: [
      'Güneş görünürlüğü (f_sun) geometrik disk payıdır; elektrik/güç üretimi değildir.',
      'DTE yalnızca Dünya merkezinin arazi ufku üstünde olmasıdır; RF bağlantı bütçesi, anten deseni veya veri hızı değildir.',
      'Eğim kısıtı ≤ 20 m DEM ister; 240 m DEM’den güvenli iniş sonucu çıkarılmaz (SLOPE_UNKNOWN → GRAY).',
      'ERR ±k bir duyarlılık senaryosudur; istatistiksel güven aralığı değildir.',
      'DEM clone modu yalnız Site01 karosunda (100 PGDA clone) ve önceden hesaplanmış iki koordinatta çalışır; diğer konumlarda CLONE_NOT_PRECOMPUTED / GRAY döner. Yalnız gözlemcinin 5 m karosu klonlanır; 80 m / 240 m katmanlar nominal kalır.',
      'CLONE-01: Site01 clone’larının yüzeyden sapması, PGDA belirsizlik haritasının (toterr) Gauss varsayımıyla beklenenden ≈ %8 büyüktür (|clone − surf| / toterr medyanı 0.726, beklenti 0.674). Ölçüt içindedir; clone yayılımı istatistiksel güven aralığı değildir.',
      '200 km tarama yarıçapı referans seçimdir; daha uzaktaki arazinin etkisi olmadığına dair kanıt değildir.',
      'Zaman serisi örneklenmiştir; geçiş anları adım (dk) içinde belirsizdir ve sertifikalı değildir.',
      'Ufuk 0.1° azimut ile örneklenir; bu tek başına %2 doğruluk garantisi değildir.',
      'Bu araç bir iniş sertifikası veya NASA onayı değildir; ön eleme / karar desteğidir.',
    ],
    healthTitle: 'Hizmet ve veri durumu (GET /health, /sites)',
    status: 'Durum: ',
    jobs: ' · bekleyen/çalışan iş: ',
    readyBefore: '“ready” yalnızca gerekli dosyaların ',
    readyStrong: 'bulunduğunu',
    readyAfter: ' söyler; checksum, kernel kapsamı veya bilimsel doğruluk doğrulaması değildir. Bilimsel doğrulama durumu aşağıdaki tabloda, yalnızca gerçek test koşularından gelir.',
    kernels: 'NAIF SPICE kernel dosyaları',
    layers: 'NASA LOLA arazi katmanları',
    layerTable: 'LOLA katman tablosu (yatay kaydırılabilir)',
    layer: 'Katman',
    expectedFile: 'Beklenen dosya',
    present: 'var',
    downloadNeeded: 'indirilmeli',
    none: 'yok',
    notPublished: 'yayımlanmıyor',
    notDownloaded: 'indirilmedi',
    siteEffresNote: 'PGDA ürün 78 site karoları için EFFRES haritası yayımlanmaz; kalite göstergesi _toterr (ERR) katmanıdır.',
    downloadIntro: '240 m referans DEM ve ERR katmanını resmi PGDA adresinden güvenli (kilitli, atomik, doğrulamalı) indirmek için proje kökünde:',
    cloneComment: '# clone ufuk profilleri (çevrimdışı ön hesap)',
    sourcesBefore: '80 m ve EFFRES: ',
    product90: 'PGDA ürün 90',
    sourcesMid: ' · 5 m site (Site01, 04, 07, 11, 23) ve DEM clone\'ları: ',
    product78: 'PGDA ürün 78',
    sourcesAfter: '; 20 m otomatik indirilmez. Site `_surf` dosyalarında boş pikseller enterpolasyonla doldurulmuştur (PGDA README). EFFRES yalnız veri kalitesi bilgisidir; ufku veya kararı değiştirmez.',
    cloneFiles: 'DEM clone dosyaları: ',
    profileSets: ' · ön hesaplanmış profil seti: ',
    cloneOnlyAt: ' — clone modu yalnız şu koordinatlarda çalışır: ',
    limits: (workers: number, pending: number, perMinute: number, timeoutS: number) =>
      `Sınırlar: ${workers} spawn worker · ${pending} bekleyen/çalışan iş · istemci başına ${perMinute} analiz/dk (tek instance, bellek içi) · iş zaman aşımı ${timeoutS} s`,
    validationTitle: 'Bilimsel doğrulama (GET /validation)',
    source: 'Kaynak: ',
    noRun: 'kayıtlı koşu yok',
    generated: ' · üretildi ',
    honesty: 'Kayıtlı gerçek koşu yoksa durum NOT_RUN’dır. Bu sonuçlar proje ekibinin NASA verisiyle yaptığı kendi testleridir; NASA tarafından onaylanmış veya sertifikalandırılmış değildir.',
    evidence: 'Kanıt',
    sourcesTitle: 'NASA veri kaynakları',
    pgda: ' — LOLA güney kutbu DEM, ERR ve EFFRES ürünleri (Barker vd. 2023, PSJ 4:183; DOI 10.60903/gsfcpgda-lola-spole). Konum: MOON_ME (DE421) polar stereografik, yükseklik metre.',
    naif: ' — SPICE kernel’leri: naif0012.tls, pck00011.tpc, de440s.bsp, moon_pa_de440_200625.bpc, moon_de440_250416.tf (frame MOON_ME_DE440_ME421).',
    moonTrek: ' — konumu görsel inceleme (koordinata odaklanma her açılışta garanti değil).',
    quickMap: ' — konumu görsel inceleme; site quickmap.lroc.im-ldi.com adresine taşındı, bağlantılar yeni adresi kullanır.',
    sha: 'Yerel SHA-256 değerleri yalnızca yerel izlenebilirlik içindir; PGDA LOLA dosyaları için yayıncı checksum’ı yayımlanmamıştır.',
    limitationsTitle: 'Bilinen bilimsel sınırlamalar',
  },
});

function StatusPill({ status }: { status: ValidationStatus }) {
  const map = {
    PASS: ['border-go/60 text-go', 'check'],
    FAIL: ['border-stop/60 text-stop', 'stop'],
    BLOCKED: ['border-caution/60 text-caution', 'alert'],
    NOT_RUN: ['border-line text-muted', 'question'],
  } as const;
  const [cls, icon] = map[status] ?? map.NOT_RUN;
  return <span className={`chip ${cls}`}><Icon name={icon} className="h-3.5 w-3.5" />{status}</span>;
}

export function DataValidation({ health, healthError, sites }: { health: Health | null; healthError: ApiError | null; sites: SitesResponse | null }) {
  const { mode } = useApp();
  const s = useStrings(STR);
  const validation = useValidation();
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <section className="panel min-w-0 space-y-3" aria-labelledby="dv-health">
        <h2 id="dv-health" className="panel-title">{s.healthTitle}</h2>
        {healthError && <Notice explained={explainError(healthError)} />}
        {health && (
          <>
            <p className="text-sm">
              {s.status}<strong className={health.status === 'ready' ? 'text-go' : 'text-caution'}>{health.status}</strong>{s.jobs}<span className="mono">{health.jobs_pending}</span>
            </p>
            <p className="rounded-md border border-caution/40 bg-caution/5 p-2 text-xs text-ink">
              {s.readyBefore}<strong>{s.readyStrong}</strong>{s.readyAfter}
            </p>
            <h3 className="text-sm font-semibold text-ink">{s.kernels}</h3>
            <ul className="mono grid grid-cols-1 gap-1 text-xs sm:grid-cols-2">
              {Object.entries(health.kernels).map(([k, ok]) => (
                <li key={k} className={ok ? 'text-go' : 'text-stop'}>{ok ? '✓' : '✗'} {k}</li>
              ))}
            </ul>
            <h3 className="text-sm font-semibold text-ink">{s.layers}</h3>
            <div className="overflow-x-auto" tabIndex={0} role="region" aria-label={s.layerTable}>
              <table className="w-full min-w-[560px] text-left text-xs [&_td]:pr-3 [&_td]:align-top [&_th]:pr-3">
                <thead className="text-muted"><tr><th className="py-1">{s.layer}</th><th>DEM</th><th>ERR</th><th>EFFRES</th><th>{s.expectedFile}</th></tr></thead>
                <tbody>
                  {(sites?.sites ?? []).map((site) => (
                    <tr key={site.id} className="border-t border-line">
                      <td className="py-1"><span className="mono whitespace-nowrap">{site.id} · {site.resolution_m} m</span>{site.region_name ? <span className="block text-muted">{site.region_name}</span> : null}</td>
                      <td className={`whitespace-nowrap py-1 ${site.available ? 'text-go' : 'text-stop'}`}>{site.available ? s.present : s.downloadNeeded}</td>
                      <td className={`whitespace-nowrap py-1 ${site.uncertainty_err_available ? 'text-go' : 'text-muted'}`}>{site.uncertainty_err_available ? s.present : s.none}</td>
                      <td className={`whitespace-nowrap py-1 ${site.effres_available ? 'text-go' : 'text-muted'}`}
                        title={site.kind === 'site' ? s.siteEffresNote : undefined}>
                        {site.effres_available ? s.present : site.kind === 'site' ? s.notPublished : s.notDownloaded}
                      </td>
                      <td className="mono py-1">{site.expected_folder}/<wbr />{site.expected_file}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="space-y-1 text-xs text-muted">
              <p>{s.downloadIntro}</p>
              <p className="term mono break-all rounded-lg p-2 text-term">python -m backend.download_data --include-lola-240m</p>
              <p className="term mono break-all rounded-lg p-2 text-term">python -m backend.download_data --include-lola-240m-err</p>
              <p className="term mono break-all rounded-lg p-2 text-term">python -m backend.download_data --include-lola-80m --include-lola-80m-err</p>
              <p className="term mono break-all rounded-lg p-2 text-term">python -m backend.download_data --include-site-5m --include-site-5m-extra</p>
              <p className="term mono break-all rounded-lg p-2 text-term">python -m backend.download_data --include-lola-effres</p>
              <p className="term mono break-all rounded-lg p-2 text-term">python -m backend.download_data --include-site-clones Site01   # 100 × ~41 MB</p>
              <p className="term mono break-all rounded-lg p-2 text-term">python -m backend.clone_engine --lat … --lon …   {s.cloneComment}</p>
              <p>{s.sourcesBefore}<ExternalLink href="https://pgda.gsfc.nasa.gov/products/90">{s.product90}</ExternalLink>{s.sourcesMid}<ExternalLink href="https://pgda.gsfc.nasa.gov/products/78">{s.product78}</ExternalLink>{s.sourcesAfter}</p>
              <p>
                {s.cloneFiles}{health.clones ? Object.values(health.clones.sites).map((c) => `${c.site_tile} ${c.present}/${c.expected}`).join(' · ') : unknownText()}{s.profileSets}
                <span className="mono">{health.clones?.precomputed_profile_sets ?? health.clone_profiles ?? unknownText()}</span>
                {health.clones?.profile_sets && health.clones.profile_sets.length > 0 && (
                  <>{s.cloneOnlyAt}<span className="mono">{health.clones.profile_sets.map((p) => `${p.site_tile} (${p.latitude}, ${p.longitude}) · ${p.observer_height_m.sun}/${p.observer_height_m.earth} m · ${p.radius_km} km`).join('; ')}</span></>
                )}.
              </p>
            </div>
            {health.limits && mode === 'engineer' && (
              <p className="mono text-xs text-muted">
                {s.limits(health.limits.max_workers, health.limits.max_pending, health.limits.analyses_per_minute_per_client, health.limits.analysis_timeout_s)}
              </p>
            )}
          </>
        )}
      </section>

      <section className="panel min-w-0 space-y-3" aria-labelledby="dv-val">
        <h2 id="dv-val" className="panel-title">{s.validationTitle}</h2>
        {validation.error && <Notice explained={explainError(validation.error)} />}
        {validation.data && (
          <>
            <p className="text-xs text-muted">
              {s.source}<span className="mono">{validation.data.source ?? s.noRun}</span>
              {validation.data.generated_utc && <>{s.generated}{formatUtc(validation.data.generated_utc)}</>}. {validation.data.note}. {s.honesty}
            </p>
            <ul className="space-y-2">
              {Object.entries(validation.data.tests).map(([id, t]) => (
                <li key={id} className="rounded-md border border-line bg-panel-2 p-2 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium text-ink"><span className="mono mr-2 text-accent">{id}</span>{(s.testTitles as Record<string, string | undefined>)[id] ?? id}</span>
                    <StatusPill status={t.status} />
                  </div>
                  <p className="mt-1 text-xs text-muted">{t.summary}{t.run_utc ? ` · ${formatUtc(t.run_utc)}` : ''}</p>
                  {mode === 'engineer' && t.evidence !== null && t.evidence !== undefined && (
                    <details className="mt-1 text-xs">
                      <summary className="cursor-pointer text-muted">{s.evidence}</summary>
                      <pre className="mono mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded bg-space p-2 text-[11px] text-ink">{JSON.stringify(t.evidence, null, 2)}</pre>
                    </details>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="panel min-w-0 space-y-3" aria-labelledby="dv-src">
        <h2 id="dv-src" className="panel-title">{s.sourcesTitle}</h2>
        <ul className="space-y-2 text-sm">
          <li><ExternalLink href="https://pgda.gsfc.nasa.gov/">NASA GSFC PGDA</ExternalLink>{s.pgda}</li>
          <li><ExternalLink href="https://naif.jpl.nasa.gov/naif/">NASA JPL NAIF</ExternalLink>{s.naif}</li>
          <li><ExternalLink href="https://trek.nasa.gov/moon/">NASA Moon Trek</ExternalLink>{s.moonTrek}</li>
          <li><ExternalLink href="https://quickmap.lroc.asu.edu/">LROC QuickMap</ExternalLink>{s.quickMap}</li>
        </ul>
        <p className="text-xs text-muted">{s.sha}</p>
      </section>

      <section className="panel min-w-0 space-y-2" aria-labelledby="dv-lim">
        <h2 id="dv-lim" className="panel-title">{s.limitationsTitle}</h2>
        <ul className="list-inside list-disc space-y-1 text-sm text-ink">
          {s.limitations.map((l) => <li key={l}>{l}</li>)}
        </ul>
      </section>
      {mode === 'public' && <div className="lg:col-span-2"><EarthMoonCard /></div>}
    </div>
  );
}
