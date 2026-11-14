# Lunar Mission Window Analyzer — Claude Code çalışma sözleşmesi

## Hedef
NASA Space Apps 2026 Lunar Landing Site Navigator: Ay güney kutbu için **gerçek** NASA LOLA DEM ve NAIF SPICE verisiyle Güneş/Dünya'nın yerel arazi ufkuna göre görünürlüğünü ve görev kısıtlarını karşılaştıran, erişilebilir bir web uygulaması. Bu bir **ön eleme / karar destek** aracıdır; güvenli iniş, radyo bağlantısı veya elektrik gücü garantisi vermez.

## Mevcut proje ve değiştirmeden önce okunacaklar
- `backend/config.py`: tek kaynak veri kataloğu, dosya yolları, kernel listesi, sınırlar.
- `backend/download_data.py`: küçük NAIF kernel'lerini `.part` ile atomik indirir, yerel SHA-256 manifest üretir. Yerel hash **NASA'nın doğrulanmış hash'i değildir**.
- `backend/astro_engine.py`: Moon Mean-Earth (MOON_ME_DE440_ME421), DE440, UTC→ET, SPICE `spkcpo`, `LT+S`, gözlemci `1737.4 km + DEM + sensör yüksekliği`.
- `backend/verify_horizons.py`: Horizons CSV başlıklarını dinamik doğrular, Güneş/Dünya yön vektörü farklarını test eder. Test geçmeden A-04 onaylandı deme.
- `backend/terrain_engine.py`: raster/CRS kontrolleri, bilinear DEM, 0.1°/3600 azimut, 200 km, LOD, horizon cache, ERR senaryoları, Güneş diski ve DTE merkezi.
- `backend/decision_engine.py`: görev sınırları, +0/24/48/72 saat senaryoları, GREEN/YELLOW/RED/GRAY, Pareto, kamu/mühendis açıklamaları.
- `backend/main.py`: FastAPI/Pydantic, izole spawn ProcessPoolExecutor(2), bounded queue, `/health`, `/sites`, `/analyses`, `/analyses/{id}`, `/analyses/{id}/horizon`, `/analyses/{id}/timeline`, `/compare`, `/scenarios/shift`.
- `tests/`: sahte NASA bilimsel sonuçları üretmeyen offline güvenlik/sözleşme testleri.

## Kesin bilimsel ve güvenlik kuralları
1. **NASA verisi yoksa hesap uydurma.** `DEM_MISSING`, `SPICE_MISSING`, `GRAY` veya ilgili HTTP hatasını göster. Sabit GREEN/uydurma yüzdeler yasak.
2. Ay enlemi −90..−80°, boylam −180..180°, 2026..2035 UTC ürün penceresi, online ufuk yarıçapı ≤200 km; 135/200/250 km offline duyarlılık testi. Kernel'in gerçek kapsamasını ayrıca doğrula.
3. Frame `MOON_ME_DE440_ME421`, Ay referans küresi 1737.4 km, radyal yerel düşey, doğu-pozitif boylam. Raster CRS ve yükseklik birimlerini gerçek metadata ile kontrol et; ürünler aynı frame'de değilse dönüştürmeden kullanma.
4. Sun/Earth yönü `LT+S`; Horizons kontrolünde gözlemci referans modeli, koordinat ve UTC eşleşmesi şart. A-04 yön vektörü hedefi 0.005°, bu garanti değil test eşiği.
5. Güneş **sonlu disk** görünürlük oranı; numerik quadrature yakınsamasını test et. DTE yalnızca **Dünya merkezi geometrik LOS**, RF link bütçesi değil. Güneş görünürlüğü güç üretimi değil.
6. ERR ±k **duyarlılık senaryosu**, istatistiksel güven aralığı değil. EFFRES eksikse veri kalitesini açıkça belirt. Gerçek 100-clone dosyaları ve eşlemesi olmadan clone sonucu **hesaplama**; açık `CLONE_NOT_PRECOMPUTED`/GRAY dön.
7. GREEN yalnızca nominal + ihtiyatlı koşullar geçiyorsa ve gerekli veri tam ise. Nominal ihlal RED; nominal geçer, ihtiyatlı ihlal YELLOW; kritik veri eksik GRAY. Her ihlal sınır/değer/senaryo ile açıklanmalı. Bu bir iniş sertifikası değildir.
8. Maksimum 2 ayrı native worker süreci, en fazla 6 bekleyen/çalışan iş, istemci başına 5 yeni analiz/dakika (tek FastAPI instance için in-memory; internete açık kullanımda paylaşımlı limit gerekir). Native worker çöküşünü API'den ayır. Geliştirmede `--reload` yalnızca yerelde.
9. Harita boşluklarını sıfır yükseklikle doldurma; belirsiz sonucu GRAY olarak ele al. Ufuk tarama mesafesi eksiksizlik kanıtı değil. Eğim için düşük çözünürlüklü DEM'den güvenli iniş sonucu çıkarma.
10. Her yanıtın kaynak/sürüm/kalite bilgisi, tarih ve birimleri açık olsun. Girdiler `Pydantic` ile doğrulansın; API traceback ve dosya yolu sızdırmasın.

## Frontend görevi (ŞİMDİ YAPILACAK)
`frontend/` altında **React + Vite + TypeScript + Tailwind CSS + Plotly.js (react-plotly.js)** kullanarak gerçek backend API'ye bağlı çalışan uygulamayı geliştir. Backend'in sözleşmesini incele; gerekiyorsa ayrı, belgeli, testli API değişikliği yap; backend'i mock sonuçlara çevirmeden ilerle.

### P0 ekranlar
1. Üst başlık: proje, kaynak verisi / hizmet durumu, **Halk / Mühendis** modu. Mod değiştirmek hesap sonuçlarını değiştirmez; yalnızca ayrıntı düzeyini değiştirir.
2. Görev formu: enlem/boylam veya veri kapsamı bilinen seçili aday, UTC iniş zamanı, görev ve tampon süreleri, 1/4/40m gibi sensör yüksekliği profilleri, maksimum karanlık, minimum güneş görünürlüğü, minimum DTE, maksimum DTE kesintisi, maksimum eğim, belirsizlik modu. Bilinmeyen site koordinatlarını veya NASA tarafından onaylanmış adayları **uydurma**.
3. 360° **2D Panoramik Horizon Sky-View**: 0–360 azimut, horizon profili, seçili UTC'de Güneş/Dünya diskleri, varsa ihtiyatlı/iyimser bandı. Azimut 0=Kuzey, 90=Doğu; güney kutbunda meridyen bağımlılığını belirt. Plotly grafiklerinde gerçek API profillerini kullan.
4. **Timeline Scrubber**: analiz sonuçlarının `scenarios[].timeline` dizisinden zaman seçimi; Sky-View ve aydınlanma/DTE zaman çizelgesi eşzamanlı; +0/+24/+48/+72 saat senaryosu.
5. **Aday karşılaştırma**: en az iki tamamlanmış analiz seçimi; `/compare` sonucu, GREEN/YELLOW/RED/GRAY, gerekçe, Pareto. Renk tek başına anlam taşımamalı; metin/ikon da göster.
6. **Veri eksikliği / hata UX**: `/health` degraded, eksik DEM, ERR, SPICE, clone, kuyruk dolu ve worker unavailable durumlarını kullanıcıya açıkça anlat. Başarı grafiği veya değerleri simüle etme.
7. NASA kaynak bağlantıları: https://trek.nasa.gov/moon/ , https://quickmap.lroc.asu.edu/ , https://naif.jpl.nasa.gov/naif/ , https://pgda.gsfc.nasa.gov/ . Kaynakları ve sınırlamaları arayüzde görünür kıl.

### UX kuralları
- Halk modu: “Bu bölgede Güneş ne kadar süre görünüyor?”, “Dünya ile doğrudan görüş ne zaman kapanıyor?”; günlük dil, açıklamalı birimler.
- Mühendis modu: azimut/yükseklik, tam UTC, DEM çözünürlüğü, horizon coverage, ERR yöntemi, kısıt ihlalleri ve veri kaynağı.
- Mobil ve masaüstünde erişilebilir, klavye kullanılabilir, kontrastlı, yükleniyor/boş/hata durumları açık.
- React frontend, `VITE_API_BASE_URL` ile backend'e bağlanmalı. Geliştirme sırasında CORS için kontrollü `localhost:5173` izinleri veya Vite proxy kullan; wildcard prod CORS açma.
- API uzun iş döndürüyor: `POST /analyses` 202 + `analysis_id`; `GET /analyses/{id}` polling ile durum takip et; `completed/partial/failed` ayrımını göster.
- Frontend TypeScript tipleri backend JSON yapısından türetilsin; bilinmeyen alanları güvenli kontrol et. Veri büyüklüğü nedeniyle timeline downsample sadece **görselleştirme** amaçlı olsun; backend bilimsel hesabını değiştirme.

### Uygulama sırası
1. Backend dosyalarını ve `tests/` testlerini oku. `python -m pytest -q` çalıştır; gerçek veri yoksa bilimsel testleri başarısız ilan etme veya geçmiş gibi gösterme.
2. Vite + React + TS + Tailwind + Plotly yapılandırmasını oluştur; `npm run build` ve mümkünse lint/test çalıştır.
3. API istemcisi, tipler, health ve form.
4. Sky-View + timeline senkronizasyonu.
5. Compare + mod geçişi + hata/veri kalite açıklamaları.
6. README'ye kurulum, çalıştırma, kullanılan NASA verileri, bilimsel sınırlamalar, testlerin durumu ve demo adımlarını yaz.

## Yapılmayacaklar
- Sahte NASA rasterı veya uydurma astronomik metrik ile yeşil aday üretme.
- 3D/AI asistanı/elektrik güç hesabı/tam RF link bütçesi ekleyip P0'ı geciktirme.
- `verify_horizons.py` testi ağ/kernel olmadan geçti diye işaretleme.
- Mevcut backend dosyalarını incelemeden tamamen yeniden yazma.

## Teslim standardı
`npm run build` başarılı, FastAPI OpenAPI açılıyor, `/health` doğru, eksik veri dürüstçe raporlanıyor, gerçek NASA dosyaları sağlandığında uçtan uca analiz mümkün; tüm bilimsel doğrulama sonuçları gerçek koşularla belgelenmiş olmalı. Mevcut ortamda veri yoksa “henüz doğrulanmadı” yaz.
