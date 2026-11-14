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
#    İsteğe bağlı (LOD + eğim): 80 m DEM (~189 MB) + 80 m ERR (~255 MB), Site01/Site04 5 m surf/toterr/slp (6 × ~41 MB)
python -m backend.download_data --include-lola-80m --include-lola-80m-err --include-site-5m
#    İsteğe bağlı (Faz 7): Site07/11/23 5 m (~0.5 GB), EFFRES etkin çözünürlük (240 + 80 m, ~510 MB),
#    DEM clone'ları (site başına 100 × ~41 MB) + clone ufuk ön hesabı (konum başına ~4 dk)
python -m backend.download_data --include-site-5m-extra --include-lola-effres
python -m backend.download_data --include-site-clones Site01 [--clone-range 1-100]
python -m backend.clone_engine --lat -89.46316 --lon -137.48955

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
| `lola/LDEM_80S_80MPP_ADJ.TIF` (+ `_ERR`) | [PGDA ürün 90](https://pgda.gsfc.nasa.gov/products/90) `/data/LOLA_20mpp/` | `--include-lola-80m` / `--include-lola-80m-err` | aynı zincir; 30 km içindeki ufuk halkasında kullanılır (LOD) |
| `sites/Site01_final_adj_5mpp_{surf,toterr,slp}.tif`, `sites/Site04_…` | [PGDA ürün 78](https://pgda.gsfc.nasa.gov/products/78) `/data/LOLA_5mpp/` (Barker et al. 2021, PSS 203:105119) | `--include-site-5m` | 5 m/piksel, 16 × 16 km karo, güney polar stereografik (R 1737.4 km), NoData NaN; `_surf` boş pikselleri **enterpolasyonla doldurulmuş** (README); `_toterr` RMS (m); `_slp` resmi eğim (°) yalnız doğrulamada kullanılır. Site01 = *Connecting ridge*, Site04 = *Shackleton rim* (PGDA README; karo adıdır, iniş noktası değildir) |
| `sites/Site07_…`, `Site11_…` (3200² × 5 m), `Site23_…` (4200² × 5 m, 21 × 21 km) `{surf,toterr,slp}` | [PGDA ürün 78](https://pgda.gsfc.nasa.gov/products/78) | `--include-site-5m-extra` | aynı zincir; Site07 Peak near Shackleton, Site11 de Gerlache rim, Site23 Malapert massif (README). Ürün sayfası "Site23'te hata tahmini yok" diyor, fakat `Site23_…_toterr.tif` mevcut ve 0.07–10.5 m (medyan 0.47 m) değer içeriyor (2026-11-14) |
| `lola/LDEM_60S_240MPP_ADJ_EFFRES.TIF` (259,831,703 B), `lola/LDEM_80S_80MPP_ADJ_EFFRES.TIF` (250,228,467 B) | [PGDA ürün 90](https://pgda.gsfc.nasa.gov/products/90): "LDEM effective resolution (in meters)" | `--include-lola-effres` | aynı zincir + EFFRES-01 (DEM ile aynı ızgara). **Yalnız veri kalitesi bilgisi**: ufku, metrikleri veya kararı değiştirmez |
| `sites/clones/Site01/Site01_final_adj_5mpp_NNNN_err.tif` (100 × ~41 MB) | ürün 78 `SiteNN/Clones/` ("100 clones of LDEM") | `--include-site-clones Site01` (Site01/04/07/11 katalogda) | her clone tam 5 m yükseklik haritası, `_surf` ile aynı ızgara (eşleme her dosyada kontrol edilir); clone − surf std 0.44 m (Site01 #1) |
| `LDEM_80S_20MPP_ADJ.TIF`, Site06/20/Haworth/Shoemaker/DM2 | PGDA | **indirilmez** | — |

- Not: 5 m site DEM'leri **ürün 90'da değil, ürün 78'de** yayımlanıyor (2026-11-14 kontrol). İndirici yalnız katalogdaki resmi (ad, URL) çiftlerini kabul eder.
- LOD: ufuk ışınının 0–5 km'si en ince mevcut katmandan (5 m site → 80 m → 240 m), 5–30 km'si 80 m'den, ötesi 240 m'den örneklenir. **ERR modunda yalnız ERR katmanı olan DEM'ler kullanılır**; diğerleri `excluded_layers` alanında gerekçesiyle raporlanır (karışık katman ERR ışınlarını NaN yapıp GRAY'e düşürürdü).
- LOLA: *A New View of the Lunar South Pole from LOLA* — Barker et al. 2023, PSJ 4:183, DOI 10.3847/PSJ/acf3e1; veri DOI 10.60903/gsfcpgda-lola-spole. Ürün sayfasına göre yükseklikler metre, konumlar **MOON_ME (DE421)** çerçevesinde polar stereografiktir.
- SPICE frame **`MOON_ME_DE440_ME421`**, NAIF frame kernel'inde DE421 ortalama-Dünya çerçevesiyle yakından hizalı tanımlıdır → LOLA ürünleriyle tutarlı. PA→ME farkı 2026-12-01'de 103.9″ ölçüldü; kod her yerde ME kullanır.
- PGDA bu dosyalar için **checksum yayımlamıyor**. Manifest'teki SHA-256 yalnız yerel izlenebilirliktir (`official_sha256_matched: false`).
- İndirici güvenliği: kilit dosyası + 30 sn heartbeat (çakışan indirme reddedilir — paralel indirmelerde gerçek koşuda görüldü), yetim `.part`/kilit temizliği, disk ön-kontrolü, Content-Length zorunluluğu, kopan/kesik aktarımda **HTTP Range ile aynı çağrı içinde devam** (en fazla 4 deneme; 206 + `Content-Range` ve ETag eşleşmeli), rasterio doğrulaması, atomik `os.replace`. Varolan geçersiz dosyanın üzerine yazılmaz. 2026-11-14'te 80 m DEM'in ilk aktarımı gerçekten kesik geldi (187.36/189.16 MB) ve reddedildi.

## Arayüz (P0 ekranlar)

React 19 + Vite 8 + TypeScript 6 (strict) + Tailwind 4 + Plotly.js (`react-plotly.js/factory` + `plotly.js-dist-min`, ayrı lazy chunk).

| Sekme | İçerik |
|---|---|
| Başlık | Backend Online/Offline, SPICE / LOLA DEM (mevcut çözünürlükler, ör. "240 · 80 · 5 m") / ERR / Clone durum çipleri, "Tüm zamanlar UTC", **Halk / Mühendis** anahtarı (yalnız sunumu değiştirir; karar aynı kalır — test ve E2E ile doğrulandı) |
| **Mission Setup** | `/sites` katmanları ("indirilmeli" etiketi), enlem −90…−80 / boylam −180…180, ayrı UTC tarih+saat (tarayıcı saat dilimi kullanılmaz, ISO `Z` önizlemesi), görev/tampon/adım, 135/200 km, panel ve DTE anten yükseklikleri (1/4/40 m), nominal/err/clone, kısıtlar, örnekleme bütçesi; 202 + 2 sn polling; sonuç özeti, ihlal UTC aralıkları, provenance, kopyalanabilir özet; Halk modunda Dünya–Ay eğitim kartı |
| **Sky View** | 0–360° panorama (0 = Kuzey, 90 = Doğu), gerçek `/horizon` profili, Güneş/Dünya disklerinin **gerçek açısal boyutu** (0/360 sarma), ERR bandı yalnız API verirse, eksik ışınlar işaretli, ayrı anten ufku, gövdeye yakınlaştırma, güney kutbu azimut/meridyen notu |
| **Timeline** | `scenarios[].timeline` ile f_sun ve geometrik DTE, en uzun karanlık/kesinti vurgusu, tıklama + klavye kaydırıcı (Sky View ile eşzamanlı), +0/+24/+48/+72 senaryoları, `/scenarios/shift` ile yeni kaymalar (ebeveyn korunur), mühendis modunda yükseklik-ufuk grafiği |
| **Compare** | Yalnız aynı görev profilindeki tamamlanmış analizler; `/compare` priority (balanced/sun/comms/resilience); GREEN/YELLOW sıralı listeler, RED/GRAY gerekçeli kartlar; arayüz kendi puanını üretmez |
| **Data & Validation** | `/health` ("dosya var" ≠ "bilimsel doğrulandı"), katman tablosu + indirme komutları, `/validation` PASS/FAIL/BLOCKED/NOT_RUN + kanıt, NASA kaynakları, sınırlamalar |

Hata/boş durumlar: backend yok (`BACKEND_OFFLINE`), `SPICE_MISSING`, `DEM_MISSING`, `TERRAIN_UNAVAILABLE`, `CLONE_NOT_PRECOMPUTED`, `WORKER_UNAVAILABLE`, `ANALYSIS_TIMEOUT`, 422 (alan bazlı), 429 `RATE_LIMITED`/`QUEUE_FULL`, 409 hazır değil, 404 (sunucu yeniden başladıysa), `INCOMPARABLE`. Kodlar her zaman metinle birlikte görünür; bilinmeyen kodlar gizlenmez.

### Halk / Eğitimci ve Mühendis modları (aynı sonuç, farklı sunum)

| | Halk / Eğitimci | Mühendis |
|---|---|---|
| Görev formu | Ana sorular sade dille; tampon, zaman adımı, tarama yarıçapı, ERR k, karanlık eşiği, eğim ve ayak izi **"Gelişmiş görev ayarları" akordeonunda** (kapalı; özet satırı var; gizli alanda hata olursa kendiliğinden açılır) | Tüm kısıt ve sensör parametreleri açık; ufuk hesap yükü ayrıntısı |
| Sonuç | Büyük **KPI kartları** (Güneş görünürlüğü, en uzun karanlık, Dünya görüşü, en uzun Dünya kesintisi; kısıt durumu ikon + kelime), sade **hikâye** anlatımı, "Neden bu sonuç?" listesi, Türkçe sınırlamalar, öne çıkarılmış **Dünya–Ay eğitim kartı** | En üstte **telemetri**: `MOON_ME_DE440_ME421`, DEM katmanları + çözünürlük, kullanılmayan katmanlar, gözlemci kotu tablosu (h_DEM + h_obs → r), ERR σ, cache anahtarı, eğim; **ihlal UTC aralıkları tablosu**; senaryo metrik tablosu |
| Sky View | Panorama + anlık açıklama + Öğren kartı | Ufuk özeti: panel/anten profili min/maks açı ve azimutu, eksik ışın, panel–anten farkı, ERR bant genişliği |
| Timeline | f_sun / DTE grafiği, kaymalar | Güneş/Dünya açısal yükseklik grafiği **üstte**, **JSON / CSV ham veri dışa aktarma** (yalnız API değerleri) |

Hata ve veri eksikliği UX'i (Faz 7, kullanıcı kararı 2026-11-14): kodlar **hiçbir modda silinmez**.
- **Halk:** `DEM_MISSING`, `SPICE_MISSING`, `CLONE_NOT_PRECOMPUTED` vb. başlık olarak gösterilmez. Önce anlaşılır Türkçe başlık gelir (ör. “Arazi verisi henüz mevcut değil”), sonra açıklama ve “Ne yapabilirsiniz”. Ham kod, teknik açıklama ve komut, klavyeyle açılabilen **“Teknik detaylar”** (`<details>`) bölümündedir. Analiz listesi ve Compare gerekçeleri de sade başlığı kullanır.
- **Mühendis:** teknik başlık + ham kod çipi + mühendis açıklaması + komut doğrudan görünür.
- Erişilebilirlik: hata kutuları `role=alert` (uyarılar `role=status`); gönderim hatasında odak hata kutusuna taşınır. `e2e:states` her durumu iki modda ve Halk'ta “Teknik detaylar”ı **klavyeyle** açarak doğrular; hata ekranlarında axe 0 ihlal.
- Halk modunda ayrıca gizlenenler: ham durum etiketleri, ihlal kodları, metrik/provenance tabloları ve cache anahtarı.

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
- **DEM clone modu (v1.3):** PGDA'nın 100 gerçek clone LDEM'i ile; her clone için gözlemci karosu yerine clone konarak tam ufuk yeniden hesaplanır (çevrimdışı ön hesap). Karar ERR ile aynı kuralla: nominal ihlal RED; ihtiyatlı = her kısıt için clone topluluğunun %95 kötü tarafı (max-tip p95, min-tip p05) ihlal ederse YELLOW; ayrıca tüm kısıtları sağlayan clone sayısı raporlanır. Gerçek örnek: Site01 merkezi 2027-11-14 → clone YELLOW (+72 sa'da 73/100 clone geçti; p95 DTE kesintisi 10.5 sa > 8 sa), ERR ile aynı sınıf.
- **200 km referans kuralı (v1.3):** ufuk 200 km'den kısa tarandıysa (ör. 135 km hızlı mod) karar **en fazla YELLOW** olur (`radius_policy.code = REDUCED_HORIZON_RADIUS`, GREEN → YELLOW). Gerekçe: kısa tarama, referans arazi örneklerinin bir alt kümesi üzerinde maksimum alır; ufku yalnız alçaltabilir, yani Güneş/DTE görünürlüğü iyimserdir. Bu yüzden 135 km'de RED geçerli kalır; YELLOW/GRAY 200 km'de kötüleşebilir. Gerçek koşu (2026-11-14, ERR k=1, 2026-12-17): aynı istek 200 km → GREEN, 135 km → YELLOW (`logs/radius_policy_faz7.json`).
- ERR ±k bir duyarlılık senaryosudur, istatistiksel güven aralığı değildir. DEM clone verisi yok → `CLONE_NOT_PRECOMPUTED`.
- Eğim: ≤ 20 m DEM gerekir; yoksa `SLOPE_UNKNOWN` → GRAY. Eğim iniş güvenliği değildir.
- Zaman serisi örneklenmiştir; geçiş anları adım içinde belirsizdir. 200 km tarama eksiksizlik kanıtı değildir; 0.1° örnekleme tek başına %2 doğruluk garantisi değildir.
- **DEM clone kapsamı:** yalnız Site01 (100 PGDA clone) ve yalnız ön hesaplanmış iki koordinat — Site01 karo merkezi (−89.46316, −137.48955) ve sırt test noktası (−89.4512, −137.1427), panel = anten 4 m, 200 km. Diğer konumlar `CLONE_NOT_PRECOMPUTED` / GRAY. Arayüz bu listeyi `/health.clones.profile_sets`'ten gösterir. Yalnız gözlemcinin 5 m karosu klonlanır; 80 m / 240 m nominal kalır.
- **CLONE-01 sapması:** \|clone − surf\| / toterr medyanı 0.726, Gauss 1σ beklentisi 0.674 → Site01 clone'larının yüzeyden sapması PGDA belirsizlik haritasının ima ettiğinden **≈ %8 büyük**. Ölçüt (0.55–0.80) içinde; clone yayılımı istatistiksel güven aralığı değildir.
- **NASA onayı değildir:** doğrulama sonuçları proje ekibinin NASA verisiyle yaptığı kendi testleridir; NASA/JPL/GSFC/PGDA tarafından onaylanmış veya sertifikalandırılmış değildir. Ayrıntı ve veri sürümleri: [`docs/VALIDATION.md`](docs/VALIDATION.md).

### Gerçek veride karar sınıfları (Faz 7, önceden sabit tasarım)

`python -m backend.scenario_search --days-step 3` → `logs/scenario_search_faz7.json`. Konumlar: 2 sabit test noktası + 5 site karo merkezi
(raster merkezi, resmi iniş noktası değil); iniş 2026-12-01 … 2027-11-26 arasında 3 günde bir (121 tarih); 48 + 12 sa, ERR k=1, 200 km,
4/4 m, +0/24/48/72 sa. Tasarım koşudan önce sabitlendi; hiçbir eşik sonuç üretmek için ayarlanmadı.

| Kısıt profili | RED | GREEN | YELLOW |
|---|---|---|---|
| form varsayılanları (karanlık ≤ 8 sa, Güneş ≥ %50, DTE ≥ %50, DTE kesintisi ≤ 8 sa) | 729 | 110 | **8** |
| yalnız Güneş (karanlık ≤ 8 sa, Güneş ≥ %50) | 513 | 314 | **20** |

- YELLOW Site01, Site07, Site11 ve Site23 merkezlerinde görüldü (sebep yalnız ihtiyatlı ERR +1σ ufkunda `MIN_ILLUMINATION`, `MAX_DARKNESS` veya `MAX_DTE_GAP`).
- Örnek, gerçek HTTP API + tarayıcıda doğrulandı: **Site01 karo merkezi (−89.46316, −137.48955), 2027-11-14 00:00 UTC, ERR k=1, form varsayılanları → YELLOW**:
  nominal ihlal yok; +72 sa senaryosunda (2027-11-17 00:00 → 2027-11-19 12:00 UTC) DTE kesintisi nominal 7.0 sa, ihtiyatlı 11.5 sa > 8 sa.
  Aynı istek nominal modda GRAY (nominal tek başına GREEN/YELLOW vermez).
- EFFRES (etkin çözünürlük) yorumu: Site01 merkezinde 240 m ürünün EFFRES'i gözlemcide 16.9 m, 30–200 km bandında medyan 24.5 m
  → LOLA ölçüm yoğunluğu 240 m ızgaradan çok daha ince; o katmanda çözünürlüğü piksel boyutu sınırlar. EFFRES karar girdisi değildir.

## API

FastAPI, `http://127.0.0.1:8000/docs`. Uzun işler `202 + analysis_id`, durum `GET /analyses/{id}` (`queued | running | completed | partial | failed`).

| Uç nokta | Not |
|---|---|
| `GET /health` | `status` ready/degraded = dosya varlığı; **v1.1 eklemeleri**: `layers` (dem/err/effres), `clone_profiles`, `limits`, `scientific_validation` |
| `GET /sites` | **v1.1**: `kind`, `effres_available`, `expected_file`, `expected_folder` (göreli), `source_page`; **v1.2**: `region_name` (PGDA README), `footprint` (raster'ın kendi georeferansından merkez, enlem aralığı, boyut; dosya yoksa `null`) |
| `POST /analyses` | 202; 503 `SPICE_MISSING`/`DEM_MISSING`; 429 `RATE_LIMITED`/`QUEUE_FULL`; **v1.1**: 422 yanıtında `error.details[{field, message, type}]` (girdi değeri geri yansıtılmaz) |
| `GET /analyses/{id}` · `/horizon` · `/timeline` | 404 `ANALYSIS_NOT_FOUND`, 409 `HORIZON_NOT_READY`/`TIMELINE_NOT_READY` |
| `POST /compare` | `analysis_ids` (2–12), `priority`; 422 `INCOMPARABLE` (konum/dataset dışındaki her parametre aynı olmalı) |
| `POST /scenarios/shift` | 202; ebeveyn ufku yeniden kullanılır |
| `GET /validation` | **v1.1 yeni**: yalnız `python -m backend.validation` gerçek koşusunun raporu; yoksa tümü `NOT_RUN`. **v1.2**: `SLOPE-01` eklendi |
| ufuk sonucu (`/horizon`) | **v1.2**: `layer_resolution_m`, `excluded_layers`; cache şeması 3 |
| görev sonucu (`result.mission`) | **v1.3**: `radius_policy` {`code` `REDUCED_HORIZON_RADIUS`/`REFERENCE_RADIUS`, `radius_km`, `reference_radius_km`, `below_reference`, `status_before_policy`, `status_after_policy`, `capped`, `note`}; mühendis açıklamasında `radius_policy=` |
| ufuk sonucu (`/horizon`) | **v1.3**: `effective_resolution` {`units`, `note`, `layers`: katman başına `status` (`OK`/`MISSING`/`NOT_PUBLISHED`), `pixel_m`, `band_km`, `at_observer_m`, `median_m`, `p90_m`, `max_m`}; önbelleğe yazılmaz, karar girdisi değildir. Clone modunda `uncertainty_mode: "clone"`, `clone_ensemble` (clone sayısı, karo, profil anahtarı, p05–p95 bant notu) ve `profiles.*.cautious/optimistic` = clone p95/p05 (yalnız gösterim) |
| `GET /health` | **v1.3**: `clones` {`sites`: site başına `present/expected/complete`, `precomputed_profile_sets`, `profile_sets` (clone modunun çalıştığı koordinat, gözlemci yüksekliği, yarıçap; dosya yolu yok)}; `clone_profiles` dizgesi korunur (`AVAILABLE`/`NOT_PRECOMPUTED`) |
| `POST /analyses` `uncertainty_mode: "clone"` | **v1.3**: ön hesaplanmış gerçek clone profili varsa her clone için metrik; ihtiyatlı varyant = kısıt başına clone p95-kötü değer (`metrics.method: clone_p95`), `variants.cautious.clone` {`n`, `pass_count`, `pass_fraction`, `fail_count_by_code`}; yoksa gerekçeli `CLONE_NOT_PRECOMPUTED` (GRAY) |

v1.1 değişiklikleri **eklemelidir** (mevcut alanlar korunur) ve `tests/test_api_v11.py` ile test edilir. Ayrıca: kontrollü localhost CORS, iş zaman aşımı (`ANALYSIS_TIMEOUT`, 1800 s), havuz yalnız `lifespan` içinde.

## Testler ve doğrulama durumu

Bilimsel doğrulamanın tam kanıtı (ölçütler, gerçek ölçümler, veri sürümleri, tekrarlanabilir senaryolar): **[`docs/VALIDATION.md`](docs/VALIDATION.md)** — ham rapor `docs/validation/report_2026-11-14.json`, veri sürümleri `docs/validation/data_versions_2026-11-14.json`. Bu sonuçlar NASA onayı veya sertifikası değildir.

Son gerçek koşular (2026-11-14, Windows 11):

| Komut | Sonuç |
|---|---|
| `python -m pytest -q` | **97 passed** (+4 gerçek-veri senaryosu `tests/test_realdata_scenarios.py`: ERR YELLOW 2027-11-14, nominal GRAY + 135 km tavanı, RED + eğim 2026-12-26, clone YELLOW 73/100; NASA dosyaları yoksa *skipped*) — önceki 93: (sözleşme, SPICE UTC→ET, indirici 24 senaryo — HTTP Range devamı + Windows manifest paylaşım ihlali dahil, Windows spawn 7, API v1.1–v1.3, LOD/ERR katman tutarlılığı + EFFRES özeti, clone motoru 5, doğrulama koşucusu, Pareto regresyonu, 200 km referans kuralı 8) |
| `python -m backend.verify_horizons` | `all_passed: true` — 6 Güneş/Dünya yönü, maks ayrım 4.14×10⁻⁷° (eşik 0.005°) |
| `python -m backend.validation` | **14 / 14 PASS** (A-04, V-01…V-10, SLOPE-01, EFFRES-01, CLONE-01; 2026-11-14T21:48Z, ağ dahil) → `data/validation/report.json` |
| `cd frontend; npx vitest run` | **97 passed** (mod ayrımı, Halk/Mühendis hata UX'i, 135 km tavanı gösterimi, EFFRES metni, clone varyantı tablosu, telemetri, CSV dışa aktarma dahil) (UTC, istemci hataları, form sınırları, deep-link URL sözleşmesi, polling, gerçek-sonuç fikstürüyle bileşen ve grafik sözleşmeleri, Dünya–Ay kartı) |
| `npm run build` / `npm run lint` | başarılı / 0 sorun |
| `npm run e2e` | gerçek backend + sistem Chrome (playwright-core): 2 konum, kayma, /compare, Halk↔Mühendis, mobil 390 px (taşma 0), **axe-core 10 tarama 0 ihlal**, konsol hatası 0; ayrıca `UNCERTAINTY=err LANDING_DATE=2026-12-17` ile GREEN + Pareto akışı, `UNCERTAINTY=err LANDING_DATE=2027-11-14` (Site01 merkezi) ile **YELLOW**, `UNCERTAINTY=clone` ile clone modu YELLOW + kayma |
| `npm run e2e:states` | 17/17 kontrol, **her durum iki modda**: Halk'ta sade başlık + kod yalnız klavyeyle açılan “Teknik detaylar”da, Mühendis'te kod doğrudan; SPICE hatasında odak taşınır; hata ekranlarında axe 0. Gerçek `DEM_MISSING` (indirilmemiş `lola_20m`); işaretli mock ile çevrimdışı, `SPICE_MISSING`, `QUEUE_FULL`, `WORKER_UNAVAILABLE` + 409; geçersiz girdi istemcide engellenir |

Mock kullanımı: yalnız UI/istemci sözleşme testlerinde ve indirici testlerinde (HTTP mock + `tmp_path` içinde sentetik minik GeoTIFF); her biri dosya başında işaretlidir. UI bileşen testleri, gerçek bir API yanıtının kısaltılmış kopyasını (`frontend/src/test/fixtures/real_analysis_62e783c2.json`, `_provenance` alanı) kullanır.

Bilimsel doğrulama (`GET /validation`, PASS yalnız kayıtlı vakaları kapsar):

| Test | Durum | Kanıt |
|---|---|---|
| A-04 / V-04 Horizons | PASS (sınırlı) | **14 durum × 2 cisim = 28 yön** (Faz 7): 2026–2035, enlem −80.5…−89.98°, ±180° dikişi, gözlemci 0–5 km, 29 Şubat 2028; maks ayrım **5.77×10⁻⁷°** (eşik 0.005°). Horizons merkez `MEAN_ME`, küre 1737.4; yükseklikler sentetik. Tam yıl/tüm konum kanıtı değildir |
| V-01 kaynak + kapsam | PASS | de440s 1849–2150; moon PA bpc 1550–2650 ⊇ 2026–2035 |
| V-02 frame/koordinat | PASS | raster küresi 1737.4 km, kutup = (0,0), +90°E → +x; PA→ME 103.9″ |
| V-03 UTC→ET | PASS | 4 tarih, bağımsız TT−UTC = 69.184 s ile < 0.01 s |
| V-05 135/200/250 km | PASS (7 konum) | 2 sabit nokta + 5 site karo merkezi: 200→250 km değişim **0°** her konumda; **135→200 km: maks 1.509° (Site11 merkezi, azimutların %13.9'u)**, Site07 1.149°, sırt noktası 0.762°, Site23 0.503° → 200 km'den kısa tarama GREEN veremez (v1.3 kuralı) |
| V-06 LOD/NoData | PASS | NaN yayılımı doğru; 5 katman çifti medyan farkı −0.09…+0.63 m (ölçüt < 5 m; 80−240: −0.09 m, Site01−80: +0.09 m, Site04−80: −0.08 m); LOD 1 km → 5 m site, 10 km → 80 m, 100 km → 240 m |
| V-07 disk quadrature | PASS (düz + gerçek eğri ufuk) | düz: analitik daire segmentine karşı maks 0.0028; **gerçek ufuklar**: 3 konumda 321 kısmi örtülme örneği (0.01 < f < 0.99), bağımsız 401×401 Kartezyen referansa göre maks \|Δ\| **0.0060**, medyan 0.00055 (ölçüt < 0.01). Yalnız disk integralini sınar (aynı ufuk enterpolasyonu), ufuk doğruluğunu değil |
| V-08 ERR | PASS (yalnız tutarlılık) | **7 konum × k=1,2**: tam kapsama, ihtiyatlı ≥ nominal ≥ iyimser, band(k=2) ≥ band(k=1) her azimutta; k=1 maks bant 0.016° (−89.54/0) … 1.548° (Site23 merkezi, gözlemci σ 0.597 m), Site01 merkezi 0.739°. İstatistiksel doğrulama değildir |
| CLONE-01 DEM clone | PASS (yalnız tutarlılık) | Site01: 100 clone'un hepsi `_surf` ızgarasında; \|clone − surf\| / toterr medyanı **0.726** (aralık 0.721–0.730; ölçüt 0.55–0.80; saf Gauss beklentisi 0.674 → clone sapmaları toterr'in ima ettiğinden ~%8 büyük); 2 ön hesap seti, her biri 100/100 tam profil (~201 s). Bilgi: clone p05–p95 yayılımı azimutların %100'ünde ERR k=2 bandı içinde (maks 0.24° / 0.58° vs 0.56° / 1.42°). Site04/07/11 clone'ları indirilmedi. İstatistiksel DEM doğrulaması değildir |
| EFFRES-01 etkin çözünürlük | PASS | 240 m + 80 m EFFRES DEM ile aynı ızgara; 7 konumda asıl LOD bandında ≥ %99 geçerli. Bant medyanları 80 m (0–30 km) 15.5–18.6 m, 240 m (30–200 km) 24.5–27.0 m. Yalnız kalite bilgisi |
| V-09 kısıt mantığı | PASS | elle hesaplanmış girdiler |
| V-10 izlenebilirlik | PASS | gerçek analizde provenance alanları; nominal → GRAY |
| SLOPE-01 5 m eğim | PASS | bizim 5 m merkezi-fark eğimimiz ile **resmi PGDA `_slp.tif`** 5 karoda 725 noktada: medyan \|Δ\| 0.07° (ölçüt ≤ 2°); Site01 merkezi maks 9.34° / ort 5.86°, Site04 karo merkezi ~31–34° (Shackleton iç duvarı). Uçtan uca: eğim kısıtlı gerçek analiz eğimi `site01_5m`'den değerlendirdi; HTTP API'de err + ≤ 10° → GREEN, err + ≤ 5° → RED (`MAX_SLOPE`). Eğim iniş güvenliği değildir |

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

- 5 m karolar Site01/04/07/11/23 ile sınırlı; dışında eğim `SLOPE_UNKNOWN` (GRAY katkısı) kalır. 20 m katmanı ve Site06/20/Haworth/Shoemaker/DM2 indirilmez.
- DEM clone modu yalnız **Site01** için (100 clone indirildi) ve yalnız **ön hesaplanmış** konum/gözlemci yüksekliği/yarıçap için çalışır (şu an Site01 karo merkezi ve sırt test noktası, 4/4 m, 200 km). Diğer konumlar gerekçeli `CLONE_NOT_PRECOMPUTED` / GRAY döner; ön hesap `python -m backend.clone_engine --lat … --lon …` (~3.5 dk). Yalnız gözlemcinin karosu klonlanır; 80/240 m nominal kalır.
- Clone ihtiyatlı kuralı (kısıt başına p95-kötü clone) bir tarama kuralıdır; sertifikalı güven düzeyi değildir.
- A-04 14 durum, V-05/V-08 7 konum, V-07 3 konumda 321 örnek: kapsam genişledi ama tam yıl / tüm konum kanıtı değildir.
- Moon Trek koordinata odaklanma güvenilir değil (dış uygulama kaynaklı).
- Rate-limit tek süreç içi; analiz kayıtları sunucu yeniden başlayınca kaybolur (UI 404'ü "kayboldu" olarak gösterir).

Oturum devamlılığı ve ayrıntılı kanıt günlüğü: [`PROGRESS.md`](PROGRESS.md). Bilimsel ve güvenlik sözleşmesi: [`CLAUDE.md`](CLAUDE.md).
