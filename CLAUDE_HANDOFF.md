# LUNAR MISSION WINDOW ANALYZER — CLAUDE CODE DEVİR VE TAMAMLAMA TALİMATI

> **Claude Code için görev:** Bu dosyayı bütünüyle oku, ardından proje kökündeki mevcut `CLAUDE.md`, `README.md`, `backend/`, `tests/` ve veri kataloğunu incele. **İndirme sürerken mevcut işlemi kesme.** Sonrasında projeyi gerçek veriye bağlı çalışan, sunulabilir bir NASA Space Apps 2026 prototipine dönüştür. Kullanıcının her adımda yeni prompt yazmasını bekleme; gerekli işleri sırayla, test ederek gerçekleştir.

## 0. Durum ve kesin bağlam

- Proje: **Lunar Mission Window Analyzer** — NASA Space Apps Challenge 2026, “Lunar Landing Site Navigator” doğrultusunda Ay güney kutbu iniş adayları için aydınlanma ve doğrudan Dünya geometrik görüşü karar destek sistemi.
- Kullanıcı Windows/PowerShell üzerinde proje kökünden sırayla şunları başlattı:
  ```powershell
  pip install -r requirements.txt
  python -m backend.download_data
  python -m pytest -q
  uvicorn backend.main:app --host 127.0.0.1 --port 8000
  ```
- Kullanıcının son bildirimi: **“Şu anda indiriyor.”** Bu, **kurulum/test/server başarıyla tamamlandı** anlamına GELMEZ. Önce gerçek terminal çıktısını incele. Aynı terminalde ilk indirme sürerken sonraki komutların çalıştığını varsayma. `download_data` indirmesi yalnızca NAIF/SPICE dosyalarını kapsıyor; **LOLA GeoTIFF dosyalarını otomatik indirmiyor**.
- Backend'in daha önce teslim edilen ZIP'i `lunar-mission-window-analyzer-backend.zip` ve proje dizininde şu dosyalar bulunmalı: `backend/config.py`, `backend/download_data.py`, `backend/astro_engine.py`, `backend/verify_horizons.py`, `backend/terrain_engine.py`, `backend/decision_engine.py`, `backend/main.py`, `tests/test_contract.py`, `requirements.txt`, `README.md`, `CLAUDE.md`.
- Bu belge projenin **kök dizinine** konulmalıdır. Mevcut `CLAUDE.md` dosyasını silme; bu belge **uygulama/devir planı**, mevcut `CLAUDE.md` ise **bilimsel ve güvenlik sözleşmesidir**. Çatışmada sahte sonuç üretmeme ve bilimsel dürüstlük önceliklidir.

## 1. Çalışma tarzı ve görev sahibi olma

1. Önce `pwd`, dosya ağacı, `git status`, Python/Node sürümleri, bağımlılıklar, `data/` durumu, çalışan süreçler ve test çıktısını denetle. Kullanıcının gerçek makinesinde dosya zaten varsa **üzerine körlemesine yazma**. Kullanıcının değişikliklerini koru; gerekirse küçük, ayrı commit'lerle ilerle.
2. Kullanıcıdan gereksiz onay veya tekrar bilgi isteme. Ortam ve izinler elveriyorsa dosyaları doğrudan oluştur; komutları çalıştır; her aşamanın sonucunu not et. Veri indirme devam ediyorsa bağımsız frontend/entegrasyon çalışmalarını paralel yürüt, ancak indirmeye dokunma.
3. Her iddiayı gerçek komut çıktısıyla doğrula. `pytest` geçmesi astronomik doğruluğu kanıtlamaz; `all_passed=true` yalnızca seçilmiş Horizons gözlemleri için bir sonuçtur. Gerçek DEM yokken tam görev hesabı geçti deme.
4. Testlerde mock yalnızca **UI durumları/kontratları** ve izole otomatik test için kullanılabilir; mock olduğunu açıkça işaretle. Mock veriyi gerçek NASA sonucu veya canlı ön eleme sonucu olarak göstermeyeceksin.
5. Zaman baskısında P0 çalışan ürün > P1 bilimsel sağlamlaştırma > P2 kozmetik/3D. Kullanıcıya yarım kalanları somut biçimde raporla, tamamlandı diye gösterme.

## 2. Bilimsel model — değiştirilemez kurallar

- Konum: **Moon Mean Earth (ME)**, SPICE frame `MOON_ME_DE440_ME421` (yüklenen frame kernel'iyle doğrula). Planetosentrik enlem, doğu-pozitif boylam. Ay referans yarıçapı **1737,4 km**. Referans radyal `Up`, yerel `East` ve `North`; tam güney kutbunda azimutun seçilen meridyene bağlı olduğunu belirt.
- Gözlemci yarıçapı: `1737.4 km + (h_DEM + h_sensor)/1000`; Güneş paneli ile DTE anteninin ayrı sensör yükseklikleri vardır. `h_DEM` gerçek LOLA rasterından gelmelidir; test amaçlı sentetik yükseklik gerçek yüzey kotu değildir.
- Güneş/Dünya konumları: NAIF SPICE `spkcpo`, `LT+S` görünür konum, UTC→ET/TDB, kernel kapsamı ve zaman-dilimli UTC doğrulaması. Güneş ve Dünya'nın **sonlu görünür diskleri** grafik üzerinde, görünürlük hesabında ise Güneş diski payı `f_sun` ile temsil edilir.
- Güneş görünürlüğü ≠ elektrik üretimi. Dünya merkezi arazi ufku üstü **geometrik DTE** ≠ garantili RF bağlantısı veya veri hızı. Yüzey eğimi ≠ iniş tehlikesizliği. Uygulama **ön eleme/karar destek** aracıdır, iniş sertifikası değildir.
- LOLA DEM kaynakları NASA PGDA. Referans güney kutup 240 m rasterı: `data/lola/LDEM_60S_240MPP_ADJ.TIF`; isteğe bağlı 80 m raster: `data/lola/LDEM_80S_80MPP_ADJ.TIF`; ERR/EFFRES ve 5 m site ürünleri **gerçek dosyaları ve gerçek footprint/metadata** doğrulanınca etkinleştir.
- Raster projeksiyonunun 1737.4 km Moon küresel tanımı ile uyumunu **gerçek GeoTIFF CRS/metadata** üzerinden kontrol et. Polar stereographic projeksiyonunu ve merkez meridyenini tahmin ederek kullanma. ME/PA frame farklarını doğrulamadan aynı kabul etme. NoData/eksik kapsamı sıfır kotla doldurma.
- 200 km referans ufuk yarıçapı; 135 km hızlı mod, 135/200/250 km **offline** duyarlılık testleri. 3600 azimut (0,1°) + ayrık/uyarlamalı hassasiyet kontrolü. Ufuk hesabı sensör yüksekliğine, kaynak raster sürümüne, konum ve yönteme bağlı **cache key** kullanmalı. 0,1° örnekleme tek başına %2 doğruluk garantisi değildir.
- ERR ±k senaryosu **istatistiksel güven aralığı olarak sunulamaz**. EFFRES kalite sinyali eksikse kayıtta belirt. 100 DEM clone ancak gerçek clone veri setleri, semantiği ve mekânsal hizası doğrulanınca; yoksa `CLONE_NOT_PRECOMPUTED`/GRAY.
- GREEN yalnızca nominal + ihtiyatlı senaryolar zorunlu kısıtları karşılayıp gerekli veriler yeterliyse; nominal geçer ihtiyatlı geçmezse YELLOW; nominal kısıt ihlalinde RED; veri yetersiz/hesap belirsizse GRAY. **Kesinlik aşırı iddiası yok.** Kullanılan kısıtların hangi saatlerde aşıldığını göster.
- Kısıt örnekleri: azami kesintisiz karanlık, asgari ortalama Güneş disk görünürlük payı, asgari DTE payı, azami kesintisiz DTE kesintisi, iniş footprint eğimi, iniş +0/+24/+48/+72 saat kayması, görev süresi ve tampon.
- A-04 Horizons doğrulaması: Güneş+Dünya, birden fazla tarih ve konum, dinamik başlık ayrıştırması, açı vektör farkı hedefi `≤0.005°`. Horizons `GEODETIC` ile yerel SPICE'ın **aynı fiziksel gözlemci, referans yarıçap, geometri ve UTC** tanımına sahip olduğunu ayrıca doğrula; referans küreyi metne yazmak tek başına kanıt değildir.
- V-01–V-10 bilimsel testler: veri kaynakları ve kernel kapsamı, frame/koordinat uyumu, UTC dönüşümü, Horizons karşılaştırması, ufuk 135/200/250 km menzil duyarlılığı, raster LOD/NoData, sonlu Güneş disk integrasyon yakınsaması, ERR/clone gerçek belirsizlik, kısıt doğruluğu ve izlenebilirlik. Veri/erişim yoksa `NOT_RUN` olarak açıkça raporla.

## 3. Güvenlik ve kaynak sınırları

- FastAPI/Pydantic doğrulama; izinli `dataset_id` kataloğu; kullanıcıdan gelen keyfi dosya yolu kesinlikle yasak.
- Native geometri hesabı ana API event loop'unda değil `spawn` süreçlerinde; **maksimum 2 worker**, toplam bekleyen/çalışan iş **maksimum 6**. Tek-instance IP limiti başlangıç için 5 analiz/dakika; internete açık dağıtımda reverse proxy/paylaşımlı limit gerektirir.
- API kaynak kodu, filesystem yolu ve traceback döndürmemeli. Worker çöküşü diğer istekleri bozmamalı; düzgün hata kodu ve yeniden başlatma olmalı. Uzun işler `202 + analysis_id` ve durum polling ile izlenmeli.
- SSRF, dosya yolu enjeksiyonu, bellek/CPU/Disk kaynak tüketimi, zaman serisi bütçesi, cache büyümesi, eşzamanlı istekler ve CORS kontrolü. Geliştirmede localhost dışında sunucu açma; public internet yayınına varsayılan olarak geçme.
- Kernel dosyaları için `.part`/atomik indirme, yerel manifest ve hash; **yerel SHA-256, yayıncı doğrulaması olarak etiketlenmesin**.
- `data/`, cache, sanal ortam, node_modules ve büyük DEM dosyaları Git'e eklenmemeli.

## 4. İlk görev: mevcut sistemi gerçekten denetle

Proje kökünden duruma göre çalıştır/incele:

```powershell
python --version
node --version
npm --version
python -m pytest -q
python -m backend.verify_horizons
```

Ağ/kernels eksikse Horizons testinin başarısız olması ayrı bir **veri/bağımlılık durumu** olarak raporlanmalı; herhangi bir testin hata verdiğini gizleme. `python -m backend.download_data` zaten çalışıyorsa tekrar başlatma. SPICE indirmesi bittikten sonra `data/spice/` ve `data/manifest.json` durumunu kontrol et.

Sonra `/health`, `/sites`, `/docs` ve OpenAPI şemasını kontrol et; erişim yoksa `uvicorn backend.main:app --host 127.0.0.1 --port 8000` ile servis başlat. `GET /health` yalnızca dosyaların bulunmasını bildiriyor olabilir; `ready` değerini **bilimsel olarak doğrulandı** ile karıştırma.

Büyük NASA rasterlarını elde etmek için PGDA ürün sayfalarına bak: https://pgda.gsfc.nasa.gov/products/90 . Kullanıcı dosyaları elle indiriyorsa çakışan indirme başlatma. İlk gerçek analizde GeoTIFF metadata, kapsama, örnek değer, NoData, kernel kapsama, bellek ve çalışma süresi ölçümü yap. Yüksek çözünürlük yoksa kısıtları güvenilir değerlendiremeyen sonuç GRAY olmalı.

### Çalışmakta olan backend API sözleşmesi — koddan tekrar teyit et

- `GET /health`
- `GET /sites`
- `POST /analyses` → HTTP `202`, `analysis_id`, `status`
- `GET /analyses/{analysis_id}` → `queued | running | completed | partial | failed`, varsa `result/error`
- `GET /analyses/{analysis_id}/horizon` → hazır değilse `409`
- `GET /analyses/{analysis_id}/timeline` → hazır değilse `409`
- `POST /compare` → `analysis_ids` ve `priority`
- `POST /scenarios/shift` → `analysis_id` ve `shifts_hours`, HTTP `202`

`POST /analyses` örneği (**örnek koordinat ve kısıt; bilimsel sonuç değildir**):

```json
{
  "dataset_id": "lola_240m",
  "latitude": -89.54,
  "longitude": 0.0,
  "landing_utc": "2026-12-01T12:00:00Z",
  "duration_hours": 48,
  "buffer_hours": 12,
  "step_minutes": 30,
  "horizon_radius_km": 200,
  "sun_observer_height_m": 4,
  "earth_observer_height_m": 4,
  "uncertainty_mode": "nominal",
  "shifts_hours": [0, 24, 48, 72],
  "constraints": {
    "max_darkness_hours": 8,
    "min_sun_fraction": 0.5,
    "min_dte_fraction": 0.5,
    "max_dte_gap_hours": 8
  }
}
```

Gerçek `main.py` Pydantic sınıfları `AnalysisInput`, `Constraints`, `CompareInput`, `ShiftInput` ve dönen JSON yapıları en doğru referanstır. Bunların tiplerini UI'da otomatik/elle türet, **hayali `scenario` alanları icat etme**.

## 5. Ana teslim: `frontend/` uygulamasını tam inşa et

**Stack:** React + Vite + TypeScript + Tailwind CSS + Plotly.js (`react-plotly.js`), React strict typing. İsteğe bağlı küçük ikon paketi kullanılabilir. Backend'i mock API'ye dönüştürme.

### P0-A — Tasarım sistemi ve sayfa yapısı

- Özgün, profesyonel NASA/uzay görevi kontrol paneli hissi; açık bilgi mimarisi, temiz tipografi, yüksek kontrast, erişilebilir renkler, responsive masaüstü/tablet/mobil. Gereksiz 3D veya ağır görsel kütüphaneler ekleme.
- Başlık ve durumu göster: **Lunar Mission Window Analyzer**, bağlantı (Backend Online/Offline), SPICE/LOLA/ERR/clone durumları, zaman diliminin UTC olduğu, Halk/Mühendis modu.
- Sekmeler veya bölümler: `Mission Setup`, `Sky View`, `Timeline`, `Compare`, `Data & Validation`.
- NASA veri kaynakları/kredileri ve net feragat: “ön eleme; iniş güvenliği, enerji ve RF bağlantısı garantisi değildir.”

### P0-B — Mission Setup formu

- Dataset seçimi `/sites` üzerinden; sadece gerçekten kayıtlı `dataset_id` değerlerini listele; mevcut olmayan raster için 'indirilmeli' etiketi.
- Enlem/boylam serbest fakat sınır kontrollü (-90..-80; -180..180). Kaynak koordinatı doğrulanmamış Shackleton/Connecting Ridge/NASA adaylarını resmi koordinatmış gibi ön tanımlama.
- UTC tarih/saat; `datetime-local` tarayıcı yerel saati yanlışlıkla UTC sayma. Kullanıcıya UTC olarak göster ve ISO-8601 `Z` üret.
- Görev/tampon saatleri, zaman adımı, ufuk yarıçapı, panel ve anten yüksekliği (1/4/40 m önerileri), `nominal|err|clone` belirsizlik, `err_k`, dört görev kısıtı ve isteğe bağlı eğim/footprint.
- Sınırları UI'da göster, backend 422 hatalarını kullanıcı dostu açıkla. Tahminî hesap maliyeti ve uzun iş durumunu göster ama rastgele kesin süre vaat etme.

### P0-C — Gerçek API client, polling ve hata işleme

- `VITE_API_BASE_URL` (varsayılan `http://127.0.0.1:8000`) ile doğrudan API'ye bağlan; CORS için Vite proxy veya yalnızca kontrollü localhost CORS. Yetkisiz wildcard prod CORS kullanma.
- `202` yanıtından `analysis_id` al; 1–3 saniyelik makul polling; `queued/running` durumunu göster; `completed/partial/failed` ayrımını doğru işle, polling'i sonlandır ve component unmount'ta cleanup yap.
- 409 hazır değil, 422 geçersiz girdi, 429 kuyruk/rate limit, 503 veri eksik gibi durumların ayrı ve anlaşılır mesajları olsun.
- `GRAY`, `DEM_MISSING`, `SPICE_MISSING`, `CLONE_NOT_PRECOMPUTED`, `TERRAIN_UNAVAILABLE`, `WORKER_UNAVAILABLE` kodlarını kesinlikle gizleme. Eksik veride çizim için dummy metrik üretme; uygun boş durum metni göster.
- Aday analizlerini uygulama içinde karşılaştırmaya ekle; aynı görev parametrelerini zorunlu tut; API `/compare` hata kodu `INCOMPARABLE` ise belirt. Sonuçları localStorage'a otomatik kalıcı yazma (analiz ID'leri sunucu yeniden başlatıldığında kaybolabilir).

### P0-D — Sky View (Plotly.js)

- **2D 360° panoramik yatay eksen azimut (0–360°), dikey eksen yükseklik (derece)**; `/analyses/{id}/horizon` verisine dayan; gerçek `horizon` anahtarlarını inceleyerek alan eşlemesini yap.
- Güneş ve Dünya yönlerini, dairelerini seçilmiş zaman adımındaki gerçek `timeline` değerlerinden çiz; Güneş'in açısal yarıçapını ve Dünya diskini gerçek veriye göre ölçekle. Azimut 359°→0° diskleri doğru sar; gerektiğinde split shape/duplicate trace.
- Güneş paneli ve DTE anteni ayrı yüksekliklere sahip olabileceğinden ayrı ufuk profillerini göster. ERR varsa bandı göster; yoksa sahte uncertainty bandı oluşturma.
- Tam güney kutbunda azimut referansını açıkla. Grafik sunumu scientific output'u hiçbir biçimde değiştirmesin.

### P0-E — Timeline ve görev kaydırma

- `/analyses/{id}/timeline` cevabındaki **gerçek** `scenarios[].timeline` değerlerinden interaktif scrubber yap; seçili zaman ve seçili +0/+24/+48/+72 saat kaymasını Sky View ile eşzamanlı göster.
- Aydınlanma (`f_sun`) ve geometrik DTE için ayrı zaman grafikleri, kesinti aralıkları ve görev kısıtı ihlalleri varsa mühendis detayında göster. API alanları eksikse bilinmiyor durumunu kullan.
- `/scenarios/shift` ile farklı kayma senaryosunu tekrar hesapla; 202 işini yine polling ile takip et. Orijinal sonucu silme; kullanıcı karşılaştırabilsin.

### P0-F — Compare ve karar açıklamaları

- En az iki **tamamlanmış ve karşılaştırılabilir** analizi `/compare` ile karşılaştır; `GREEN/YELLOW/RED/GRAY` kararını sözcük + ikon + renk olarak sun.
- Kısıtlar, Pareto/priority (`balanced`, `sun`, `comms`, `resilience`) sunucu çıktısındaki gibi göster; kendin yeni puanlama uydurma.
- Halk modu: “Güneş ne kadar görülebilir?”, “Dünya yönü ne zaman arazi tarafından kapanıyor?” gibi anlaşılır açıklamalar. Mühendis modu: UTC, frame, DEM resolution, data provenance, horizon radius, açılar, metrik ve ihlal aralıkları.
- Mod değişikliği **aynı hesap sonucunu korumalı**, sadece anlatım seviyesi değişmeli.

### P0-G — Data & Validation ekranı

- Kaynak URL'leri: https://pgda.gsfc.nasa.gov/ , https://naif.jpl.nasa.gov/naif/ , https://trek.nasa.gov/moon/ , https://quickmap.lroc.asu.edu/ .
- Gerçek `GET /health` durumunu göster; 'dosya var' ile 'bilimsel geçerlilik doğrulandı' ayrımını açık yap.
- A-04 Horizons, 135/200/250 menzil, ERR/EFFRES, clone ve V-01–V-10 durumlarını PASS/FAIL/NOT_RUN olarak yalnızca **gerçek test loglarıyla** doldur. Otomatik test çalışmamışsa `NOT_RUN`.

## 6. Uçtan uca entegrasyon ve backend sorunlarını çöz

1. Backend kodunu önce okuduğun için API response structure/UI map uyumsuzluklarını gerçek örneklerle gider. Mevcut backend'de hata varsa minimal patch + ilgili test uygula. Backend kodunu sırf mimariyi değiştirmek için baştan yazma.
2. `download_data.py` sadece kernel'leri indirir. Kullanıcıya 240 m/80 m DEM dosyalarının adlarını ve doğru klasörlerini arayüzde/README'de göster; indirme izinsiz ve tekrar tekrar yapılmamalı.
3. `backend/verify_horizons.py` dinamik başlık ayıklama ve `GEODETIC` küre uyumunu **gerçek Horizons yanıtında** gözden geçir; API hata mesajlarını kaydet, sabit örnek çıktı uydurma.
4. `backend/terrain_engine.py` gerçek GeoTIFF olmadan `GREEN` dönmüyor mu kontrol et; NoData, raster sınırı, CRS, cache, 135/200km ve ERR fallback'leri incele. Sadece 'test geçti' demek yerine en az bir gerçek küçük örnek hesap ve oluşan provenance kaydını doğrula. 250 km offline duyarlılık için güvenli ayrı test mekanizması geliştirilebilir ama mevcut online limit 200 km korunur.
5. Uygulama arayüzünde proje veri indirirken boş durum da **güzel ve kullanışlı** görünsün; gerçek veri yerleştiğinde ayrı UI kodu gerektirmeden analiz çalışsın.
6. API ile UI aynı anda çalışsın: backend `http://127.0.0.1:8000`, Vite varsayılan `http://localhost:5173`. Backend'de CORS yoksa önce Vite proxy'yi tercih et veya sadece bu iki localhost origin'i izinli kıl.
7. Zaman/mesafe/boylam/açı birimleri tutarlı; uzun ufuk serisini Plotly'de görüntü amaçlı hafifletmek bilimsel örnekleri değiştirmemeli.

## 7. Test planı / kabul kriterleri

### Çalıştırılacak temel komutlar

```powershell
python -m pytest -q
python -m backend.verify_horizons
uvicorn backend.main:app --host 127.0.0.1 --port 8000
# Ayrı terminal:
cd frontend
npm install
npm run build
npm run dev
```

### Minimum P0 kabul listesi

- [ ] `python -m pytest -q` gerçek çıktı ile raporlandı; test hataları gizlenmedi.
- [ ] Backend `/health`, `/sites` ve `/docs` erişilebilir; kullanılabilirlik ve bilimsel veri doğruluğu ayrı durumlar.
- [ ] `frontend/` TypeScript derlemesi `npm run build` ile başarılı.
- [ ] Backend yok, SPICE yok, LOLA DEM yok, ERR yok, worker başarısız, 429 kuyruk dolu, 422 hatalı giriş ve 409 sonuç hazır değil durumlarının hepsi düzgün UX'e sahip.
- [ ] Gerçek veri varsa en az bir analiz, polling, ufuk grafik, seçili zaman, kıyaslama ve kaydırma başarılı.
- [ ] Gerçek veri yoksa sahte sonuç çizilmedi; P0 UI boş/veri bekliyor durumunda çalışır.
- [ ] +0/24/48/72 kayma, Güneş/Dünya ayrı gözlemci yükseklikleri, zaman dilimi ve tür alanları doğru.
- [ ] Halk/Mühendis modu sadece sunumu değiştiriyor; hesapları veya kararları değiştirmiyor.
- [ ] Kullanılabilir görsel arayüz mobil/masaüstü ve klavye erişimine sahip.
- [ ] README ve `.env.example` kurulum, veri dosyaları, çalışma komutları ve limitleri doğru anlatıyor.
- [ ] Bilimsel doğrulamalar yalnızca gerçek kanıtla PASS ilan edilmiş; eksikleri NOT_RUN veya FAIL.

## 8. Uygulama fazları — bu sırayı izle

**Faz 0 (durum ve sağlık):** Çalışan indirmeyi koru; dosya ağacı/testler/health/API veri şekillerini incele; erişim ve kayıp veri durumlarını listele. Küçük hata varsa düzelt.

**Faz 1 (çekirdek frontend):** React/Vite/TS/Tailwind/Plotly, tema, navbar, health banner, API client, model tipleri, hata durumları. `npm run build`.

**Faz 2 (analiz):** Mission Setup formu, POST 202, polling, sonuç durumları, kaynak/provenance, belirsizlik etiketleri. Test.

**Faz 3 (bilimsel görselleştirme):** Gerçek horizon serisi, Sky View, görünür Güneş/Dünya diskleri, senkronize timeline, shift; sözleşme testleri.

**Faz 4 (kıyaslama + erişilebilirlik):** `/compare`, Halk/Mühendis, PDF gerektirmeyen basit paylaşılabilir rapor veya kopyalanabilir özet (P0 başarıdan sonra), mobil erişim, performans.

**Faz 5 (doğrulama ve final):** Python testleri + TypeScript build + en az bir uçtan uca koşu (gerçek veri uygunsa), README, veri kaynakları, bilinen sınırlamalar. Projenin kalan eksiklerini net listede bırak.

## 9. Claude Code'un her faz sonunda raporlaması gerekenler

- Değişen/oluşan dosyaların tam yolları.
- Gerçekte çalıştırılan komutlar, sonuç ve test sayıları.
- Gerçek NASA kernel ve DEM durumları; Horizons/CRS kontrol sonucu.
- Bitmiş özellikler, kanıtlanmamış varsayımlar, eksik veri ve kalan görevler.
- Backend ve frontend'i yerelde başlatma komutları.
- Bir sonraki fazı otomatik başlat; engel çıkarsa kullanıcı müdahalesinin gerekli olduğu **tek net şeyi** sor.

## 10. Son talimat

**Şimdi işi devral:** Dosyaları oku, mevcut indirme sürecini bozma, API sözleşmesini tespit et, `frontend/` geliştirmesini başlat ve P0 uygulamayı test edip çalışır hâle getir. Mevcut NASA verisi yoksa varsayımsal sayıları gerçekmiş gibi sunma. Güvenlik, bilimsel kaynak izlenebilirliği ve belirsizlik açıklamaları hız uğruna kaldırılmayacak. Çalışmayı yalnızca sohbet metni olarak tarif etmekle kalma; dosyaları gerçekten oluştur ve build/test et.

## 11. EK ZORUNLU KURALLAR — OTURUM DEVAMLILIĞI, WINDOWS, LOLA VE P0-F

> Bu bölüm, önceki bütün fazların **zorunlu tamamlayıcı şartnamesidir**. Mevcut `CLAUDE.md` ve bu devir belgesindeki bilimsel doğruluk, veri kaynakları ve güvenlik koşulları aynen geçerlidir. Bu beş maddeyi uygulanmış kabul etmek için kod, test ve gerekiyorsa gerçek veri kanıtı üret.

### 11.1. Canlı ilerleme günlüğü: `PROGRESS.md` — hesap ve oturum değişikliği koruması

1. Proje kökünde `PROGRESS.md` oluştur. **Her yeni Claude Code oturumunda ilk işlem**, kod yazmadan, paket indirmeden veya test başlatmadan önce `CLAUDE.md`, `CLAUDE_DEVIR_TALIMATI.md`, `PROGRESS.md` ve `git status` okumak olmalıdır. `PROGRESS.md` yoksa önce proje durumunu denetle ve gerçeğe dayalı bir ilk kayıt oluştur.
2. Her fazın **başlangıcında, önemli ara adımında ve tamamlanmasında** günlüğü diske hemen kaydet. Sadece sohbet hafızasına veya Claude Code oturum özetine güvenme. Her önemli değişiklikten sonra kaydı güncelle; özellikle bağlam/token limitine yaklaşmadan önce dosyayı yaz.
3. Günlük en az şu bölümleri içermelidir:
   - **Son güncelleme:** UTC ISO-8601 zaman damgası; mevcut faz, tam alt adım, durum (`NOT_STARTED`, `IN_PROGRESS`, `BLOCKED`, `DONE`, `FAILED`).
   - **Tamamlanan iş:** İşlev bazında hangi gereksinimlerin gerçekten bittiği ve kanıtları.
   - **Dosya envanteri:** Oluşturulan/değiştirilen dosyaların proje köküne göre yolları; mevcut dosyalara dokunma gerekçesi ve mümkünse ilişkili git commit/diff bilgisi.
   - **Test kanıtları:** Gerçekten çalıştırılan komut, tarih, çıkış kodu, geçti/kaldı/atlandı sayıları; hata varsa ilgili log yolu veya kısa gerçek hata parçası. Çalıştırılmayan test için `NOT_RUN` yaz; sonuç uydurma.
   - **Veri durumu:** Her SPICE kernel ve LOLA 240 m/80 m/ERR/EFFRES/site rasterının `MISSING`, `DOWNLOADING`, `PRESENT_UNVERIFIED`, `VERIFIED` veya `INVALID` durumu, dosya yolu, boyut, kaynak URL, varsa hash ve doğrulama yöntemi.
   - **Çalışan işlemler:** Devam eden indirmeler, `.part` dosyaları, sunucu/worker süreçleri, bilinen PID/komut ve güvenli yeniden bağlanma bilgisi. PID doğrulanmamışsa tahmin etme.
   - **Bilimsel doğrulama:** A-04 ve V-01–V-10 için `PASS`, `FAIL`, `NOT_RUN` veya `BLOCKED`, test kanıtı ve kalan risk.
   - **Blokajlar ve bir sonraki tam adım:** Bir sonraki komut/dosya/işlev, önkoşulları ve başarının gözlenebilir ölçütü.
4. Yeni hesap veya oturumda **önce kaldığın noktayı doğrula**: `PROGRESS.md` ile gerçek dosyaları, `git status` çıktısını, çalışan süreçleri ve test kanıtlarını çapraz kontrol et. Günlük yanlış veya eskiyse bunu kaydet ve düzelt. **Tamamlanmış işi gereksiz yere tekrarlama**, ama eksik/bozuk işi yeniden çalıştırmak gerekirse gerekçeyi kaydet.
5. Günlük append-only olay kayıtları ve güncel durum özeti içerebilir; okunabilir kalmasını sağla. Gizli anahtar, API token'ı, kişisel bilgi veya büyük log dökümleri yazma; gerekiyorsa `.gitignore`'a uygun log dosyası yolu kullan.
6. Her fazın sonunda `PROGRESS.md` yazılmadan o fazı `DONE` sayma. Oturum sınırı, araç hatası veya kullanıcı müdahalesi nedeniyle durulursa, **yeniden başlatma talimatını ve tek sonraki adımı** günlükte bırak.

### 11.2. Windows `spawn` koruması — `ProcessPoolExecutor`

1. Windows'ta `multiprocessing` varsayılan `spawn` yöntemini kullanır. **`ProcessPoolExecutor(max_workers=2)` kesinlikle modülün top-level'ında, import sırasında, sabit/global başlangıç ifadesinde veya her HTTP isteğinde oluşturulmayacaktır.**
2. Havuzu **yalnızca FastAPI `lifespan` içinde** uygulama başlarken oluştur; `app.state` üzerinden eriş ve uygulama kapanırken `shutdown` ile kapat. Worker'a giden fonksiyonlar modül seviyesinde, pickle edilebilir ve import-safe olmalıdır. SPICE kernel yüklemesini worker süreci içinde, gerektiğinde bir kere yap; parent sürecindeki SPICE durumunu paylaşılıyor varsayma.
3. Uvicorn `--reload` ve çoklu API worker seçeneklerini geliştirme/üretim davranışı açısından ayrı değerlendir: her sunucu sürecinin kendi işçi havuzunu yaratması toplam süreç sayısını artırabilir. P0 için `uvicorn backend.main:app --host 127.0.0.1 --port 8000` ve tek API worker ile başla. Windows'ta `spawn`, başlatma/kapatma ve bozuk worker (`BrokenProcessPool`) için test yaz.
4. `max_workers=2` **eşzamanlılık sınırıdır, tek başına kuyruk veya bellek sınırı değildir**: bekleyen iş sayısı ve toplam analiz yükü için ayrı bounded admission/queue, 429/503 davranışı, zaman aşımı, iptal/temizlik ve disk kota kurallarını uygula. Kapanışta takılı işi sonsuza kadar bekleme; güvenli kapatma stratejisini belgele.
5. Komut dosyası olarak multiprocessing başlatılan her dosyada uygun `if __name__ == "__main__":` koruması kullan; modüllerin import edilmesi yeni sunucu veya child process başlatmamalıdır.

### 11.3. LOLA 240 m otomatik tamamlama — `--include-lola-240m`

1. **Faz 0'da** `data/lola/LDEM_60S_240MPP_ADJ.TIF` dosyasının gerçek varlığını ve kullanılabilirliğini kontrol et. Dosya yoksa ve aynı hedefe ait **aktif bir indirme** doğrulanmıyorsa, `backend/download_data.py` içine isteğe bağlı `--include-lola-240m` CLI parametresini ekleyerek NASA PGDA'nın resmi ve doğrulanmış dosya URL'sinden 240 m referans DEM'i otomatik indir. Ürün sayfası: `https://pgda.gsfc.nasa.gov/products/90`. Ürün sayfası **doğrudan TIFF URL'si değildir**; gerçek indirme bağlantısını ve kaynağını doğrulamadan URL uydurma.
2. Varsayılan `python -m backend.download_data` davranışını bozma. Yeni kullanım: `python -m backend.download_data --include-lola-240m`. Proje köküne göre sabit hedef yol kullan; Windows'ta da yol çözümlemesi güvenilir olsun. İndirmenin dosya boyutu yaklaşık 210 MB olabilir; **sunucuya bildirilen gerçek boyut ve gerçek TIFF metadata** esas alınır, 210 MB sabit bir kriptografik doğrulama ölçütü değildir.
3. Geçici dosyayı `LDEM_60S_240MPP_ADJ.TIF.part` veya çakışmayan benzersiz güvenli `.part` adıyla aynı dosya sistemine yaz. Akış halinde indir, HTTP ve boyut kontrolü yap, varsa yayımlanmış güvenilir hash ile karşılaştır, Rasterio ile açıp rasterın okunabilirliğini/CRS'ini/bantlarını/footprint'ini/NoData bilgisini doğrula; sonra atomik `os.replace` yap. Her durumda manifest'e doğrulama kapsamını dürüstçe kaydet. **Yalnızca kendi hesapladığın SHA-256 kaynak bütünlüğünü bağımsız olarak kanıtlamaz.**
4. `.part` mevcutsa bunun **aktif** indirme mi yoksa geçmiş oturumdan kalmış **yetim** kısmi dosya mı olduğunu doğrula; yalnızca `.part` var diye sonsuza kadar bekleme ve gerçekten aktif bir indirmenin üzerine yazma. Yarışan iki indirmeyi dosya kilidi / açık sahiplik durumu ile önle. İndirilemezse nedenini `PROGRESS.md`'ye yaz ve kullanıcının doğrudan indirebileceği resmi kaynak bağlantısını göster.
5. Veri yokken API açıkça `DEM_MISSING`/`GRAY` gösterecek. **İndirmeye başlamak, indirmeyi bitirmek veya DEM'i okumak otomatik olarak GREEN üretmez.** Yalnızca doğrulanmış arazi, astronomi, senaryo ve zorunlu görev kısıtı hesapları sonrasında uygunluk kararı üretilebilir. Faz 0, veri eksikliğini gizlemek için sentetik DEM veya sahte güneş görünürlüğü kullanmayacaktır.
6. Bu seçenek için en az şu testler gerekli: ilk kurulum, zaten geçerli dosya, yarıda kesilmiş `.part`, aktif indirme çakışması, bozuk TIFF, yanlış boyut, disk dolu, HTTP hata ve çevrimdışı senaryo. Gerekirse HTTP mock kullan; mock kullanıldığını raporla. Gerçek NASA indirimi ayrıca doğrulanmalıdır.

### 11.4. P0-F — NASA resmi araç koordinat deep-link'leri

1. Aday karşılaştırma kartlarında ve seçili site detayında şu iki harici bağlantı bulunmalıdır: **“NASA Moon Trek'te Aç”** ve **“LROC Quickmap'te Aç”**. İkisi de kartta seçilen *aynı* `latitude` ve `longitude` konumunu hedeflemelidir.
2. **Gerçek URL parametre şemasını** NASA Moon Trek ve LROC Quickmap'in resmi sitelerinden/dokümanlarından veya tarayıcı ile doğrulanmış gerçek örneklerden belirle. Rastgele `?lat=...&lon=...` parametreleri uydurup çalışan deep-link iddiasında bulunma. İlgili aracın koordinat gösterim kuralını (doğu-pozitif, 0–360 veya −180–180, planetosentrik/planetografik) doğrula ve yalnızca gerekiyorsa açıkça belgelenmiş dönüşümü uygula.
3. Harici linkleri yeni sekmede güvenli biçimde aç (`target="_blank" rel="noopener noreferrer"`). Koordinatı sayısal ve sonlu olarak doğrula; kullanıcı girdisinden ham URL birleştirme veya açık yönlendirme üretme. Aracın doğrudan koordinata gitme işlevi doğrulanamazsa linki “siteyi aç” olarak açıkça etiketle; koordinata gidiyormuş gibi gösterme.
4. En az iki farklı güney kutbu adayı için URL sözleşmesi testi ve mümkünse gerçek tarayıcı navigasyon testi yap. Güncel URL örneklerini, kontrol tarihini ve kısıtları README + `PROGRESS.md` içinde kaydet.

### 11.5. P0-F — Halk/Eğitimci modu “Dünya vs. Ay” kıyaslama kartı

1. Halk/Eğitimci görünümüne **“Dünya ve Ay'da Güneş neden farklı görünür?”** başlıklı erişilebilir bir eğitim kartı ekle. Bu kart gerçek zamanlı Dünya simülasyonu, dünya hava durumu veya yeryüzü astronomi hesabı **yapmayacak**; bilimsel kaynağı belgelenmiş **sabit fiziksel farkları** gösterecek.
2. Karşılaştırmanın asgari içeriği:
   - **Dünya:** Ortalama Güneş günü yaklaşık **24 saat**.
   - **Ay:** Ortalama Güneş günü yaklaşık **29,5 Dünya günü**; bunun Ay'ın ~27,3 günlük yıldız dönmesinden farklı bir büyüklük olduğunu yanlış yorumlamayı önlemek için açıklayıcı not ekle.
   - **Atmosferik kırılma:** Dünya'da atmosfer ışığın görünür yönünü değiştirebilir; Ay'da anlamlı bir küresel atmosfer olmadığından Dünya'dakine benzer atmosferik kırılma beklenmez.
   - **Kutup Güneş geometrisi:** Dünya'da mevsimsel eksen eğikliği yaklaşık **23,4°**, Ay'ın ekliptiğe göre eksen eğikliği yaklaşık **1,5°** olduğundan Ay kutuplarında Güneş ufka çok yakın seyreder; yerel krater sırtları ve gölgeler belirleyicidir. Basitleştirmeyi dürüstçe etiketle; enlem/yerel ufuk/mevsim etkisini tek bir evrensel açı sayısıyla temsil etme.
3. Kaynaklar NASA ve/veya güvenilir astronomi referanslarından olmalı; kartın altında “Kaynaklar” bağlantıları ve “yaklaşık değerler” açıklaması bulunmalı. 29,5 gün, 24 saat ve eğiklikleri ölçüm hassasiyetine göre uygun biçimde yuvarla; gün uzunluğunu sadece “Ay 29,5 günde döner” şeklinde yanlış sunma.
4. Kart **mevcut bilimsel API kararlarından bağımsız eğitim içeriğidir**. Karar puanını, `f_sun`, DTE veya `GREEN/YELLOW/RED/GRAY` sonucunu etkilemez. Halk/Eğitimci modu değişimi aynı gerçek analiz sonuçlarını korur. Responsive ve klavye erişilebilir olmalıdır.
5. Testlerde kart metni, kaynak linkleri, görünürlük modu ve karar motorundan bağımsızlık denetlensin. Kart yerinde olmayan gerçek zamanlı Dünya simülasyonu, sahte ölçüm veya kullanıcıya ait canlı konum bilgisi talep etmeyecektir.

### 11.6. Güncellenmiş bitiş kriteri

Proje `P0_DONE` olarak işaretlenmeden önce **11.1–11.5 maddelerinin her biri** `PROGRESS.md` içinde ayrı kabul girdisi olarak yer almalı. `PROGRESS.md` oturum devamlılığını sağlamalı; Windows `spawn` testi çalışmalı; LOLA indirme seçeneği güvenli olmalı; her iki resmi koordinat linki gerçek URL formatıyla doğrulanmalı veya açıkça `BLOCKED/NOT_VERIFIED` olarak gösterilmeli; Dünya–Ay kartının fiziksel kaynakları belgelenmeli. Doğrulanmayan hiçbir koşul `PASS` yazılmamalı. **Claude Code kullanıcıdan ilave prompt beklemeden, doğruladığı sonraki adıma ilerlemelidir.**
