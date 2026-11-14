"""DEM clone ensemble (PGDA product 78: "Clones/: 100 clones of LDEM", Barker et al. 2021).

Offline precompute (heavy; one location / observer-height set at a time):

    python -m backend.clone_engine --site Site01 --lat -89.46316 --lon -137.48955 [--sun-h 4 --earth-h 4]

For every REAL clone GeoTIFF of the site tile containing the observer, the tile's nominal `_surf` layer is
replaced by the clone and the full horizon profile is recomputed with the same core as the nominal
horizon (observer elevation included). Nothing is synthesised: a clone set is used only when all
CLONE_COUNT files exist and each one is on exactly the `_surf` grid (the clone <-> tile mapping).
Other layers (80 m, 240 m, other site tiles) stay nominal, as their uncertainty is not cloned.

Online use (uncertainty_mode='clone'): `load_clone_ensemble` returns the precomputed profiles or None
(-> CLONE_NOT_PRECOMPUTED / GRAY). The ensemble is an empirical spread of 100 realisations; the
derived 95 % figures are screening statistics, not certified confidence levels.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from backend.config import DATA, DATASETS, SITES

CLONE_SCHEMA = 1
CLONE_COUNT = 100
CLONES = SITES / 'clones'
CLONE_PROFILES = DATA / 'clone_profiles'
CLONE_SITES = ('Site01', 'Site04', 'Site07', 'Site11')
# Per-constraint "cautious" clone value: the 95th-percentile-worst clone (max-type limits use p95,
# min-type limits use p05). A screening convention, documented in README; not a certification level.
CLONE_CAUTIOUS_PERCENTILE = 95.0


class CloneError(RuntimeError):
    """Clone set missing, incomplete or not mappable to its site tile."""


def clone_paths(site_tile: str) -> list[Path]:
    if site_tile not in CLONE_SITES:
        raise CloneError(f'No catalogued clones for {site_tile}')
    folder = CLONES / site_tile
    return [folder / f'{site_tile}_final_adj_5mpp_{i:04d}_err.tif' for i in range(1, CLONE_COUNT + 1)]


def clone_status(site_tile: str) -> dict:
    paths = clone_paths(site_tile)
    present = [p for p in paths if p.is_file()]
    return {'site_tile': site_tile, 'present': len(present), 'expected': CLONE_COUNT,
            'complete': len(present) == CLONE_COUNT}


def _layer(site_tile: str) -> str:
    return f'{site_tile.lower()}_5m'


def check_clone_grid(clone: Path, surf: Path) -> None:
    """The clone must be on exactly the `_surf` grid: same shape, affine transform and CRS parameters."""
    import warnings
    import rasterio
    from pyproj import CRS
    with rasterio.open(clone) as c, rasterio.open(surf) as s:
        if (c.width, c.height) != (s.width, s.height) or c.transform != s.transform:
            raise CloneError(f'{clone.name}: grid differs from {surf.name}')
        with warnings.catch_warnings():
            warnings.simplefilter('ignore', UserWarning)  # WKT names differ ("unknown"); compare parameters
            same = c.crs is not None and CRS.from_wkt(c.crs.to_wkt()).to_dict() == CRS.from_wkt(s.crs.to_wkt()).to_dict()
        if not same:
            raise CloneError(f'{clone.name}: CRS parameters differ from {surf.name}')


def site_tile_for(lat: float, lon: float) -> str | None:
    """First clone-capable site tile (LOD order) whose nominal surface has a value at the observer."""
    from backend.terrain_engine import RasterSampler, TerrainMissing, TerrainError
    for tile in CLONE_SITES:
        surf = DATASETS[_layer(tile)]['path']
        if not surf.is_file():
            continue
        try:
            s = RasterSampler.open(tile, surf, lon, lat, 0.1)
        except (TerrainMissing, TerrainError):
            continue
        try:
            if np.isfinite(s.sample(np.array([lon]), np.array([lat]))[0]):
                return tile
        finally:
            s.close()
    return None


def _key(lat, lon, radius_km, sun_h, earth_h, site_tile, layers: dict) -> str:
    blob = json.dumps([CLONE_SCHEMA, round(float(lat), 6), round(float(lon), 6), float(radius_km), float(sun_h),
                       float(earth_h), site_tile, sorted(layers.items())], sort_keys=True)
    return hashlib.sha256(blob.encode()).hexdigest()


def _layer_fingerprint(ctx) -> dict:
    """Nominal layers used around the observer (name -> 'file:size'), so a changed layer set misses the cache."""
    return {name: f'{src.path.name}:{src.path.stat().st_size}' for name, src in ctx.sources.items()}


def precompute(lat: float, lon: float, sun_h: float = 4.0, earth_h: float = 4.0, radius_km: float = 200.0,
               site_tile: str | None = None, log=print) -> Path:
    from backend.terrain_engine import RasterSampler, TerrainContext, _profile_compute
    site_tile = site_tile or site_tile_for(lat, lon)
    if site_tile is None:
        raise CloneError('Observer is not inside a clone-capable 5 m site tile with data')
    status = clone_status(site_tile)
    if not status['complete']:
        raise CloneError(f'{site_tile}: {status["present"]}/{CLONE_COUNT} clone files present; download them first '
                         f'(python -m backend.download_data --include-site-clones {site_tile})')
    layer = _layer(site_tile)
    surf = DATASETS[layer]['path']
    ctx = TerrainContext(lon, lat, radius_km, uncertainty=False)
    try:
        if layer not in ctx.sources:
            raise CloneError(f'{layer} does not cover the observer')
        layers = _layer_fingerprint(ctx)
        key = _key(lat, lon, radius_km, sun_h, earth_h, site_tile, layers)
        heights = {'sun': float(sun_h), 'earth': float(earth_h)}
        unique = sorted(set(heights.values()))
        nominal_source = ctx.sources[layer]
        profiles = {h: np.full((CLONE_COUNT, 3600), np.nan, dtype=np.float32) for h in unique}
        observer_dem = np.full(CLONE_COUNT, np.nan)
        files = []
        t0 = time.perf_counter()
        for i, path in enumerate(clone_paths(site_tile)):
            check_clone_grid(path, surf)
            sampler = RasterSampler.open(f'{layer}_clone{i + 1:04d}', path, lon, lat, min(5.0, radius_km))
            try:
                ctx.sources[layer] = sampler
                for h in unique:
                    az, prof, cvg, obs_h, _ = _profile_compute(ctx, h, radius_km=radius_km)
                    profiles[h][i] = prof.astype(np.float32)
                    observer_dem[i] = obs_h
            finally:
                ctx.sources[layer] = nominal_source
                sampler.close()
            files.append({'file': path.name, 'bytes': path.stat().st_size})
            if (i + 1) % 10 == 0:
                log(f'  {i + 1}/{CLONE_COUNT} clones ({time.perf_counter() - t0:.0f} s)')
    finally:
        ctx.close()
    CLONE_PROFILES.mkdir(parents=True, exist_ok=True)
    arrays = {f'h{h:g}': profiles[h] for h in unique}
    tmp = CLONE_PROFILES / f'{key}.{os.getpid()}.part.npz'
    np.savez_compressed(tmp, observer_dem_m=observer_dem, **arrays)
    os.replace(tmp, CLONE_PROFILES / f'{key}.npz')
    meta = {'schema': CLONE_SCHEMA, 'key': key, 'latitude': lat, 'longitude': lon, 'radius_km': radius_km,
            'observer_height_m': heights, 'site_tile': site_tile, 'cloned_layer': layer, 'nominal_layers': layers,
            'n_clones': CLONE_COUNT, 'files': files, 'created_utc': datetime.now(timezone.utc).isoformat(timespec='seconds'),
            'seconds': round(time.perf_counter() - t0, 1),
            'complete_profiles': int(sum(np.isfinite(profiles[h]).all(axis=1).sum() for h in unique)),
            'source': 'PGDA product 78 (Barker et al. 2021, PSS 203:105119) LDEM clones',
            'note': 'Only the observer tile is cloned; 80 m / 240 m and other tiles stay nominal.'}
    tmpj = CLONE_PROFILES / f'{key}.{os.getpid()}.part.json'
    tmpj.write_text(json.dumps(meta, indent=1), encoding='utf-8')
    os.replace(tmpj, CLONE_PROFILES / f'{key}.json')
    log(f'[OK] clone profiles {key[:12]} ({meta["seconds"]} s)')
    return CLONE_PROFILES / f'{key}.json'


def load_clone_ensemble(lat: float, lon: float, sun_h: float, earth_h: float, radius_km: float) -> dict | None:
    """Precomputed clone profiles for exactly this request, or None (-> CLONE_NOT_PRECOMPUTED)."""
    from backend.terrain_engine import TerrainContext
    site_tile = site_tile_for(lat, lon)
    if site_tile is None or not clone_status(site_tile)['complete']:
        return None
    ctx = TerrainContext(lon, lat, radius_km, uncertainty=False)
    try:
        key = _key(lat, lon, radius_km, sun_h, earth_h, site_tile, _layer_fingerprint(ctx))
    finally:
        ctx.close()
    meta_path, npz_path = CLONE_PROFILES / f'{key}.json', CLONE_PROFILES / f'{key}.npz'
    if not (meta_path.is_file() and npz_path.is_file()):
        return None
    meta = json.loads(meta_path.read_text(encoding='utf-8'))
    with np.load(npz_path) as z:
        profiles = {body: z[f'h{float(h):g}'].astype(float) for body, h in (('sun', sun_h), ('earth', earth_h))}
        observer_dem = z['observer_dem_m'].astype(float)
    if any(p.shape != (CLONE_COUNT, 3600) for p in profiles.values()):
        return None
    return {'meta': meta, 'profiles': profiles, 'observer_dem_m': observer_dem}


def describe_gap(lat: float, lon: float) -> str:
    """Why no clone result can be produced for this location (user-facing, no paths)."""
    tile = site_tile_for(lat, lon)
    if tile is None:
        return (f'Observer is not inside a 5 m site tile with published clones ({", ".join(CLONE_SITES)}) '
                'that is present on the server; no synthetic substitute')
    st = clone_status(tile)
    if not st['complete']:
        return f'{tile}: {st["present"]}/{CLONE_COUNT} clone files present; clone ensemble incomplete'
    return (f'{tile} clones present, but profiles for this exact location/observer heights/radius are not precomputed '
            f'(python -m backend.clone_engine --lat {lat} --lon {lon})')


def summary_status() -> dict:
    """For /health: clone files per site and number of precomputed profile sets."""
    metas = []
    for meta_path in sorted(CLONE_PROFILES.glob('*.json')) if CLONE_PROFILES.is_dir() else []:
        try:
            m = json.loads(meta_path.read_text(encoding='utf-8'))
        except (OSError, ValueError):
            continue
        metas.append({'site_tile': m.get('site_tile'), 'latitude': m.get('latitude'), 'longitude': m.get('longitude'),
                      'observer_height_m': m.get('observer_height_m'), 'radius_km': m.get('radius_km'),
                      'n_clones': m.get('n_clones')})
    return {'sites': {t: clone_status(t) for t in CLONE_SITES}, 'precomputed_profile_sets': len(metas),
            'profile_sets': metas}


def envelope(profiles: np.ndarray) -> dict:
    """Per-azimuth p05 / p95 / min / max of the clone horizons (deg); for display only."""
    complete = bool(np.isfinite(profiles).all())
    q = lambda a: [None if not math.isfinite(x) else float(x) for x in a]
    return {'p05': q(np.nanpercentile(profiles, 5, axis=0)), 'p95': q(np.nanpercentile(profiles, 95, axis=0)),
            'min': q(np.nanmin(profiles, axis=0)), 'max': q(np.nanmax(profiles, axis=0)), 'complete': complete}


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(prog='python -m backend.clone_engine', description=__doc__.split('\n')[0])
    parser.add_argument('--lat', type=float, required=True)
    parser.add_argument('--lon', type=float, required=True)
    parser.add_argument('--site', choices=CLONE_SITES, help='site tile (default: the tile containing the observer)')
    parser.add_argument('--sun-h', type=float, default=4.0)
    parser.add_argument('--earth-h', type=float, default=4.0)
    parser.add_argument('--radius', type=float, default=200.0)
    args = parser.parse_args(argv)
    if not (-90 <= args.lat <= -80 and -180 <= args.lon <= 180 and 10 <= args.radius <= 200
            and 0 <= args.sun_h <= 100 and 0 <= args.earth_h <= 100):
        parser.error('outside supported limits')
    try:
        precompute(args.lat, args.lon, args.sun_h, args.earth_h, args.radius, args.site)
    except CloneError as exc:
        print(f'[ERROR] {exc}', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
