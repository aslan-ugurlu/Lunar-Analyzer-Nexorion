# Lunar Mission Window Analyzer — Backend

Açık kaynak NASA LOLA / NAIF SPICE verisiyle Ay güney kutbu için **tarama seviyesinde** görünürlük analizi. Bu proje bir uçuş emniyeti, gerçek RF bağlantısı veya güç bütçesi sertifikası değildir.

## Kurulum (Python 3.11+)

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python -m backend.download_data
python -m backend.verify_horizons
uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

`http://127.0.0.1:8000/docs` OpenAPI, `/health` veri durumu. Windows'ta komutları **proje kökünden** çalıştır. Native hesaplama için iki ayrı `spawn` worker kullanılır.

## Gerçek veriler
- NAIF kernel URL'leri `backend/download_data.py` içinde; indirme otomatik yapılır. Yerel manifest SHA-256 yalnızca **yerel izlenebilirlik** sağlar.
- LOLA GeoTIFF'leri **otomatik indirilmez**. NASA PGDA/PDS ürününün sürümünü, lisansını, birimini ve gerçek dosya adını kontrol edip `backend/config.py` içindeki ilgili dizine koy. URL: https://pgda.gsfc.nasa.gov/ .
- `data/lola/LDEM_60S_240MPP_ADJ.TIF` referans dış ufuk için zorunlu olarak seçilmiştir. Diğer yüksek çözünürlüklü rasterlar seçime bağlıdır.
- Veri ürününün CRS/datum'u Moon Mean-Earth frame ile aynı değilse `terrain_engine.py` kullanmadan önce geodezik dönüşüm doğrulanmalı. Sadece CRS yarıçap eşitliği frame eşitliğinin ispatı değildir.
- `data/cache/` otomatik oluşturulur. Yüksek çözünürlüklü rasterı olmayan eğim kısıtları **bilinmiyor** döner.

## Testler

```powershell
python -m pytest -q
python -m backend.verify_horizons
```

`verify_horizons` **gerçek kernel + internet** ister; A-04 geçmesi yalnızca seçilen sentetik gözlemci geometrilerini sınar. 135/200/250 km, ERR/EFFRES, gerçek DEM doğruluğu ve 100-clone V-01..V-10 benchmarkları bu pakette **tamamlanmış değildir**.

## API

- `GET /health`, `GET /sites`
- `POST /analyses` → `202` ve `analysis_id`; `GET /analyses/{id}` ile takip et
- `GET /analyses/{id}/horizon`, `GET /analyses/{id}/timeline`
- `POST /compare`, `POST /scenarios/shift`

### Örnek istek (yalnızca veri mevcutsa çalışır)

```json
{
  "dataset_id": "lola_240m", "latitude": -89.54, "longitude": 0,
  "landing_utc": "2026-12-01T12:00:00Z", "duration_hours": 48,
  "buffer_hours": 12, "step_minutes": 30, "horizon_radius_km": 200,
  "sun_observer_height_m": 4, "earth_observer_height_m": 4,
  "uncertainty_mode": "nominal", "shifts_hours": [0,24,48,72],
  "constraints": {"max_darkness_hours": 8, "min_sun_fraction": 0.5,
                  "min_dte_fraction": 0.5, "max_dte_gap_hours": 8}
}
```

**Not:** `nominal` tek başına GREEN sınıfına yükseltilmez. ERR veri seti tam kapsama sağlamıyorsa GRAY olur. Clone modu henüz veri/ön-hesap bulunmadığı için GRAY'dir. DTE Dünya merkezi görüşüdür. Güneş görünürlüğü elektrik üretimi değildir.

## Performans / güvenlik sınırlamaları

İki worker, en fazla altı bekleyen/çalışan iş, tek-instance bellek içi IP rate limit (5/dakika). Disk önbelleği ve süreç havuzu bu prototipte üretim ölçekli güvenlik garantisi sunmaz. Genel internete açmadan önce reverse proxy, paylaşımlı rate-limit, timeout/worker recycling, cache kotası, erişim denetimi ve yük testi gerekir. Tek bir 200 km / 3600 azimut analizi, kullanılan DEM ve SSD'ye göre **dakikalar sürebilir**; saniyelik performans iddiası yoktur.
