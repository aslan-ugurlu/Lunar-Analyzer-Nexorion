import type { ApiError } from '../api/client';
import { explainError } from '../api/errors';
import type { Health, SitesResponse, ValidationStatus } from '../api/types';
import { useValidation } from '../hooks/useBackend';
import { formatUtc } from '../lib/utc';
import { useApp } from '../state/AppState';
import { EarthMoonCard } from './EarthMoonCard';
import { ExternalLink, Icon, Notice } from './ui';

const TEST_TITLES: Record<string, string> = {
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
};

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

const LIMITATIONS = [
  'Güneş görünürlüğü (f_sun) geometrik disk payıdır; elektrik/güç üretimi değildir.',
  'DTE yalnızca Dünya merkezinin arazi ufku üstünde olmasıdır; RF bağlantı bütçesi, anten deseni veya veri hızı değildir.',
  'Eğim kısıtı ≤ 20 m DEM ister; 240 m DEM’den güvenli iniş sonucu çıkarılmaz (SLOPE_UNKNOWN → GRAY).',
  'ERR ±k bir duyarlılık senaryosudur; istatistiksel güven aralığı değildir. DEM clone verisi olmadan clone modu GRAY döner.',
  '200 km tarama yarıçapı referans seçimdir; daha uzaktaki arazinin etkisi olmadığına dair kanıt değildir.',
  'Zaman serisi örneklenmiştir; geçiş anları adım (dk) içinde belirsizdir ve sertifikalı değildir.',
  'Ufuk 0.1° azimut ile örneklenir; bu tek başına %2 doğruluk garantisi değildir.',
  'Bu araç bir iniş sertifikası veya NASA onayı değildir; ön eleme / karar desteğidir.',
];

export function DataValidation({ health, healthError, sites }: { health: Health | null; healthError: ApiError | null; sites: SitesResponse | null }) {
  const { mode } = useApp();
  const validation = useValidation();
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <section className="panel min-w-0 space-y-3" aria-labelledby="dv-health">
        <h2 id="dv-health" className="panel-title">Hizmet ve veri durumu (GET /health, /sites)</h2>
        {healthError && <Notice explained={explainError(healthError)} />}
        {health && (
          <>
            <p className="text-sm">
              Durum: <strong className={health.status === 'ready' ? 'text-go' : 'text-caution'}>{health.status}</strong> · bekleyen/çalışan iş: <span className="mono">{health.jobs_pending}</span>
            </p>
            <p className="rounded-md border border-caution/40 bg-caution/5 p-2 text-xs text-ink">
              “ready” yalnızca gerekli dosyaların <strong>bulunduğunu</strong> söyler; checksum, kernel kapsamı veya bilimsel doğruluk doğrulaması değildir.
              Bilimsel doğrulama durumu aşağıdaki tabloda, yalnızca gerçek test koşularından gelir.
            </p>
            <h3 className="text-sm font-semibold text-ink">NAIF SPICE kernel dosyaları</h3>
            <ul className="mono grid grid-cols-1 gap-1 text-xs sm:grid-cols-2">
              {Object.entries(health.kernels).map(([k, ok]) => (
                <li key={k} className={ok ? 'text-go' : 'text-stop'}>{ok ? '✓' : '✗'} {k}</li>
              ))}
            </ul>
            <h3 className="text-sm font-semibold text-ink">NASA LOLA arazi katmanları</h3>
            <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="LOLA katman tablosu (yatay kaydırılabilir)">
              <table className="w-full min-w-[480px] text-left text-xs">
                <thead className="text-muted"><tr><th className="py-1">Katman</th><th>DEM</th><th>ERR</th><th>EFFRES</th><th>Beklenen dosya</th></tr></thead>
                <tbody>
                  {(sites?.sites ?? []).map((s) => (
                    <tr key={s.id} className="border-t border-line">
                      <td className="mono py-1">{s.id} · {s.resolution_m} m{s.region_name ? <span className="block font-sans text-muted">{s.region_name}</span> : null}</td>
                      <td className={s.available ? 'text-go' : 'text-stop'}>{s.available ? 'var' : 'indirilmeli'}</td>
                      <td className={s.uncertainty_err_available ? 'text-go' : 'text-muted'}>{s.uncertainty_err_available ? 'var' : 'yok'}</td>
                      <td className={s.effres_available ? 'text-go' : 'text-muted'}>{s.effres_available ? 'var' : 'yok'}</td>
                      <td className="mono break-all">{s.expected_folder}/{s.expected_file}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="space-y-1 text-xs text-muted">
              <p>240 m referans DEM ve ERR katmanını resmi PGDA adresinden güvenli (kilitli, atomik, doğrulamalı) indirmek için proje kökünde:</p>
              <p className="mono break-all rounded bg-panel-2 p-2 text-ink">python -m backend.download_data --include-lola-240m</p>
              <p className="mono break-all rounded bg-panel-2 p-2 text-ink">python -m backend.download_data --include-lola-240m-err</p>
              <p className="mono break-all rounded bg-panel-2 p-2 text-ink">python -m backend.download_data --include-lola-80m --include-lola-80m-err</p>
              <p className="mono break-all rounded bg-panel-2 p-2 text-ink">python -m backend.download_data --include-site-5m --include-site-5m-extra</p>
              <p className="mono break-all rounded bg-panel-2 p-2 text-ink">python -m backend.download_data --include-lola-effres</p>
              <p className="mono break-all rounded bg-panel-2 p-2 text-ink">python -m backend.download_data --include-site-clones Site01   # 100 × ~41 MB</p>
              <p className="mono break-all rounded bg-panel-2 p-2 text-ink">python -m backend.clone_engine --lat … --lon …   # clone ufuk profilleri (çevrimdışı ön hesap)</p>
              <p>80 m ve EFFRES: <ExternalLink href="https://pgda.gsfc.nasa.gov/products/90">PGDA ürün 90</ExternalLink> · 5 m site (Site01, 04, 07, 11, 23) ve DEM clone'ları: <ExternalLink href="https://pgda.gsfc.nasa.gov/products/78">PGDA ürün 78</ExternalLink>; 20 m otomatik indirilmez. Site `_surf` dosyalarında boş pikseller enterpolasyonla doldurulmuştur (PGDA README). EFFRES yalnız veri kalitesi bilgisidir; ufku veya kararı değiştirmez.</p>
              <p>
                DEM clone dosyaları: {health.clones ? Object.values(health.clones.sites).map((c) => `${c.site_tile} ${c.present}/${c.expected}`).join(' · ') : 'bilinmiyor'} ·
                ön hesaplanmış profil seti: <span className="mono">{health.clones?.precomputed_profile_sets ?? health.clone_profiles ?? 'bilinmiyor'}</span>.
              </p>
            </div>
            {health.limits && mode === 'engineer' && (
              <p className="mono text-xs text-muted">
                Sınırlar: {health.limits.max_workers} spawn worker · {health.limits.max_pending} bekleyen/çalışan iş · istemci başına {health.limits.analyses_per_minute_per_client} analiz/dk (tek instance, bellek içi) · iş zaman aşımı {health.limits.analysis_timeout_s} s
              </p>
            )}
          </>
        )}
      </section>

      <section className="panel min-w-0 space-y-3" aria-labelledby="dv-val">
        <h2 id="dv-val" className="panel-title">Bilimsel doğrulama (GET /validation)</h2>
        {validation.error && <Notice explained={explainError(validation.error)} />}
        {validation.data && (
          <>
            <p className="text-xs text-muted">
              Kaynak: <span className="mono">{validation.data.source ?? 'kayıtlı koşu yok'}</span>
              {validation.data.generated_utc && <> · üretildi {formatUtc(validation.data.generated_utc)}</>}. {validation.data.note}.
              Kayıtlı gerçek koşu yoksa durum NOT_RUN’dır.
            </p>
            <ul className="space-y-2">
              {Object.entries(validation.data.tests).map(([id, t]) => (
                <li key={id} className="rounded-md border border-line bg-panel-2 p-2 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium text-ink"><span className="mono mr-2 text-accent">{id}</span>{TEST_TITLES[id] ?? id}</span>
                    <StatusPill status={t.status} />
                  </div>
                  <p className="mt-1 text-xs text-muted">{t.summary}{t.run_utc ? ` · ${formatUtc(t.run_utc)}` : ''}</p>
                  {mode === 'engineer' && t.evidence !== null && t.evidence !== undefined && (
                    <details className="mt-1 text-xs">
                      <summary className="cursor-pointer text-muted">Kanıt</summary>
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
        <h2 id="dv-src" className="panel-title">NASA veri kaynakları</h2>
        <ul className="space-y-2 text-sm">
          <li><ExternalLink href="https://pgda.gsfc.nasa.gov/">NASA GSFC PGDA</ExternalLink> — LOLA güney kutbu DEM, ERR ve EFFRES ürünleri (Barker vd. 2023, PSJ 4:183; DOI 10.60903/gsfcpgda-lola-spole). Konum: MOON_ME (DE421) polar stereografik, yükseklik metre.</li>
          <li><ExternalLink href="https://naif.jpl.nasa.gov/naif/">NASA JPL NAIF</ExternalLink> — SPICE kernel’leri: naif0012.tls, pck00011.tpc, de440s.bsp, moon_pa_de440_200625.bpc, moon_de440_250416.tf (frame MOON_ME_DE440_ME421).</li>
          <li><ExternalLink href="https://trek.nasa.gov/moon/">NASA Moon Trek</ExternalLink> — konumu görsel inceleme (koordinata odaklanma her açılışta garanti değil).</li>
          <li><ExternalLink href="https://quickmap.lroc.asu.edu/">LROC QuickMap</ExternalLink> — konumu görsel inceleme; site quickmap.lroc.im-ldi.com adresine taşındı, bağlantılar yeni adresi kullanır.</li>
        </ul>
        <p className="text-xs text-muted">Yerel SHA-256 değerleri yalnızca yerel izlenebilirlik içindir; PGDA LOLA dosyaları için yayıncı checksum’ı yayımlanmamıştır.</p>
      </section>

      <section className="panel min-w-0 space-y-2" aria-labelledby="dv-lim">
        <h2 id="dv-lim" className="panel-title">Bilinen bilimsel sınırlamalar</h2>
        <ul className="list-inside list-disc space-y-1 text-sm text-ink">
          {LIMITATIONS.map((l) => <li key={l}>{l}</li>)}
        </ul>
      </section>
      {mode === 'public' && <div className="lg:col-span-2"><EarthMoonCard /></div>}
    </div>
  );
}
