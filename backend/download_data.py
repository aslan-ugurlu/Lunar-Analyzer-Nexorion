import os
import json
import hashlib
import urllib.request
from datetime import datetime, timezone

os.makedirs("data/spice", exist_ok=True)
os.makedirs("data/lola", exist_ok=True)
os.makedirs("data/sites", exist_ok=True)

# NAIF Resmi Generic Kernels (Toplam ~35 MB - Saniyeler içinde iner)
SPICE_FILES = {
    "naif0012.tls": "https://naif.jpl.nasa.gov/pub/naif/generic_kernels/lsk/naif0012.tls",
    "pck00011.tpc": "https://naif.jpl.nasa.gov/pub/naif/generic_kernels/pck/pck00011.tpc",
    "de440s.bsp": "https://naif.jpl.nasa.gov/pub/naif/generic_kernels/spk/planets/de440s.bsp",
    "moon_pa_de440_200625.bpc": "https://naif.jpl.nasa.gov/pub/naif/generic_kernels/pck/moon_pa_de440_200625.bpc",
    "moon_de440_250416.tf": "https://naif.jpl.nasa.gov/pub/naif/generic_kernels/fk/satellites/moon_de440_250416.tf",
}

def sha256_file(filepath: str) -> str:
    h = hashlib.sha256()
    with open(filepath, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()

manifest = {"downloaded_utc": datetime.now(timezone.utc).isoformat(), "files": {}}

for filename, url in SPICE_FILES.items():
    dest = os.path.join("data/spice", filename)
    if not os.path.exists(dest):
        print(f"İndiriliyor: {filename}...")
        urllib.request.urlretrieve(url, dest)
    else:
        print(f"Zaten mevcut: {filename}")
    
    manifest["files"][filename] = {
        "path": dest,
        "url": url,
        "bytes": os.path.getsize(dest),
        "sha256": sha256_file(dest),
    }

with open("data/manifest.json", "w", encoding="utf-8") as f:
    json.dump(manifest, f, indent=2)

print("\nSPICE çekirdekleri hazır ve SHA-256 kayıtları data/manifest.json dosyasına yazıldı.")
print("LOLA DEM için NASA PGDA (https://pgda.gsfc.nasa.gov/products/90) üzerinden")
print("'LDEM_60S_240MPP_ADJ.TIF' (210 MB) dosyasını data/lola/ klasörüne indirin.")