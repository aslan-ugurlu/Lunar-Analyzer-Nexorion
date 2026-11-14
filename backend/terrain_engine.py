"""Raster-backed lunar terrain horizon: NO fabricated heights or visibility.

Assumptions:
- south-pole LOLA adjusted LDEM GeoTIFF elevations in meters above 1737.4-km sphere
- the raster CRS uses the same Moon mean-Earth horizontal frame as the site input
- azimuth clockwise from north, east-positive longitude, radial local Up
- adaptive *terrain resolution by distance*, fixed 0.1-deg azimuth sampling
- 200-km search is a reference radius, not proof of complete terrain occlusion

Rasters are sampled in bounded windows. Missing data invalidates the affected ray
rather than silently assuming zero height. This is a screening-grade method,
not a certified landing hazard model. The solar-disk integration is separately
checked for numerical convergence, not promised to be <= 0.02 in all terrains.
"""
from __future__ import annotations

import hashlib
import json
import math
import os
from pathlib import Path
from dataclasses import dataclass

import numpy as np
import rasterio
from rasterio.windows import Window, from_bounds
from pyproj import CRS, Geod, Transformer

from backend.config import CACHE, DATASETS, MAX_CACHE_MB, R_MOON_KM
from backend.astro_engine import local_enu

R_M = R_MOON_KM * 1000.0
GEO = CRS.from_proj4(f'+proj=longlat +a={R_M:.0f} +b={R_M:.0f} +no_defs')
GEOD = Geod(a=R_M, b=R_M)
AZ_STEP_DEG = 0.1


class TerrainError(RuntimeError):
    pass


class TerrainMissing(TerrainError):
    pass


@dataclass
class RasterSampler:
    name: str
    path: Path
    ds: object
    transformer: object
    inv: object
    window: object
    data: np.ndarray
    crs_name: str

    @classmethod
    def open(cls, name: str, path: Path, lon: float, lat: float, radius_km: float):
        try:
            ds = rasterio.open(path)
        except Exception as exc:
            raise TerrainError(f'Cannot open {name}: {type(exc).__name__}') from exc
        try:
            if ds.count != 1 or ds.crs is None or ds.transform.determinant == 0:
                raise TerrainError(f'{name}: invalid raster bands, CRS or affine transform')
            ell = CRS.from_wkt(ds.crs.to_wkt()).ellipsoid
            a = ell.semi_major_metre
            b = ell.semi_minor_metre
            if not (math.isfinite(a) and math.isfinite(b) and abs(a-R_M) < 100 and abs(b-R_M) < 100):
                raise TerrainError(f'{name}: unexpected planetary ellipsoid {a}, {b}; check datum')
            tf = Transformer.from_crs(GEO, ds.crs, always_xy=True)
            # Query geodesic cardinal directions to cover a full disk even near projection edge.
            bearings = np.arange(0, 360, 5, dtype=float)
            lo, la, _ = GEOD.fwd(np.full_like(bearings, lon), np.full_like(bearings, lat),
                                 bearings, np.full_like(bearings, radius_km*1000))
            xx, yy = tf.transform(np.r_[lon, lo], np.r_[lat, la])
            finite = np.isfinite(xx) & np.isfinite(yy)
            if not finite.all():
                raise TerrainError(f'{name}: coordinate transformation failed')
            bounds = (float(np.min(xx)), float(np.min(yy)), float(np.max(xx)), float(np.max(yy)))
            raw = from_bounds(*bounds, transform=ds.transform).round_offsets().round_lengths()
            # One-cell margin required for bilinear interpolation.
            col0 = max(0, int(raw.col_off) - 2)
            row0 = max(0, int(raw.row_off) - 2)
            col1 = min(ds.width, int(raw.col_off + raw.width) + 3)
            row1 = min(ds.height, int(raw.row_off + raw.height) + 3)
            if col1 <= col0 or row1 <= row0:
                raise TerrainMissing(f'{name}: site outside raster footprint')
            win = Window(col0, row0, col1-col0, row1-row0)
            masked = ds.read(1, window=win, masked=True)
            vals = masked.astype('float64').filled(np.nan)
            if not np.isfinite(vals).any():
                raise TerrainMissing(f'{name}: no valid pixels in region')
            # NASA adjusted LDEM values are metres. Fail closed if obviously not plausible.
            valid = vals[np.isfinite(vals)]
            if float(np.nanmin(valid)) < -30000 or float(np.nanmax(valid)) > 30000:
                raise TerrainError(f'{name}: unexpected elevation range; verify units and product')
            return cls(name, path, ds, tf, ~ds.transform, win, vals, str(ds.crs))
        except BaseException:
            ds.close()
            raise

    def sample(self, lon, lat):
        lon = np.asarray(lon, dtype=float)
        lat = np.asarray(lat, dtype=float)
        shape = lon.shape
        x, y = self.transformer.transform(lon.ravel(), lat.ravel())
        col, row = self.inv * (np.asarray(x), np.asarray(y))
        # rasterio's inverse maps pixel corners, whereas bilinear samples centers.
        cc = np.asarray(col) - 0.5 - self.window.col_off
        rr = np.asarray(row) - 0.5 - self.window.row_off
        c0 = np.floor(cc).astype('int64')
        r0 = np.floor(rr).astype('int64')
        ok = np.isfinite(cc) & np.isfinite(rr) & (c0 >= 0) & (r0 >= 0) & \
             (c0+1 < self.data.shape[1]) & (r0+1 < self.data.shape[0])
        out = np.full(len(cc), np.nan, dtype=float)
        if np.any(ok):
            indices = np.flatnonzero(ok)
            c, r = c0[indices], r0[indices]
            a, b = cc[indices]-c, rr[indices]-r
            v00, v01 = self.data[r,c], self.data[r,c+1]
            v10, v11 = self.data[r+1,c], self.data[r+1,c+1]
            valid = np.isfinite(v00) & np.isfinite(v01) & np.isfinite(v10) & np.isfinite(v11)
            out[indices[valid]] = (
                v00[valid]*(1-a[valid])*(1-b[valid]) +
                v01[valid]*a[valid]*(1-b[valid]) +
                v10[valid]*(1-a[valid])*b[valid] +
                v11[valid]*a[valid]*b[valid]
            )
        return out.reshape(shape)

    def close(self):
        self.ds.close()


class TerrainContext:
    def __init__(self, lon, lat, radius_km, uncertainty):
        self.lon, self.lat, self.radius = lon, lat, radius_km
        self.sources = {}
        self.errors = {}
        self.loaded = []
        try:
            for name, definition in DATASETS.items():
                path = definition['path']
                if not path.is_file():
                    continue
                limit = min(radius_km, 5 if '5m' in name or '20m' in name else
                            30 if '80m' in name else radius_km)
                try:
                    source = RasterSampler.open(name, path, lon, lat, limit)
                    self.sources[name] = source
                    self.loaded.append(source)
                except TerrainMissing:
                    continue
                if uncertainty and definition.get('err') is not None and definition['err'].is_file():
                    err = RasterSampler.open(name+'_ERR', definition['err'], lon, lat, limit)
                    self.errors[name] = err
                    self.loaded.append(err)
            if 'lola_240m' not in self.sources:
                raise TerrainMissing('lola_240m is required for complete 200-km coverage')
        except BaseException:
            self.close()
            raise

    def close(self):
        for s in self.loaded:
            s.close()

    def sample(self, lon, lat, distance_km, with_error=False):
        """Best available LOD; use coarser layer for missing higher-res pixels."""
        distance = np.asarray(distance_km)
        shape = np.shape(lon)
        available = []
        if np.max(distance) <= 5.0001:
            available = ['site01_5m','site04_5m','site07_5m','site11_5m','site23_5m','lola_20m','lola_80m','lola_240m']
        elif np.max(distance) <= 30.0001:
            available = ['lola_80m','lola_240m']
        else:
            available = ['lola_240m']
        heights = np.full(shape, np.nan)
        errors = np.full(shape, np.nan)
        provenance = np.full(shape, '', dtype=object)
        for name in available:
            if name not in self.sources:
                continue
            values = self.sources[name].sample(lon, lat)
            new = np.isnan(heights) & np.isfinite(values)
            heights[new] = values[new]
            provenance[new] = name
            if with_error and name in self.errors:
                sigma = self.errors[name].sample(lon, lat)
                errors[new] = np.where(sigma[new] >= 0, sigma[new], np.nan)
        return heights, errors, provenance


def _cartesian(lon_deg, lat_deg, heights_m):
    lo, la = np.radians(lon_deg), np.radians(lat_deg)
    cl = np.cos(la)
    radius = R_M + heights_m
    return np.stack((radius*cl*np.cos(lo), radius*cl*np.sin(lo), radius*np.sin(la)), axis=-1)


def _angle(observer_xyz, target_xyz, up):
    delta = target_xyz - observer_xyz
    vertical = np.sum(delta*up, axis=-1)
    horizontal = np.sqrt(np.maximum(0, np.sum(delta*delta, axis=-1) - vertical*vertical))
    return np.degrees(np.arctan2(vertical, horizontal))


def _profile_compute(ctx: TerrainContext, observer_height_m, sigma_multiplier=0.0,
                     uncertainty=False, az_step_deg=AZ_STEP_DEG, radius_km=200.0):
    """Return azimuth profile; sigma_multiplier is +/- on OBSTACLE heights.

    Observer elevation is modified in the OPPOSITE direction. Requires complete
    ERR coverage for uncertainty use; otherwise corresponding azimuth is NaN.
    """
    azimuths = np.arange(0, 360, az_step_deg, dtype=float)
    profile = np.full(len(azimuths), np.nan)
    coverage = np.zeros(len(azimuths), dtype=float)
    obs_h, obs_err, _ = ctx.sample(np.array([ctx.lon]), np.array([ctx.lat]), np.array([0.0]), uncertainty)
    if not np.isfinite(obs_h[0]):
        raise TerrainMissing('No valid DEM at observer location')
    if uncertainty and not np.isfinite(obs_err[0]):
        raise TerrainMissing('No ERR layer at observer location')
    observer_radius_h = float(obs_h[0] + observer_height_m - sigma_multiplier*(obs_err[0] if uncertainty else 0))
    if R_M + observer_radius_h <= 0:
        raise TerrainError('Invalid observer radius')
    observer = _cartesian(ctx.lon, ctx.lat, observer_radius_h)
    east, north, up = local_enu(ctx.lat, ctx.lon)
    rings = ((0.02, min(5.0, radius_km), 0.02),
             (5.0, min(30.0, radius_km), 0.08),
             (30.0, radius_km, 0.24))
    # 60 bearings per chunk to bound peak allocations.
    for i in range(0, len(azimuths), 60):
        group = azimuths[i:i+60]
        best = np.full(group.shape, -90.0)
        inspected, missing = np.zeros(len(group)), np.zeros(len(group))
        for start, stop, step in rings:
            if stop <= start:
                continue
            distances = np.arange(start, stop+1e-7, step)
            aa = np.broadcast_to(group[:,None], (len(group), len(distances)))
            dd = np.broadcast_to(distances[None,:], aa.shape)
            lon2, lat2, _ = GEOD.fwd(np.full(aa.size, ctx.lon), np.full(aa.size, ctx.lat),
                                     aa.ravel(), (dd*1000).ravel())
            lon2 = np.asarray(lon2).reshape(aa.shape)
            lat2 = np.asarray(lat2).reshape(aa.shape)
            h, err, _ = ctx.sample(lon2, lat2, dd, uncertainty)
            valid = np.isfinite(h)
            if uncertainty:
                valid &= np.isfinite(err)
            inspected += len(distances)
            missing += (~valid).sum(axis=1)
            h_variant = np.where(valid, h + (sigma_multiplier*err if uncertainty else 0), 0.0)
            target = _cartesian(lon2, lat2, h_variant)
            angles = _angle(observer, target, up)
            angles[~valid] = -90.0
            best = np.maximum(best, np.max(angles, axis=1))
        # Missing ANY sample can hide an unconstrained obstacle: fail closed on the affected ray.
        profile[i:i+len(group)] = np.where(missing == 0, best, np.nan)
        coverage[i:i+len(group)] = np.divide(inspected-missing, inspected, out=np.zeros_like(inspected), where=inspected>0)
    return azimuths, profile, coverage, float(obs_h[0]), float(obs_err[0]) if np.isfinite(obs_err[0]) else None


def prune_cache(directory: Path = CACHE, max_mb: float = MAX_CACHE_MB, keep: Path | None = None) -> int:
    """Enforce the horizon-cache disk quota by deleting the oldest entries. Returns count removed."""
    try:
        entries = [(p.stat().st_mtime, p.stat().st_size, p) for p in directory.glob('*.json')]
    except OSError:
        return 0
    total = sum(size for _, size, _ in entries)
    limit = max_mb * 1024 * 1024
    removed = 0
    for _, size, path in sorted(entries, key=lambda e: e[0]):
        if total <= limit:
            break
        if keep is not None and path == keep:
            continue
        try:
            path.unlink()
            total -= size
            removed += 1
        except OSError:
            continue
    return removed


def _fingerprint(lat, lon, radius_km, sun_h, earth_h, uncertainty, k, sources, dataset_id):
    entries = []
    for name, src in sorted(sources):
        stat = src.stat()
        entries.append((name, str(src.resolve()), stat.st_size, stat.st_mtime_ns))
    blob = json.dumps([lat,lon,radius_km,sun_h,earth_h,uncertainty,k, AZ_STEP_DEG,entries,dataset_id], sort_keys=True)
    return hashlib.sha256(blob.encode()).hexdigest()


def compute_horizon(lat_deg: float, lon_deg: float, radius_km=200.0,
                    sun_height_m=4.0, earth_height_m=4.0,
                    uncertainty_mode='nominal', k=1.0, dataset_id='lola_240m'):
    if not all(map(math.isfinite, (lat_deg, lon_deg, radius_km, sun_height_m, earth_height_m, k))):
        raise ValueError('Nonfinite parameter')
    if not (-90 <= lat_deg <= -80 and -180 <= lon_deg <= 180):
        raise ValueError('Outside supported south pole')
    if not 10 <= radius_km <= 250:  # 250 allowed only for offline validation caller
        raise ValueError('Invalid radius')
    if not 0 <= sun_height_m <= 100 or not 0 <= earth_height_m <= 100 or not 0 <= k <= 3:
        raise ValueError('Invalid observer height or k')
    if uncertainty_mode not in ('nominal', 'err'):
        raise ValueError('Clone profiles require independently registered precomputed inputs')
    if dataset_id not in DATASETS or not DATASETS[dataset_id]['path'].is_file():
        raise TerrainMissing(f'Selected dataset missing or invalid: {dataset_id}')
    uncertainty = uncertainty_mode == 'err'
    # Open full set once per analysis; 250-km tests use same computation core.
    ctx = TerrainContext(lon_deg, lat_deg, radius_km, uncertainty)
    try:
        if dataset_id not in ctx.sources:
            raise TerrainMissing(f'Selected dataset does not cover observer: {dataset_id}')
        selected_elev = ctx.sources[dataset_id].sample(np.array([lon_deg]), np.array([lat_deg]))
        if not np.isfinite(selected_elev[0]):
            raise TerrainMissing(f'Selected dataset has no valid elevation at observer: {dataset_id}')
        sources = [(name, src.path) for name, src in ctx.sources.items()]
        sources += [(name+'_err', src.path) for name, src in ctx.errors.items()]
        key = _fingerprint(lat_deg, lon_deg, radius_km, sun_height_m, earth_height_m, uncertainty, k, sources, dataset_id)
        CACHE.mkdir(parents=True, exist_ok=True)
        cache_path = CACHE / (key+'.json')
        if cache_path.exists():
            return json.loads(cache_path.read_text(encoding='utf-8'))
        profiles = {}
        geometry = None
        computed = {}  # identical observer heights -> identical profiles; compute once
        for body,height in (('sun',sun_height_m), ('earth',earth_height_m)):
            if height in computed:
                profiles[body] = json.loads(json.dumps(computed[height]))
                continue
            az, nominal, cvg, obs_height, obs_sigma = _profile_compute(ctx, height, radius_km=radius_km)
            record = {'nominal': [None if not math.isfinite(x) else float(x) for x in nominal], 'coverage': cvg.tolist()}
            if uncertainty:
                _, caution, _, _, _ = _profile_compute(ctx, height, sigma_multiplier=+k,
                                                         uncertainty=True, radius_km=radius_km)
                _, optimistic, _, _, _ = _profile_compute(ctx, height, sigma_multiplier=-k,
                                                            uncertainty=True, radius_km=radius_km)
                record.update({'cautious': [None if not math.isfinite(x) else float(x) for x in caution], 'optimistic': [None if not math.isfinite(x) else float(x) for x in optimistic]})
            profiles[body] = record
            computed[height] = record
            geometry = {'observer_dem_m': obs_height, 'observer_err_m': obs_sigma,
                        'observer_height_m': {'sun': sun_height_m, 'earth': earth_height_m}}
        output = {'azimuth_deg': az.tolist(), 'profiles': profiles, 'geometry': geometry,
                  'sources': {name:src.path.relative_to(src.path.parents[1]).as_posix() for name,src in ctx.sources.items()},
                  'reference_radius_km':radius_km, 'selected_dataset_id':dataset_id, 'uncertainty_mode':uncertainty_mode,
                  'k':k if uncertainty else None, 'cache_key':key,
                  'status':'complete' if all(np.isfinite(np.asarray(profiles[b]['nominal'],dtype=float)).all() for b in profiles)
                              and (not uncertainty or all(np.isfinite(np.asarray(profiles[b][mode],dtype=float)).all() for b in profiles
                                                            for mode in ('cautious','optimistic'))) else 'partial',
                  'notes':['200 km is an adopted JPL-inspired reference, not guaranteed exhaustive',
                           'ERR +/- k is a sensitivity scenario, NOT statistical confidence bounds',
                           'Sun disk integration numerical accuracy must be tested separately']}
        tmp = cache_path.with_name(cache_path.name+'.'+str(os.getpid())+'.part')
        tmp.write_text(json.dumps(output, allow_nan=False), encoding='utf-8')
        os.replace(tmp, cache_path)
        prune_cache(CACHE, MAX_CACHE_MB, keep=cache_path)
        return output
    finally:
        ctx.close()


def horizon_at(profile: dict, azimuth):
    """Periodic linear interpolation; invalid adjacent rays yield NaN."""
    heights = np.asarray(profile, dtype=float)
    az = np.asarray(azimuth, dtype=float)
    scaled = (az % 360.0) / (360.0 / len(heights))
    lower = np.floor(scaled).astype(int) % len(heights)
    upper = (lower+1) % len(heights)
    t = scaled-np.floor(scaled)
    val = heights[lower]*(1-t)+heights[upper]*t
    return val


def sun_disk_fraction(sun_az, sun_el, radius_deg, horizon_deg, detail=1):
    """Numerically integrate uniform-brightness solar disk against curved horizon.

    Return None if the relevant horizon contains NaNs. Does not model panel power.
    For partial disks, compare base and doubled quadrature and report |difference|.
    """
    sun_az, sun_el, radius_deg = float(sun_az), float(sun_el), float(radius_deg)
    center_h = float(horizon_at(horizon_deg, sun_az))
    if not math.isfinite(center_h):
        return {'fraction':None, 'numerical_diff':None}
    # Bounding entire possible horizon across solar disk, not only center point.
    az_scan = np.linspace(sun_az-2*radius_deg, sun_az+2*radius_deg, 15)
    hs = horizon_at(horizon_deg, az_scan)
    if not np.isfinite(hs).all():
        return {'fraction':None, 'numerical_diff':None}
    if sun_el-radius_deg > float(np.max(hs)):
        return {'fraction':1.0, 'numerical_diff':0.0}
    if sun_el+radius_deg < float(np.min(hs)):
        return {'fraction':0.0, 'numerical_diff':0.0}

    def integrate(nr, nt):
        # Area-uniform polar quadrature (equal area annuli and equal angular bins).
        r = radius_deg*np.sqrt((np.arange(nr)+0.5)/nr)[:,None]
        t = 2*np.pi*(np.arange(nt)+0.5)/nt
        dx, dy = r*np.cos(t), r*np.sin(t)
        cos_el = max(1e-8, math.cos(math.radians(sun_el)))
        sample_az = sun_az + dx / cos_el
        sample_el = sun_el + dy
        hs2 = horizon_at(horizon_deg, sample_az)
        if not np.isfinite(hs2).all():
            return None
        return float(np.mean(sample_el >= hs2))

    a = integrate(12*detail, 48*detail)
    b = integrate(24*detail, 96*detail)
    if a is None or b is None:
        return {'fraction':None, 'numerical_diff':None}
    return {'fraction':b, 'numerical_diff':abs(a-b)}


def earth_dte_visible(earth_az, earth_el, horizon_deg):
    h = float(horizon_at(horizon_deg, earth_az))
    if not math.isfinite(h):
        return None
    # Geometrical Earth CENTER above the terrain horizon. Not an RF link budget.
    return bool(earth_el > h)


def local_slope(lat_deg, lon_deg, footprint_radius_m=30.0):
    """Screening-only slope from central finite differences; no terrain safety certification.

    Uses best available <=20m raster and checks a user-specified footprint grid.
    If no such dataset is available, return unavailable instead of a guessed slope.
    """
    options = sorted(((v['resolution_m'], key, v['path']) for key,v in DATASETS.items()
                      if v['resolution_m'] <= 20 and v['path'].exists()))
    for resolution, name, path in options:
        try:
            s = RasterSampler.open(name, path, lon_deg, lat_deg, max(0.5, footprint_radius_m/1000+0.2))
            try:
                xy = np.linspace(-footprint_radius_m,footprint_radius_m,7)
                values=[]
                step = max(5., float(resolution))
                for north in xy:
                    for east in xy:
                        if east*east+north*north > footprint_radius_m**2:
                            continue
                        az = math.degrees(math.atan2(east,north))%360
                        dd = math.hypot(east,north)
                        lo,la,_ = GEOD.fwd(lon_deg,lat_deg,az,dd)
                        bearings = np.array([0,90,180,270], dtype=float)
                        longitudes,latitudes,_=GEOD.fwd(np.full(4,lo),np.full(4,la),bearings,np.full(4,step))
                        north_h,east_h,south_h,west_h=s.sample(longitudes,latitudes)
                        if not np.isfinite([north_h,east_h,south_h,west_h]).all():
                            return {'slope_max_deg':None,'status':'missing_data','source':name}
                        grad = math.hypot((east_h-west_h)/(2*step),(north_h-south_h)/(2*step))
                        values.append(math.degrees(math.atan(grad)))
                if values:
                    return {'slope_max_deg':max(values),'slope_mean_deg':float(np.mean(values)),
                            'status':'screening_only','source':name,'footprint_radius_m':footprint_radius_m,
                            'sampling_interval_m':step}
            finally:
                s.close()
        except TerrainMissing:
            continue
    return {'slope_max_deg':None,'status':'high_resolution_dem_missing'}
