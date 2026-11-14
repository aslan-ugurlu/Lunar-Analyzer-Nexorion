# Lunar Mission Window Analyzer

NASA Space Apps Challenge 2026 — *Lunar Landing Site Navigator*. Ay güney kutbundaki bir konum için **gerçek NASA LOLA arazi verisi** ve **NAIF SPICE efemerisiyle** yerel arazi ufkunu hesaplar; Güneş diskinin ne kadarının görünür olduğunu ve Dünya merkezinin ufkun üstünde olup olmadığını (geometrik DTE) görev zaman penceresi boyunca değerlendirir, görev kısıtlarına göre `GREEN / YELLOW / RED / GRAY` ön eleme kararı verir.

> **Bu bir ön eleme / karar destek aracıdır.** İniş güvenliği, elektrik üretimi veya RF bağlantısı garantisi değildir; NASA onayı veya iniş sertifikası değildir. Veri yoksa sonuç uydurulmaz: `DEM_MISSING`, `SPICE_MISSING`, `CLONE_NOT_PRECOMPUTED` veya `GRAY` gösterilir.

## İçindekiler
1. [Hızlı başlangıç](#hızlı-başlangıç)
2. [Kullanılan NASA verileri](#kullanılan-nasa-verileri)
3. [Arayüz (P0 ekranlar)](#arayüz-p0-ekranlar)
4. [Demo adımları](#demo-adımları)
5. [Bilimsel model ve sınırlamalar](#bilimsel-model-ve-sınırlamalar)
6. [API](#api)
7. [Testler ve doğrulama durumu](#testler-ve-doğrulama-durumu)
8. [Deep-link doğrulaması (Moon Trek / QuickMap)](#deep-link-doğrulaması)
9. [Güvenlik ve kaynak sınırları](#güvenlik-ve-kaynak-sınırları)
10. [Bilinen eksikler](#bilinen-eksikler)

## Hızlı başlangıç

Gereksinimler: **Python 3.11+**, **Node.js 20+** (test edildi: Python 3.11.9, Node 24.14.0, npm 11.9.0, Windows 11). Komutlar **proje kökünden** çalıştırılır.

```powershell
# 1) Python bağımlılıkları (isteğe bağlı sanal ortam)
py -m venv .venv; .\.venv\Scripts\Activate.ps1
pip install -r requirements.txt

# 2) NASA verisi: NAIF kernel'leri (~45 MB) + LOLA 240 m referans DEM (~219 MB)
python -m backend.download_data --include-lola-240m
#    İsteğe bağlı: ERR katmanı (~267 MB) -> "err" belirsizlik modu (GREEN/YELLOW için gerekli)
python -m backend.download_data --include-lola-240m-err

# 3) Backend (tek API worker; --reload yalnız yerel geliştirmede)
uvicorn backend.main:app --host 127.0.0.1 --port 8000
#    OpenAPI: http://127.0.0.1:8000/docs   Sağlık: http://127.0.0.1:8000/health

# 4) Frontend (ayrı terminal)
cd frontend
npm install
npm run dev        # http://localhost:5173
```

Ortam değişkenleri:

| Değişken | Nerede | Varsayılan | Açıklama |
|---|---|---|---|
| `VITE_API_BASE_URL` | `frontend/.env` | `http://127.0.0.1:8000` | Backend adresi. `/api` yazılırsa Vite dev proxy kullanılır. |
| `LUNAR_CORS_ORIGINS` | backend kabuğu | `http://localhost:5173,http://127.0.0.1:5173` | Açık origin listesi; `*` başlangıçta reddedilir. |
| `CSPICE_SHARED_LIB` | backend kabuğu | — | spiceypy `cspice.dll`'i bulamazsa tam yol (bu makinede bir kez geçici olarak görüldü). |

Örnekler: [`.env.example`](.env.example), [`frontend/.env.example`](frontend/.env.example).

## Kullanılan NASA verileri

| Dosya (`data/` altında, Git'e eklenmez) | Kaynak | Durum (2026-11-14) | Doğrulama |
|---|---|---|---|
| `spice/naif0012.tls`, `pck00011.tpc`, `de440s.bsp`, `moon_pa_de440_200625.bpc`, `moon_de440_250416.tf` | [NASA JPL NAIF generic_kernels](https://naif.jpl.nasa.gov/naif/) | mevcut | başlık (`KPL/`, `DAF/`) + yerel SHA-256; kapsam V-01 ile doğrulandı |
| `lola/LDEM_60S_240MPP_ADJ.TIF` (218,961,039 B) | [PGDA ürün 90](https://pgda.gsfc.nasa.gov/products/90) — `https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LDEM_60S_240MPP_ADJ.TIF` | mevcut | HTTP 200 + Content-Length eşleşmesi + rasterio: 1 bant float32, 7760×7760, 240 m, CRS *Moon (2015) - Sphere / Ocentric / South Polar* (Polar Stereographic B, lat_ts −90°, lon_0 0°, R = 1,737,400 m), NoData = NaN, z −9127…7025 m |
| `lola/LDEM_60S_240MPP_ADJ_ERR.TIF` (267,005,175 B) | aynı ürün sayfası | mevcut (isteğe bağlı indirme) | aynı zincir; aynı CRS/ızgara, NoData NaN, kutup örneği σ 0.02–0.17 m |
| `lola/LDEM_80S_80MPP_ADJ.TIF`, `LDEM_80S_20MPP_ADJ.TIF`, `sites/*5mpp*` | PGDA | **otomatik indirilmez** | yalnız 240 m kullanılır; eğim kısıtı ≤ 20 m DEM ister |

- LOLA: *A New View of the Lunar South Pole from LOLA* — Barker et al. 2023, PSJ 4:183, DOI 10.3847/PSJ/acf3e1; veri DOI 10.60903/gsfcpgda-lola-spole. Ürün sayfasına göre yükseklikler metre, konumlar **MOON_ME (DE421)** çerçevesinde polar stereografiktir.
- SPICE frame **`MOON_ME_DE440_ME421`**, NAIF frame kernel'inde DE421 ortalama-Dünya çerçevesiyle yakından hizalı tanımlıdır → LOLA ürünleriyle tutarlı. PA→ME farkı 2026-12-01'de 103.9″ ölçüldü; kod her yerde ME kullanır.
- PGDA bu dosyalar için **checksum yayımlamıyor**. Manifest'teki SHA-256 yalnız yerel izlenebilirliktir (`official_sha256_matched: false`).
- İndirici güvenliği: kilit dosyası + 30 sn heartbeat (çakışan indirme reddedilir), yetim `.part`/kilit temizliği, disk ön-kontrolü, Content-Length zorunluluğu, rasterio doğrulaması, atomik `os.replace`. Varolan geçersiz dosyanın üzerine yazılmaz.

## Arayüz (P0 ekranlar)

React 19 + Vite 8 + TypeScript 6 (strict) + Tailwind 4 + Plotly.js (`react-plotly.js/factory` + `plotly.js-dist-min`, ayrı lazy chunk).

| Sekme | İçerik |
|---|---|
| Başlık | Backend Online/Offline, SPICE / LOLA 240 m / ERR / Clone durum çipleri, "Tüm zamanlar UTC", **Halk / Mühendis** anahtarı (yalnız anlatımı değiştirir; karar aynı kalır — test ve E2E ile doğrulandı) |
| **Mission Setup** | `/sites` katmanları ("indirilmeli" etiketi), enlem −90…−80 / boylam −180…180, ayrı UTC tarih+saat (tarayıcı saat dilimi kullanılmaz, ISO `Z` önizlemesi), görev/tampon/adım, 135/200 km, panel ve DTE anten yükseklikleri (1/4/40 m), nominal/err/clone, kısıtlar, örnekleme bütçesi; 202 + 2 sn polling; sonuç özeti, ihlal UTC aralıkları, provenance, kopyalanabilir özet; Halk modunda Dünya–Ay eğitim kartı |
| **Sky View** | 0–360° panorama (0 = Kuzey, 90 = Doğu), gerçek `/horizon` profili, Güneş/Dünya disklerinin **gerçek açısal boyutu** (0/360 sarma), ERR bandı yalnız API verirse, eksik ışınlar işaretli, ayrı anten ufku, gövdeye yakınlaştırma, güney kutbu azimut/meridyen notu |
| **Timeline** | `scenarios[].timeline` ile f_sun ve geometrik DTE, en uzun karanlık/kesinti vurgusu, tıklama + klavye kaydırıcı (Sky View ile eşzamanlı), +0/+24/+48/+72 senaryoları, `/scenarios/shift` ile yeni kaymalar (ebeveyn korunur), mühendis modunda yükseklik-ufuk grafiği |
| **Compare** | Yalnız aynı görev profilindeki tamamlanmış analizler; `/compare` priority (balanced/sun/comms/resilience); GREEN/YELLOW sıralı listeler, RED/GRAY gerekçeli kartlar; arayüz kendi puanını üretmez |
| **Data & Validation** | `/health` ("dosya var" ≠ "bilimsel doğrulandı"), katman tablosu + indirme komutları, `/validation` PASS/FAIL/BLOCKED/NOT_RUN + kanıt, NASA kaynakları, sınırlamalar |

Hata/boş durumlar: backend yok (`BACKEND_OFFLINE`), `SPICE_MISSING`, `DEM_MISSING`, `TERRAIN_UNAVAILABLE`, `CLONE_NOT_PRECOMPUTED`, `WORKER_UNAVAILABLE`, `ANALYSIS_TIMEOUT`, 422 (alan bazlı), 429 `RATE_LIMITED`/`QUEUE_FULL`, 409 hazır değil, 404 (sunucu yeniden başladıysa), `INCOMPARABLE`. Kodlar her zaman metinle birlikte görünür; bilinmeyen kodlar gizlenmez.

## Demo adımları

1. Backend ve frontend'i başlatın; başlıkta **Backend: Online**, **LOLA 240 m: var** görünmeli.
2. **Mission Setup** → "Belgelerdeki örnek koordinatı doldur (−89.54°, 0°)" → **Analizi başlat**. ~2–60 sn içinde *Tamamlandı*; karar **RED** (bu nokta −754 m'lik bir çukurda: Güneş ve Dünya sürekli arazi arkasında).
3. Enlem/boylamı **−89.4512, −137.1427** yapıp tekrar başlatın (DEM yüksekliği 1950.3 m olan bir sırt noktası; kutba 40 km içindeki en yüksek piksele — 1954.3 m @ −89.4455°, −137.3137° — komşu; *resmi aday değildir*). Sonuç: Güneş diski görev boyunca %100 görünür, fakat 1–4 Aralık 2026 penceresinde Dünya ufkun altında (−1.9° … −4.6°) → DTE %0 → **RED**. Aynı nokta için 16–24 Aralık 2026'da Dünya yerel ufkun belirgin üstündedir; iniş tarihini değiştirmek sonucu değiştirir.
4. **Sky View**: panorama, "Güneş'e yakınlaştır", kaydırıcıyı ok tuşlarıyla gezdirin.
5. **Timeline**: senaryo +24/+48/+72; "+6 sa" ekleyip **Kayma senaryolarını hesapla** → yeni analiz listelenir.
6. **Compare**: iki konum analizini seçin → **Karşılaştır**. İkisi de RED olduğundan Pareto sıralaması yok; gerekçeler ve QuickMap/Moon Trek bağlantıları gösterilir.
7. Üst sağdan **Mühendis** moduna geçin: aynı karar, ek olarak az/el, UTC, metrik tablosu, ihlal aralıkları, DEM kaynağı, cache anahtarı.
8. **Data & Validation**: kernel/katman durumu ve kayıtlı gerçek doğrulama sonuçları.
9. **ERR ile GREEN örneği:** belirsizlik **ERR ±k** (k = 1), iniş **2026-12-17 00:00 UTC**, aynı kısıtlarla iki konum: (−89.4512, −137.1427) ve (−88.6663, −68.2302) (ikincisi DEM'de kutba 60 km içinde, ilkinden ≥ 8 km uzak ikinci en yüksek piksel, 1809.9 m; *resmi aday değildir*). Gerçek sonuç: ikisi de **GREEN** — tüm +0/24/48/72 senaryolarında nominal ve ihtiyatlı (ERR +1σ) varyantta Güneş diski %100, DTE %100, karanlık/kesinti 0 sa. **Compare**: iki GREEN aday, karşılıklı Pareto-baskın değil. Bu, tanımlı kısıtların bu 60 saatlik pencerede 240 m DEM ile sağlandığını söyler; eğim değerlendirilmedi, iniş güvenliği değildir. GREEN/YELLOW yalnız ERR modunda mümkündür.

## Bilimsel model ve sınırlamalar

- Konum: Moon Mean-Earth (`MOON_ME_DE440_ME421`), planetosentrik enlem, doğu-pozitif boylam, küre R = 1737.4 km, radyal yerel düşey; gözlemci yarıçapı `1737.4 km + (h_DEM + h_sensör)/1000`. Panel ve DTE anteni ayrı yüksekliklere sahip olabilir.
- Güneş/Dünya: SPICE `spkcpo`, `LT+S`, DE440s, UTC→ET (`naif0012.tls`). Tam −90°'de azimut, girilen boylamın meridyenine göre tanımlanır.
- Ufuk: 3600 azimut (0.1°), 200 km referans yarıçap (API sınırı; 250 km yalnız offline doğrulamada), mesafeye göre adım (20/80/240 m), bilinear örnekleme; eksik piksel o ışını NaN yapar (sıfırla doldurma yok) → `partial` → GRAY.
- Güneş görünürlüğü: sonlu disk payı `f_sun`, alan-eşit polar quadrature + iki kademeli fark raporu. **Elektrik üretimi değildir.**
- DTE: yalnız Dünya **merkezinin** arazi ufku üstünde olması. **RF bağlantı bütçesi değildir.**
- Karar: nominal ihlal → RED; nominal geçer ama ihtiyatlı (ERR +k) ihlal → YELLOW; veri/doğrulama eksik → GRAY; GREEN yalnız nominal + ihtiyatlı geçerse. **Nominal mod tek başına GREEN üretmez.**
- ERR ±k bir duyarlılık senaryosudur, istatistiksel güven aralığı değildir. DEM clone verisi yok → `CLONE_NOT_PRECOMPUTED`.
- Eğim: ≤ 20 m DEM gerekir; yoksa `SLOPE_UNKNOWN` → GRAY. Eğim iniş güvenliği değildir.
- Zaman serisi örneklenmiştir; geçiş anları adım içinde belirsizdir. 200 km tarama eksiksizlik kanıtı değildir; 0.1° örnekleme tek başına %2 doğruluk garantisi değildir.

## API

FastAPI, `http://127.0.0.1:8000/docs`. Uzun işler `202 + analysis_id`, durum `GET /analyses/{id}` (`queued | running | completed | partial | failed`).

| Uç nokta | Not |
|---|---|
| `GET /health` | `status` ready/degraded = dosya varlığı; **v1.1 eklemeleri**: `layers` (dem/err/effres), `clone_profiles`, `limits`, `scientific_validation` |
| `GET /sites` | **v1.1**: `kind`, `effres_available`, `expected_file`, `expected_folder` (göreli), `source_page` |
| `POST /analyses` | 202; 503 `SPICE_MISSING`/`DEM_MISSING`; 429 `RATE_LIMITED`/`QUEUE_FULL`; **v1.1**: 422 yanıtında `error.details[{field, message, type}]` (girdi değeri geri yansıtılmaz) |
| `GET /analyses/{id}` · `/horizon` · `/timeline` | 404 `ANALYSIS_NOT_FOUND`, 409 `HORIZON_NOT_READY`/`TIMELINE_NOT_READY` |
| `POST /compare` | `analysis_ids` (2–12), `priority`; 422 `INCOMPARABLE` (konum/dataset dışındaki her parametre aynı olmalı) |
| `POST /scenarios/shift` | 202; ebeveyn ufku yeniden kullanılır |
| `GET /validation` | **v1.1 yeni**: yalnız `python -m backend.validation` gerçek koşusunun raporu; yoksa tümü `NOT_RUN` |

v1.1 değişiklikleri **eklemelidir** (mevcut alanlar korunur) ve `tests/test_api_v11.py` ile test edilir. Ayrıca: kontrollü localhost CORS, iş zaman aşımı (`ANALYSIS_TIMEOUT`, 1800 s), havuz yalnız `lifespan` içinde.

## Testler ve doğrulama durumu

Son gerçek koşular (2026-11-14, Windows 11):

| Komut | Sonuç |
|---|---|
| `python -m pytest -q` | **62 passed** (sözleşme, SPICE UTC→ET, `--include-lola-240m` 17 senaryo, Windows spawn 7, API v1.1, doğrulama koşucusu, Pareto regresyonu) |
| `python -m backend.verify_horizons` | `all_passed: true` — 6 Güneş/Dünya yönü, maks ayrım 4.14×10⁻⁷° (eşik 0.005°) |
| `python -m backend.validation` | **10 PASS · 1 BLOCKED** (V-06) → `data/validation/report.json` |
| `cd frontend; npx vitest run` | **71 passed** (UTC, istemci hataları, form sınırları, deep-link URL sözleşmesi, polling, gerçek-sonuç fikstürüyle bileşen ve grafik sözleşmeleri, Dünya–Ay kartı) |
| `npm run build` / `npm run lint` | başarılı / 0 sorun |
| `npm run e2e` | gerçek backend + sistem Chrome (playwright-core): 2 konum, kayma, /compare, Halk↔Mühendis, mobil 390 px (taşma 0), **axe-core 10 tarama 0 ihlal**, konsol hatası 0; ayrıca `UNCERTAINTY=err LANDING_DATE=2026-12-17` ile GREEN + Pareto akışı |
| `npm run e2e:states` | 8/8: gerçek `DEM_MISSING`; işaretli mock ile çevrimdışı, `SPICE_MISSING`, `QUEUE_FULL`, `WORKER_UNAVAILABLE` + 409; geçersiz girdi istemcide engellenir |

Mock kullanımı: yalnız UI/istemci sözleşme testlerinde ve indirici testlerinde (HTTP mock + `tmp_path` içinde sentetik minik GeoTIFF); her biri dosya başında işaretlidir. UI bileşen testleri, gerçek bir API yanıtının kısaltılmış kopyasını (`frontend/src/test/fixtures/real_analysis_62e783c2.json`, `_provenance` alanı) kullanır.

Bilimsel doğrulama (`GET /validation`, PASS yalnız kayıtlı vakaları kapsar):

| Test | Durum | Kanıt |
|---|---|---|
| A-04 / V-04 Horizons | PASS (sınırlı) | 3 site × 2 cisim × 3 tarih; Horizons merkez `MEAN_ME`, küre 1737.4; yükseklikler sentetik |
| V-01 kaynak + kapsam | PASS | de440s 1849–2150; moon PA bpc 1550–2650 ⊇ 2026–2035 |
| V-02 frame/koordinat | PASS | raster küresi 1737.4 km, kutup = (0,0), +90°E → +x; PA→ME 103.9″ |
| V-03 UTC→ET | PASS | 4 tarih, bağımsız TT−UTC = 69.184 s ile < 0.01 s |
| V-05 135/200/250 km | PASS (2 site) | 200→250 km değişim 0°; **135→200 km: 1950 m'lik sırt noktasında 0.457°, azimutların %7.1'i** → hızlı mod yüksek konumlarda yetersiz olabilir |
| V-06 LOD/NoData | BLOCKED | NaN yayılımı doğru; LOD geçişi yalnız 240 m olduğundan test edilemedi |
| V-07 disk quadrature | PASS (düz ufuk) | analitik daire segmentine karşı maks hata 0.0028 |
| V-08 ERR/clone | PASS (yalnız tutarlılık) | 2 sitede ERR ±1σ: tam kapsama, ihtiyatlı ≥ nominal ≥ iyimser, gözlemci σ 0.028 / 0.036 m, bant ≤ 0.006° / 0.104°. İstatistiksel doğrulama değildir. Clone: NOT_RUN (veri yok) |
| V-09 kısıt mantığı | PASS | elle hesaplanmış girdiler |
| V-10 izlenebilirlik | PASS | gerçek analizde provenance alanları; nominal → GRAY |

## Deep-link doğrulaması

Kontrol tarihi **2026-11-14**; yöntem: uygulamaların kendi JavaScript kodu + headless Chrome'da iki güney kutbu konumunun açılması. Koordinatlar sayısal/sonlu ve aralık içi doğrulanır; bağlantılar `target="_blank" rel="noopener noreferrer"`.

| Araç | URL şeması | Durum |
|---|---|---|
| LROC QuickMap | `https://quickmap.lroc.im-ldi.com/?proj=27&center=<lon>,<lat>&resolution=20` — `proj=27` = *Stereographic (South Pole)* IAU2000:30120, `center` derece (doğu-pozitif −180…180), harita ürünleri Mean Earth. `quickmap.lroc.asu.edu` yeni adrese 301 ile yönleniyor. | **VERIFIED** — iki sitede tam ortalandı |
| NASA Moon Trek | `https://trek.nasa.gov/moon/#v=0.1&x=<m>&y=<m>&z=8&p=urn%3Aogc%3Adef%3Acrs%3AIAU2000%3A%3A30120&d=&b=moon` — x/y güney polar stereografik metre (R = 1737400 m, lon_0 = 0; ρ = 2R·tan(45°+φ/2), x = ρ·sinλ, y = ρ·cosλ). URN'de çift iki nokta (`::`) gerekir. | Biçim **VERIFIED**; koordinata odaklanma **UNRELIABLE** (−89.45/−137.5: 4/4; −85.5/30: 2/7 — diğerlerinde kutup genel görünümü). Arayüz bunu açıkça yazar. |

Her iki araç da bu parametreleri resmi olarak belgelemiyor; uygulamalar değişirse bağlantılar bozulabilir. Sözleşme testleri: `frontend/src/lib/__tests__/deeplinks.test.ts`.

Dünya–Ay eğitim kartı kaynakları: NASA NSSDC [Earth](https://nssdc.gsfc.nasa.gov/planetary/factsheet/earthfact.html) ve [Moon](https://nssdc.gsfc.nasa.gov/planetary/factsheet/moonfact.html) fact sheet'leri (gün 24.0000 sa, eğiklik 23.44°; sinodik 29.53 g, yıldız dönmesi 655.72 sa, gece yüzey basıncı 3×10⁻¹⁵ bar), [NASA SVS 5229](https://svs.gsfc.nasa.gov/5229/) (Ay ekseni 1.5°), [NASA Science — Shadows near the Moon's South Pole](https://science.nasa.gov/resource/shadows-near-the-moons-south-pole/) (kutuplarda Güneş ufkun en fazla 1.5° üstünde/altında).

## Bu çalışmada bulunan ve düzeltilen backend hataları

| Hata | Etki | Düzeltme + test |
|---|---|---|
| `str2et('YYYY-MM-DDTHH:MM:SS UTC')` → `SPICE(UNPARSEDTIME)` | **Her** analiz ve A-04 başarısızdı | boşluklu UTC biçimi; `tests/test_spice_time.py` |
| Horizons AIRLESS başlıkları `Azimuth_/Elevation_(a-app)` | A-04 ayrıştırılamıyordu | regex ile iki biçim; gerçek başlıkla test |
| `pareto_compare` döngü içinde `costs` silme | ≥ 2 GREEN/YELLOW adayda `/compare` → 500 | ilişkiler önce hesaplanır; `tests/test_pareto.py` |
| ERR modunda `geometry.observer_err_m` hep `None` | provenance eksik | ihtiyatlı çağrının σ'sı raporlanır; V-08 ölçütü; cache şema sürümü |
| `MAX_CACHE_MB` tanımlı ama uygulanmıyordu | sınırsız önbellek | `prune_cache` + test |
| Zaman aşımı / kapanışta takılı native iş | süreç asılı kalabilirdi | `ANALYSIS_TIMEOUT` + worker terminate; spawn testleri |

## Güvenlik ve kaynak sınırları

- En fazla **2 `spawn` worker**, en fazla **6 bekleyen/çalışan iş** (`429 QUEUE_FULL`), istemci başına **5 analiz/dk** (`429 RATE_LIMITED`; tek instance, bellek içi — internete açılırsa paylaşımlı limit ve reverse proxy gerekir).
- Havuz yalnız FastAPI `lifespan` içinde oluşturulur (import'ta değil); worker çökmesi → `WORKER_UNAVAILABLE` + havuz yenilenir; zaman aşımı → worker süreçleri sonlandırılır; kapanışta takılı iş beklenmez.
- `dataset_id` yalnız katalogdan; kullanıcı dosya yolu kabul edilmez; yanıtlar traceback/mutlak yol içermez; 422 ayrıntıları girdi değerini yansıtmaz.
- Ufuk önbelleği `data/cache/` (kota `MAX_CACHE_MB` = 1536, en eskiler silinir). Analiz kayıtları yalnız bellekte; frontend sonuçları tarayıcıya kalıcı yazmaz.
- CORS yalnız açık localhost origin'leri; wildcard reddedilir. Sunucu varsayılan olarak `127.0.0.1`'e bağlanır.

## Bilinen eksikler

- YELLOW (nominal geçer, ERR +k ihlal) durumu gerçek veriyle henüz gözlenmedi; mantığı birim testleriyle doğrulandı.
- 80 m / 20 m / 5 m katmanları yok → LOD geçişi (V-06) ve eğim kısıtı test edilmedi; eğim her zaman `SLOPE_UNKNOWN`.
- DEM clone belirsizliği uygulanmadı (`CLONE_NOT_PRECOMPUTED`).
- A-04 yalnız 3 geometri/tarih; V-05 yalnız 2 konum; V-07 yalnız düz ufuk. Tam yıl ve eğri arazi kanıtı değildir.
- Moon Trek koordinata odaklanma güvenilir değil (dış uygulama kaynaklı).
- Rate-limit tek süreç içi; analiz kayıtları sunucu yeniden başlayınca kaybolur (UI 404'ü "kayboldu" olarak gösterir).

Oturum devamlılığı ve ayrıntılı kanıt günlüğü: [`PROGRESS.md`](PROGRESS.md). Bilimsel ve güvenlik sözleşmesi: [`CLAUDE.md`](CLAUDE.md).
