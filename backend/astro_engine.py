"""SPICE lunar topocentric Sun/Earth positions; no synthetic ephemerides."""
import math
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path

import numpy as np

from backend.config import FRAME, KERNELS, R_MOON_KM

R_SUN_KM = 695700.0
R_EARTH_KM = 6378.137
_LOADED = False


def _spice():
    import spiceypy as spice
    return spice


def load_kernels(force_reload=False):
    """Run once PER subprocess; SPICE's kernel pool is process-global."""
    global _LOADED
    if _LOADED and not force_reload:
        return
    spice = _spice()
    _LOADED = False
    spice.kclear()
    try:
        for kernel in KERNELS:
            if not Path(kernel).is_file():
                raise FileNotFoundError(f'Missing SPICE kernel: {kernel.name}')
            spice.furnsh(str(kernel))
        if spice.namfrm(FRAME) == 0:
            raise RuntimeError(f'Lunar frame not available: {FRAME}')
        # Check coordinate transformation and ephemeris availability explicitly.
        # SPICE rejects ISO 'T' timestamps that also carry a ' UTC' label
        # (SPICE(UNPARSEDTIME)); use the space-delimited form with explicit UTC.
        spice.pxform(FRAME, 'J2000', spice.str2et('2026-11-14 12:00:00 UTC'))
        _LOADED = True
    except Exception:
        spice.kclear()
        raise


def normalize_utc_to_et(text: str) -> tuple[str, float]:
    if not isinstance(text, str):
        raise ValueError('UTC text required')
    value = text.strip().replace('Z', '+00:00') if text.strip().endswith('Z') else text.strip()
    dt = datetime.fromisoformat(value)
    if dt.tzinfo is None:
        raise ValueError('UTC offset required (Z or +00:00)')
    utc = dt.astimezone(timezone.utc)
    if not 2026 <= utc.year <= 2035:
        raise ValueError('Supported product dates: 2026–2035')
    canonical = utc.isoformat(timespec='milliseconds').replace('+00:00', 'Z')
    # Space delimiter + explicit UTC label: 'YYYY-MM-DDTHH:MM:SS UTC' raises SPICE(UNPARSEDTIME).
    et_text = utc.strftime('%Y-%m-%d %H:%M:%S.%f UTC')
    return canonical, float(_spice().str2et(et_text))


def local_enu(lat_deg: float, lon_deg: float):
    la, lo = math.radians(lat_deg), math.radians(lon_deg)
    up = np.array([math.cos(la)*math.cos(lo), math.cos(la)*math.sin(lo), math.sin(la)])
    east = np.array([-math.sin(lo), math.cos(lo), 0.0])
    north = np.array([-math.sin(la)*math.cos(lo), -math.sin(la)*math.sin(lo), math.cos(la)])
    return east, north, up


def _valid(lat, lon, dem, sun_height, earth_height, times):
    for v in (lat, lon, dem, sun_height, earth_height):
        if not math.isfinite(v):
            raise ValueError('Non-finite numeric value')
    if not -90 <= lat <= -80 or not -180 <= lon <= 180:
        raise ValueError('Coordinates outside configured lunar south pole')
    if not 0 <= sun_height <= 100 or not 0 <= earth_height <= 100:
        raise ValueError('Observer height outside 0–100m')
    if not isinstance(times, (tuple, list)) or not 1 <= len(times) <= 6000:
        raise ValueError('Time series size outside 1–6000')


def compute_sky_positions(lat_deg, lon_deg, dem_height_m, utc_iso_list,
                          sun_obs_height_m=4.0, earth_obs_height_m=4.0):
    _valid(lat_deg, lon_deg, dem_height_m, sun_obs_height_m, earth_obs_height_m, utc_iso_list)
    load_kernels()
    spice = _spice()
    la, lo = math.radians(lat_deg), math.radians(lon_deg)
    east, north, up = local_enu(lat_deg, lon_deg)

    def observer(height_m):
        r_km = R_MOON_KM + (dem_height_m + height_m) / 1000
        if r_km <= 0:
            raise ValueError('Invalid radius for observer')
        return spice.latrec(r_km, lo, la)

    obs_sun = observer(sun_obs_height_m)
    obs_earth = observer(earth_obs_height_m)

    def convert(state, radius):
        vec = np.asarray(state[:3], dtype=float)
        dist = float(np.linalg.norm(vec))
        if not math.isfinite(dist) or dist <= radius:
            raise ValueError('Invalid target distance')
        x, y, z = float(vec @ east), float(vec @ north), float(vec @ up)
        return {'az_deg': (math.degrees(math.atan2(x, y)) % 360),
                'el_deg': math.degrees(math.atan2(z, math.hypot(x, y))),
                'angular_radius_deg': math.degrees(math.asin(radius/dist)),
                'distance_km': dist}

    output = []
    for utc in utc_iso_list:
        canonical, et = normalize_utc_to_et(utc)
        sun, _ = spice.spkcpo('SUN', et, FRAME, 'OBSERVER', 'LT+S', obs_sun, 'MOON', FRAME)
        earth, _ = spice.spkcpo('EARTH', et, FRAME, 'OBSERVER', 'LT+S', obs_earth, 'MOON', FRAME)
        output.append({'utc': canonical, 'frame': FRAME,
                       'azimuth_reference': ('meridian-dependent at exact south pole'
                                             if lat_deg == -90 else 'local north; clockwise east'),
                       'sun': convert(sun, R_SUN_KM), 'earth': convert(earth, R_EARTH_KM)})
    return output
