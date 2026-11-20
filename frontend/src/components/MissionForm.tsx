import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, ApiError } from '../api/client';
import { explainError } from '../api/errors';
import type { Health, SiteLayer, SitesResponse, UncertaintyMode } from '../api/types';
import { formatLatLon } from '../lib/format';
import { buildRequest, DEFAULT_FORM, fieldForApiPath, LIMITS, type FieldErrors, type MissionForm as Form } from '../lib/mission';
import { FRAME, latrecKm, MOON_RADIUS_KM } from '../lib/telemetry';
import { utcPartsToIso } from '../lib/utc';
import { useApp } from '../state/AppState';
import { Icon, Notice, type IconName } from './ui';
import { Stepper, type StepState } from './Wizard';
import { defineStrings, useLang, useStrings } from '../i18n';

const SHIFT_OPTIONS = [0, 24, 48, 72];
const HEIGHT_PRESETS = [1, 4, 40];
/** Fields that live in the "Advanced mission settings" accordion in Public mode. */
export const ADVANCED_FIELDS: (keyof Form)[] = [
  'buffer_hours', 'step_minutes', 'horizon_radius_km', 'err_k', 'dark_fraction_threshold', 'max_slope_deg', 'slope_footprint_radius_m',
];

type ErrorKey = keyof FieldErrors;
export type WizardStep = 'site' | 'time' | 'needs' | 'review';
type ConstraintKey = 'max_darkness_hours' | 'min_sun_fraction_pct' | 'min_dte_fraction_pct' | 'max_dte_gap_hours';

/**
 * Public wizard. Presentation only: every step edits the SAME form state that Engineer mode shows, and
 * the request body is built by the same `buildRequest`, so the mode never changes a result.
 * Step titles, questions and intros are in STR.steps (interface language).
 */
export const WIZARD_STEPS: { key: WizardStep; icon: IconName; keys: ErrorKey[] }[] = [
  { key: 'site', icon: 'pin', keys: ['dataset_id', 'latitude', 'longitude'] },
  { key: 'time', icon: 'clock', keys: ['landing_date', 'landing_time', 'duration_hours', 'shifts'] },
  {
    key: 'needs', icon: 'target',
    keys: ['max_darkness_hours', 'min_sun_fraction_pct', 'min_dte_fraction_pct', 'max_dte_gap_hours', 'constraints', 'sun_observer_height_m', 'earth_observer_height_m'],
  },
  { key: 'review', icon: 'rocket', keys: ['uncertainty_mode', ...ADVANCED_FIELDS, 'budget'] },
];

type StepText = { title: string; question: string; intro: string };

const STR = defineStrings({
  en: {
    steps: {
      site: {
        title: 'Location', question: 'Where at the Moon’s south pole shall we look?',
        intro: 'Choose a NASA LOLA terrain map and enter the coordinate. The coordinate must be in the Moon’s south polar region (latitude −80° … −90°).',
      },
      time: {
        title: 'Time', question: 'When is the landing, and how long will the mission last?',
        intro: 'All times are UTC; your browser’s time zone is not used. We can also try a landing delayed by a few days at the same time.',
      },
      needs: {
        title: 'Needs', question: 'How much does the mission need the Sun and Earth?',
        intro: 'Enter how long the vehicle can survive darkness and how much direct line of sight to Earth it needs. The defaults are only examples, not NASA recommendations.',
      },
      review: {
        title: 'Review', question: 'Choose the uncertainty, check the summary and start',
        intro: 'Terrain maps have measurement errors too. A “suitable” decision is given only if the constraints are still met when this error is taken into account.',
      },
    } as Record<WizardStep, StepText>,
    cloneNoneEngineer: (detail: string) => `No precomputed clone profiles${detail} → CLONE_NOT_PRECOMPUTED / GRAY.`,
    cloneNoneDetail: (complete: string, sets: number) => ` (complete clone sets: ${complete || 'none'}; profile sets: ${sets})`,
    cloneNonePublic: 'NASA clone data for this method is not ready yet; if selected, the result will be “uncertain”.',
    cloneEngineer: (tiles: string, n: number, where: string) =>
      `Coverage only ${tiles} · ${n} precomputed coordinates: ${where} (panel/antenna 4 m, 200 km). PGDA 100 DEM clones; conservative = clone p95. Other locations → CLONE_NOT_PRECOMPUTED / GRAY.`,
    clonePublic: (tiles: string, n: number, where: string) =>
      `A test with 100 different NASA terrain-map samples. It currently works only on the ${tiles} tile, at ${n} prepared coordinates: ${where}. At other locations the result is “uncertain”.`,
    serverPrefix: (message: string) => `Server: ${message}`,
    datasetLabel: 'NASA LOLA terrain layer (dataset)',
    datasetHint: (resolution: number, region: string | null | undefined, note: string) =>
      `${resolution} m/pixel${region ? ` · PGDA region name: ${region}` : ''} · ${note}`,
    datasetHintNone: 'The layer list comes from the /sites endpoint.',
    available: '· available',
    needsDownload: '· needs download',
    layerListUnavailable: '(layer list unavailable)',
    missingFileEngineer: (path: string, code: ReactNode) =>
      <>This layer’s file is not on the server ({path}). An analysis request is rejected with {code}; no result is invented.</>,
    missingFilePublic: 'Terrain data for this layer is not available yet; no analysis can be started with this layer (no result is invented). Choose a layer whose terrain data is available.',
    technicalDetails: 'Technical details',
    code: 'Code:',
    expectedFile: 'expected file:',
    tileNote: (w: string, h: string, lat0: string, lat1: string, outside: ReactNode) =>
      <>This DEM tile is {w} × {h} km; latitude {lat0}° … {lat1}°. The coordinate must be inside this tile; outside it, {outside}.</>,
    tileOutsideEngineer: (code: ReactNode) => <>the analysis returns {code}</>,
    tileOutsidePublic: 'no analysis is possible because this layer has no terrain data there',
    fillTileCentre: (lat: string, lon: string) => `Fill in the tile centre (${lat}°, ${lon}°)`,
    tileCentreNote: '— the centre of the raster coverage; not an official landing site.',
    latLabel: 'Latitude (°, planetocentric)',
    latHint: '−90 … −80 (south polar region)',
    lonLabel: 'Longitude (°, east-positive)',
    noOfficialCandidate: 'No ready-made “official candidate” coordinate is offered: unverified Shackleton / Connecting Ridge / NASA candidate coordinates are not invented. Enter your coordinate in the Moon Mean-Earth (ME) frame.',
    fillExample: 'Fill in the documented example coordinate (−89.54°, 0°)',
    exampleOnly: '— an example only, not an official candidate.',
    dateLabel: 'Landing date (UTC)',
    timeLabel: 'Landing time (UTC, 24-hour)',
    timeHint: 'The browser time zone is not used; the value entered is taken as UTC.',
    timeToSend: 'Time to be sent:',
    invalid: 'invalid',
    durationLabel: 'Mission duration (hours)',
    durationHint: '0 < duration ≤ 720',
    shiftsLegend: 'Landing slip scenarios (hours)',
    hoursUnit: 'h',
    shiftsHint: '+0 is always computed. More slips can also be requested later from the Timeline.',
    bufferLabel: 'Buffer (hours)',
    bufferHintPublic: 'Safety margin added after the mission (0 … 168 h)',
    stepLabel: 'Time step (minutes)',
    stepHintEngineer: '10 … 120, integer',
    stepHintPublic: 'How often the calculation is done, in minutes (10 … 120)',
    radiusLabel: 'Horizon scan radius (km)',
    radiusHintEngineer: '10 … 200. 200 km is the reference; < 200 km (e.g. the 135 km quick mode) can only lower the horizon → the result is at best YELLOW (REDUCED_HORIZON_RADIUS; V-05: differences up to 0.76°). Scan distance is not proof of completeness.',
    radiusHintPublic: '10 … 200. 200 km is the full scan; 135 km is faster but can miss distant mountains, so a “suitable” (GREEN) decision is only given with 200 km.',
    setRadius: (r: number) => `Set radius to ${r} km`,
    errKLabel: 'ERR multiplier k',
    errKHint: '0 … 3 (obstacle +kσ, observer −kσ)',
    darkLabel: 'Darkness threshold (Sun-disk visible fraction ≤)',
    darkHint: '0 … 0.1; e.g. 0.01 = 1% of the disk',
    slopeLabel: 'Maximum slope (°, optional)',
    slopeHint: 'Needs a ≤ 20 m DEM (the 5 m site DEMs qualify); otherwise SLOPE_UNKNOWN → GRAY. Slope is not landing safety.',
    footprintLabel: 'Slope footprint radius (m)',
    sunHeightLabel: 'Solar panel height (m, above the surface)',
    earthHeightLabel: 'DTE antenna height (m, above the surface)',
    heightHint: '0 … 100 m; suggestions 1 / 4 / 40 m',
    metres: (h: number) => `${h} ${h === 1 ? 'metre' : 'metres'}`,
    constraints: {
      max_darkness_hours: { eng: 'Maximum continuous darkness (hours)', pub: 'At most how many hours can it stay in darkness?', hint: '0 … 720 hours' },
      min_sun_fraction_pct: { eng: 'Minimum mean Sun-disk visibility (%)', pub: 'At least what percentage should the Sun be visible?', hint: '0 … 100 % (not electrical power generation)' },
      min_dte_fraction_pct: { eng: 'Minimum DTE line-of-sight share (%)', pub: 'At least what percentage should Earth be visible?', hint: 'Geometric line of sight to Earth’s centre; not an RF link' },
      max_dte_gap_hours: { eng: 'Maximum continuous DTE outage (hours)', pub: 'At most how many hours may Earth be out of sight?', hint: '0 … 720 hours' },
    } as Record<ConstraintKey, { eng: string; pub: string; hint: string }>,
    nominalEngineer: 'DEM only. Cannot produce GREEN on its own (GRAY at best).',
    nominalPublic: 'Quick preview: the terrain map alone. It cannot say “suitable” on its own; at best the result is “uncertain”.',
    errEngineerAvailable: 'ERR layer available. ±k sensitivity scenario; not a statistical confidence interval.',
    errEngineerMissing: 'No ERR file for this layer → the result will be GRAY.',
    errPublicAvailable: 'The mountains are tried slightly higher and lower using NASA’s terrain error map. Required for a “suitable” decision; not a statistical confidence interval.',
    errPublicMissing: 'There is no error map for this terrain layer; if selected, the result will be “uncertain”.',
    recommended: 'Recommended',
    uncertaintyMode: 'Uncertainty mode',
    loadTitle: 'Estimated computation load (not a time promise)',
    load: (points: ReactNode, scenarios: ReactNode, total: ReactNode) =>
      <>Time series: {points} samples × {scenarios} scenarios{total !== null && <> = {total} Sun/Earth positions (limit 12000)</>}.</>,
    horizonLoad: (profiles: ReactNode, sameHeights: boolean) =>
      <>Horizon: 3600 azimuths × {profiles} profiles{sameHeights ? ' (panel and antenna at the same height → one profile)' : ''}; ~1270 DEM samples per ray at 200 km. The first computation can take minutes depending on the DEM and the disk; identical parameters come from the cache.</>,
    body: '(body)',
    queued: (id: ReactNode) =>
      <>Analysis queued (HTTP 202): {id}. Its status is tracked in the list on the right. For a comparison, change only the location and submit again.</>,
    submitting: 'Submitting…',
    start: 'Start analysis',
    cockpitEyebrow: 'POST /analyses · mission input',
    cockpitTitle: 'Mission definition — all parameters',
    bodyValid: 'body valid',
    fieldsPending: (n: number) => `${n} ${n === 1 ? 'field' : 'fields'} pending`,
    legendSite: '1 · Location and terrain data',
    moduleSite: '01 · Location / DEM',
    frameLine: 'planetocentric, east-positive',
    radiusLine: 'r = R_ref + (h_DEM + h_obs)/1000; h_DEM comes from the API with the result.',
    legendTime: '2 · Time (UTC)',
    moduleTime: '02 · Time (UTC)',
    legendObserver: '3 · Observer and horizon',
    moduleObserver: '03 · Observer / horizon',
    legendUncertainty: '4 · Uncertainty',
    moduleUncertainty: '04 · Uncertainty',
    legendConstraints: '5 · Mission constraints',
    moduleConstraints: '05 · Mission constraints',
    constraintsNote: 'The defaults are documented example values, not mission limits recommended by NASA. A constraint left empty is not evaluated.',
    bodyPreview: 'Request body preview (POST /analyses, JSON)',
    bodyNotBuilt: 'Body cannot be built yet:',
    resetForm: 'Reset form',
    summaryLabels: { site: 'Location', time: 'Time', needs: 'Needs', equipment: 'Equipment', uncertainty: 'Uncertainty' },
    noCoordinate: 'no coordinate entered',
    timeSummary: (iso: string, duration: string, shifts: string) => `${iso} · ${duration} h mission · slips ${shifts} h`,
    darkSummary: (v: string) => `darkness ≤ ${v} h`,
    sunSummary: (v: string) => `Sun ≥ ${v}%`,
    earthSummary: (v: string) => `Earth ≥ ${v}%`,
    gapSummary: (v: string) => `Earth outage ≤ ${v} h`,
    noConstraints: 'no constraints',
    equipmentSummary: (panel: string, antenna: string) => `panel ${panel} m · antenna ${antenna} m above the ground`,
    advBuffer: (v: string) => `buffer ${v} h`,
    advStep: (v: string) => `step ${v} min`,
    advSlope: (v: string | null) => `slope ${v ? `≤ ${v}°` : 'not evaluated'}`,
    stepEyebrow: (n: number, total: number, title: string) => `Step ${n} / ${total} · ${title}`,
    explorerMode: 'Explorer mode',
    wizardTitle: 'Mission Wizard',
    wizardIntro: 'A landing-window analysis with real NASA data in 4 steps.',
    exploreTiles: 'Explore: NASA’s 5 m resolution terrain tiles',
    tileCentre: (w: string, h: string) => `${w} × ${h} km tile centre`,
    tileCentreHint: 'The tile centre is the centre of the PGDA raster coverage; it is not an official NASA landing candidate. Region names come from the PGDA LOLA 5 m README.',
    equipmentHeight: 'Equipment height',
    equipmentHint: 'How high above the ground are the solar panel and the Earth-facing antenna? The higher they are, the less nearby hills get in the way.',
    uncertaintyQuestion: 'How should terrain uncertainty be taken into account?',
    missionSummary: 'Mission summary',
    edit: 'Edit',
    advanced: 'Advanced mission settings',
    fieldNeedsFix: ' · a field needs fixing',
    back: 'Back',
    next: (title: string) => `Next: ${title}`,
    startHint: 'The next steps are pre-filled with example values; after entering the location you can press “Start analysis” at any step.',
  },
  tr: {
    steps: {
      site: {
        title: 'Konum', question: 'Ay’ın güney kutbunda nereyi inceleyelim?',
        intro: 'Bir NASA LOLA arazi haritası seçin ve koordinatı girin. Koordinat Ay’ın güney kutbu bölgesinde (−80° … −90° enlem) olmalı.',
      },
      time: {
        title: 'Zaman', question: 'İniş ne zaman, görev ne kadar sürecek?',
        intro: 'Tüm zamanlar UTC’dir; tarayıcınızın saat dilimi kullanılmaz. İnişin birkaç gün gecikmesi durumunu da aynı anda deneyebiliriz.',
      },
      needs: {
        title: 'İhtiyaçlar', question: 'Görevin Güneş’e ve Dünya’ya ne kadar ihtiyacı var?',
        intro: 'Aracın dayanabileceği karanlık süresini ve Dünya ile doğrudan görüş ihtiyacını yazın. Varsayılanlar yalnızca örnektir; NASA önerisi değildir.',
      },
      review: {
        title: 'Kontrol', question: 'Belirsizliği seçin, özeti kontrol edin ve başlatın',
        intro: 'Arazi haritalarının da ölçüm hatası vardır. “Uygun” kararı yalnızca bu hata hesaba katıldığında da kısıtlar sağlanıyorsa verilir.',
      },
    },
    cloneNoneEngineer: (detail: string) => `Ön hesaplanmış clone profili yok${detail} → CLONE_NOT_PRECOMPUTED / GRAY.`,
    cloneNoneDetail: (complete: string, sets: number) => ` (tam clone seti: ${complete || 'yok'}; profil seti: ${sets})`,
    cloneNonePublic: 'Bu yöntem için NASA klon verisi henüz hazır değil; seçilirse sonuç “belirsiz” olur.',
    cloneEngineer: (tiles: string, n: number, where: string) =>
      `Kapsam yalnız ${tiles} · ön hesaplanmış ${n} koordinat: ${where} (panel/anten 4 m, 200 km). PGDA 100 DEM clone; ihtiyatlı = clone p95. Diğer konumlarda CLONE_NOT_PRECOMPUTED / GRAY.`,
    clonePublic: (tiles: string, n: number, where: string) =>
      `NASA’nın 100 farklı arazi haritası örneğiyle sınama. Şu an yalnız ${tiles} karosunda, önceden hazırlanmış ${n} koordinatta çalışır: ${where}. Diğer konumlarda sonuç “belirsiz” olur.`,
    serverPrefix: (message: string) => `Sunucu: ${message}`,
    datasetLabel: 'NASA LOLA arazi katmanı (dataset)',
    datasetHint: (resolution: number, region: string | null | undefined, note: string) =>
      `${resolution} m/piksel${region ? ` · PGDA bölge adı: ${region}` : ''} · ${note}`,
    datasetHintNone: 'Katman listesi /sites uç noktasından gelir.',
    available: '· mevcut',
    needsDownload: '· indirilmeli',
    layerListUnavailable: '(katman listesi alınamadı)',
    missingFileEngineer: (path: string, code: ReactNode) =>
      <>Bu katmanın dosyası sunucuda yok ({path}). Analiz isteği {code} ile reddedilir; sonuç uydurulmaz.</>,
    missingFilePublic: 'Bu katman için arazi verisi henüz mevcut değil; bu katmanla analiz başlatılamaz (sonuç uydurulmaz). Arazi verisi mevcut olan bir katman seçin.',
    technicalDetails: 'Teknik detaylar',
    code: 'Kod:',
    expectedFile: 'beklenen dosya:',
    tileNote: (w: string, h: string, lat0: string, lat1: string, outside: ReactNode) =>
      <>Bu DEM karosu {w} × {h} km; enlem {lat0}° … {lat1}°. Koordinat bu karonun içinde olmalı; dışındaysa {outside}.</>,
    tileOutsideEngineer: (code: ReactNode) => <>analiz {code} döner</>,
    tileOutsidePublic: 'bu katmanda arazi verisi olmadığı için analiz yapılamaz',
    fillTileCentre: (lat: string, lon: string) => `Karonun merkezini doldur (${lat}°, ${lon}°)`,
    tileCentreNote: '— raster kapsamının merkezidir; resmi iniş noktası değildir.',
    latLabel: 'Enlem (°, planetosentrik)',
    latHint: '−90 … −80 (güney kutbu bölgesi)',
    lonLabel: 'Boylam (°, doğu-pozitif)',
    noOfficialCandidate: 'Hazır “resmi aday” koordinatı sunulmaz: kaynağı doğrulanmamış Shackleton / Connecting Ridge / NASA aday koordinatları uydurulmaz. Koordinatınızı Moon Mean-Earth (ME) çerçevesinde girin.',
    fillExample: 'Belgelerdeki örnek koordinatı doldur (−89.54°, 0°)',
    exampleOnly: '— yalnızca örnektir, resmi aday değildir.',
    dateLabel: 'İniş tarihi (UTC)',
    timeLabel: 'İniş saati (UTC, 24 saat)',
    timeHint: 'Tarayıcı saat dilimi kullanılmaz; girilen değer UTC kabul edilir.',
    timeToSend: 'Gönderilecek zaman:',
    invalid: 'geçersiz',
    durationLabel: 'Görev süresi (saat)',
    durationHint: '0 < süre ≤ 720',
    shiftsLegend: 'İniş kayma senaryoları (saat)',
    hoursUnit: 'sa',
    shiftsHint: '+0 her zaman hesaplanır. Ek kaymalar sonradan Zaman Çizelgesi’nden de istenebilir.',
    bufferLabel: 'Tampon (saat)',
    bufferHintPublic: 'Görev sonrasına eklenen emniyet süresi (0 … 168 sa)',
    stepLabel: 'Zaman adımı (dakika)',
    stepHintEngineer: '10 … 120, tam sayı',
    stepHintPublic: 'Hesabın kaç dakikada bir yapılacağı (10 … 120)',
    radiusLabel: 'Ufuk tarama yarıçapı (km)',
    radiusHintEngineer: '10 … 200. 200 km referans; < 200 km (ör. 135 km hızlı mod) ufku yalnız alçaltabilir → sonuç en fazla YELLOW (REDUCED_HORIZON_RADIUS; V-05: 0.76°’ye kadar fark). Tarama mesafesi eksiksizlik kanıtı değildir.',
    radiusHintPublic: '10 … 200. 200 km tam tarama; 135 km hızlıdır ama uzaktaki dağları kaçırabilir, bu yüzden “uygun” (GREEN) kararı yalnız 200 km ile verilir.',
    setRadius: (r: number) => `Yarıçapı ${r} km yap`,
    errKLabel: 'ERR çarpanı k',
    errKHint: '0 … 3 (engel +kσ, gözlemci −kσ)',
    darkLabel: 'Karanlık eşiği (Güneş diski görünür payı ≤)',
    darkHint: '0 … 0.1; örn. 0.01 = diskin %1’i',
    slopeLabel: 'Azami eğim (°, isteğe bağlı)',
    slopeHint: '≤ 20 m DEM gerekir (5 m site DEM’leri uygundur); yoksa SLOPE_UNKNOWN → GRAY. Eğim iniş güvenliği değildir.',
    footprintLabel: 'Eğim ayak izi yarıçapı (m)',
    sunHeightLabel: 'Güneş paneli yüksekliği (m, yüzey üstü)',
    earthHeightLabel: 'DTE anten yüksekliği (m, yüzey üstü)',
    heightHint: '0 … 100 m; öneriler 1 / 4 / 40 m',
    metres: (h: number) => `${h} metre`,
    constraints: {
      max_darkness_hours: { eng: 'Azami kesintisiz karanlık (saat)', pub: 'En fazla kaç saat karanlıkta kalınabilir?', hint: '0 … 720 saat' },
      min_sun_fraction_pct: { eng: 'Asgari ort. Güneş diski görünürlüğü (%)', pub: 'Güneş en az yüzde kaç görünmeli?', hint: '0 … 100 % (elektrik üretimi değildir)' },
      min_dte_fraction_pct: { eng: 'Asgari DTE görüş payı (%)', pub: 'Dünya en az yüzde kaç görünmeli?', hint: 'Dünya merkezi geometrik görüşü; RF bağlantısı değildir' },
      max_dte_gap_hours: { eng: 'Azami kesintisiz DTE kesintisi (saat)', pub: 'Dünya en fazla kaç saat görünmeyebilir?', hint: '0 … 720 saat' },
    },
    nominalEngineer: 'Yalnız DEM. Tek başına GREEN üretemez (en iyi durumda GRAY).',
    nominalPublic: 'Hızlı ön bakış: yalnız arazi haritasının kendisi. Tek başına “uygun” diyemez; sonuç en iyi durumda “belirsiz” olur.',
    errEngineerAvailable: 'ERR katmanı mevcut. ±k duyarlılık senaryosu; istatistiksel güven aralığı değildir.',
    errEngineerMissing: 'Bu katman için ERR dosyası yok → sonuç GRAY olur.',
    errPublicAvailable: 'NASA’nın arazi hata haritasıyla dağlar biraz yükseltilip alçaltılarak denenir. “Uygun” kararı için gereklidir; istatistiksel güven aralığı değildir.',
    errPublicMissing: 'Bu arazi katmanı için hata haritası yok; seçilirse sonuç “belirsiz” olur.',
    recommended: 'Önerilen',
    uncertaintyMode: 'Belirsizlik modu',
    loadTitle: 'Tahmini hesap yükü (süre vaadi değildir)',
    load: (points: ReactNode, scenarios: ReactNode, total: ReactNode) =>
      <>Zaman serisi: {points} örnek × {scenarios} senaryo{total !== null && <> = {total} Güneş/Dünya konumu (sınır 12000)</>}.</>,
    horizonLoad: (profiles: ReactNode, sameHeights: boolean) =>
      <>Ufuk: 3600 azimut × {profiles} profil{sameHeights ? ' (panel ve anten aynı yükseklikte → tek profil)' : ''}; 200 km’de ışın başına ~1270 DEM örneği. İlk hesap DEM ve diske bağlı olarak dakikalar sürebilir; aynı parametreler önbellekten gelir.</>,
    body: '(gövde)',
    queued: (id: ReactNode) =>
      <>Analiz kuyruğa alındı (HTTP 202): {id}. Durum sağdaki listede izleniyor. Karşılaştırma için yalnızca konumu değiştirip tekrar gönderin.</>,
    submitting: 'Gönderiliyor…',
    start: 'Analizi başlat',
    cockpitEyebrow: 'POST /analyses · görev girdisi',
    cockpitTitle: 'Görev tanımı — tüm parametreler',
    bodyValid: 'gövde geçerli',
    fieldsPending: (n: number) => `${n} alan bekliyor`,
    legendSite: '1 · Konum ve arazi verisi',
    moduleSite: '01 · Konum / DEM',
    frameLine: 'planetosentrik, doğu-pozitif',
    radiusLine: 'r = R_ref + (h_DEM + h_obs)/1000; h_DEM sonuçla birlikte API’den gelir.',
    legendTime: '2 · Zaman (UTC)',
    moduleTime: '02 · Zaman (UTC)',
    legendObserver: '3 · Gözlemci ve ufuk',
    moduleObserver: '03 · Gözlemci / ufuk',
    legendUncertainty: '4 · Belirsizlik',
    moduleUncertainty: '04 · Belirsizlik',
    legendConstraints: '5 · Görev kısıtları',
    moduleConstraints: '05 · Görev kısıtları',
    constraintsNote: 'Varsayılanlar belgelerdeki örnek değerlerdir; NASA tarafından önerilmiş görev sınırları değildir. Boş bırakılan kısıt değerlendirilmez.',
    bodyPreview: 'İstek gövdesi önizlemesi (POST /analyses, JSON)',
    bodyNotBuilt: 'Gövde henüz oluşturulamadı:',
    resetForm: 'Formu sıfırla',
    summaryLabels: { site: 'Konum', time: 'Zaman', needs: 'İhtiyaçlar', equipment: 'Ekipman', uncertainty: 'Belirsizlik' },
    noCoordinate: 'koordinat girilmedi',
    timeSummary: (iso: string, duration: string, shifts: string) => `${iso} · ${duration} sa görev · kaymalar ${shifts} sa`,
    darkSummary: (v: string) => `karanlık ≤ ${v} sa`,
    sunSummary: (v: string) => `Güneş ≥ %${v}`,
    earthSummary: (v: string) => `Dünya ≥ %${v}`,
    gapSummary: (v: string) => `Dünya kesintisi ≤ ${v} sa`,
    noConstraints: 'kısıt yok',
    equipmentSummary: (panel: string, antenna: string) => `panel ${panel} m · anten ${antenna} m yükseklikte`,
    advBuffer: (v: string) => `tampon ${v} sa`,
    advStep: (v: string) => `adım ${v} dk`,
    advSlope: (v: string | null) => `eğim ${v ? `≤ ${v}°` : 'değerlendirilmiyor'}`,
    stepEyebrow: (n: number, total: number, title: string) => `Adım ${n} / ${total} · ${title}`,
    explorerMode: 'Keşif modu',
    wizardTitle: 'Görev Sihirbazı',
    wizardIntro: '4 adımda gerçek NASA verisiyle bir iniş penceresi analizi.',
    exploreTiles: 'Keşfet: NASA’nın 5 m çözünürlüklü arazi karoları',
    tileCentre: (w: string, h: string) => `${w} × ${h} km karo merkezi`,
    tileCentreHint: 'Karo merkezi, PGDA raster kapsamının merkezidir; NASA’nın resmi iniş adayı değildir. Bölge adları PGDA LOLA 5 m README’sinden gelir.',
    equipmentHeight: 'Ekipman yüksekliği',
    equipmentHint: 'Güneş paneli ve Dünya’ya bakan anten yerden ne kadar yüksekte? Yükseldikçe yakındaki tepeler daha az engel olur.',
    uncertaintyQuestion: 'Arazi belirsizliği nasıl hesaba katılsın?',
    missionSummary: 'Görev özeti',
    edit: 'Düzenle',
    advanced: 'Gelişmiş görev ayarları',
    fieldNeedsFix: ' · düzeltilmesi gereken alan var',
    back: 'Geri',
    next: (title: string) => `İleri: ${title}`,
    startHint: 'Sonraki adımlar örnek değerlerle hazırdır; konumu girdikten sonra dilediğiniz adımda “Analizi başlat” diyebilirsiniz.',
  },
});
type Str = (typeof STR)['en'];

function stepOf(key: ErrorKey): WizardStep {
  return WIZARD_STEPS.find((s) => s.keys.includes(key))?.key ?? 'review';
}

function Field({ id, label, hint, error, compact = false, children }: {
  id: string; label: string; hint?: ReactNode; error?: string; compact?: boolean; children: ReactNode;
}) {
  return (
    <div className="min-w-0">
      <label htmlFor={id} className={compact ? 'label-term' : 'label'}>{label}</label>
      {children}
      {hint && <p id={`${id}-hint`} className={compact ? 'hint-term' : 'hint'}>{hint}</p>}
      {error && (
        <p id={`${id}-error`} className="mt-1 flex items-center gap-1 text-xs font-medium text-stop">
          <Icon name="alert" className="h-3.5 w-3.5" /> {error}
        </p>
      )}
    </div>
  );
}

function describedBy(id: string, hint: boolean, error?: string) {
  return [hint ? `${id}-hint` : '', error ? `${id}-error` : ''].filter(Boolean).join(' ') || undefined;
}

/** Clone option help: real clone-file counts from /health; never claims availability it does not report. */
function cloneHelp(health: Health | null, engineer: boolean, s: Str): string {
  const c = health?.clones;
  const complete = c ? Object.values(c.sites).filter((x) => x.complete).map((x) => x.site_tile) : [];
  if (!c || complete.length === 0 || c.precomputed_profile_sets === 0) {
    return engineer
      ? s.cloneNoneEngineer(c ? s.cloneNoneDetail(complete.join(', '), c.precomputed_profile_sets) : '')
      : s.cloneNonePublic;
  }
  const where = (c.profile_sets ?? []).map((p) => `(${p.latitude}, ${p.longitude})`).join(', ');
  return engineer
    ? s.cloneEngineer(complete.join(', '), c.precomputed_profile_sets, where || '—')
    : s.clonePublic(complete.join(', '), c.precomputed_profile_sets, where || '—');
}

function parsed(v: string): number | null {
  if (v.trim() === '') return null;
  const n = Number(v.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

export function MissionForm({ sites, health, onQueued }: { sites: SitesResponse | null; health: Health | null; onQueued?: (id: string) => void }) {
  const { register, mode } = useApp();
  const engineer = mode === 'engineer';
  const s = useStrings(STR);
  const { lang } = useLang();
  const uid = useId();
  const [form, setForm] = useState<Form>(DEFAULT_FORM);
  const [touched, setTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<unknown>(null);
  const [serverFieldErrors, setServerFieldErrors] = useState<FieldErrors>({});
  const [lastQueued, setLastQueued] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [step, setStep] = useState<WizardStep>('site');
  const [visited, setVisited] = useState<Set<WizardStep>>(() => new Set<WizardStep>(['site']));
  const focusStepHeading = useRef(false);
  const stepHeadings = useRef<Partial<Record<WizardStep, HTMLHeadingElement | null>>>({});

  // `lang` only changes the wording of validation messages, never the request body.
  const built = useMemo(() => buildRequest(form, lang), [form, lang]);
  const errors: FieldErrors = touched ? { ...built.errors, ...serverFieldErrors } : serverFieldErrors;
  const advancedHasError = ADVANCED_FIELDS.some((k) => Boolean(errors[k]));
  const set = <K extends keyof Form>(key: K, value: Form[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setServerFieldErrors((e) => ({ ...e, [key]: undefined }));
  };
  const id = (name: string) => `${uid}-${name}`;

  // Move focus to the new step's heading after a user-initiated step change (not on first render).
  useEffect(() => {
    if (!focusStepHeading.current) return;
    focusStepHeading.current = false;
    stepHeadings.current[step]?.focus();
  }, [step]);

  const goTo = (next: WizardStep, focusHeading = true) => {
    focusStepHeading.current = focusHeading;
    setStep(next);
    setVisited((v) => new Set(v).add(next));
  };

  const site = sites?.sites.find((s) => s.id === form.dataset_id) ?? null;
  const layer = health?.layers?.[form.dataset_id];
  const errAvailable = site?.uncertainty_err_available ?? layer?.err ?? false;
  const isoPreview = utcPartsToIso(form.landing_date, form.landing_time);
  const sameHeights = form.sun_observer_height_m.trim() === form.earth_observer_height_m.trim();
  const profileCount = (sameHeights ? 1 : 2) * (form.uncertainty_mode === 'err' ? 3 : 1);

  const focusField = (key: ErrorKey) => setTimeout(() => document.getElementById(id(key))?.focus(), 0);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setTouched(true);
    setServerError(null);
    setServerFieldErrors({});
    if (!built.input) {
      const first = Object.keys(built.errors)[0] as ErrorKey | undefined;
      if (first && ADVANCED_FIELDS.includes(first as keyof Form)) setAdvancedOpen(true);
      if (first && !engineer) goTo(stepOf(first), false);
      if (first) focusField(first);
      return;
    }
    setSubmitting(true);
    try {
      const queued = await api.createAnalysis(built.input);
      register(queued.analysis_id, built.input);
      setLastQueued(queued.analysis_id);
      onQueued?.(queued.analysis_id);
    } catch (error) {
      setServerError(error);
      if (error instanceof ApiError && error.code === 'INVALID_INPUT') {
        const mapped: FieldErrors = {};
        for (const d of error.details) {
          const key = fieldForApiPath(d.field);
          if (key) mapped[key] = s.serverPrefix(d.message);
        }
        setServerFieldErrors(mapped);
        if (Object.keys(mapped).some((k) => ADVANCED_FIELDS.includes(k as keyof Form))) setAdvancedOpen(true);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const reset = () => {
    setForm(DEFAULT_FORM);
    setTouched(false);
    setServerError(null);
    setServerFieldErrors({});
    setStep('site');
    setVisited(new Set<WizardStep>(['site']));
  };

  /* ---------- wizard step navigation (Public) ---------- */
  const steps = WIZARD_STEPS.map((d) => ({ ...d, ...s.steps[d.key] }));
  const stepIndex = WIZARD_STEPS.findIndex((s) => s.key === step);
  const stepKeys = (k: WizardStep) => WIZARD_STEPS.find((s) => s.key === k)?.keys ?? [];
  const stepHasRawError = (k: WizardStep) => stepKeys(k).some((key) => Boolean(built.errors[key] || serverFieldErrors[key]));
  const stepStates = Object.fromEntries(WIZARD_STEPS.map((s) => {
    const state: StepState = s.key === step ? 'current'
      : stepKeys(s.key).some((key) => Boolean(errors[key])) ? 'error'
        : visited.has(s.key) && !stepHasRawError(s.key) ? 'done' : 'todo';
    return [s.key, state];
  })) as Record<WizardStep, StepState>;

  const nextStep = () => {
    const bad = stepKeys(step).filter((key) => Boolean(built.errors[key]));
    if (bad.length > 0) {
      setTouched(true);
      const focusable = bad.find((key) => document.getElementById(id(key)));
      if (focusable) focusField(focusable);
      return;
    }
    const next = WIZARD_STEPS[stepIndex + 1];
    if (next) goTo(next.key);
  };
  const prevStep = () => {
    const prev = WIZARD_STEPS[stepIndex - 1];
    if (prev) goTo(prev.key);
  };

  const numberInput = (name: keyof Form, props: { min?: number; max?: number; step?: number | 'any'; required?: boolean; hint?: boolean } = {}) => (
    <input
      id={id(name)}
      className={`input mono ${engineer ? 'input-term' : ''}`}
      inputMode="decimal"
      type="number"
      min={props.min}
      max={props.max}
      step={props.step ?? 'any'}
      required={props.required}
      value={form[name] as string}
      onChange={(e) => set(name, e.target.value as never)}
      aria-invalid={Boolean(errors[name])}
      aria-describedby={describedBy(id(name), props.hint ?? true, errors[name])}
    />
  );
  const c = engineer; // compact field styling in the cockpit

  /* ---------- shared field elements (rendered once, placed by layout) ---------- */
  const fDataset = (
    <Field compact={c} id={id('dataset_id')} label={s.datasetLabel} hint={site ? s.datasetHint(site.resolution_m, site.region_name, site.note) : s.datasetHintNone}>
      <select id={id('dataset_id')} className={`input ${c ? 'input-term' : ''}`} value={form.dataset_id} onChange={(e) => set('dataset_id', e.target.value)} aria-describedby={`${id('dataset_id')}-hint`}>
        {sites && sites.sites.length > 0 ? (
          sites.sites.map((x) => (
            <option key={x.id} value={x.id}>
              {x.id} · {x.resolution_m} m{x.region_name ? ` · ${x.region_name}` : ''} {x.available ? s.available : s.needsDownload}
            </option>
          ))
        ) : (
          <option value={form.dataset_id}>{form.dataset_id} {s.layerListUnavailable}</option>
        )}
      </select>
    </Field>
  );
  const datasetNotes = (
    <>
      {site && !site.available && (
        engineer ? (
          <p role="status" className="rounded-md border border-caution/50 bg-caution/10 p-2 font-mono text-[11px] text-caution">
            {s.missingFileEngineer(`${site.expected_folder}/${site.expected_file}`, <span className="mono">DEM_MISSING</span>)}
          </p>
        ) : (
          <div role="status" className="rounded-xl border border-caution/50 bg-caution/10 p-3 text-xs text-caution">
            <p>{s.missingFilePublic}</p>
            <details className="mt-1 text-muted">
              <summary className="cursor-pointer select-none rounded font-medium text-ink/80">{s.technicalDetails}</summary>
              <p className="mt-1">{s.code} <span className="mono text-ink">DEM_MISSING</span> · {s.expectedFile} <span className="mono break-all">{site.expected_folder}/{site.expected_file}</span></p>
            </details>
          </div>
        )
      )}
      {site?.available && site.footprint && !site.footprint.contains_pole && (
        <div className={`rounded-lg border border-line bg-panel-2 p-2 text-xs text-muted ${c ? 'font-mono text-[11px]' : ''}`}>
          <p>
            {s.tileNote(site.footprint.width_km.toFixed(1), site.footprint.height_km.toFixed(1), site.footprint.lat_range[0].toFixed(3),
              site.footprint.lat_range[1].toFixed(3), engineer ? s.tileOutsideEngineer(<span className="mono">DEM_MISSING</span>) : s.tileOutsidePublic)}
          </p>
          <button type="button" className="link mt-1" onClick={() => { set('latitude', String(site.footprint!.center.lat)); set('longitude', String(site.footprint!.center.lon)); }}>
            {s.fillTileCentre(site.footprint.center.lat.toFixed(4), site.footprint.center.lon.toFixed(4))}
          </button>{' '}{s.tileCentreNote}
        </div>
      )}
    </>
  );
  const fLat = (
    <Field compact={c} id={id('latitude')} label={s.latLabel} hint={s.latHint} error={errors.latitude}>
      {numberInput('latitude', { min: LIMITS.latitude.min, max: LIMITS.latitude.max, required: true })}
    </Field>
  );
  const fLon = (
    <Field compact={c} id={id('longitude')} label={s.lonLabel} hint="−180 … 180" error={errors.longitude}>
      {numberInput('longitude', { min: LIMITS.longitude.min, max: LIMITS.longitude.max, required: true })}
    </Field>
  );
  const exampleCoordinate = (
    <p className={`text-xs text-muted ${c ? 'font-mono text-[11px]' : ''}`}>
      {s.noOfficialCandidate}{' '}
      <button type="button" className="link" onClick={() => { set('latitude', '-89.54'); set('longitude', '0'); }}>
        {s.fillExample}
      </button>{' '}
      {s.exampleOnly}
    </p>
  );
  const fDate = (
    <Field compact={c} id={id('landing_date')} label={s.dateLabel} error={errors.landing_date}>
      <input id={id('landing_date')} type="date" className={`input mono ${c ? 'input-term' : ''}`} min="2026-01-01" max="2035-12-31" value={form.landing_date}
        onChange={(e) => set('landing_date', e.target.value)} aria-invalid={Boolean(errors.landing_date)} aria-describedby={describedBy(id('landing_date'), false, errors.landing_date)} />
    </Field>
  );
  const fTime = (
    <Field compact={c} id={id('landing_time')} label={s.timeLabel} hint={s.timeHint}>
      <input id={id('landing_time')} type="time" step={60} className={`input mono ${c ? 'input-term' : ''}`} value={form.landing_time}
        onChange={(e) => set('landing_time', e.target.value)} aria-describedby={`${id('landing_time')}-hint`} />
    </Field>
  );
  const isoLine = (
    <p className={`text-xs text-muted ${c ? 'font-mono text-[11px]' : ''}`}>
      {s.timeToSend} <span className="mono text-ink">{isoPreview ?? s.invalid}</span>
    </p>
  );
  const fDuration = (
    <Field compact={c} id={id('duration_hours')} label={s.durationLabel} hint={s.durationHint} error={errors.duration_hours}>
      {numberInput('duration_hours', { min: 0, max: 720 })}
    </Field>
  );
  const fShifts = (
    <fieldset>
      <legend className={c ? 'label-term' : 'label'}>{s.shiftsLegend}</legend>
      <div className="flex flex-wrap gap-2">
        {SHIFT_OPTIONS.map((shift) => {
          const checked = form.shifts.includes(shift);
          return (
            <label key={shift} className={`chip cursor-pointer border-line ${c ? 'px-2.5 py-1 font-mono text-xs' : 'px-3 py-1.5 text-sm'} ${checked ? 'border-accent/60 bg-accent/15 text-accent' : 'text-ink'}`}>
              <input type="checkbox" className="accent-[var(--color-accent)]" checked={checked} disabled={shift === 0}
                onChange={(e) => set('shifts', e.target.checked ? [...form.shifts, shift] : form.shifts.filter((x) => x !== shift))} />
              +{shift} {s.hoursUnit}
            </label>
          );
        })}
      </div>
      <p className={c ? 'hint-term' : 'hint'}>{s.shiftsHint}</p>
      {errors.shifts && <p className="mt-1 text-xs font-medium text-stop">{errors.shifts}</p>}
    </fieldset>
  );
  const fBuffer = (
    <Field compact={c} id={id('buffer_hours')} label={s.bufferLabel} hint={engineer ? '0 … 168' : s.bufferHintPublic} error={errors.buffer_hours}>
      {numberInput('buffer_hours', { min: 0, max: 168 })}
    </Field>
  );
  const fStep = (
    <Field compact={c} id={id('step_minutes')} label={s.stepLabel} hint={engineer ? s.stepHintEngineer : s.stepHintPublic} error={errors.step_minutes}>
      {numberInput('step_minutes', { min: 10, max: 120, step: 1 })}
    </Field>
  );
  const fRadius = (
    <Field compact={c} id={id('horizon_radius_km')} label={s.radiusLabel} hint={engineer ? s.radiusHintEngineer : s.radiusHintPublic} error={errors.horizon_radius_km}>
      <div className="flex gap-2">
        {numberInput('horizon_radius_km', { min: 10, max: 200 })}
        {[135, 200].map((r) => (
          <button key={r} type="button" className={`btn shrink-0 ${c ? 'min-h-8 px-2 py-1 font-mono text-xs' : ''}`} onClick={() => set('horizon_radius_km', String(r))} aria-label={s.setRadius(r)}>{r}</button>
        ))}
      </div>
    </Field>
  );
  const fErrK = form.uncertainty_mode === 'err' ? (
    <Field compact={c} id={id('err_k')} label={s.errKLabel} hint={s.errKHint} error={errors.err_k}>
      {numberInput('err_k', { min: 0, max: 3 })}
    </Field>
  ) : null;
  const fDark = (
    <Field compact={c} id={id('dark_fraction_threshold')} label={s.darkLabel} hint={s.darkHint} error={errors.dark_fraction_threshold}>
      {numberInput('dark_fraction_threshold', { min: 0, max: 0.1 })}
    </Field>
  );
  const fSlope = (
    <Field compact={c} id={id('max_slope_deg')} label={s.slopeLabel} hint={s.slopeHint} error={errors.max_slope_deg}>
      {numberInput('max_slope_deg', { min: 0, max: 90 })}
    </Field>
  );
  const fFootprint = (
    <Field compact={c} id={id('slope_footprint_radius_m')} label={s.footprintLabel} hint="5 … 200" error={errors.slope_footprint_radius_m}>
      {numberInput('slope_footprint_radius_m', { min: 5, max: 200 })}
    </Field>
  );
  const fHeights = (['sun_observer_height_m', 'earth_observer_height_m'] as const).map((key) => (
    <Field compact={c} key={key} id={id(key)} label={key === 'sun_observer_height_m' ? s.sunHeightLabel : s.earthHeightLabel} hint={s.heightHint} error={errors[key]}>
      <div className="flex gap-2">
        {numberInput(key, { min: 0, max: 100 })}
        {HEIGHT_PRESETS.map((h) => (
          <button key={h} type="button" className={`btn shrink-0 px-2 ${c ? 'min-h-8 py-1 font-mono text-xs' : ''}`} onClick={() => set(key, String(h))} aria-label={s.metres(h)}>{h}</button>
        ))}
      </div>
    </Field>
  ));
  const constraintFields: { key: ConstraintKey; eng: string; pub: string; hint: string; icon: IconName; tone: string; max: number }[] = ([
    { key: 'max_darkness_hours', icon: 'moon', tone: 'text-violet', max: 720 },
    { key: 'min_sun_fraction_pct', icon: 'sun', tone: 'text-sun', max: 100 },
    { key: 'min_dte_fraction_pct', icon: 'earth', tone: 'text-earth', max: 100 },
    { key: 'max_dte_gap_hours', icon: 'satellite', tone: 'text-earth', max: 720 },
  ] as const).map((f) => ({ ...f, ...s.constraints[f.key] }));
  const fConstraint = (f: (typeof constraintFields)[number]) => (
    <Field compact={c} id={id(f.key)} label={engineer ? f.eng : f.pub} hint={f.hint} error={errors[f.key]}>
      {numberInput(f.key, { min: 0, max: f.max })}
    </Field>
  );
  const uncertaintyOptions: [UncertaintyMode, string, string, string | null][] = [
    ['nominal', 'Nominal', engineer ? s.nominalEngineer : s.nominalPublic, null],
    ['err', 'ERR ±k', engineer
      ? (errAvailable ? s.errEngineerAvailable : s.errEngineerMissing)
      : (errAvailable ? s.errPublicAvailable : s.errPublicMissing),
      errAvailable && !engineer ? s.recommended : null],
    ['clone', 'DEM clone', cloneHelp(health, engineer, s), null],
  ];
  const fUncertainty = (
    <div role="radiogroup" aria-label={s.uncertaintyMode} className={`grid gap-2 ${engineer ? 'sm:grid-cols-3' : ''}`}>
      {uncertaintyOptions.map(([value, label, help, badge]) => {
        const checked = form.uncertainty_mode === value;
        return (
          <label key={value} className={`cursor-pointer rounded-xl border transition ${c ? 'p-2 text-xs' : 'p-3 text-sm'} ${checked ? 'border-accent/70 bg-accent/10 shadow-[0_0_18px_-10px_var(--color-neon)]' : 'border-line bg-panel-2 hover:border-line-strong'}`}>
            <span className={`flex items-center gap-2 font-medium ${c ? 'font-mono' : ''}`}>
              <input type="radio" name={id('mode')} value={value} checked={checked} onChange={() => set('uncertainty_mode', value)} />
              {label}
              {badge && <span className="chip border-go/50 text-go">{badge}</span>}
            </span>
            <span className={`mt-1 block text-muted ${c ? 'font-mono text-[10.5px] leading-snug' : 'text-xs'}`}>{help}</span>
          </label>
        );
      })}
    </div>
  );

  const loadBox = (
    <div className={`rounded-xl border border-line p-3 text-xs text-muted ${c ? 'term font-mono text-[11px]' : 'bg-panel-2'}`} aria-live="polite">
      <p className="font-semibold text-ink">{s.loadTitle}</p>
      <p>
        {s.load(<span className="mono text-ink">{built.points ?? '—'}</span>, <span className="mono text-ink">{built.scenarioCount}</span>,
          built.points !== null ? <span className="mono text-ink">{built.points * built.scenarioCount}</span> : null)}
      </p>
      {engineer && <p>{s.horizonLoad(<span className="mono text-ink">{profileCount}</span>, sameHeights)}</p>}
      {errors.budget && <p className="mt-1 font-medium text-stop">{errors.budget}</p>}
    </div>
  );

  const feedback = (
    <>
      {serverError !== null && (
        <Notice explained={explainError(serverError)} focusOnMount>
          {engineer && serverError instanceof ApiError && serverError.details.length > 0 && (
            <ul className="mono list-inside list-disc text-xs">
              {serverError.details.map((d, i) => <li key={i}>{d.field ?? s.body}: {d.message}</li>)}
            </ul>
          )}
        </Notice>
      )}
      {lastQueued && serverError === null && (
        <p role="status" className="flex items-start gap-2 rounded-xl border border-go/40 bg-go/10 p-3 text-sm text-go">
          <Icon name="check" className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{s.queued(<span className="mono">{lastQueued.slice(0, 8)}</span>)}</span>
        </p>
      )}
    </>
  );

  const submitLabel = submitting ? <><Icon name="spinner" /> {s.submitting}</> : <><Icon name="rocket" /> {s.start}</>;

  /* =================================================================== Engineer: cockpit */
  if (engineer) {
    const lat = parsed(form.latitude);
    const lon = parsed(form.longitude);
    const unit = lat !== null && lon !== null && !built.errors.latitude && !built.errors.longitude ? latrecKm(1, lat, lon) : null;
    const invalidCount = Object.keys(built.errors).length;
    return (
      <form onSubmit={submit} noValidate className="space-y-3" aria-labelledby={id('title')}>
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <p className="eyebrow">{s.cockpitEyebrow}</p>
            <h2 id={id('title')} className="panel-title">{s.cockpitTitle}</h2>
          </div>
          <p className={`chip font-mono ${built.input ? 'border-go/50 text-go' : 'border-caution/50 text-caution'}`}>
            <span className="led" aria-hidden />
            {built.input ? s.bodyValid : s.fieldsPending(invalidCount)}
          </p>
        </div>

        <fieldset className="module space-y-2">
          <legend className="sr-only">{s.legendSite}</legend>
          <p className="module-title" aria-hidden><Icon name="pin" className="h-3.5 w-3.5" /> {s.moduleSite}</p>
          {fDataset}
          {datasetNotes}
          <div className="grid gap-2 sm:grid-cols-2">{fLat}{fLon}</div>
          <p className="font-mono text-[10.5px] leading-snug text-muted">
            {FRAME} · {s.frameLine} · R_ref {MOON_RADIUS_KM} km · û = {unit ? `(${unit.map((v) => v.toFixed(5)).join(', ')})` : '—'}
            <span className="block">{s.radiusLine}</span>
          </p>
          {exampleCoordinate}
        </fieldset>

        <fieldset className="module space-y-2">
          <legend className="sr-only">{s.legendTime}</legend>
          <p className="module-title" aria-hidden><Icon name="clock" className="h-3.5 w-3.5" /> {s.moduleTime}</p>
          <div className="grid gap-2 sm:grid-cols-2">{fDate}{fTime}</div>
          {isoLine}
          <div className="grid gap-2 sm:grid-cols-3">{fDuration}{fBuffer}{fStep}</div>
          {fShifts}
        </fieldset>

        <fieldset className="module space-y-2">
          <legend className="sr-only">{s.legendObserver}</legend>
          <p className="module-title" aria-hidden><Icon name="radar" className="h-3.5 w-3.5" /> {s.moduleObserver}</p>
          {fRadius}
          <div className="grid gap-2 sm:grid-cols-2">{fHeights}</div>
        </fieldset>

        <fieldset className="module space-y-2">
          <legend className="sr-only">{s.legendUncertainty}</legend>
          <p className="module-title" aria-hidden><Icon name="layers" className="h-3.5 w-3.5" /> {s.moduleUncertainty}</p>
          {fUncertainty}
          <div className="grid gap-2 sm:grid-cols-2">{fErrK}{fDark}</div>
        </fieldset>

        <fieldset className="module space-y-2">
          <legend className="sr-only">{s.legendConstraints}</legend>
          <p className="module-title" aria-hidden><Icon name="target" className="h-3.5 w-3.5" /> {s.moduleConstraints}</p>
          <p className="font-mono text-[10.5px] text-muted">{s.constraintsNote}</p>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {constraintFields.map((f) => <div key={f.key}>{fConstraint(f)}</div>)}
            {fSlope}
            {fFootprint}
          </div>
          {errors.constraints && <p className="text-xs font-medium text-stop">{errors.constraints}</p>}
        </fieldset>

        {loadBox}
        <details className="module text-[11px]">
          <summary className="cursor-pointer font-mono text-term">{s.bodyPreview}</summary>
          {built.input
            ? <pre className="mono mt-2 max-h-56 overflow-auto text-[11px] leading-snug text-ink">{JSON.stringify(built.input, null, 2)}</pre>
            : <p className="mt-2 font-mono text-caution">{s.bodyNotBuilt} {Object.keys(built.errors).join(', ')}</p>}
        </details>
        {feedback}
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" className="btn btn-primary" disabled={submitting}>{submitLabel}</button>
          <button type="button" className="btn" onClick={reset}>{s.resetForm}</button>
        </div>
      </form>
    );
  }

  /* =================================================================== Public: wizard */
  const sitePicks = (sites?.sites ?? []).filter((x): x is SiteLayer & { footprint: NonNullable<SiteLayer['footprint']> } =>
    x.kind === 'site' && x.available && Boolean(x.footprint));
  const lat = parsed(form.latitude);
  const lon = parsed(form.longitude);
  const modeLabel = uncertaintyOptions.find(([v]) => v === form.uncertainty_mode)?.[1] ?? form.uncertainty_mode;
  const L = s.summaryLabels;
  const summary: { step: WizardStep; icon: IconName; label: string; value: string }[] = [
    { step: 'site', icon: 'pin', label: L.site, value: `${lat !== null && lon !== null && !built.errors.latitude && !built.errors.longitude ? formatLatLon(lat, lon) : s.noCoordinate} · ${form.dataset_id}${site ? ` (${site.resolution_m} m)` : ''}` },
    { step: 'time', icon: 'clock', label: L.time, value: s.timeSummary(isoPreview ? isoPreview.replace('T', ' ').replace('Z', ' UTC') : s.invalid,
      form.duration_hours || '—', [...form.shifts].sort((a, b) => a - b).map((x) => `+${x}`).join(', ')) },
    { step: 'needs', icon: 'target', label: L.needs, value: [
      form.max_darkness_hours && s.darkSummary(form.max_darkness_hours), form.min_sun_fraction_pct && s.sunSummary(form.min_sun_fraction_pct),
      form.min_dte_fraction_pct && s.earthSummary(form.min_dte_fraction_pct), form.max_dte_gap_hours && s.gapSummary(form.max_dte_gap_hours),
    ].filter(Boolean).join(' · ') || s.noConstraints },
    { step: 'needs', icon: 'satellite', label: L.equipment, value: s.equipmentSummary(form.sun_observer_height_m || '—', form.earth_observer_height_m || '—') },
    { step: 'review', icon: 'layers', label: L.uncertainty, value: modeLabel },
  ];
  const advancedSummary = [
    s.advBuffer(form.buffer_hours || '—'), s.advStep(form.step_minutes || '—'), `${form.horizon_radius_km || '—'} km`,
    form.uncertainty_mode === 'err' ? `k ${form.err_k}` : null, s.advSlope(form.max_slope_deg || null),
  ].filter(Boolean).join(' · ');

  const panelFor = (k: WizardStep, body: ReactNode) => {
    const def = steps.find((x) => x.key === k)!;
    const n = steps.indexOf(def) + 1;
    return (
      <section key={k} hidden={step !== k} aria-labelledby={id(`step-${k}`)} className="space-y-4" data-step={k}>
        <div className="flex items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-accent/40 bg-[rgb(31_98_224/0.25)] text-neon shadow-[0_0_24px_-10px_var(--color-neon)]">
            <Icon name={def.icon} className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="eyebrow">{s.stepEyebrow(n, steps.length, def.title)}</p>
            <h3 id={id(`step-${k}`)} tabIndex={-1} ref={(el) => { stepHeadings.current[k] = el; }}
              className="font-display text-lg font-semibold leading-snug text-ink focus:outline-none sm:text-xl">{def.question}</h3>
            <p className="mt-1 text-sm text-muted">{def.intro}</p>
          </div>
        </div>
        {body}
      </section>
    );
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-5" aria-labelledby={id('title')}>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="eyebrow">{s.explorerMode}</p>
          <h2 id={id('title')} className="panel-title">{s.wizardTitle}</h2>
          <p className="text-sm text-muted">{s.wizardIntro}</p>
        </div>
      </div>
      <Stepper steps={steps} active={step} states={stepStates} onSelect={(k) => goTo(k)} />

      {panelFor('site', (
        <>
          {sitePicks.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium text-ink">{s.exploreTiles}</p>
              <ul className="grid gap-2 sm:grid-cols-2">
                {sitePicks.map((x) => {
                  const chosen = form.dataset_id === x.id && lat === x.footprint.center.lat && lon === x.footprint.center.lon;
                  return (
                    <li key={x.id}>
                      <button type="button" aria-pressed={chosen}
                        onClick={() => { set('dataset_id', x.id); set('latitude', String(x.footprint.center.lat)); set('longitude', String(x.footprint.center.lon)); }}
                        className={`flex w-full items-start gap-2 rounded-xl border p-2.5 text-left text-sm transition ${chosen ? 'border-accent/70 bg-accent/10' : 'border-line bg-panel-2 hover:border-line-strong'}`}>
                        <Icon name="moon" className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
                        <span className="min-w-0">
                          <span className="block font-medium text-ink">{x.region_name ?? x.id}</span>
                          <span className="mono block text-xs text-muted">{x.id} · {s.tileCentre(x.footprint.width_km.toFixed(1), x.footprint.height_km.toFixed(1))}</span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              <p className="hint">{s.tileCentreHint}</p>
            </div>
          )}
          {fDataset}
          {datasetNotes}
          <div className="grid gap-3 sm:grid-cols-2">{fLat}{fLon}</div>
          {exampleCoordinate}
        </>
      ))}

      {panelFor('time', (
        <>
          <div className="grid gap-3 sm:grid-cols-2">{fDate}{fTime}</div>
          {isoLine}
          {fDuration}
          {fShifts}
        </>
      ))}

      {panelFor('needs', (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            {constraintFields.map((f) => (
              <div key={f.key} className="rounded-xl border border-line bg-panel-2 p-3">
                <span className={`mb-1 flex ${f.tone}`} aria-hidden><Icon name={f.icon} className="h-5 w-5" /></span>
                {fConstraint(f)}
              </div>
            ))}
          </div>
          {errors.constraints && <p className="text-xs font-medium text-stop">{errors.constraints}</p>}
          <fieldset className="space-y-2 rounded-xl border border-line p-3">
            <legend className="px-1 text-sm font-semibold text-ink">{s.equipmentHeight}</legend>
            <p className="text-xs text-muted">{s.equipmentHint}</p>
            <div className="grid gap-3 sm:grid-cols-2">{fHeights}</div>
          </fieldset>
        </>
      ))}

      {panelFor('review', (
        <>
          <fieldset className="space-y-2">
            <legend className="label">{s.uncertaintyQuestion}</legend>
            {fUncertainty}
          </fieldset>
          <div className="rounded-xl border border-line bg-panel-2 p-3">
            <p className="mb-2 text-sm font-semibold text-ink">{s.missionSummary}</p>
            <dl className="space-y-1.5 text-sm">
              {summary.map((row) => (
                <div key={row.label} className="flex items-start gap-2">
                  <Icon name={row.icon} className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                  <dt className="w-24 shrink-0 text-muted">{row.label}</dt>
                  <dd className="min-w-0 flex-1 text-ink">{row.value}</dd>
                  {row.step !== 'review' && (
                    <button type="button" className="link shrink-0 text-xs" onClick={() => goTo(row.step)}>
                      {s.edit}<span className="sr-only">: {row.label}</span>
                    </button>
                  )}
                </div>
              ))}
            </dl>
          </div>
          {loadBox}
          <details
            className="rounded-xl border border-line bg-panel-2 p-3"
            open={advancedOpen || advancedHasError}
            onToggle={(e) => setAdvancedOpen((e.currentTarget as HTMLDetailsElement).open)}
            data-testid="advanced-settings"
          >
            <summary className="cursor-pointer text-sm font-semibold text-ink">
              {s.advanced}
              <span className="mt-0.5 block text-xs font-normal text-muted">{advancedSummary}{advancedHasError ? s.fieldNeedsFix : ''}</span>
            </summary>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {fBuffer}
              {fStep}
              <div className="sm:col-span-2">{fRadius}</div>
              {fErrK}
              {fDark}
              {fSlope}
              {fFootprint}
            </div>
          </details>
        </>
      ))}

      {feedback}
      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
        <button type="button" className="btn" onClick={prevStep} disabled={stepIndex === 0}>
          <Icon name="chevron-left" /> {s.back}
        </button>
        {stepIndex < WIZARD_STEPS.length - 1 && (
          <button type="button" className="btn btn-primary" onClick={nextStep}>
            {s.next(steps[stepIndex + 1]?.title ?? '')} <Icon name="chevron-right" />
          </button>
        )}
        <span className="flex-1" />
        <button type="button" className="btn" onClick={reset}>{s.resetForm}</button>
        <button type="submit" className={`btn ${stepIndex === WIZARD_STEPS.length - 1 ? 'btn-primary' : 'border-accent/60 text-accent'}`} disabled={submitting}>
          {submitLabel}
        </button>
      </div>
      <p className="hint -mt-2">{s.startHint}</p>
    </form>
  );
}
