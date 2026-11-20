import { API_BASE, ApiError } from './client';
import { defineStrings, pick } from '../i18n';

export interface Explained {
  code: string;
  /** Engineer heading (shown next to the verbatim code). */
  title: string;
  /** Plain-language heading for Public mode; falls back to `title`. */
  publicTitle?: string;
  publicText: string;
  engineerText: string;
  /** Technical action (commands); Public mode shows it under “Technical details”. */
  action?: string;
  /** Plain-language action a non-specialist can take (Public mode). */
  publicAction?: string;
  tone: 'error' | 'warning' | 'info';
}

type Entry = Omit<Explained, 'code'>;

/**
 * Every backend / job / result code the UI may meet. Codes are never hidden or softened into
 * success: Engineer mode shows them verbatim next to the explanation; Public mode leads with a
 * plain-language heading and keeps the verbatim code under an expandable “Technical details”.
 * Codes themselves are never translated.
 */
const CATALOG = defineStrings<Record<string, Entry>>({
  en: {
    BACKEND_OFFLINE: {
      title: 'Backend offline',
      publicText: 'The computation server cannot be reached. No result can be shown.',
      engineerText: `Network request failed: ${API_BASE}. uvicorn may not be running, or the CORS/proxy setting does not match.`,
      action: 'From the project root: uvicorn backend.main:app --host 127.0.0.1 --port 8000',
      tone: 'error',
    },
    SPICE_MISSING: {
      title: 'SPICE kernel files missing',
      publicText: 'The NASA/NAIF files needed to compute the Sun and Earth positions are not on the server.',
      engineerText: 'HTTP 503 SPICE_MISSING: the kernel set under data/spice is incomplete.',
      action: 'python -m backend.download_data',
      tone: 'error',
    },
    DEM_MISSING: {
      title: 'NASA LOLA terrain data (DEM) missing',
      publicText: 'The selected terrain map is not on the server; the horizon cannot be computed, so no result was produced.',
      engineerText: 'DEM_MISSING: the selected dataset file is missing or the location is outside the raster coverage.',
      action: 'python -m backend.download_data --include-lola-240m',
      tone: 'error',
    },
    TERRAIN_UNAVAILABLE: {
      title: 'Terrain data unusable',
      publicText: 'The terrain map could not be opened or is not in the expected format. The result is uncertain (GRAY).',
      engineerText: 'TERRAIN_UNAVAILABLE: raster could not be opened / CRS, band or elevation-range check failed.',
      tone: 'error',
    },
    CLONE_NOT_PRECOMPUTED: {
      title: 'DEM clone profiles not ready',
      publicText: 'The precomputed NASA clone files needed for the “clone” uncertainty mode are not available. No fake result was produced.',
      engineerText: 'CLONE_NOT_PRECOMPUTED: the real 100-clone dataset and its mapping are not registered → GRAY.',
      action: 'Choose the “nominal” mode, or “err” if the ERR layer is available.',
      tone: 'warning',
    },
    WORKER_UNAVAILABLE: {
      title: 'Computation process crashed',
      publicText: 'The background process doing the computation stopped unexpectedly. The API is still running; you can restart the analysis.',
      engineerText: 'WORKER_UNAVAILABLE: BrokenProcessPool; the pool was recreated.',
      tone: 'error',
    },
    ANALYSIS_TIMEOUT: {
      title: 'Analysis timed out',
      publicText: 'The computation exceeded the allowed time and was stopped.',
      engineerText: 'ANALYSIS_TIMEOUT: worker processes were terminated and the pool was renewed.',
      action: 'Increase the time step, or reduce the duration or the horizon radius.',
      tone: 'error',
    },
    CALCULATION_ERROR: {
      title: 'Calculation error',
      publicText: 'The computation could not be completed. No result can be shown.',
      engineerText: 'CALCULATION_ERROR: unexpected exception inside the worker (details in the server log).',
      tone: 'error',
    },
    CANCELLED: {
      title: 'Analysis cancelled',
      publicText: 'The analysis was cancelled while the server was shutting down.',
      engineerText: 'CANCELLED',
      tone: 'warning',
    },
    INVALID_INPUT: {
      title: 'Invalid input',
      publicText: 'Some values are outside the supported limits.',
      engineerText: 'HTTP 422 INVALID_INPUT (Pydantic validation).',
      tone: 'warning',
    },
    RATE_LIMITED: {
      title: 'Too many requests',
      publicText: 'At most 5 new analyses can be started per minute. Wait a moment and try again.',
      engineerText: 'HTTP 429 RATE_LIMITED (5/min per client, single-instance in-memory).',
      tone: 'warning',
    },
    QUEUE_FULL: {
      title: 'Queue full',
      publicText: 'The server accepts at most 6 analyses at a time. Try again when one finishes.',
      engineerText: 'HTTP 429 QUEUE_FULL (MAX_PENDING=6, 2 workers).',
      tone: 'warning',
    },
    HORIZON_NOT_READY: {
      title: 'Horizon not ready yet',
      publicText: 'The horizon profile for this analysis has not been computed yet, or could not be computed.',
      engineerText: 'HTTP 409 HORIZON_NOT_READY',
      tone: 'info',
    },
    TIMELINE_NOT_READY: {
      title: 'Timeline not ready',
      publicText: 'There is no timeline for this analysis.',
      engineerText: 'HTTP 409 TIMELINE_NOT_READY',
      tone: 'info',
    },
    ANALYSIS_NOT_READY: {
      title: 'Analysis not completed',
      publicText: 'At least one of the selected analyses has not completed or has no mission result.',
      engineerText: 'HTTP 409 ANALYSIS_NOT_READY',
      tone: 'info',
    },
    ANALYSIS_NOT_FOUND: {
      title: 'Analysis not found',
      publicText: 'The server does not know this analysis. If the server was restarted, analyses may have been cleared.',
      engineerText: 'HTTP 404 ANALYSIS_NOT_FOUND (job records are kept in memory only).',
      tone: 'warning',
    },
    INCOMPARABLE: {
      title: 'Analyses not comparable',
      publicText: 'Candidates can only be compared when every mission setting except the location is the same.',
      engineerText: 'HTTP 422 INCOMPARABLE: the payload (excluding location and dataset) must be identical.',
      action: 'Use “new candidate with the same profile” in Mission Setup.',
      tone: 'warning',
    },
    INTERNAL_ERROR: {
      title: 'Server error',
      publicText: 'The server could not complete this request.',
      engineerText: 'HTTP 500 INTERNAL_ERROR (check the server log using the request_id).',
      tone: 'error',
    },
    INCOMPLETE_VISIBILITY: {
      title: 'Visibility calculation incomplete',
      publicText: 'Terrain data is missing in the direction of the Sun or Earth; the result is uncertain for those hours.',
      engineerText: 'INCOMPLETE_VISIBILITY: horizon is NaN at the relevant azimuth (incomplete coverage).',
      tone: 'warning',
    },
    SLOPE_UNKNOWN: {
      title: 'Slope unknown',
      publicText: 'No terrain data at ≤20 m resolution is available for the slope constraint; slope could not be assessed.',
      engineerText: 'SLOPE_UNKNOWN: no high-resolution DEM/sample → contributes GRAY.',
      tone: 'warning',
    },
    REDUCED_HORIZON_RADIUS: {
      title: 'Horizon scanned shorter than the 200 km reference (GREEN capped at YELLOW)',
      publicText: 'In this analysis the horizon was scanned in quick mode, to a shorter distance than 200 km. Distant mountains could ' +
        'additionally block the Sun or Earth, so the result may be optimistic. A “suitable” (GREEN) decision is therefore not given; the best result is “caution” (YELLOW).',
      engineerText: 'REDUCED_HORIZON_RADIUS: r < 200 km. A shorter scan can only lower the horizon (maximum over fewer terrain samples) → visibility is optimistic. ' +
        'RED stays valid; GREEN is capped at YELLOW; YELLOW/GRAY may worsen at 200 km.',
      action: 'Run again with horizon scan radius = 200 km.',
      tone: 'warning',
    },
  },
  tr: {
    BACKEND_OFFLINE: {
      title: 'Backend çevrimdışı',
      publicText: 'Hesaplama sunucusuna ulaşılamıyor. Sonuç gösterilemez.',
      engineerText: `Ağ isteği başarısız: ${API_BASE}. uvicorn çalışmıyor olabilir veya CORS/proxy ayarı uyuşmuyor.`,
      action: 'Proje kökünde: uvicorn backend.main:app --host 127.0.0.1 --port 8000',
      tone: 'error',
    },
    SPICE_MISSING: {
      title: 'SPICE kernel dosyaları eksik',
      publicText: 'Güneş ve Dünya konumlarını hesaplamak için gereken NASA/NAIF dosyaları sunucuda yok.',
      engineerText: 'HTTP 503 SPICE_MISSING: data/spice altındaki kernel kümesi tam değil.',
      action: 'python -m backend.download_data',
      tone: 'error',
    },
    DEM_MISSING: {
      title: 'NASA LOLA arazi verisi (DEM) eksik',
      publicText: 'Seçilen arazi haritası sunucuda yok; ufuk hesaplanamaz, bu yüzden sonuç üretilmedi.',
      engineerText: 'DEM_MISSING: seçili dataset dosyası yok ya da konum raster kapsamı dışında.',
      action: 'python -m backend.download_data --include-lola-240m',
      tone: 'error',
    },
    TERRAIN_UNAVAILABLE: {
      title: 'Arazi verisi kullanılamadı',
      publicText: 'Arazi haritası açılamadı veya beklenen biçimde değil. Sonuç belirsiz (GRAY).',
      engineerText: 'TERRAIN_UNAVAILABLE: raster açılamadı / CRS, bant veya yükseklik aralığı kontrolü başarısız.',
      tone: 'error',
    },
    CLONE_NOT_PRECOMPUTED: {
      title: 'DEM clone profilleri hazır değil',
      publicText: '“Clone” belirsizlik modu için gerekli önceden hesaplanmış NASA klon dosyaları yok. Sahte sonuç üretilmedi.',
      engineerText: 'CLONE_NOT_PRECOMPUTED: gerçek 100-clone veri seti ve eşlemesi kayıtlı değil → GRAY.',
      action: '“nominal” veya (ERR katmanı varsa) “err” modunu seçin.',
      tone: 'warning',
    },
    WORKER_UNAVAILABLE: {
      title: 'Hesap süreci çöktü',
      publicText: 'Hesaplamayı yapan arka plan süreci beklenmedik şekilde durdu. API çalışmaya devam ediyor; analizi yeniden başlatabilirsiniz.',
      engineerText: 'WORKER_UNAVAILABLE: BrokenProcessPool; havuz yeniden oluşturuldu.',
      tone: 'error',
    },
    ANALYSIS_TIMEOUT: {
      title: 'Analiz zaman aşımına uğradı',
      publicText: 'Hesaplama izin verilen süreyi aştı ve durduruldu.',
      engineerText: 'ANALYSIS_TIMEOUT: worker süreçleri sonlandırıldı, havuz yenilendi.',
      action: 'Adımı büyütün, süreyi veya ufuk yarıçapını azaltın.',
      tone: 'error',
    },
    CALCULATION_ERROR: {
      title: 'Hesaplama hatası',
      publicText: 'Hesaplama tamamlanamadı. Sonuç gösterilemez.',
      engineerText: 'CALCULATION_ERROR: worker içinde beklenmeyen istisna (ayrıntı sunucu logunda).',
      tone: 'error',
    },
    CANCELLED: {
      title: 'Analiz iptal edildi',
      publicText: 'Sunucu kapanırken analiz iptal edildi.',
      engineerText: 'CANCELLED',
      tone: 'warning',
    },
    INVALID_INPUT: {
      title: 'Geçersiz giriş',
      publicText: 'Bazı değerler desteklenen sınırların dışında.',
      engineerText: 'HTTP 422 INVALID_INPUT (Pydantic doğrulaması).',
      tone: 'warning',
    },
    RATE_LIMITED: {
      title: 'Çok sık istek',
      publicText: 'Dakikada en fazla 5 yeni analiz başlatılabilir. Biraz bekleyip tekrar deneyin.',
      engineerText: 'HTTP 429 RATE_LIMITED (istemci başına 5/dk, tek instance bellek içi).',
      tone: 'warning',
    },
    QUEUE_FULL: {
      title: 'Kuyruk dolu',
      publicText: 'Sunucu aynı anda en fazla 6 analiz kabul ediyor. Biri bitince tekrar deneyin.',
      engineerText: 'HTTP 429 QUEUE_FULL (MAX_PENDING=6, 2 worker).',
      tone: 'warning',
    },
    HORIZON_NOT_READY: {
      title: 'Ufuk henüz hazır değil',
      publicText: 'Bu analiz için ufuk profili henüz hesaplanmadı veya hesaplanamadı.',
      engineerText: 'HTTP 409 HORIZON_NOT_READY',
      tone: 'info',
    },
    TIMELINE_NOT_READY: {
      title: 'Zaman çizelgesi hazır değil',
      publicText: 'Bu analiz için zaman çizelgesi yok.',
      engineerText: 'HTTP 409 TIMELINE_NOT_READY',
      tone: 'info',
    },
    ANALYSIS_NOT_READY: {
      title: 'Analiz tamamlanmadı',
      publicText: 'Seçilen analizlerden en az biri tamamlanmamış veya görev sonucu içermiyor.',
      engineerText: 'HTTP 409 ANALYSIS_NOT_READY',
      tone: 'info',
    },
    ANALYSIS_NOT_FOUND: {
      title: 'Analiz bulunamadı',
      publicText: 'Sunucu bu analizi tanımıyor. Sunucu yeniden başlatıldıysa analizler silinmiş olabilir.',
      engineerText: 'HTTP 404 ANALYSIS_NOT_FOUND (iş kayıtları yalnızca bellekte tutulur).',
      tone: 'warning',
    },
    INCOMPARABLE: {
      title: 'Karşılaştırılamaz analizler',
      publicText: 'Adaylar yalnızca konum dışında aynı görev ayarlarıyla karşılaştırılabilir.',
      engineerText: 'HTTP 422 INCOMPARABLE: payload (konum ve dataset hariç) birebir aynı olmalı.',
      action: 'Görev Kurulumu’nda “aynı profille yeni aday” kullanın.',
      tone: 'warning',
    },
    INTERNAL_ERROR: {
      title: 'Sunucu hatası',
      publicText: 'Sunucu bu isteği tamamlayamadı.',
      engineerText: 'HTTP 500 INTERNAL_ERROR (request_id ile sunucu logunu inceleyin).',
      tone: 'error',
    },
    INCOMPLETE_VISIBILITY: {
      title: 'Görünürlük hesabı eksik',
      publicText: 'Güneş veya Dünya yönünde arazi verisi eksik; o saatler için sonuç belirsiz.',
      engineerText: 'INCOMPLETE_VISIBILITY: ilgili azimutta ufuk NaN (kapsama eksik).',
      tone: 'warning',
    },
    SLOPE_UNKNOWN: {
      title: 'Eğim bilinmiyor',
      publicText: 'Eğim kısıtı için ≤20 m çözünürlüklü arazi verisi yok; eğim değerlendirilemedi.',
      engineerText: 'SLOPE_UNKNOWN: yüksek çözünürlüklü DEM/örnek yok → GRAY katkısı.',
      tone: 'warning',
    },
    REDUCED_HORIZON_RADIUS: {
      title: 'Ufuk 200 km referanstan kısa tarandı (GREEN tavanı: YELLOW)',
      publicText: 'Bu analizde ufuk hızlı modda, 200 km yerine daha kısa bir mesafeye kadar tarandı. Uzaktaki dağlar Güneş’i veya Dünya’yı ' +
        'ek olarak kapatabileceği için sonuç olduğundan iyimser olabilir. Bu yüzden “uygun” (GREEN) kararı verilmez; en iyi sonuç “dikkat” (YELLOW) olur.',
      engineerText: 'REDUCED_HORIZON_RADIUS: r < 200 km. Kısa tarama ufku yalnız alçaltabilir (daha az arazi örneği üzerinde maksimum) → görünürlük iyimser. ' +
        'RED geçerli kalır; GREEN → YELLOW tavanı; YELLOW/GRAY 200 km’de kötüleşebilir.',
      action: 'Ufuk tarama yarıçapı = 200 km ile yeniden çalıştırın.',
      tone: 'warning',
    },
  },
});

/** Plain-language Public-mode headings. The verbatim code stays available under “Technical details”. */
const PUBLIC_TITLE = defineStrings<Record<string, string>>({
  en: {
    BACKEND_OFFLINE: 'The computation server cannot be reached right now',
    SPICE_MISSING: 'Sun and Earth position data is not available yet',
    DEM_MISSING: 'Terrain data is not available yet',
    TERRAIN_UNAVAILABLE: 'Terrain data could not be read',
    CLONE_NOT_PRECOMPUTED: 'Data for this uncertainty method is not ready yet',
    WORKER_UNAVAILABLE: 'The computation was interrupted',
    ANALYSIS_TIMEOUT: 'The computation took too long and was stopped',
    CALCULATION_ERROR: 'The computation could not be completed',
    CANCELLED: 'The analysis was cancelled',
    INVALID_INPUT: 'Some values are outside the accepted range',
    RATE_LIMITED: 'Too many analyses were started in a short time',
    QUEUE_FULL: 'The server is very busy right now',
    HORIZON_NOT_READY: 'The horizon line is not ready yet',
    TIMELINE_NOT_READY: 'The timeline is not ready yet',
    ANALYSIS_NOT_READY: 'The analysis has not finished yet',
    ANALYSIS_NOT_FOUND: 'This analysis is no longer on the server',
    INCOMPARABLE: 'These candidates cannot be compared with each other',
    INTERNAL_ERROR: 'An unexpected problem occurred on the server',
    INCOMPLETE_VISIBILITY: 'Terrain data is missing for some hours',
    SLOPE_UNKNOWN: 'The terrain slope could not be assessed',
    REDUCED_HORIZON_RADIUS: 'Quick scan used: a full scan is needed for a definite “suitable” decision',
  },
  tr: {
    BACKEND_OFFLINE: 'Hesaplama sunucusuna şu an ulaşılamıyor',
    SPICE_MISSING: 'Güneş ve Dünya konum verisi henüz mevcut değil',
    DEM_MISSING: 'Arazi verisi henüz mevcut değil',
    TERRAIN_UNAVAILABLE: 'Arazi verisi okunamadı',
    CLONE_NOT_PRECOMPUTED: 'Bu belirsizlik yöntemi için veri henüz hazır değil',
    WORKER_UNAVAILABLE: 'Hesaplama yarıda kesildi',
    ANALYSIS_TIMEOUT: 'Hesaplama çok uzun sürdü ve durduruldu',
    CALCULATION_ERROR: 'Hesaplama tamamlanamadı',
    CANCELLED: 'Analiz iptal edildi',
    INVALID_INPUT: 'Bazı değerler kabul edilen aralığın dışında',
    RATE_LIMITED: 'Kısa sürede çok fazla analiz başlatıldı',
    QUEUE_FULL: 'Sunucu şu an çok meşgul',
    HORIZON_NOT_READY: 'Ufuk çizgisi henüz hazır değil',
    TIMELINE_NOT_READY: 'Zaman çizelgesi henüz hazır değil',
    ANALYSIS_NOT_READY: 'Analiz henüz tamamlanmadı',
    ANALYSIS_NOT_FOUND: 'Bu analiz artık sunucuda yok',
    INCOMPARABLE: 'Bu adaylar birbiriyle karşılaştırılamaz',
    INTERNAL_ERROR: 'Sunucuda beklenmeyen bir sorun oluştu',
    INCOMPLETE_VISIBILITY: 'Bazı saatler için arazi verisi eksik',
    SLOPE_UNKNOWN: 'Arazi eğimi değerlendirilemedi',
    REDUCED_HORIZON_RADIUS: 'Hızlı tarama yapıldı: kesin “uygun” kararı için tam tarama gerekli',
  },
});

/** Actions a non-specialist can take; command-line actions stay under “Technical details”. */
const PUBLIC_ACTION = defineStrings<Record<string, string>>({
  en: {
    BACKEND_OFFLINE: 'Reload the page in a few minutes.',
    SPICE_MISSING: 'No analysis is possible until the data is loaded; the “Data & Validation” tab shows the status.',
    DEM_MISSING: 'Choose a layer whose terrain data is available, or move the coordinate inside the selected tile.',
    CLONE_NOT_PRECOMPUTED: 'Set the uncertainty mode to “Nominal” or “ERR ±k” and try again.',
    WORKER_UNAVAILABLE: 'You can restart the analysis.',
    ANALYSIS_TIMEOUT: 'Shorten the mission duration or use a larger time step and try again.',
    RATE_LIMITED: 'Wait a minute and try again.',
    QUEUE_FULL: 'Try again when one of the running analyses finishes.',
    INCOMPARABLE: 'Use the “new candidate with the same profile” option in Mission Setup.',
    REDUCED_HORIZON_RADIUS: 'In the advanced mission settings, set the horizon scan radius to 200 km and run again.',
  },
  tr: {
    BACKEND_OFFLINE: 'Birkaç dakika sonra sayfayı yenileyin.',
    SPICE_MISSING: 'Veri yüklenene kadar analiz yapılamaz; “Veri ve Doğrulama” sekmesinde durumu görebilirsiniz.',
    DEM_MISSING: 'Arazi verisi mevcut olan bir katman seçin veya koordinatı seçili karonun içine alın.',
    CLONE_NOT_PRECOMPUTED: 'Belirsizlik modunu “Nominal” veya “ERR ±k” yapıp yeniden deneyin.',
    WORKER_UNAVAILABLE: 'Analizi yeniden başlatabilirsiniz.',
    ANALYSIS_TIMEOUT: 'Görev süresini kısaltın veya zaman adımını büyütüp yeniden deneyin.',
    RATE_LIMITED: 'Bir dakika bekleyip yeniden deneyin.',
    QUEUE_FULL: 'Çalışan analizlerden biri bitince yeniden deneyin.',
    INCOMPARABLE: 'Görev Kurulumu’nda “aynı profille yeni aday” seçeneğini kullanın.',
    REDUCED_HORIZON_RADIUS: 'Gelişmiş görev ayarlarında ufuk tarama yarıçapını 200 km yapıp yeniden çalıştırın.',
  },
});

const UNKNOWN = defineStrings({
  en: {
    title: (code: string) => `Unknown status: ${code}`,
    publicTitle: 'An unexpected situation occurred',
    publicText: 'An unexpected situation occurred; no result is shown.',
    engineerText: (code: string) => `Code: ${code}`,
  },
  tr: {
    title: (code: string) => `Bilinmeyen durum: ${code}`,
    publicTitle: 'Beklenmeyen bir durum oluştu',
    publicText: 'Beklenmeyen bir durum oluştu; sonuç gösterilmiyor.',
    engineerText: (code: string) => `Kod: ${code}`,
  },
});

/** Every code with a catalogued explanation (used by tests to check Public headings). */
export const KNOWN_CODES: readonly string[] = Object.keys(CATALOG.en);

/** Explanation in the current interface language (see `getLang()`). */
export function explainCode(code: string): Explained {
  const entry = Object.hasOwn(CATALOG.en, code) ? pick(CATALOG)[code] : undefined;
  if (entry) return { code, ...entry, publicTitle: pick(PUBLIC_TITLE)[code] ?? entry.title, publicAction: pick(PUBLIC_ACTION)[code] };
  const u = pick(UNKNOWN);
  return {
    code,
    title: u.title(code),
    publicTitle: u.publicTitle,
    publicText: u.publicText,
    engineerText: u.engineerText(code),
    tone: 'error',
  };
}

/** Heading for the current mode (Public: plain language; Engineer: technical title). */
export function headingFor(explained: Explained, mode: 'public' | 'engineer'): string {
  return mode === 'public' ? explained.publicTitle ?? explained.title : explained.title;
}

export function explainError(error: unknown): Explained & { details: ApiError['details']; requestId?: string } {
  if (error instanceof ApiError) {
    const base = explainCode(error.code);
    const generic = !Object.hasOwn(CATALOG.en, error.code);
    return {
      ...base,
      engineerText: generic ? `${error.code}: ${error.message}` : base.engineerText,
      details: error.details,
      requestId: error.requestId,
    };
  }
  return { ...explainCode('CLIENT_ERROR'), details: [] };
}

export interface ViolationText {
  /** Engineer wording of the constraint. */
  label: string;
  /** Plain-language wording (Public mode). */
  publicLabel: string;
}

const VIOLATION_TEXT = defineStrings<Record<string, ViolationText>>({
  en: {
    MAX_DARKNESS: { label: 'Maximum continuous darkness', publicLabel: 'The longest time without sunlight exceeds the limit' },
    MIN_ILLUMINATION: { label: 'Minimum mean Sun-disk visibility', publicLabel: 'The Sun is not visible enough' },
    MIN_DTE: { label: 'Minimum DTE (geometric Earth line of sight) share', publicLabel: 'Earth is not visible for long enough' },
    MAX_DTE_GAP: { label: 'Maximum continuous DTE outage', publicLabel: 'The longest break in direct line of sight to Earth is too long' },
    MAX_SLOPE: { label: 'Maximum slope', publicLabel: 'The terrain slope is above the limit' },
  },
  tr: {
    MAX_DARKNESS: { label: 'Azami kesintisiz karanlık', publicLabel: 'Güneşsiz kalınan en uzun süre sınırı aşıldı' },
    MIN_ILLUMINATION: { label: 'Asgari ortalama Güneş diski görünürlüğü', publicLabel: 'Güneş yeterince görünmüyor' },
    MIN_DTE: { label: 'Asgari DTE (geometrik Dünya görüşü) payı', publicLabel: 'Dünya yeterince uzun süre görünmüyor' },
    MAX_DTE_GAP: { label: 'Azami kesintisiz DTE kesintisi', publicLabel: 'Dünya ile doğrudan görüşün en uzun kesintisi çok uzun' },
    MAX_SLOPE: { label: 'Azami eğim', publicLabel: 'Arazi eğimi sınırın üzerinde' },
  },
});

/** Wording of a constraint-violation code in the current language; undefined for unknown codes. */
export function violationText(code: string): ViolationText | undefined {
  return Object.hasOwn(VIOLATION_TEXT.en, code) ? pick(VIOLATION_TEXT)[code] : undefined;
}
