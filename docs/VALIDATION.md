# Bilimsel doğrulama kanıtı — 2026-11-14

> **Önemli:** Buradaki tüm sonuçlar, proje ekibinin NASA'nın kamuya açık verileriyle **kendi yaptığı testlerdir**.
> NASA, JPL, GSFC veya PGDA tarafından **onaylanmış, incelenmiş ya da sertifikalandırılmış değildir**. PASS yalnız kaydedilen
> durumları ve önceden yazılmış ölçütü kapsar; iniş güvenliği, güç üretimi veya radyo bağlantısı garantisi değildir.

- Koşu: `python -m backend.validation` (ağ dahil), **2026-11-14T21:48:51Z** → sonuç **14 / 14 PASS**.
- Ham rapor: [`validation/report_2026-11-14.json`](validation/report_2026-11-14.json) (`data/validation/report.json` kopyası; `/validation` uç noktası aynısını sunar).
- Veri sürümleri: [`validation/data_versions_2026-11-14.json`](validation/data_versions_2026-11-14.json) — her dosyanın resmi URL'si, ürün sayfası,
  bayt boyutu, indirme zamanı ve **yerel** SHA-256'sı (PGDA checksum yayımlamaz; bu değerler NASA kimlik doğrulaması değildir).
- Yeniden üretmek: `python -m backend.export_evidence` (veri içermeyen kanıt dosyalarını yazar).

## Kullanılan veri

| Grup | Dosyalar | Kaynak |
|---|---|---|
| SPICE | `naif0012.tls`, `pck00011.tpc`, `de440s.bsp`, `moon_pa_de440_200625.bpc`, `moon_de440_250416.tf`; frame `MOON_ME_DE440_ME421` | NASA JPL NAIF generic_kernels |
| LOLA 240 m / 80 m | `LDEM_60S_240MPP_ADJ{,_ERR,_EFFRES}.TIF`, `LDEM_80S_80MPP_ADJ{,_ERR,_EFFRES}.TIF` | PGDA ürün 90 (Barker vd. 2023, PSJ 4:183) |
| 5 m site karoları | Site01 (Connecting ridge), Site04 (Shackleton rim), Site07 (Peak near Shackleton), Site11 (de Gerlache rim), Site23 (Malapert massif) — `_surf`, `_toterr`, `_slp` | PGDA ürün 78 (Barker vd. 2021, PSS 203:105119) |
| DEM clone | Site01 `Clones/Site01_final_adj_5mpp_0001…0100_err.tif` (100 dosya, 4,098,716,270 B) | PGDA ürün 78 |
| Clone ufuk ön hesabı | Site01 karo merkezi (−89.46316, −137.48955) ve sırt test noktası (−89.4512, −137.1427); panel = anten 4 m; 200 km; her biri 100/100 tam profil | `python -m backend.clone_engine` (yerel türetilmiş) |

Test konumları: iki sabit nokta (−89.54, 0) ve (−89.4512, −137.1427) + mevcut her 5 m karonun **raster kapsam merkezi**
(resmi iniş noktası değildir). JPL Horizons karşılaştırmasında gözlemci yükseklikleri sentetiktir.

## Sonuçlar (önceden yazılmış ölçüt → gerçek ölçüm)

| Test | Ölçüt | Gerçek ölçüm | Durum |
|---|---|---|---|
| A-04 / V-04 Horizons | Güneş/Dünya yönü farkı ≤ 0.005° | 14 durum × 2 cisim = 28 yön; 2026–2035, enlem −80.5…−89.98°, ±180° dikişi, 0–5 km, 29 Şubat 2028; **maks 5.77×10⁻⁷°** | PASS |
| V-01 kaynak/kapsam | SPK + Ay PA PCK 2026–2035'i kapsar | de440s ve `moon_pa_de440_200625.bpc` kapsamı 2026–2035'i içerir | PASS |
| V-02 frame/koordinat | ME frame yüklü; raster 1737.4 km küre, güney kutup stereo, doğu-pozitif | sağlandı | PASS |
| V-03 UTC→ET | bağımsız TT−UTC = 69.184 s ile ≤ 0.01 s | sağlandı (yeni artık saniye varsayılmaz) | PASS |
| V-05 tarama yarıçapı | 200→250 km ufuk değişimi < 0.05° (her konum) | 7 konumda **0°**. Bilgi: 135→200 km maks **1.509°** (Site11 merkezi, azimutların %13.9'u) → 200 km'den kısa tarama GREEN veremez | PASS |
| V-06 LOD/NoData | NoData = NaN; her örtüşen katman çiftinde \|medyan fark\| < 5 m | 11 çift: −0.24 … +0.63 m (ör. 80−240 −0.09, Site01−80 +0.09, Site23−240 +0.37 m); LOD 1 km → 5 m, 10 km → 80 m, 100 km → 240 m | PASS |
| V-07 disk integrali | düz analitik ve gerçek eğri ufukta \|Δ\| < 0.01 | düz maks 0.0028; gerçek ufuklarda 321 kısmi örtülme örneği (3 konum), bağımsız 401×401 Kartezyen referansa göre maks **0.0060**, medyan 0.00055 | PASS |
| V-08 ERR tutarlılığı | tam kapsama; ihtiyatlı ≥ nominal ≥ iyimser; band(k=2) ≥ band(k=1) | 7 konum × k=1,2 sağlandı; k=1 maks bant 0.016° … 1.548° (Site23 merkezi, gözlemci σ 0.597 m) | PASS |
| V-09 kısıt mantığı | elle hesaplanmış girdiler | sağlandı | PASS |
| V-10 izlenebilirlik | gerçek analizde provenance alanları | sağlandı; nominal mod → GRAY | PASS |
| SLOPE-01 eğim | bizim 5 m eğim vs resmi PGDA `_slp.tif`, medyan \|Δ\| ≤ 2° | 5 karoda 725 nokta, medyan **0.07°**; Site01 merkezi maks 9.34° / ort 5.86° | PASS |
| EFFRES-01 | EFFRES DEM ile aynı ızgara; 7 konumda asıl LOD bandında ≥ %99 geçerli/pozitif | sağlandı; bant medyanları 80 m (0–30 km) 15.5–18.6 m, 240 m (30–200 km) 24.5–27.0 m | PASS |
| CLONE-01 | 100 clone `_surf` ızgarasında; her clone için medyan \|clone − surf\| / toterr ∈ [0.55, 0.80]; ≥ 1 tam ön hesap seti | Site01: ızgara OK; medyan **0.726** (0.721–0.730); 2 set × 100/100 profil. Bilgi: clone p05–p95 yayılımı azimutların %100'ünde ERR k=2 bandı içinde | PASS |

## Sınırlamalar (sonuçlarla birlikte okunmalı)

- **CLONE-01 sapması:** \|clone − surf\| / toterr medyanı 0.726; toterr'in Gauss 1σ olduğu varsayımında beklenen 0.674.
  Yani Site01 clone'larının yüzeyden sapması, PGDA belirsizlik haritasının ima ettiğinden **≈ %8 büyüktür**. Ölçüt aralığı içindedir,
  ama clone yayılımı istatistiksel güven aralığı olarak yorumlanmamalıdır.
- **Clone kapsamı:** yalnız Site01 (Site04/07/11 clone'ları indirilmedi) ve yalnız ön hesaplanmış iki koordinat (4/4 m, 200 km).
  Yalnız gözlemcinin 5 m karosu klonlanır; 80 m / 240 m katmanlar nominal kalır.
- ERR ±k bir duyarlılık senaryosudur, güven aralığı değildir. EFFRES yalnız kalite bilgisidir, karar girdisi değildir.
- A-04 14 durum, V-05/V-08 7 konum, V-07 3 konumda 321 örnek: kapsam geniş ama tam yıl / tüm konum kanıtı değildir.
- 200 km tarama yarıçapı referans seçimdir; eksiksizlik kanıtı değildir. Zaman örneklemesi 30 dk; geçiş anları adım içinde belirsizdir.

## Tekrarlanabilir gerçek-veri senaryoları

`python -m pytest -q tests/test_realdata_scenarios.py` — üretim worker'ını (`POST /analyses` ile aynı Pydantic yükü) gerçek dosyalarla
çalıştırır; NASA dosyaları yoksa testler **atlanır** (sahte geçiş yok). 2026-11-14'te gözlenen değerler sabitlenmiştir; bir değişiklik
"sonuç değişti" demektir ve belgelenmelidir. Ortak ayarlar: Site01 karo merkezi (−89.46316, −137.48955), `site01_5m`, 48 + 12 sa,
30 dk, +0/24/48/72 sa, 4/4 m, k=1, kısıtlar: karanlık ≤ 8 sa, Güneş ≥ %50, DTE ≥ %50, DTE kesintisi ≤ 8 sa.

| Senaryo | Beklenen (gözlenen) sonuç |
|---|---|
| ERR, iniş 2027-11-14 00:00 UTC | **YELLOW** — nominal ihlal yok; +72 sa (2027-11-17 00:00 → 11-19 12:00 UTC) DTE kesintisi nominal 7.0 sa, ihtiyatlı 11.5 sa > 8 sa |
| aynı istek, nominal mod | GRAY (nominal tek başına GREEN/YELLOW veremez) |
| ERR, 2026-12-17 00:00 UTC: 200 km / 135 km | GREEN / YELLOW (`REDUCED_HORIZON_RADIUS`, GREEN → YELLOW) |
| ERR + eğim ≤ 10°, 2026-12-26 12:00 UTC | RED (`MIN_DTE`, `MAX_DTE_GAP`); eğim `site01_5m` maks 9.34° |
| clone, 2027-11-14 | **YELLOW** — +72 sa'da **73/100 clone** tüm kısıtları sağlar, 27'si `MAX_DTE_GAP`; clone p95 kesinti 10.5 sa |
| clone, 2026-12-17 / 2026-12-26 | GREEN / RED (ERR ile aynı sınıf) |

Tarayıcı karşılıkları (gerçek backend + Chrome): `cd frontend` ve
`$env:APP_URL="http://localhost:5174"; $env:SITES="-89.46316,-137.48955"; $env:UNCERTAINTY="err"; $env:LANDING_DATE="2027-11-14"; $env:LANDING_TIME="00:00"; node e2e/smoke.mjs ../logs/e2e_yellow`
(`UNCERTAINTY="clone"` ile clone modu). Yıllık sınıf taraması: `python -m backend.scenario_search --days-step 3`
(7 konum × 121 iniş; form varsayılanları RED 729 / GREEN 110 / YELLOW 8, yalnız Güneş RED 513 / GREEN 314 / YELLOW 20).
