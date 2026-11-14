# PROGRESS — Lunar Mission Window Analyzer

> Oturum devamlılık günlüğü (CLAUDE_HANDOFF.md §11.1). Yeni oturumda **ilk iş**: `CLAUDE.md`,
> `CLAUDE_DEVIR_TALIMATI.md` (+ §11 için `CLAUDE_HANDOFF.md`), bu dosya ve `git status` okunur;
> sonra buradaki iddialar gerçek dosyalar/süreçler/testlerle çapraz kontrol edilir.

## Son güncelleme
- **Zaman (UTC):** 2026-11-14T09:22Z
- **Faz:** Faz 0 DONE (84bf2f5) · Faz 1 DONE (1199213) · Faz 2 DONE (bu commit) → Faz 3 başlıyor
- **Alt adım:** Sky View + Timeline (Plotly) gerçek horizon/timeline ile
- **Durum:** IN_PROGRESS

## Tamamlanan iş
- Talimat dosyaları okundu: `CLAUDE.md`, `CLAUDE_DEVIR_TALIMATI.md` (§0–§10).
  **Not:** §11 (PROGRESS.md, Windows spawn, `--include-lola-240m`, deep-link, Dünya–Ay kartı)
  yalnızca `CLAUDE_HANDOFF.md` içinde var; HANDOFF = DEVIR + §11. Her ikisi de uygulanıyor.
- Backend kodu tamamen okundu: `config.py`, `download_data.py`, `astro_engine.py`,
  `terrain_engine.py`, `decision_engine.py`, `verify_horizons.py`, `main.py`, `tests/test_contract.py`.

## Ortam (gerçek komut çıktısı, 2026-11-14)
- Python 3.11.9 (Microsoft Store Python, kullanıcı site-packages; `.venv` yok)
- Node v24.14.0, npm 11.9.0, git 2.53.0.windows.2
- Paketler: spiceypy 8.4.0 (CSPICE_N0067), rasterio 1.4.4 (GDAL 3.10.3), pyproj 3.7.2,
  fastapi 0.136.3, pydantic 2.13.4, numpy 2.4.6, pytest 9.2.0, httpx 0.28.1, uvicorn 0.49.0
- **Gözlem:** İlk `import spiceypy` denemesi `RuntimeError: Could not locate or load CSPICE shared library`
  verdi; hemen ardından aynı komut başarılı oldu (`cspice.dll` doğrudan `ctypes.CDLL` ile de yüklendi).
  Geçici (muhtemelen yeni kurulan DLL'in antivirüs taraması). Tekrar görülürse `CSPICE_SHARED_LIB`
  ortam değişkeni ile DLL yolu verilebilir.
- Disk: C: 273 GB boş.

## Git durumu
- Depo zaten başlatılmış (`git init` gerekmedi). Tek commit: `f613c81 first` (yalnızca eski `backend/download_data.py`).
- Çalışma ağacında `backend/download_data.py` değişmiş, geri kalan backend/tests/doküman dosyaları izlenmiyor.
- `backend/* (1).py` dosyaları ilgili dosyaların **bayt bayt aynısı** (`cmp` ile doğrulandı) — tarayıcı
  kopyası olduğu değerlendiriliyor; commit edilmiyor, silinmedi (kullanıcı kararı).

## Dosya envanteri
| Yol | İşlem | Gerekçe |
|---|---|---|
| `PROGRESS.md` | oluşturuldu | §11.1 |
| `.gitignore` | sertleştirildi | data/, *.TIF/*.tif, *.bsp, *.bpc, kernel uzantıları, *.part, .venv/, node_modules/, __pycache__/, logs/ |
| `backend/astro_engine.py` | 2 satır düzeltme | SPICE(UNPARSEDTIME) — her analizi bozuyordu |
| `backend/verify_horizons.py` | ayrıştırıcı | gerçek Horizons AIRLESS başlıkları |
| `backend/download_data.py` | genişletildi | §11.3 `--include-lola-240m` (+ `-err`) |
| `backend/main.py` | v1.1 (eklemeli) | §11.2 spawn/timeout/kapanış, CORS, 422 details, /health katmanları, /sites rehberi, /validation |
| `backend/terrain_engine.py` | küçük | cache kotası, eşit yükseklik tek profil, POSIX `sources` yolu |
| `backend/config.py` | küçük | ANALYSIS_TIMEOUT_S, VALIDATION, 240 m EFFRES yolu |
| `tests/test_spice_time.py`, `test_download_lola.py`, `test_spawn_pool.py`, `test_api_v11.py` | yeni | 40 yeni test |
| `frontend/**` | yeni | React/Vite/TS/Tailwind/Plotly uygulaması |
| `frontend/src/test/fixtures/real_analysis_62e783c2.json` | yeni | GERÇEK API yanıtının kısaltılmış kopyası (UI testleri için; `_provenance` alanında açıklama) |

## Test kanıtları
| Komut | Tarih (UTC) | Çıkış | Sonuç |
|---|---|---|---|
| `python -m pytest -q` | 2026-11-14T08:39Z | 0 | 15 passed (başlangıç durumu) |
| `python -m backend.verify_horizons` | 08:39Z | 1 | FAIL SPICE(UNPARSEDTIME) → düzeltildi |
| `python -m backend.verify_horizons` | 08:40Z | 1 | FAIL başlık ayrıştırma → düzeltildi |
| `python -m backend.verify_horizons` | 08:40Z | 0 | all_passed=true (6 satır, maks 3.3e-7°) — `logs/verify_horizons_faz0.json` |
| `python -m pytest -q` | 09:21Z | 0 | 55 passed |
| `npm run build` (frontend) | 09:21Z | 0 | tsc + vite OK (ilk yük 286 kB JS; Plotly ayrı chunk) |
| `npm run lint` | 09:21Z | 0 | 0 sorun |
| `npx vitest run` | 09:21Z | 0 | 56 passed (7 dosya) |
| Gerçek uçtan uca analiz (API) | 09:08Z | — | `62e783c2…` completed < 1 dk; RED; ufuk 3600/3600 tam kapsama; `logs/first_real_analysis.json` |

## Veri durumu
| Dosya | Durum | Boyut (bayt) | Kaynak | Doğrulama |
|---|---|---|---|---|
| `data/spice/naif0012.tls` | PRESENT_UNVERIFIED | 5257 | naif.jpl.nasa.gov generic_kernels/lsk | başlık `KPL/` + yerel SHA-256 manifest ile eşleşti (yayıncı hash'i değil) |
| `data/spice/pck00011.tpc` | PRESENT_UNVERIFIED | 131226 | generic_kernels/pck | aynı |
| `data/spice/de440s.bsp` | PRESENT_UNVERIFIED | 32726016 | generic_kernels/spk/planets | `DAF/` başlık + yerel SHA-256 |
| `data/spice/moon_pa_de440_200625.bpc` | PRESENT_UNVERIFIED | 12863488 | generic_kernels/pck | aynı |
| `data/spice/moon_de440_250416.tf` | PRESENT_UNVERIFIED | 19478 | generic_kernels/fk/satellites | aynı |
| `data/lola/LDEM_60S_240MPP_ADJ.TIF` | PRESENT_UNVERIFIED (yapısal/CRS doğrulaması PASS) | 218961039 (= Content-Length) | https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LDEM_60S_240MPP_ADJ.TIF (ürün 90) | rasterio: GTiff float32 1 bant 7760×7760, 240 m, CRS "Moon (2015) - Sphere / Ocentric / South Polar" (Polar Stereographic B, lat_ts −90, lon_0 0, R 1737400 m), NoData NaN, z −9127.1…7024.8 m, kutup örneği −6…1457 m. Yerel SHA-256 `3f966325…8b34`; PGDA checksum yayımlamıyor. Bilimsel doğruluk doğrulaması değildir. |
| `data/lola/LDEM_80S_80MPP_ADJ.TIF` | MISSING | — | PGDA | — |
| `data/lola/LDEM_60S_240MPP_ADJ_ERR.TIF` | DOWNLOADING (09:07Z başladı, sunucu 267.0 MB) | — | https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LDEM_60S_240MPP_ADJ_ERR.TIF | aynı doğrulama zinciri |
| `LDEM_60S_240MPP_ADJ_EFFRES.TIF` | MISSING (bilerek indirilmedi) | — | PGDA ürün 90 | config'e eklendi; kodda kullanılmıyor |
| `data/sites/*5mpp*` | MISSING | — | PGDA | — |

`data/manifest.json` tarihi `2026-11-14T08:12:33Z`; 5 kernel kaydı var, `official_sha256_matched=false`.

## Çalışan işlemler (2026-11-14T08:38Z)
- 08:38Z: kullanıcının `download_data` süreci **çalışmıyordu** (python süreci/`.part` yoktu).
- 09:07Z: Claude'un başlattığı `python -u -m backend.download_data --include-lola-240m --include-lola-240m-err`
  ERR dosyasını indiriyor (kilit `data/lola/LDEM_60S_240MPP_ADJ_ERR.TIF.download.lock`, heartbeat 30 sn; PID kilit dosyasında).
  Kesilirse: aynı komutu tekrar çalıştırın; tamamlanmış DEM yeniden indirilmez, yetim `.part`/kilit otomatik temizlenir.
- 09:09Z: uvicorn (v1.1 kodu) `127.0.0.1:8000`'de Claude tarafından yeniden başlatıldı; eski süreç (PID 34784) durduruldu.
- İlgisiz: `@21st-dev/magic` MCP node süreçleri (PID 15336, 58236) — dokunulmayacak.

## Bilimsel doğrulama
| Test | Durum | Kanıt / risk |
|---|---|---|
| A-04 Horizons | PASS (sınırlı) | 3 site × 2 cisim, maks 3.3e-7°; sentetik yükseklik, 3 tarih; arazi doğrulaması değil |
| V-01 veri kaynakları + kernel kapsamı | NOT_RUN | |
| V-02 frame/koordinat uyumu | NOT_RUN | |
| V-03 UTC dönüşümü | PASS (sınırlı) | tests/test_spice_time.py: 3 tarih, bağımsız TT−UTC=69.184 s, tol 0.01 s |
| V-04 Horizons karşılaştırması | PASS (sınırlı) | = A-04 |
| V-05 ufuk 135/200/250 km | NOT_RUN | DEM yok |
| V-06 raster LOD/NoData | NOT_RUN | DEM yok |
| V-07 Güneş diski quadrature yakınsaması | NOT_RUN | |
| V-08 ERR/clone | NOT_RUN | ERR yok, clone yok |
| V-09 kısıt doğruluğu | NOT_RUN | |
| V-10 izlenebilirlik | NOT_RUN | |

## §11 kabul girdileri
| Madde | Durum |
|---|---|
| 11.1 PROGRESS.md | IN_PROGRESS (bu dosya) |
| 11.2 Windows spawn | PASS (tests/test_spawn_pool.py 7/7, gerçek spawn alt süreçleri) |
| 11.3 `--include-lola-240m` | kod+17 test PASS (HTTP mock + sentetik TIFF fikstürü); gerçek indirme IN_PROGRESS |
| 11.4 Moon Trek / QuickMap deep-link | QuickMap PASS (URL şeması uygulama JS'inden + headless Chrome'da iki sitede tam ortalama, 2026-11-14); Moon Trek URL biçimi PASS, koordinata odaklanma **NOT_VERIFIED/UNRELIABLE** (1. site 4/4, 2. site 2/7) → arayüzde açıkça etiketli. 13 URL sözleşme testi geçti. |
| 11.5 Dünya vs Ay kartı | PASS: NSSDC Earth/Moon fact sheet, NASA SVS 5229, NASA Science (kaynaklar 2026-11-14 kontrol); 4 test (metin, linkler, yalnız Halk modu, karar motorundan bağımsızlık) |

## Blokajlar ve bir sonraki tam adım
- Sonraki: Faz 3 — `SkyView.tsx` (/horizon + timeline diskleri, 0/360 sarma), `TimelineView.tsx` (scrubber, f_sun/DTE grafikleri,
  /scenarios/shift), sözleşme testleri. Başarı ölçütü: gerçek analiz 62e783c2 benzeri bir sonuçla grafikler çiziliyor, build/test geçiyor.

## Olay günlüğü (append-only)
- 2026-11-14T08:38Z — Faz 0 başladı; denetim yapıldı; PROGRESS.md oluşturuldu.
- 08:39Z — `python -m pytest -q` → 15 passed (exit 0). Hiçbir test SPICE'a dokunmuyordu.
- 08:39Z — `python -m backend.verify_horizons` → **FAIL**: `SPICE(UNPARSEDTIME)`; `str2et('…T… UTC')` biçimi
  SPICE'ta geçersiz. `astro_engine.py` iki satırda `'%Y-%m-%d %H:%M:%S.%f UTC'` biçimine düzeltildi
  (bağımsız kontrol: calendar farkı + 69.184 s ile 1.3 ms içinde uyum).
- 08:40Z — Horizons yanıt başlıkları `Azimuth_(a-app)`/`Elevation_(a-app)` (APPARENT=AIRLESS);
  ayrıştırıcı yalnızca `Azi_/Elev_` arıyordu → regex ile iki biçim + belirsizlik reddi.
- 08:40Z — **A-04 PASS** (3 geometri × Güneş/Dünya, eşik 0.005°): ayrımlar 8.3e-9° … 3.3e-7°.
  Horizons metadata: `Center pole/equ: MEAN_ME`, `Center radii: 1737.4 ×3`. Yükseklikler sentetik. Log: `logs/verify_horizons_faz0.json`.
- 08:41Z — uvicorn başlatıldı (arka plan). `/health` degraded (SPICE var, DEM yok), `/docs` 200, OpenAPI 8 yol,
  DEM eksik POST → 503 DEM_MISSING, 422/404 doğru. CORS yok (OPTIONS 405).
- 08:45Z — PGDA ürün 90 sayfasından gerçek URL'ler doğrulandı (LDEM 210M, ERR 255M, EFFRES 248M; checksum yayımlanmamış).
  Frame kernel: `MOON_ME_DE440_ME421` DE421 ME ile yakın hizalı → LOLA "MOON_ME (DE421)" ile uyumlu.
- 08:50Z — `download_data.py`: `--include-lola-240m` (+ `--include-lola-240m-err`) eklendi; kilit/heartbeat,
  yetim `.part`, disk ön-kontrol, Content-Length, rasterio CRS/küre/kutup/NoData doğrulaması, atomik `os.replace`.
  `os.kill(pid,0)` Windows'ta süreci öldürdüğü için ctypes OpenProcess kullanıldı.
- 08:52Z — Gerçek indirme başlatıldı: `python -u -m backend.download_data --include-lola-240m --include-lola-240m-err`
  (log `logs/download_lola_240m.log`; sunucu Content-Length 219.0 MB bildirdi).
- 09:00Z — main.py v1.1: lifespan-only pool factory, timeout→worker terminate+recycle, kapanışta terminate,
  localhost CORS (wildcard reddi), 422 `details`, `/health.layers/clone_profiles/limits`, `/sites` dosya rehberi,
  `/validation` (yalnız kayıtlı gerçek koşulardan). terrain: `MAX_CACHE_MB` kotası uygulandı; eşit yükseklikte profil tek hesap.
- 09:04Z — `python -m pytest -q` → **55 passed** (exit 0): contract 15 + spice_time 7 + download 17 + spawn 7 + api_v11 9.
- 09:06Z — **Gerçek PGDA indirmesi tamamlandı**: LDEM_60S_240MPP_ADJ.TIF 218,961,039 B, 1326 s, rasterio doğrulaması PASS, atomik replace.
- 09:07Z — QuickMap/Moon Trek deep-link araştırması (alt ajan, uygulama JS'i + headless Chrome): QuickMap VERIFIED,
  Moon Trek biçim VERIFIED / koordinata odaklanma UNRELIABLE (bir sitede 7 denemenin 2'si).
- 09:10Z — `python -m pytest -q` → 55 passed (exit 0), uvicorn yeniden başlatıldı, `/health` → `ready`, lola_240m dem=true err=false.
- 09:10Z — **Faz 0 DONE**, commit 84bf2f5.
- 09:08Z — İlk gerçek analiz (örnek koordinat −89.54°, 0°; nominal; 48+12 sa; 4 senaryo): < 1 dk, `completed`, karar RED.
  Gözlemci DEM −754.1 m, ufuk −0.21°…10.68°, Güneş 1.50° → f_sun 0, Dünya −1.90° → DTE 0, eğim `high_resolution_dem_missing`.
  Bu, örnek koordinatın bir çukurda olduğunu gösteren gerçek sonuçtur; aday önerisi değildir.
- 09:12Z — **Faz 1 DONE**, commit 1199213 (build/lint/48 test).
- 09:20Z — ERR indirmesi yavaş (~15 kB/s; sunucu kaynaklı olabilir). Bloklamıyor: ERR yokken `err` modu GRAY döner ve UI bunu söyler.
- 09:22Z — **Faz 2 DONE**: form (UTC ayrık tarih/saat, sınırlar, bütçe, 422 alan eşlemesi), 202+polling (2 sn, terminalde durur,
  404→lost, unmount cleanup), sonuç özeti (Halk/Mühendis, ihlal UTC aralıkları, provenance, kopyalanabilir özet).
  Testler: polling 4, gerçek-fikstür ResultSummary 4 (mod değişimi kararı değiştirmiyor).
