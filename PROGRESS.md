# PROGRESS — Lunar Mission Window Analyzer

> Oturum devamlılık günlüğü (CLAUDE_HANDOFF.md §11.1). Yeni oturumda **ilk iş**: `CLAUDE.md`,
> `CLAUDE_DEVIR_TALIMATI.md` (+ §11 için `CLAUDE_HANDOFF.md`), bu dosya ve `git status` okunur;
> sonra buradaki iddialar gerçek dosyalar/süreçler/testlerle çapraz kontrol edilir.

## Son güncelleme
- **Zaman (UTC):** 2026-11-14T13:33Z
- **Faz:** Faz 7 (P1-2) — (1) `(1).py` temizliği + push, (2) Halk hata UX + 200 km GREEN kuralı, (3) EFFRES/Site07-11-23/YELLOW/doğrulama kapsamı, clone modu
- **Alt adım:** 7.1 + 7.2 DONE (push edildi) → kullanıcıya test raporu → 7.3 (EFFRES, Site07/11/23, YELLOW araştırması, doğrulama kapsamı) başlıyor
- **Durum:** IN_PROGRESS (Faz 0–6 kullanıcı tarafından kabul edildi, 2026-11-14)

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
- **2026-11-14T13:17Z güncel:** kullanıcı talimatıyla 7 `(1).py` dosyası proje dışına taşındı:
  `C:\Users\mehme\Documents\NasaSpaceApp2026_yedek\backend_ilk_teslim_kopyalari_2026-11-14\` (+ `SHA256SUMS.txt`, `NEDEN.txt`).
  AST karşılaştırması: yalnız `(1)` sürümünde olan fonksiyon/sınıf/endpoint **yok**; farklı satırlar Faz 0+ ile düzeltilmiş
  eski mantık (eski Horizons başlık ayrıştırıcısı, eski `local_slope`, eski havuz yaşam döngüsü, eski NAIF `main()`).
  `decision_engine (1).py` = commit `84bf2f5` sürümü. Çalışma ağacı temiz.

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
| `python -m pytest -q` | ≈09:11Z | 0 | 55 passed |
| `npm run build` (frontend) | ≈09:11Z | 0 | tsc + vite OK (ilk yük 286 kB JS; Plotly ayrı chunk) |
| `npm run lint` | ≈09:11Z | 0 | 0 sorun |
| `npx vitest run` | ≈09:11Z | 0 | 56 passed (7 dosya) |
| Gerçek uçtan uca analiz (API) | 09:08:29Z | — | `62e783c2…` completed < 1 dk; RED; ufuk 3600/3600 tam kapsama; `logs/first_real_analysis.json` |
| `npm run e2e` (playwright-core + sistem Chrome, GERÇEK backend) | ≈09:20Z | 0 | 2 site + kayma akışı; sky view 7 iz; slider klavye 10 adım = +5 sa; mod değişimi kararı değiştirmedi; mobil 390 px taşma 0; konsol hatası 0. Görseller `logs/e2e/*.png` |
| `npx vitest run` | ≈09:21Z | 0 | 70 passed (8 dosya) |
| `npm run build` / `npm run lint` | ≈09:21Z | 0 / 0 | ana JS 315 kB, Plotly lazy 4.65 MB |
| `python -m pytest -q` | ≈09:21Z | 0 | 55 passed |
| `python -m backend.validation` | 09:28:23Z | 0 | 9 PASS, 2 BLOCKED (V-06, V-08); A-04 ağ ile PASS |
| `npm run e2e` (+ axe-core) | ≈09:29Z | 0 | Halk/Mühendis × 5 sekme = 10 tarama, **0 axe ihlali** (ilk koşuda 1: scrollable-region-focusable → düzeltildi); gerçek /compare; 429 RATE_LIMITED UX gerçek sunucuda görüldü |
| `python -m pytest -q` | ≈09:30Z | 0 | 59 passed |
| Gerçek ERR modu analizleri (API) | 09:37:47Z | — | (−89.4512, −137.1427) ve (−88.6663, −68.2302), iniş 2026-12-17 00:00Z, k=1: ikisi de GREEN; `/compare` ilk denemede **500** (Pareto KeyError) → düzeltildi → 200, iki GREEN, baskın değil. `logs/err_mode_runs.json` |
| `python -m backend.validation` | 09:39:15Z | 0 | 10 PASS, 1 BLOCKED (V-06) |
| `npm run e2e` (ERR + 2026-12-17) | 09:40:09Z | 0 | GREEN rozet, Sky View ERR bandı (9 iz), GREEN Pareto compare, axe 0 ihlal, mobil 0, konsol 0 — `logs/e2e_err/` |
| `npm run e2e:states` | 09:40:51Z | 0 | 8/8 (DEM_MISSING gerçek; offline/SPICE_MISSING/QUEUE_FULL/WORKER_UNAVAILABLE/409 işaretli mock; 422 istemcide engellendi) |
| `python -m pytest -q` / `npx vitest run` / build / lint | 09:40:35Z | 0 | **62 passed** / **71 passed** / OK / 0 sorun |
| `npx vitest run` / build / lint | ≈09:30Z | 0 | 71 passed / OK / 0 sorun |

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
| `data/lola/LDEM_60S_240MPP_ADJ_ERR.TIF` | PRESENT_UNVERIFIED (yapısal/CRS doğrulaması PASS) | 267005175 (= Content-Length) | https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LDEM_60S_240MPP_ADJ_ERR.TIF | rasterio: aynı CRS/ızgara (7760², 240 m), NoData NaN, kutup örneği σ 0.024–0.165 m; 1774.7 s |
| `LDEM_60S_240MPP_ADJ_EFFRES.TIF` | MISSING (bilerek indirilmedi) | — | PGDA ürün 90 | config'e eklendi; kodda kullanılmıyor |
| `data/lola/LDEM_80S_80MPP_ADJ.TIF` | PRESENT_UNVERIFIED (yapısal/CRS PASS) | 189158392 (= Content-Length; 2. deneme) | PGDA ürün 90 /data/LOLA_20mpp/ | Moon (2015) Sphere South Polar, 7600² × 80 m, NoData NaN, kutup örneği 1008–1353 m |
| `data/lola/LDEM_80S_80MPP_ADJ_ERR.TIF` | PRESENT_UNVERIFIED (yapısal/CRS PASS) | 254808965 | PGDA ürün 90 | aynı ızgara; kutup σ 0.03–0.51 m |
| `data/sites/Site01_final_adj_5mpp_{surf,toterr,slp}.tif` | PRESENT_UNVERIFIED (yapısal/CRS PASS) | 40980810 / 40980810 / 40980776 | PGDA ürün 78 /data/LOLA_5mpp/Site01/ | Polar Stereographic B, R 1737400, 3200² × 5 m, 16×16 km, merkez (−89.46316, −137.48955); `_surf` enterpolasyonla doldurulmuş |
| `data/sites/Site04_final_adj_5mpp_{surf,toterr,slp}.tif` | PRESENT_UNVERIFIED (yapısal/CRS PASS) | 40980806 / 40980808 / 40980772 | PGDA ürün 78 /data/LOLA_5mpp/Site04/ | aynı; karo güney kutbunu içeriyor |
| `data/sites/*5mpp*` | MISSING | — | PGDA | — |

`data/manifest.json` tarihi `2026-11-14T08:12:33Z`; 5 kernel kaydı var, `official_sha256_matched=false`.

## Çalışan işlemler (2026-11-14T08:38Z)
- 08:38Z: kullanıcının `download_data` süreci **çalışmıyordu** (python süreci/`.part` yoktu).
- 08:44Z (manifest: bitiş 09:06:44Z − 1326 s): Claude'un başlattığı `python -u -m backend.download_data --include-lola-240m --include-lola-240m-err`
  ERR dosyasını indiriyor (kilit `data/lola/LDEM_60S_240MPP_ADJ_ERR.TIF.download.lock`, heartbeat 30 sn; PID kilit dosyasında).
  Kesilirse: aynı komutu tekrar çalıştırın; tamamlanmış DEM yeniden indirilmez, yetim `.part`/kilit otomatik temizlenir.
- 09:09Z: uvicorn (v1.1 kodu) `127.0.0.1:8000`'de Claude tarafından yeniden başlatıldı; eski süreç (PID 34784) durduruldu.
- İlgisiz: `@21st-dev/magic` MCP node süreçleri (PID 15336, 58236) — dokunulmayacak.

## Bilimsel doğrulama
Kaynak: `python -m backend.validation` → `data/validation/report.json` (UI: Data & Validation). Son tam koşu 2026-11-14T09:39:15Z
(ağ + ERR dahil, çıkış 0): **10 PASS, 1 BLOCKED**; kopya `logs/validation_report_final.json`. PASS yalnızca kayıtlı vaka ve ölçütleri kapsar.

| Test | Durum | Kanıt / kalan risk |
|---|---|---|
| A-04 Horizons | PASS (sınırlı) | 3 site × Güneş/Dünya, 3 tarih; maks ayrım 4.14e-7° (eşik 0.005°). Horizons: `MEAN_ME`, küre 1737.4. Yükseklikler sentetik; tüm yıl/arazi kanıtı değil |
| V-01 kaynak + kernel kapsamı | PASS | de440s: Sun/Earth/Moon/EMB 1849–2150; moon_pa bpc 1550–2650 ⊇ 2026–2035; LOLA manifest kaydı |
| V-02 frame/koordinat | PASS | MOON_ME_DE440_ME421 (id 31009); PA→ME 103.9″ (2026-12-01); raster "Moon (2015) Sphere / Ocentric / South Polar", R 1737400, kutup (0,0), +90°E → +x |
| V-03 UTC→ET | PASS | 4 tarih, bağımsız TT−UTC = 69.184 s ile < 0.01 s; 2035'e kadar yeni artık saniye olmadığı varsayımı |
| V-04 Horizons | PASS (sınırlı) | = A-04 |
| V-05 135/200/250 km | PASS (2 site) | 200→250 km değişim 0.0000° (eğrilik ≥3.3° düşürür); **135→200 km 1950 m sırt noktasında 0.457°, azimutların %7.1'i** → 135 km hızlı mod yüksek konumlarda yetersiz olabilir |
| V-06 LOD/NoData | PASS (11:35Z) | NaN yayılımı; 5 çift medyan −0.09…+0.63 m (ölçüt < 5 m, önceden sabit); LOD 1 km→site, 10 km→80 m, 100 km→240 m |
| V-07 disk quadrature | PASS (düz ufuk) | analitik daire segmentine karşı 27 ofset, maks hata 0.0028 (< 0.01); eğri arazi kapsanmadı |
| V-08 ERR/clone | PASS (yalnız tutarlılık, 11:35Z) | 240+80+5 m ERR ile: gözlemci σ 0.059/0.278 m, bant ≤ 0.016°/0.299°, sıralama doğru. İstatistiksel doğrulama değil. Clone: NOT_RUN |
| SLOPE-01 5 m eğim | PASS (11:35Z) | resmi `_slp.tif` ile 290 noktada medyan \|Δ\| 0.08° (ölçüt ≤ 2°, önceden sabit); uçtan uca eğim kısıtlı worker analizi `site01_5m` `screening_only` |
| V-09 kısıt doğruluğu | PASS | elle hesaplanmış girdilerde en uzun koşu, min/maks sınırları, SLOPE_UNKNOWN |
| V-10 izlenebilirlik | PASS | gerçek 24 sa analiz (site 2): sources/cache_key/radius/mode/disclaimers/UTC Z mevcut; nominal → GRAY (GREEN değil) |

## §11 kabul girdileri (§11.6)
| Madde | Durum | Kanıt |
|---|---|---|
| 11.1 PROGRESS.md | PASS | Bu dosya; her faz başı/ara/sonu güncellendi; yeniden başlatma talimatı aşağıda |
| 11.2 Windows spawn | PASS | Havuz yalnız `lifespan`'de (`_new_pool`), import'ta değil; `tests/test_spawn_pool.py` 7/7 gerçek spawn alt süreçleri: başlatma, çökme→WORKER_UNAVAILABLE+yenileme, zaman aşımı→terminate, kapanışta takılmama, 429 kuyruk, 5/dk |
| 11.3 `--include-lola-240m` | PASS | 17 test (mock HTTP + sentetik TIFF fikstürü; işaretli): ilk kurulum, geçerli dosya, yetim .part, aktif kilit çakışması, eski kilit, bozuk TIFF, yanlış CRS, yanlış boyut, Content-Length yok, disk ön-kontrol, yazarken disk dolu, HTTP 404, çevrimdışı, katalog dışı URL, varsayılan CLI, PID kontrolü. **Gerçek PGDA indirmesi** 218,961,039 B, rasterio doğrulaması PASS |
| 11.4 Moon Trek / QuickMap | QuickMap PASS · Moon Trek biçim PASS / odaklanma NOT_VERIFIED (UNRELIABLE) | URL şemaları uygulama JS'inden + headless Chrome (2026-11-14), 2 güney kutbu sitesi; 13 sözleşme testi; arayüz Moon Trek uyarısını gösterir; README "Deep-link doğrulaması" |
| 11.5 Dünya vs Ay kartı | PASS | NSSDC Earth/Moon, NASA SVS 5229, NASA Science kaynakları; 4 test (metin, güvenli linkler, yalnız Halk modu, karar motorundan bağımsızlık) |

## §7 minimum P0 kabul listesi
| Kriter | Durum | Kanıt |
|---|---|---|
| pytest gerçek çıktıyla raporlandı | ✅ | 59 passed (başlangıç 15; hata gizlenmedi: ilk verify_horizons FAIL kaydı yukarıda) |
| /health, /sites, /docs erişilebilir; kullanılabilirlik ≠ bilimsel doğruluk | ✅ | curl + UI Data & Validation ayrımı |
| `npm run build` | ✅ | tsc + vite OK |
| Backend yok / SPICE yok / LOLA yok / ERR yok / worker çöküşü / 429 / 422 / 409 UX | ✅ | `e2e/states.mjs` 8/8 (DEM_MISSING gerçek; diğerleri işaretli mock), RATE_LIMITED gerçek sunucuda görüldü, ERR yok → çip + form uyarısı |
| Gerçek veriyle analiz, polling, ufuk grafiği, seçili zaman, kıyaslama, kayma | ✅ | `e2e/smoke.mjs` gerçek backend |
| Veri yokken sahte sonuç yok | ✅ | AnalysisGate boş durumları; offline'da grafik çizilmiyor (e2e) |
| +0/24/48/72, ayrı Güneş/Dünya yükseklikleri, UTC | ✅ | form + Sky View ayrı anten ufku testi + UTC testleri (America/Los_Angeles TZ) |
| Halk/Mühendis yalnız sunum | ✅ | bileşen testi + e2e (karar değişmedi) |
| Mobil/masaüstü, klavye | ✅ | 390 px taşma 0, axe-core 10 tarama 0 ihlal, WAI-ARIA sekmeler, klavye kaydırıcı |
| README ve .env.example | ✅ | kök + frontend |
| Bilimsel doğrulamalar yalnız gerçek kanıtla PASS | ✅ | `/validation` raporu; V-06/V-08 BLOCKED |

## Yeniden başlatma talimatı (yeni oturum için)
1. `git log --oneline` (son: Faz 5) ve `git status` kontrol et; bu dosyayı oku.
2. Backend: `uvicorn backend.main:app --host 127.0.0.1 --port 8000` · Frontend: `cd frontend; npm run dev`.
3. Eksik veri varsa: `python -m backend.download_data --include-lola-240m [--include-lola-240m-err]` (kilit/yetim .part güvenli).
4. Doğrulama: `python -m pytest -q`, `python -m backend.validation`, `cd frontend; npx vitest run; npm run build; npm run e2e; npm run e2e:states`.

## Blokajlar ve bir sonraki tam adım
- Blokaj yok. Kalan (P1+): 80/20/5 m katmanları ile LOD (V-06) ve eğim; DEM clone verisi; YELLOW'un gerçek veriyle gözlenmesi;
  daha fazla Horizons/V-05 vakası ve eğri arazi quadrature testi; paylaşımlı rate-limit (internete açılırsa).
- Çalışan süreçler (Claude başlattı): uvicorn `127.0.0.1:8000`, Vite dev `localhost:5173` (arka plan). İndirme süreci bitti.

## Olay günlüğü (append-only)
> 09:44Z düzeltmesi: önceki sürümde bazı zaman damgaları tahminiydi (bazıları ileri tarihliydi). Git commit saatleri, dosya mtime'ları, manifest `downloaded_utc` ve uvicorn log saatlerine göre düzeltildi; kesin olmayanlar `≈` ile işaretli. Olayların sırası liste sırasından farklı olabilir; saat esas alınmalı.
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
- ≈08:42Z — PGDA ürün 90 sayfasından gerçek URL'ler doğrulandı (LDEM 210M, ERR 255M, EFFRES 248M; checksum yayımlanmamış).
  Frame kernel: `MOON_ME_DE440_ME421` DE421 ME ile yakın hizalı → LOLA "MOON_ME (DE421)" ile uyumlu.
- ≈08:43Z — `download_data.py`: `--include-lola-240m` (+ `--include-lola-240m-err`) eklendi; kilit/heartbeat,
  yetim `.part`, disk ön-kontrol, Content-Length, rasterio CRS/küre/kutup/NoData doğrulaması, atomik `os.replace`.
  `os.kill(pid,0)` Windows'ta süreci öldürdüğü için ctypes OpenProcess kullanıldı.
- 08:44:38Z — Gerçek indirme başlatıldı: `python -u -m backend.download_data --include-lola-240m --include-lola-240m-err`
  (log `logs/download_lola_240m.log`; sunucu Content-Length 219.0 MB bildirdi).
- ≈08:50Z — main.py v1.1: lifespan-only pool factory, timeout→worker terminate+recycle, kapanışta terminate,
  localhost CORS (wildcard reddi), 422 `details`, `/health.layers/clone_profiles/limits`, `/sites` dosya rehberi,
  `/validation` (yalnız kayıtlı gerçek koşulardan). terrain: `MAX_CACHE_MB` kotası uygulandı; eşit yükseklikte profil tek hesap.
- ≈08:55Z — `python -m pytest -q` → **55 passed** (exit 0): contract 15 + spice_time 7 + download 17 + spawn 7 + api_v11 9.
- 09:06Z — **Gerçek PGDA indirmesi tamamlandı**: LDEM_60S_240MPP_ADJ.TIF 218,961,039 B, 1326 s, rasterio doğrulaması PASS, atomik replace.
- ≈09:06Z — QuickMap/Moon Trek deep-link araştırması (alt ajan, uygulama JS'i + headless Chrome): QuickMap VERIFIED,
  Moon Trek biçim VERIFIED / koordinata odaklanma UNRELIABLE (bir sitede 7 denemenin 2'si).
- 09:07:44Z — `python -m pytest -q` → 55 passed (exit 0), uvicorn yeniden başlatıldı, `/health` → `ready`, lola_240m dem=true err=false.
- 09:08:16Z — **Faz 0 DONE**, commit 84bf2f5.
- 09:08:29Z — İlk gerçek analiz (örnek koordinat −89.54°, 0°; nominal; 48+12 sa; 4 senaryo): < 1 dk, `completed`, karar RED.
  Gözlemci DEM −754.1 m, ufuk −0.21°…10.68°, Güneş 1.50° → f_sun 0, Dünya −1.90° → DTE 0, eğim `high_resolution_dem_missing`.
  Bu, örnek koordinatın bir çukurda olduğunu gösteren gerçek sonuçtur; aday önerisi değildir.
- 09:09:07Z — **Faz 1 DONE**, commit 1199213 (build/lint/48 test).
- ≈09:12Z — ERR indirmesi yavaş (~15 kB/s; sunucu kaynaklı olabilir). Bloklamıyor: ERR yokken `err` modu GRAY döner ve UI bunu söyler.
- ≈09:17Z — İkinci test konumu DEM'den türetildi: (−89.4512°, −137.1427°), DEM 1950.3 m (resmi aday değildir).
  **Düzeltme (≈09:33Z):** ilk aramada kesirli raster penceresi ⅓ piksel kaydırdı; bu nokta en yüksek piksel değil, ona komşu.
  Gerçek en yüksek piksel (40 km içinde) 1954.3 m @ (−89.4455°, −137.3137°). Kanıtlar −89.4512/−137.1427 ile üretildiği için korunuyor. Gerçek sonuç: f_sun %100, karanlık 0 sa; Dünya ufkun altında (DTE %0) → RED. Yeni 200 km ufuk ~2 sn.
- 09:21:32Z — **Faz 3 DONE**: Sky View (gerçek /horizon, gerçek açısal boyutlu diskler, 0/360 sarma, ERR bandı yalnız varsa,
  eksik ışın işareti, Güneş/Dünya izleri, gövdeye yakınlaştırma eşit ölçekli), Timeline (f_sun + DTE, en uzun aralık vurgusu,
  tıklayarak seçim, klavye kaydırıcı, mühendis yükseklik grafiği, /scenarios/shift + polling, ebeveyn korunur).
  E2E'de bulunan ve düzeltilen hatalar: mobil 300 px taşma, MIN_* ihlallerinde ters karşılaştırma işareti, zoom'da eksen etiketi
  kaybı/elips disk, kayma sonrası ebeveynden otomatik atlama, Türkçe yüzde ekleri.
- 09:36:18Z — ERR indirmesi tamamlandı (267,005,175 B, doğrulama PASS). `/health` lola_240m err=true.
- 09:37Z — Gerçek ERR analizleri GREEN; `/compare` 500 → `pareto_compare` KeyError('costs') (≥2 GREEN/YELLOW'da hiç çalışmamış yol)
  bulundu, minimal düzeltme + `tests/test_pareto.py` (3). Ayrıca ERR modunda `observer_err_m` hep None → düzeltildi,
  horizon cache anahtarına `HORIZON_SCHEMA=2` eklendi, V-08 ölçütü σ raporlamasını kontrol ediyor. uvicorn iki kez yeniden başlatıldı.
- 09:44Z — **Faz 5 DONE / P0_DONE.**
- Kullanıcı onayıyla `git push origin main`: f613c81..8a37e4f → github.com/aslan-ugurlu/Lunar-Mission-Window-Analyzer-Nasa-Space-App (main). Sıradaki iş: tasarım ve Halk/Mühendis modu güncellemeleri (kullanıcıdan ayrıntı bekleniyor).
- 09:30:45Z — **Faz 4 DONE**: Compare (yalnız aynı profil seçilebilir, backend sıralama anahtarları açıklanır, RED/GRAY gerekçeli
  kartlar, deep-link'ler), Data & Validation (/health, /sites, gerçek /validation raporu, kaynaklar, sınırlamalar),
  `backend/validation.py`, axe-core 0 ihlal, mobil taşma 0, Plotly lazy chunk.
- 09:11:56Z — **Faz 2 DONE**: form (UTC ayrık tarih/saat, sınırlar, bütçe, 422 alan eşlemesi), 202+polling (2 sn, terminalde durur,
  404→lost, unmount cleanup), sonuç özeti (Halk/Mühendis, ihlal UTC aralıkları, provenance, kopyalanabilir özet).
  Testler: polling 4, gerçek-fikstür ResultSummary 4 (mod değişimi kararı değiştirmiyor).
- 10:43Z — **Faz 6 başladı** (kullanıcı isteği: 80 m + 5 m site DEM, V-06/eğim, Halk/Mühendis ayrımı). git: main = origin/main + 1 (aef6af9).
- 10:45Z — Kaynak doğrulama: PGDA **ürün 90**'da 5 m site dosyası YOK (yeniden kontrol edildi). 5 m site DEM'leri **ürün 78**
  (https://pgda.gsfc.nasa.gov/products/78, veri dizini /data/LOLA_5mpp/, README: Site01 = Connecting ridge, Site04 = Shackleton rim,
  5 m/piksel güney polar stereografik, MOON_ME DE421, `_surf` yükseklik m — boş pikseller enterpolasyonla doldurulmuş, `_toterr` RMS m,
  `_slp` eğim °; Barker vd. 2021 PSS 203:105119). HEAD boyutları: 80 m DEM 189.2 MB, 80 m ERR 254.8 MB, site surf/toterr/slp 41.0 MB.
  Not: ürün 78'de site başına 100 DEM clone dosyası da yayımlanıyor (bu fazda kullanılmıyor; CLONE_NOT_PRECOMPUTED korunuyor).
- 10:50Z — `download_data.py`: resmi CATALOG (ürün 90: 80 m + ERR; ürün 78: Site01/Site04 surf/toterr/slp), bayraklar
  `--include-lola-80m`, `--include-lola-80m-err`, `--include-site-5m`; doğrulayıcı kutup içermeyen site rasterlarında merkezden örnekler.
  terrain_engine: ERR modunda ERR'si olmayan katman kullanılmaz ve `excluded_layers` ile raporlanır (aksi hâlde 80 m ERR inmeden
  ERR analizleri GRAY'e düşerdi); `layer_resolution_m`; `raster_footprint`; eğim örnekleri `_slope_points`; HORIZON_SCHEMA=3.
  `/sites`: `region_name` (PGDA README), ürün 78 sayfası, gerçek `footprint`. validation: V-06 LOD (katman çifti medyan sapma
  < 5 m ölçütü önceden sabitlendi) + yeni **SLOPE-01** (resmi `_slp.tif` ile medyan |Δ| ≤ 2°, önceden sabitlendi) + uçtan uca eğim.
- 10:52Z — `python -m pytest -q` → 68 passed (yeni: tests/test_lod_layers.py 6 — sentetik fikstür, işaretli).
- 10:54Z — Site01_final_adj_5mpp_surf.tif staged (40,980,810 B = Content-Length): CRS Polar Stereographic B, küre 1737400 m,
  3200×3200 × 5 m (16×16 km), NoData NaN, AREA_OR_POINT=Area, merkez (−89.46316°, −137.48955°), merkez kotu ~1939–1948 m.
  Test konumu 2 (−89.4512, −137.1427) bu karonun içinde.
- 10:55Z — Frontend mod ayrımı: Halk'ta "Gelişmiş görev ayarları" akordeonu (tampon/adım/yarıçap/err_k/karanlık eşiği/eğim/ayak izi),
  KPI kartları, hikâye anlatımı, "Neden bu sonuç?", öne çıkarılmış Dünya–Ay kartı (Setup + Sky View); Mühendis'te tüm parametreler,
  en üstte telemetri (frame, DEM katman+çözünürlük, h_DEM + h_obs → r, cache key, eğim) + ihlal UTC tablosu, Sky View ufuk
  min/maks + panel–anten farkı + ERR bant genişliği, Timeline'da yükseklik grafiği üstte + JSON/CSV ham veri dışa aktarma.
  **Karar:** CLAUDE.md "DEM_MISSING/SPICE_MISSING/GRAY… kodlarını kesinlikle gizleme" kuralı nedeniyle Halk modunda veri-eksikliği/
  hata kodları (Notice çipi) gizlenmedi; gizlenenler ham durum etiketleri, metrik/provenance tabloları, cache key, ihlal kodları.
- 10:57Z — `npx vitest run` → 85 passed (yeni: telemetry 8, ModeSeparation 6). tsc + lint temiz.
- 10:58Z — Paralel indirme süreçleri (Claude): A `--include-site-5m` zinciri (log logs/download_faz6.log), B 80 m→80 m ERR
  (logs/download_faz6_80m.log), C Site04 surf/slp/toterr (logs/download_faz6_site04.log), D 80 m ERR (logs/download_faz6_80m_err.log).
  Bağlantı başına ~80–130 KB/s. Dosya kilidi çakışmayı önler; kesilirse aynı komut güvenle tekrar çalıştırılabilir.
- 11:00Z — uvicorn yeniden başlatıldı (Faz 6 kodu). `/sites`: site01_5m region_name "Connecting ridge", ürün 78, footprint merkez (−89.46316, −137.48955).
- 11:00Z — `npm run e2e` (gerçek backend): Halk akordeonu kapalı; Mühendis CSV (121 satır, ham sütunlar) + JSON gerçek indirme;
  JSON `dem_layers=lola_240m=240m site01_5m=5m` → ufukta 5 m LOD kullanıldı; axe 10/10 ekran 0 ihlal; mobil taşma 0; konsol 0.
- 11:03Z — **Gerçek HTTP API eğim analizleri** (Site01 karo merkezi, 2026-12-17 00:00Z, 48+12 sa; `logs/slope_api_runs.json`):
  eğim maks 9.34° / ort 5.86° (site01_5m, Δ 5 m, 29 nokta, r 30 m). nominal + ≤10° → GRAY (nominal kuralı);
  err + ≤10° → GREEN (gözlemci σ 0.253 m; site04_5m ERR'si o an yoktu → `excluded_layers`); err + ≤5° → RED (MAX_SLOPE nominal+ihtiyatlı).
- 11:06Z — Site01 `_slp`, Site04 `_surf`/`_slp` staged. İndirme zinciri A, Site04 toterr ve 80 m için **aktif kilitleri görüp çakışan
  indirme başlatmadan durdu** (EXIT_SITE=1 / EXIT_80M=1 — beklenen §11.3 davranışı; dosyalar B/C/D süreçlerince iniyor).
- 11:07Z — Ön koşular: **SLOPE-01 PASS** — resmi PGDA `_slp.tif` ile 290 noktada medyan |Δ| 0.08° (ölçüt ≤ 2°; satır başına
  0.02–0.24°); Site04 karo merkezi eğimi ~31–34° (Shackleton iç duvarı — karo merkezi iniş noktası değildir). Uçtan uca worker
  analizi eğimi site01_5m'den `screening_only` olarak değerlendirdi. **V-06 PASS (80 m'siz ön koşu)**: site01−240 m medyan +0.63 m
  (p95 9.8 m), site04−240 m −0.09 m (p95 8.0 m); LOD 1 km→site, 10/100 km→240 m. 80 m inince final koşu yapılacak.
- 11:17Z — Site04 `_toterr` staged; tüm Site01/Site04 surf/toterr/slp dosyaları mevcut (her biri ~40.98 MB = Content-Length).
- 11:21Z — **80 m DEM ilk deneme FAIL (gerçek kısmi aktarım):** `Size mismatch: received 187358688 bytes, server reported 189158392`.
  İndirici dosyayı reddetti, `.part` silindi, eksik dosya yerleşmedi (yanlış-boyut koruması gerçek koşuda doğrulandı).
- 11:23Z — PGDA `Accept-Ranges: bytes` + 206/`Content-Range` doğrulandı (curl). `download_data.py`'ye aynı çağrı içinde HTTP Range ile
  devam eklendi (en fazla 4 deneme; 206 + Content-Range başlangıç/toplam ve ETag eşleşmeli; sunucu Range'i yok sayarsa baştan;
  yetim `.part` hâlâ silinir). Yeni 6 test (işaretli mock): kesik aktarım devamı, ETag değişimi reddi, tutarsız Content-Range reddi,
  Range yok sayılınca temiz yeniden başlama, akış ortasında bağlantı kopması, deneme sınırı. tests/test_download_lola.py 23 passed.
- 11:24Z — 80 m DEM yeniden indirme başlatıldı (log logs/download_faz6_80m_retry.log); 80 m ERR süreci D devam ediyor.
- 11:26Z — 80 m ERR staged (254,808,965 B). 11:31Z — 80 m DEM 2. deneme staged (189,158,392 B, devam gerekmedi).
- 11:35Z — `python -m backend.validation` (ağ dahil) → **12/12 PASS** (A-04, V-01…V-10, SLOPE-01); `logs/validation_report_faz6.json`.
  V-05 (5 m + 80 m LOD ile): site 2'de 135→200 km 0.762° / azimutların %10'u; 200→250 km 0. V-08: σ 0.059/0.278 m, bant ≤ 0.299°.
- 11:36Z — ERR analizleri (2026-12-17, k=1) yeni katmanlarla yeniden: iki konum GREEN, /compare 200 iki GREEN baskın değil (`logs/err_mode_runs_faz6.json`).
- 11:36Z — `npm run e2e` nominal (2 site, katmanlar 240/80/5/5 m) ve ERR (GREEN + Pareto) → geçti; axe 10/10 ekran 0 ihlal, mobil 0, konsol 0.
  `npm run e2e:states` ilk denemede FAIL: "gerçek DEM_MISSING" adımı artık mevcut olan `lola_80m`'i seçiyordu → `lola_20m` ile düzeltildi → 8/8.
- 11:37Z — **Final:** `python -m pytest -q` 75 passed · `npx vitest run` 85 passed · `npm run build` OK (349 kB) · `npm run lint` 0.
- 11:39Z — **Faz 6 DONE**, yerel commit. Push yapılmadı (kullanıcı onayı bekleniyor).

### Faz 7 — kullanıcı talimatı (2026-11-14T13:15Z): P0 + Faz 6 kabul; temizlik + push, Halk hata UX + 200 km kuralı, bilimsel P1
- 13:17Z — `backend/* (1).py` (7 dosya) AST/satır karşılaştırması: eksik önemli işlev yok (bkz. "Git durumu"); proje dışı
  yedek klasörüne taşındı (SHA-256 listesiyle). `git status` temiz.
- 13:18Z — Push öncesi kontrol: `.gitignore` `data/`, `*.TIF`/`*.tif`, `*.bsp`, `*.bpc`, `logs/`, `node_modules/` içeriyor
  (`git check-ignore -v` örnekleri doğruladı); `git ls-files` içinde `data/`/`logs/` yok; gönderilecek aralıkta (`origin/main..HEAD`)
  yasak yol yok, en büyük blob 29.6 kB (`PROGRESS.md`).
- 13:18Z — **Push (7.1) başarılı:** `git push origin main` → `8a37e4f..d943820  main -> main`
  (Faz 6 `c945069`, `aef6af9` ve temizlik kaydı `d943820` GitHub'da). `git status`: `main...origin/main` eşit.

#### 7.2 — Halk/Mühendis hata UX'i + 200 km referans kuralı (13:20Z–13:33Z)
- **Kullanıcı kararı (2026-11-14):** Halk modunda kodlar ana başlık olmaz; sade Türkçe başlık + açıklama, ham kod açılır
  “Teknik detaylar” içinde (silinmez). Mühendis modunda kodlar doğrudan görünür. Bu, Faz 6'daki “kodlar Halk'ta da görünür” kararının yerine geçer.
- Frontend: `api/errors.ts` → `publicTitle`/`publicAction` + `headingFor()` + `KNOWN_CODES` + `REDUCED_HORIZON_RADIUS`;
  `ui.tsx` `Notice` moda göre (Halk: `<details>` “Teknik detaylar”; `focusOnMount`); `App.tsx` degraded uyarısı `Notice`'e taşındı;
  `AnalysisList`, `ComparePanel`, `MissionForm` (DEM/clone ipuçları, yarıçap ipucu), `ResultSummary` (yarıçap uyarısı + YELLOW hikâyesi),
  `TelemetryPanel` (“Yarıçap kuralı” satırı), `CopySummary` (UYARI satırı). Tasarım korunmuştur (yeni sayfa/düzen yok).
- Backend (API v1.3, ekleyici): `config.REFERENCE_HORIZON_RADIUS_KM = 200`; `decision_engine._radius_policy` →
  r < 200 km ise GREEN → YELLOW (RED/YELLOW/GRAY değişmez), `mission.radius_policy` alanı, etiket + kamu/mühendis açıklaması.
  Gerekçe: kısa tarama = referans örneklerinin alt kümesi üzerinde maksimum → ufuk ≤ referans → görünürlük iyimser.
- Testler: `python -m pytest -q` **83 passed** (+8 `tests/test_radius_policy.py`, işaretli sentetik sky/slope çiftleriyle) ·
  `npx vitest run` **95 passed** (+10 `ErrorUx.test.tsx`) · `npm run lint` 0 · `npm run build` OK (358 kB).
- uvicorn yeni kodla yeniden başlatıldı (bellek içi analiz kayıtları sıfırlandı).
- `npm run e2e:states` (yeniden yazıldı, iki mod) → **17/17**: Halk'ta sade başlık + kod yalnız klavyeyle açılan “Teknik detaylar”da;
  Mühendis'te kod çipi görünür; SPICE hatasında odak hata kutusuna; axe DEM_MISSING Halk (detaylar açık) 0 / Mühendis 0.
- **Gerçek API (200 vs 135 km)**, test konumu (−89.4512, −137.1427), ERR k=1, 2026-12-17T00:00Z, 48+12 sa:
  200 km → **GREEN** (`REFERENCE_RADIUS`), 135 km → **YELLOW** (`REDUCED_HORIZON_RADIUS`, GREEN → YELLOW); katmanlar 240/80/5/5 m,
  eğim maks 5.20° (`logs/radius_policy_faz7.json`).
- **Kullanıcı test senaryosu, Site01 karo merkezi** (−89.46316, −137.48955; raster merkezi, resmi iniş noktası değil), `site01_5m`,
  ERR k=1, eğim ≤ 10°, diğerleri form varsayılanı (`logs/user_test_site01_faz7.json`):
  - 2026-12-26T12:00Z, 200 km → **RED** (nominal `MIN_DTE` + `MAX_DTE_GAP`; ihtiyatlıda ek `MIN_ILLUMINATION`).
    Dünya 2026-12-27 09:00–09:30Z arasında az ≈143°'de batıyor (DTE %35.8, kesinti 38.5 sa); Güneş ort. %95.5, en düşük %80.3
    (2026-12-28T20:30Z, az 78.85°, el +1.18°); karanlık 0 sa.
  - 2026-12-17T00:00Z: 200 km → **GREEN**, 135 km → **YELLOW** (aynı veri).
  - Eğim maks 9.34° / ort 5.86° (`site01_5m`, Δ 5 m, `screening_only`); gözlemci DEM 1944.83 m, σ 0.253 m; katmanlar 240/80/5/5 m, dışlanan yok.
- `npm run e2e` (nominal, varsayılan) → geçti: axe 10/10 ekran 0, mobil 0, konsol 0. `SITES=2 konum UNCERTAINTY=err 2026-12-17` →
  GREEN, Compare/Pareto, JSON katmanları 240/80/5/5 m, axe 0, mobil 0, konsol 0 (`logs/e2e_err_faz7/`).

#### 7.3 — Bilimsel P1 (aşamalı) — 13:35Z'den itibaren
- 13:36Z — Kullanıcıya 7.1/7.2 raporu + Site01 test senaryosu verildi (kullanıcının 8000/5173 sunucularına dokunulmuyor).
- 13:38Z — **PGDA keşfi (gerçek):**
  - Ürün 90 sayfası: `LDEM_60S_240MPP_ADJ_EFFRES.TIF` (259,831,703 B) ve `LDEM_80S_80MPP_ADJ_EFFRES.TIF` (250,228,467 B);
    açıklama "LDEM effective resolution (in meters)". `/data/LOLA_20mpp/` dizini listelenemiyor (404), dosyalar doğrudan erişilebilir.
  - Ürün 78 README: siteler 01, 04, 06, 07, 11, 20, 23, Haworth, Shoemaker, DM2; "Clones/: 100 clones of LDEM";
    sayfa notu "Site23 does not yet have error estimates or clones", fakat `Site23_final_adj_5mpp_toterr.tif` HTTP 200 (70,586,811 B).
  - Liste: Site01/04/07/11 için 100 clone (`SiteNN/Clones/SiteNN_final_adj_5mpp_NNNN_err.tif`, ~41 MB).
  - Site01 clone 0001 örnek incelemesi: tam LDEM (yükseklik), `_surf` ile aynı 3200² × 5 m ızgara; clone − surf std 0.44 m,
    medyan |clone − surf| / toterr = 0.73 (1σ Gauss beklentisi 0.674) → clone'lar toterr ile tutarlı gerçekleşimler.
    CRS WKT adları farklı ("unknown"), parametreler aynı.
- 13:38Z — İndirici: `--include-lola-effres`, `--include-site-5m-extra` (Site07/11/23), `--include-site-clones SITE`
  + `--clone-range N-M`; katalog yalnız resmi PGDA (ad, URL) çiftleri (400 clone girdisi). `--include-site-5m` (Site01/04) değişmedi.
  Testler +2 (katalog, CLI). İndirmeler başlatıldı (2 süreç; manifest yarışını önlemek için): site+EFFRES ve Site01 clone 1–100.
- ≈13:41Z — **EFFRES entegrasyonu (kod):** `terrain_engine.effective_resolution_summary` her kullanılan katman için gözlemci
  değeri + katmanın asıl LOD bandında (20 m: 0–5, 80 m: 0–30, 240 m: 30–200 km) medyan/p90/maks; site karoları `NOT_PUBLISHED`,
  indirilmemiş `MISSING`. Önbelleğe yazılmaz (ufuk/karar değişmez). `/horizon.effective_resolution` (v1.3); Mühendis telemetri satırı.
- 13:43Z — **Doğrulama genişletmesi (kod, kriterler koşudan önce sabit):** A-04 3 → 14 durum (2026–2035, −80.5…−89.98°,
  ±180° dikişi, 0–5 km, 29 Şubat; bağlantı için 3 deneme); `validation_sites()` = 2 sabit nokta + mevcut her site karo merkezi;
  V-05 ve V-08 bu konumların hepsinde, V-08'e k=2 ve band(k=2) ≥ band(k=1); V-07'ye gerçek eğri ufuklarda kısmi örtülme
  (0.01 < f < 0.99) örnekleri için bağımsız 401×401 Kartezyen referans (ölçüt < 0.01, ≥ 20 örnek); yeni EFFRES-01.
- 13:46–13:48Z — **Clone modu (kod):** `backend/clone_engine.py` (ön hesap CLI; 100 dosyanın tamamı + her birinin `_surf` ızgarası/CRS
  eşlemesi zorunlu; yalnız gözlemcinin karosu klonlanır), `decision_engine._clone_variant` (her clone gerçek profille;
  ihtiyatlı = kısıt başına clone p95 kötü taraf; ortak geçme oranı ayrıca), API clone modu: ön hesap yoksa gerekçeli
  `CLONE_NOT_PRECOMPUTED`; `/health.clones` (ekleyici). Frontend: clone bandı etiketi, telemetri satırı, form ipucu gerçek sayılardan.
- 13:51Z — Hata düzeltmesi: ERR modunda `excluded_layers` konumu kapsamayan katmanları da listeliyordu (ör. Site04 merkezinde
  `site23_5m`) → yalnız kapsayan katmanlar raporlanıyor; regresyon testi.
- 13:52Z — Testler: `python -m pytest -q` **92 passed** · `npx vitest run` **96 passed** · lint 0 · tsc 0.
  `python -m backend.scenario_search --days-step 150` kısa deneme çalıştı (21 analiz/7 konum; tam koşu veri inince).
- 13:54Z — Düzeltme: 7.3 kayıtlarındaki 13:45Z–14:12Z zaman damgaları tahminle ileri tarihli yazılmıştı; dosya mtime'larına göre düzeltildi (≈ = yaklaşık).
- 13:53Z — Site07/11/23 (9 dosya) indirildi + yapısal/CRS PASS. Değer kontrolü: Site07/11 3200² × 5 m, Site23 4200² × 5 m (21 × 21 km);
  tümü %100 sonlu. Site23 `toterr` 0.071–10.5 m (medyan 0.465 m): ürün 78 sayfasındaki "Site23'te hata tahmini yok" notu güncel değil görünüyor.
- 13:53Z — V-05 (gerçek, 7 konum) **PASS**: 200→250 km değişim 0° her konumda; 135→200 km maks 1.509° (Site11 merkezi, azimutların
  %13.9'u), Site07 1.149°, ridge 0.762°, Site23 0.503°. V-07 **PASS**: düz analitik maks 0.0028; gerçek eğri ufuklarda 3 konumda
  321 kısmi örtülme örneği, yoğun Kartezyen referansa göre maks |Δ| 0.0060, medyan 0.00055 (ölçüt < 0.01).
- ≈13:55Z — Clone zamanlaması: Site01 merkezi, clone #1 ile tam profil 2.1 s (nominal 1.9 s); gözlemci kotu 1944.832 → 1944.981 m,
  ufuk farkı maks 0.281°, medyan 0.027°. İndirme hızı için Site01 clone indirmesi 3 sürece bölündü (1–40 / 41–70 / 71–100; kilitli);
  manifest geçici dosyası süreç başına ayrıldı. Test kopyası: uvicorn :8001 + Vite :5174 (kullanıcının :8000/:5173'üne dokunulmadı).
- 13:54–13:58Z — **YELLOW araştırması (önceden sabit tasarım, `python -m backend.scenario_search --days-step 3`)**: 7 konum × 121 iniş
  (2026-12-01 … 2027-11-26, 3 günde bir), 48 + 12 sa, ERR k=1, 200 km, 4/4 m, +0/24/48/72 sa → `logs/scenario_search_faz7.json` (240 s).
  - `form_default` (karanlık ≤ 8 sa, Güneş ≥ %50, DTE ≥ %50, DTE kesintisi ≤ 8 sa): RED 729 · GREEN 110 · **YELLOW 8**.
  - `sun_only` (karanlık ≤ 8 sa, Güneş ≥ %50): RED 513 · GREEN 314 · **YELLOW 20**.
  - YELLOW konumları: Site01, Site07, Site11, Site23 merkezleri (iki sabit test noktasında ve Site04 merkezinde YELLOW yok).
    Sebepler: MIN_ILLUMINATION, MAX_DARKNESS ve MAX_DTE_GAP (yalnız ihtiyatlı ERR +1σ ufkunda).
  - Kural kopyası kontrolü: `form_default` için betiğin yeniden sınıflandırması her analizde `analyze_mission` kararıyla aynı (assert).
- 13:58Z — Hata düzeltmesi: önbellekten okunan ufuklar eski `excluded_layers` notunu taşıyordu (profil değerleri etkilenmez) →
  önbellek okumasında güncel bağlamdan yeniden yazılıyor.
- 13:59Z — **YELLOW gerçek API'de doğrulandı** (:8001, `logs/yellow_api_faz7.json`): Site01 merkezi, `site01_5m`, 2027-11-14T00:00Z,
  ERR k=1, form varsayılanları → **YELLOW**; nominal ihlal yok, ihtiyatlı `MAX_DTE_GAP` 41,400 s > 28,800 s (+72 sa senaryosu
  2027-11-17 00:00 → 2027-11-19 12:00Z; nominal kesinti 7.0 sa, ihtiyatlı 11.5 sa). Eğim ≤ 10° ile de YELLOW (maks 9.34°);
  aynı istek nominal modda GRAY. Tarayıcı (:5174) → YELLOW rozeti, mod geçişinde değişmedi, axe 0, mobil 0, konsol 0 (`logs/e2e_yellow_faz7/`).
- 14:00Z — Düzeltme (ikinci kez): 13:57Z–14:16Z kayıtları yine tahminle ileri tarihli yazılmıştı; dosya mtime'larıyla düzeltildi. Bundan sonra her kayıttan önce `date -u` alınıyor.
- ≈14:00Z — 240 m EFFRES indirildi (259,831,703 B, yapısal/CRS PASS). Gerçek değerler (Site01 merkezi): gözlemci 16.9 m, 30–200 km
  bandı medyan 24.5 m / p90 43.3 m → LOLA veri yoğunluğu 240 m ızgaradan çok daha ince; bu katmanda çözünürlüğü piksel sınırlıyor.
- 16:51Z (log mtime) — **Ağ kesintisi:** dört indirme süreci `Network unavailable (URLError)` ile durdu (makine/ağ uykuda; 16:51–20:25Z
  arası iş yok). Durum: 80 m EFFRES yok, Site01 clone 27/100. Yarım dosya yerleşmedi (`.part`/kilit kalmadı — kontrol edildi).
  Hata mesajı clone/site dosyaları için de ürün 90'ı öneriyordu → dosyanın kendi ürün sayfası (78/90) yazılıyor.
- 20:25Z — Ağ geri geldi (HEAD 200). İndirmeler 60 sn bekleme ile en çok 30 denemelik döngülerle yeniden başlatıldı
  (80 m EFFRES; clone 1–40 / 41–70 / 71–100). Sunucular :8000/:8001/:5173/:5174 ayakta.
- 20:26Z — **A-04 genişletilmiş (gerçek Horizons, ağ):** **PASS** — 14 durum / 28 yön (2026–2035, −80.5…−89.98°, ±180° dikişi,
  0–5 km, 29 Şubat), maks ayrım **5.77×10⁻⁷°** (eşik 0.005°) → `logs/a04_extended_faz7.json`.
- 20:29Z — **V-08 genişletilmiş:** **PASS** — 7 konum × k=1,2: tam kapsama, sıralama, band(k=2) ≥ band(k=1) her azimutta;
  k=1 maks bant 0.016° (−89.54/0) … 1.548° (Site23 merkezi, gözlemci σ 0.597 m); Site01 merkezi 0.739° (σ 0.253 m)
  → `logs/v08_extended_faz7.json`. Tutarlılık kontrolüdür, istatistiksel doğrulama değil.
- 20:39Z — 80 m EFFRES indirildi (250,228,467 B; yeniden deneme döngüsünün 1. denemesi). **EFFRES-01 PASS**: 240 m ve 80 m EFFRES
  DEM ile aynı ızgara (boyut, affine, CRS parametreleri); 7 konumda asıl LOD bandında ≥ %99 geçerli/pozitif. Bant medyanları:
  80 m (0–30 km) 15.5–18.6 m, 240 m (30–200 km) 24.5–27.0 m → LOLA veri yoğunluğu her iki ızgaradan ince; çözünürlüğü piksel sınırlıyor
  (`logs/effres01_faz7.json`).
- 20:40Z — Kullanıcı ekran görüntüsü (Data & Validation): site karolarında "EFFRES: yok" eksik veri gibi okunuyordu → hücre artık
  site karolarında "yayımlanmıyor" (PGDA ürün 78 EFFRES yayımlamaz; açıklama ipucunda), indirilmemiş katmanlarda "indirilmedi".
  README: doğrulama tablosu (A-04 14 durum, V-05/V-08 7 konum, V-07 eğri ufuk), YELLOW araştırması bölümü, EFFRES yorumu, API v1.3 satırları.
  Clone indirmesi sürüyor (≈42/100).
- 20:59Z — Kullanıcı yavaşlığı sordu; ölçüm: genel internet 5.7 MB/s (Cloudflare 20 MB), PGDA tek bağlantı 0.32 MB/s (sunucu tarafı
  bağlantı başı sınır). Clone indirmesi 3 → 6 paralel sürece çıkarıldı (36–40, 64–70, 95–100 ek süreçler; kilitli). Hız ≈ 1.5 clone/dk.
- 21:15–21:27Z — Altı süreç tekrar tekrar `Network unavailable (URLError)` aldı (bağlantı gidip geldi; döngüler 60 sn'de bir denedi,
  bu arada 80 → 86 clone). **Ayrıca gerçek bir hata bulundu:** Windows'ta 6 süreç aynı `manifest.json`'u okuyup değiştirirken
  paylaşım ihlali (WinError 5) → 3 süreçte `os.replace` başarısız, 2 süreçte okuma kilidi yanlışlıkla "manifest geçersiz" diye raporlandı.
  Manifest bozulmadı (geçerli JSON; 86 clone kaydı = diskteki 86 dosya). Düzeltme: okuma ve değiştirmede PermissionError için kısa
  yeniden deneme; yalnız gerçek JSON hatası "geçersiz"; yeni test. Ölü süreçlerin 3 geçici manifest dosyası silindi.
- 21:28Z — pytest `tests/test_download_lola.py` 24 passed. İndirme 86/100, döngüler yeni kodla devam ediyor.
