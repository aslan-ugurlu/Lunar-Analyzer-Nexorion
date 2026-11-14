import { API_BASE, ApiError } from './client';

export interface Explained {
  code: string;
  /** Engineer heading (shown next to the verbatim code). */
  title: string;
  /** Plain-language heading for Halk mode; falls back to `title`. */
  publicTitle?: string;
  publicText: string;
  engineerText: string;
  /** Technical action (commands); Halk mode shows it under “Teknik detaylar”. */
  action?: string;
  /** Plain-language action a non-specialist can take (Halk mode). */
  publicAction?: string;
  tone: 'error' | 'warning' | 'info';
}

/**
 * Every backend / job / result code the UI may meet. Codes are never hidden or softened into
 * success: Mühendis mode shows them verbatim next to the explanation; Halk mode leads with a
 * plain-language heading and keeps the verbatim code under an expandable “Teknik detaylar”.
 */
const CATALOG: Record<string, Omit<Explained, 'code'>> = {
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
    action: 'Mission Setup’ta “aynı profille yeni aday” kullanın.',
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
};

/** Plain-language Halk-mode headings. The verbatim code stays available under “Teknik detaylar”. */
const PUBLIC_TITLE: Record<string, string> = {
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
};

/** Actions a non-specialist can take; command-line actions stay under “Teknik detaylar”. */
const PUBLIC_ACTION: Record<string, string> = {
  BACKEND_OFFLINE: 'Birkaç dakika sonra sayfayı yenileyin.',
  SPICE_MISSING: 'Veri yüklenene kadar analiz yapılamaz; “Data & Validation” sekmesinde durumu görebilirsiniz.',
  DEM_MISSING: 'Arazi verisi mevcut olan bir katman seçin veya koordinatı seçili karonun içine alın.',
  CLONE_NOT_PRECOMPUTED: 'Belirsizlik modunu “Nominal” veya “ERR ±k” yapıp yeniden deneyin.',
  WORKER_UNAVAILABLE: 'Analizi yeniden başlatabilirsiniz.',
  ANALYSIS_TIMEOUT: 'Görev süresini kısaltın veya zaman adımını büyütüp yeniden deneyin.',
  RATE_LIMITED: 'Bir dakika bekleyip yeniden deneyin.',
  QUEUE_FULL: 'Çalışan analizlerden biri bitince yeniden deneyin.',
  INCOMPARABLE: 'Mission Setup’ta “aynı profille yeni aday” seçeneğini kullanın.',
  REDUCED_HORIZON_RADIUS: 'Gelişmiş görev ayarlarında ufuk tarama yarıçapını 200 km yapıp yeniden çalıştırın.',
};

/** Every code with a catalogued explanation (used by tests to check Halk headings). */
export const KNOWN_CODES: readonly string[] = Object.keys(CATALOG);

export function explainCode(code: string): Explained {
  const entry = CATALOG[code];
  if (entry) return { code, ...entry, publicTitle: PUBLIC_TITLE[code] ?? entry.title, publicAction: PUBLIC_ACTION[code] };
  return {
    code,
    title: `Bilinmeyen durum: ${code}`,
    publicTitle: 'Beklenmeyen bir durum oluştu',
    publicText: 'Beklenmeyen bir durum oluştu; sonuç gösterilmiyor.',
    engineerText: `Kod: ${code}`,
    tone: 'error',
  };
}

/** Heading for the current mode (Halk: plain language; Mühendis: technical title). */
export function headingFor(explained: Explained, mode: 'public' | 'engineer'): string {
  return mode === 'public' ? explained.publicTitle ?? explained.title : explained.title;
}

export function explainError(error: unknown): Explained & { details: ApiError['details']; requestId?: string } {
  if (error instanceof ApiError) {
    const base = explainCode(error.code);
    const generic = base.title.startsWith('Bilinmeyen');
    return {
      ...base,
      engineerText: generic ? `${error.code}: ${error.message}` : base.engineerText,
      details: error.details,
      requestId: error.requestId,
    };
  }
  return { ...explainCode('CLIENT_ERROR'), details: [] };
}

export const VIOLATION_TEXT: Record<string, { label: string; publicLabel: string }> = {
  MAX_DARKNESS: { label: 'Azami kesintisiz karanlık', publicLabel: 'Güneşsiz kalınan en uzun süre sınırı aşıldı' },
  MIN_ILLUMINATION: { label: 'Asgari ortalama Güneş diski görünürlüğü', publicLabel: 'Güneş yeterince görünmüyor' },
  MIN_DTE: { label: 'Asgari DTE (geometrik Dünya görüşü) payı', publicLabel: 'Dünya yeterince uzun süre görünmüyor' },
  MAX_DTE_GAP: { label: 'Azami kesintisiz DTE kesintisi', publicLabel: 'Dünya ile doğrudan görüşün en uzun kesintisi çok uzun' },
  MAX_SLOPE: { label: 'Azami eğim', publicLabel: 'Arazi eğimi sınırın üzerinde' },
};
