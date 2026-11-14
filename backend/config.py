"""Single source of truth for dataset locations and bounded workload policy."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
SPICE = DATA / "spice"
LOLA = DATA / "lola"
SITES = DATA / "sites"
CACHE = DATA / "cache"

# Coordinates are Moon mean-Earth (east-positive, planetocentric latitude).
# The raster's own spatial bounds are checked separately. Site products are
# not assigned guessed latitude rectangles.
DATASETS = {
    # PGDA product 90 also publishes LDEM_60S_240MPP_ADJ_EFFRES.TIF (checked 2026-11-14).
    "lola_240m": {"path": LOLA / "LDEM_60S_240MPP_ADJ.TIF", "resolution_m": 240, "kind": "global", "err": LOLA / "LDEM_60S_240MPP_ADJ_ERR.TIF", "effres": LOLA / "LDEM_60S_240MPP_ADJ_EFFRES.TIF"},
    "lola_80m": {"path": LOLA / "LDEM_80S_80MPP_ADJ.TIF", "resolution_m": 80, "kind": "regional", "err": LOLA / "LDEM_80S_80MPP_ADJ_ERR.TIF", "effres": LOLA / "LDEM_80S_80MPP_ADJ_EFFRES.TIF"},
    "lola_20m": {"path": LOLA / "LDEM_80S_20MPP_ADJ.TIF", "resolution_m": 20, "kind": "regional", "err": LOLA / "LDEM_80S_20MPP_ADJ_ERR.TIF", "effres": LOLA / "LDEM_80S_20MPP_ADJ_EFFRES.TIF"},
    "site01_5m": {"path": SITES / "Site01_final_adj_5mpp_surf.tif", "resolution_m": 5, "kind": "site", "err": SITES / "Site01_final_adj_5mpp_toterr.tif", "effres": None},
    "site04_5m": {"path": SITES / "Site04_final_adj_5mpp_surf.tif", "resolution_m": 5, "kind": "site", "err": SITES / "Site04_final_adj_5mpp_toterr.tif", "effres": None},
    "site07_5m": {"path": SITES / "Site07_final_adj_5mpp_surf.tif", "resolution_m": 5, "kind": "site", "err": SITES / "Site07_final_adj_5mpp_toterr.tif", "effres": None},
    "site11_5m": {"path": SITES / "Site11_final_adj_5mpp_surf.tif", "resolution_m": 5, "kind": "site", "err": SITES / "Site11_final_adj_5mpp_toterr.tif", "effres": None},
    "site23_5m": {"path": SITES / "Site23_final_adj_5mpp_surf.tif", "resolution_m": 5, "kind": "site", "err": SITES / "Site23_final_adj_5mpp_toterr.tif", "effres": None},
}

KERNELS = (
    SPICE / "naif0012.tls", SPICE / "pck00011.tpc",
    SPICE / "de440s.bsp", SPICE / "moon_pa_de440_200625.bpc",
    SPICE / "moon_de440_250416.tf",
)
R_MOON_KM = 1737.4
FRAME = "MOON_ME_DE440_ME421"
MAX_WORKERS = 2
MAX_PENDING = 6  # executing + waiting; process executor is NOT used as an unlimited queue
MAX_CACHE_MB = 1536
# Wall-clock limit for one analysis job. A native call cannot be interrupted, so on
# timeout the worker processes are terminated and the pool is recreated.
ANALYSIS_TIMEOUT_S = 1800
VALIDATION = DATA / "validation"  # reports written ONLY by real validation runs
# Official product pages for user guidance (no automatic download from the API).
PGDA_SOUTH_POLE_PAGE = "https://pgda.gsfc.nasa.gov/products/90"
PGDA_SITE_PAGE = "https://pgda.gsfc.nasa.gov/products/78"
# Region names as written in the PGDA LOLA_5mpp README (checked 2026-11-14; numbering after
# Mazarico et al. 2011). These name DEM tiles, NOT approved landing coordinates.
SITE_NAMES = {"site01_5m": "Connecting ridge", "site04_5m": "Shackleton rim", "site07_5m": "Peak near Shackleton",
              "site11_5m": "de Gerlache rim", "site23_5m": "Malapert massif"}
