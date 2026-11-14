"""Run the scientific validation checks that are possible with the data present
and write data/validation/report.json (served by GET /validation).

    python -m backend.validation                 # all checks, incl. JPL Horizons (network)
    python -m backend.validation --skip-network  # A-04/V-04 recorded as NOT_RUN

Rules: a status is PASS/FAIL only when the check actually ran; missing data ->
BLOCKED, never-implemented data products (clones) -> NOT_RUN. Each PASS covers
only the recorded cases and criteria; it is not a mission certification.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import sys
import time
import traceback
from datetime import datetime, timezone

import numpy as np

from backend.config import DATASETS, FRAME, KERNELS, R_MOON_KM, VALIDATION

# Test locations: (1) example coordinate from the project docs, (2) a ridge point with DEM height
# 1950.3 m adjacent to the highest pixel within 40 km of the pole (1954.3 m at -89.4455, -137.3137;
# the first search used a fractional raster window, hence the one-pixel offset).
# Neither is an official candidate.
SITES = [(-89.54, 0.0), (-89.4512, -137.1427)]


def validation_sites() -> list[tuple[str, float, float]]:
    """Faz 7: the two fixed test points + the raster centre of every PRESENT 5 m site tile.

    Tile centres come from each GeoTIFF's own georeferencing (raster_footprint); they are coverage
    centres, not landing coordinates. Sites are added only when their file exists, so the list (and
    therefore the evidence) is recorded with every run.
    """
    from backend.terrain_engine import raster_footprint
    out = [('test point -89.54/0', *SITES[0]), ('ridge test point', *SITES[1])]
    for name, definition in DATASETS.items():
        if definition.get('kind') == 'site' and definition['path'].is_file():
            fp = raster_footprint(definition['path'])
            out.append((f'{name} tile centre', round(fp['center']['lat'], 5), round(fp['center']['lon'], 5)))
    return out


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z')


def entry(status: str, summary: str, evidence=None) -> dict:
    assert status in ('PASS', 'FAIL', 'NOT_RUN', 'BLOCKED')
    return {'status': status, 'summary': summary, 'evidence': evidence, 'run_utc': now()}


def dem_present() -> bool:
    return DATASETS['lola_240m']['path'].is_file()


# --------------------------------------------------------------------------- checks

def v01_sources_and_coverage() -> dict:
    from backend.astro_engine import load_kernels, _spice
    missing = [k.name for k in KERNELS if not k.is_file()]
    if missing:
        return entry('BLOCKED', f'Missing kernels: {missing}')
    load_kernels(force_reload=True)
    spice = _spice()
    window = (spice.str2et('2026-01-01 00:00:00 UTC'), spice.str2et('2036-01-01 00:00:00 UTC'))
    spk = str([k for k in KERNELS if k.name.endswith('.bsp')][0])
    bpc = str([k for k in KERNELS if k.name.endswith('.bpc')][0])
    evidence = {'product_window_utc': ['2026-01-01', '2036-01-01'], 'spk': {}, 'pck': {}}
    ok = True
    for body, code in (('SUN', 10), ('EARTH', 399), ('MOON', 301), ('EMB', 3)):
        cover = spice.spkcov(spk, code)
        intervals = [spice.wnfetd(cover, i) for i in range(spice.wncard(cover))]
        covered = any(a <= window[0] and b >= window[1] for a, b in intervals)
        evidence['spk'][body] = {'covered': covered, 'intervals_utc': [[spice.et2utc(a, 'ISOC', 0), spice.et2utc(b, 'ISOC', 0)] for a, b in intervals]}
        ok &= covered
    frame_class_id = 31008  # MOON_PA_DE440 binary PCK frame
    cover = spice.pckcov(bpc, frame_class_id)
    intervals = [spice.wnfetd(cover, i) for i in range(spice.wncard(cover))]
    covered = any(a <= window[0] and b >= window[1] for a, b in intervals)
    evidence['pck']['MOON_PA_DE440 (31008)'] = {'covered': covered, 'intervals_utc': [[spice.et2utc(a, 'ISOC', 0), spice.et2utc(b, 'ISOC', 0)] for a, b in intervals]}
    ok &= covered
    manifest_path = VALIDATION.parent / 'manifest.json'
    if manifest_path.is_file():
        manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
        evidence['lola'] = {k: {'status': v.get('status'), 'bytes': v.get('bytes'), 'url': v.get('url'),
                                'crs': v.get('validation', {}).get('crs_wkt_name')} for k, v in manifest.get('lola', {}).items()}
    evidence['dem_present'] = dem_present()
    return entry('PASS' if ok else 'FAIL',
                 'SPK (Sun/Earth/Moon/EMB) and Moon PA binary PCK cover 2026-2035' if ok else 'Kernel coverage gap in 2026-2035',
                 evidence)


def v02_frames() -> dict:
    from backend.astro_engine import load_kernels, _spice
    load_kernels()
    spice = _spice()
    et = spice.str2et('2026-12-01 12:00:00 UTC')
    rot = np.asarray(spice.pxform('MOON_PA_DE440', FRAME, et))
    angle_arcsec = math.degrees(math.acos(max(-1.0, min(1.0, (np.trace(rot) - 1) / 2)))) * 3600
    evidence = {'frame': FRAME, 'frame_id': int(spice.namfrm(FRAME)),
                'PA_to_ME_rotation_arcsec_2026-12-01': round(angle_arcsec, 2),
                'note': 'ME and PA differ by this rotation (~hundreds of metres at the surface); all code uses ME'}
    if not dem_present():
        return entry('BLOCKED', 'Frame OK but LOLA 240 m raster missing for CRS check', evidence)
    import rasterio
    from pyproj import CRS, Transformer
    with rasterio.open(DATASETS['lola_240m']['path']) as ds:
        crs = CRS.from_wkt(ds.crs.to_wkt())
        a = crs.ellipsoid.semi_major_metre
        b = crs.ellipsoid.semi_minor_metre
        geo = CRS.from_proj4(f'+proj=longlat +a={R_MOON_KM * 1000} +b={R_MOON_KM * 1000} +no_defs')
        px, py = Transformer.from_crs(geo, crs, always_xy=True).transform(0.0, -90.0)
        qx, qy = Transformer.from_crs(geo, crs, always_xy=True).transform(90.0, -89.0)
        evidence.update({'raster_crs': crs.name, 'sphere_m': [a, b], 'pole_xy_m': [px, py],
                         'east_90_lat_-89_xy_m': [round(qx, 1), round(qy, 1)]})
        ok = abs(a - R_MOON_KM * 1000) < 1 and abs(b - R_MOON_KM * 1000) < 1 and abs(px) < 1e-6 and abs(py) < 1e-6 \
            and qx > 0 and abs(qy) < 1e-6  # +90 E lies on +x (east-positive longitudes)
    return entry('PASS' if ok else 'FAIL',
                 'MOON_ME_DE440_ME421 loaded; raster is 1737.4 km Moon sphere south-polar stereographic, east-positive' if ok
                 else 'Raster CRS/sphere/orientation mismatch', evidence)


def v03_utc() -> dict:
    from backend.astro_engine import load_kernels, normalize_utc_to_et
    load_kernels()
    rows = []
    for text in ('2026-01-01T00:00:00Z', '2026-12-01T12:00:00Z', '2030-06-30T23:59:59Z', '2035-12-31T12:00:00Z'):
        _, et = normalize_utc_to_et(text)
        utc = datetime.fromisoformat(text.replace('Z', '+00:00'))
        expected = (utc - datetime(2000, 1, 1, 12, tzinfo=timezone.utc)).total_seconds() + 69.184
        rows.append({'utc': text, 'et': et, 'independent_tt_approx': expected, 'diff_s': et - expected})
    ok = all(abs(r['diff_s']) < 0.01 for r in rows)
    return entry('PASS' if ok else 'FAIL', 'UTC->ET within 0.01 s of independent TT-UTC=69.184 s (TDB-TT < 2 ms; assumes no new leap second)', rows)


def a04_horizons() -> dict:
    from backend.verify_horizons import run_a04_suite
    result = run_a04_suite(extended=True)
    worst = max(r['difference_deg'] for r in result['rows'])
    cases = len({r['case'] for r in result['rows']})
    return entry('PASS' if result['all_passed'] else 'FAIL',
                 f"{len(result['rows'])} Sun/Earth directions at {cases} site/date cases (2026-2035, lat -80.5..-89.98, "
                 f"heights 0-5 km); max separation {worst:.2e} deg (threshold 0.005); synthetic heights",
                 {'max_difference_deg': worst, 'rows': [{k: r[k] for k in ('case', 'body', 'utc', 'difference_deg', 'passed')} for r in result['rows']],
                  'horizons_site_metadata': result['rows'][0]['horizons_site_metadata']})


def v05_radius_sensitivity() -> dict:
    if not dem_present():
        return entry('BLOCKED', 'LOLA 240 m raster missing')
    from backend.terrain_engine import compute_horizon
    rows = []
    for label, lat, lon in validation_sites():
        prof = {}
        timings = {}
        for radius in (135.0, 200.0, 250.0):  # 250 km: offline validation only (API limit is 200)
            t0 = time.perf_counter()
            h = compute_horizon(lat, lon, radius_km=radius, sun_height_m=4.0, earth_height_m=4.0)
            timings[radius] = round(time.perf_counter() - t0, 2)
            prof[radius] = np.asarray(h['profiles']['sun']['nominal'], dtype=float)
        d1 = np.abs(prof[200.0] - prof[135.0])
        d2 = np.abs(prof[250.0] - prof[200.0])
        rows.append({'site': [lat, lon], 'label': label, 'seconds': timings,
                     'max_abs_diff_deg_135_vs_200': float(np.nanmax(d1)), 'share_az_diff_gt_0.01deg_135_vs_200': float(np.mean(d1 > 0.01)),
                     'max_abs_diff_deg_200_vs_250': float(np.nanmax(d2)), 'share_az_diff_gt_0.01deg_200_vs_250': float(np.mean(d2 > 0.01))})
    worst = max(r['max_abs_diff_deg_200_vs_250'] for r in rows)
    ok = worst < 0.05
    worst135 = max(r['max_abs_diff_deg_135_vs_200'] for r in rows)
    return entry('PASS' if ok else 'FAIL',
                 f'Criterion: 200->250 km max horizon change < 0.05 deg at every site; observed {worst:.4f} deg over {len(rows)} sites. '
                 f'135->200 km max change {worst135:.3f} deg (why <200 km may not end GREEN). Not exhaustive.',
                 rows)


def _grid_points(footprint: dict, path, n: int = 15, inner: float = 0.8):
    """Regular grid of lon/lat points over the inner part of a raster (from its own transform)."""
    import rasterio
    from pyproj import CRS, Transformer
    with rasterio.open(path) as ds:
        left, bottom, right, top = ds.bounds
        cx, cy = (left + right) / 2, (bottom + top) / 2
        hx, hy = (right - left) / 2 * inner, (top - bottom) / 2 * inner
        xs, ys = np.meshgrid(np.linspace(cx - hx, cx + hx, n), np.linspace(cy - hy, cy + hy, n))
        geo = CRS.from_proj4(f'+proj=longlat +a={R_MOON_KM * 1000} +b={R_MOON_KM * 1000} +no_defs')
        lon, lat = Transformer.from_crs(ds.crs, geo, always_xy=True).transform(xs.ravel(), ys.ravel())
    return np.asarray(lon), np.asarray(lat)


def _compare_layers(fine: str, coarse: str, lon, lat, centre, radius_km) -> dict:
    from backend.terrain_engine import RasterSampler
    a = RasterSampler.open(fine, DATASETS[fine]['path'], centre[0], centre[1], radius_km)
    b = RasterSampler.open(coarse, DATASETS[coarse]['path'], centre[0], centre[1], radius_km)
    try:
        fa, fb = a.sample(lon, lat), b.sample(lon, lat)
    finally:
        a.close()
        b.close()
    ok = np.isfinite(fa) & np.isfinite(fb)
    d = fa[ok] - fb[ok]
    return {'pair': f'{fine} - {coarse}', 'n': int(ok.sum()), 'median_diff_m': float(np.median(d)) if d.size else None,
            'p95_abs_diff_m': float(np.percentile(np.abs(d), 95)) if d.size else None}


def v06_lod_nodata() -> dict:
    if not dem_present():
        return entry('BLOCKED', 'LOLA 240 m raster missing')
    import rasterio
    from rasterio.windows import from_bounds
    from backend.terrain_engine import RasterSampler, TerrainContext, raster_footprint
    with rasterio.open(DATASETS['lola_240m']['path']) as ds:
        win = from_bounds(-260000, -260000, 260000, 260000, transform=ds.transform)
        data = ds.read(1, window=win, masked=True)
        nan_count = int(np.count_nonzero(~np.isfinite(data.filled(np.nan))))
    sampler = RasterSampler.open('lola_240m', DATASETS['lola_240m']['path'], 0.0, -89.5, 5)
    try:
        sampler.data[sampler.data.shape[0] // 2, sampler.data.shape[1] // 2] = np.nan  # in-memory copy only
        r = sampler.data.shape[0] // 2 + sampler.window.row_off
        c = sampler.data.shape[1] // 2 + sampler.window.col_off
        x, y = sampler.ds.transform * (c + 0.5, r + 0.5)
        lon, lat = sampler.transformer.transform(x, y, direction='INVERSE')
        sampled = float(sampler.sample(np.array([lon]), np.array([lat]))[0])
    finally:
        sampler.close()
    present = [k for k, v in DATASETS.items() if v['path'].is_file()]
    evidence = {'nan_pixels_within_260km_box': nan_count, 'nodata_pixel_sample_returns': 'NaN' if math.isnan(sampled) else sampled,
                'layers_present': present, 'criterion': '|median(fine - coarse)| < 5 m for every overlapping pair; '
                'LOD picks site (<=5 km), 80 m (<=30 km), 240 m (beyond)', 'pairs': [], 'lod_provenance': []}
    if not math.isnan(sampled):
        return entry('FAIL', 'NoData pixel did not propagate as NaN', evidence)
    finer = [k for k in present if k != 'lola_240m']
    if not finer:
        return entry('BLOCKED', 'NoData handling PASS (NaN propagates, no zero fill); LOD switching not testable: only lola_240m present', evidence)
    ok = True
    if 'lola_80m' in present:
        lon, lat = _grid_points(None, DATASETS['lola_80m']['path'], n=21, inner=0.05)  # +-~15 km box round the pole
        pair = _compare_layers('lola_80m', 'lola_240m', lon, lat, (0.0, -90.0), 40)
        evidence['pairs'].append(pair)
        ok &= pair['n'] > 0 and abs(pair['median_diff_m']) < 5
    for site in [k for k in present if DATASETS[k]['kind'] == 'site']:
        fp = raster_footprint(DATASETS[site]['path'])
        lon, lat = _grid_points(fp, DATASETS[site]['path'])
        centre = (fp['center']['lon'], fp['center']['lat'])
        radius = max(fp['width_km'], fp['height_km'])
        for coarse in [k for k in ('lola_80m', 'lola_240m') if k in present]:
            pair = _compare_layers(site, coarse, lon, lat, centre, radius)
            evidence['pairs'].append(pair)
            ok &= pair['n'] > 0 and abs(pair['median_diff_m']) < 5
        ctx = TerrainContext(centre[0], centre[1], 50.0, False)
        try:
            one = (np.array([centre[0]]), np.array([centre[1]]))
            got = {d: str(ctx.sample(*one, np.array([d]))[2][0]) for d in (1.0, 10.0, 100.0)}
        finally:
            ctx.close()
        expected = {1.0: site, 10.0: 'lola_80m' if 'lola_80m' in present else 'lola_240m', 100.0: 'lola_240m'}
        evidence['lod_provenance'].append({'site': site, 'centre': fp['center'], 'by_distance_km': got,
                                           'expected': {str(k): v for k, v in expected.items()}})
        ok &= all(got[d] == expected[d] for d in got)
    return entry('PASS' if ok else 'FAIL',
                 f"NoData propagates as NaN; {len(evidence['pairs'])} layer pair(s) agree (|median diff| < 5 m) and LOD picks the finest layer by distance"
                 if ok else 'Layer bias or LOD selection outside criterion (see evidence)', evidence)


def slope01_cross_check() -> dict:
    """Our 5 m central-difference slope vs the official PGDA product-78 slope map at the same points,
    plus one real worker analysis with a slope constraint (end-to-end)."""
    from backend.terrain_engine import RasterSampler, local_slope, raster_footprint
    from backend.config import SITES
    sites = [k for k, v in DATASETS.items() if v['kind'] == 'site' and v['path'].is_file()]
    pairs = [(k, SITES / DATASETS[k]['path'].name.replace('_surf.tif', '_slp.tif')) for k in sites]
    pairs = [(k, slp) for k, slp in pairs if slp.is_file()]
    if not pairs:
        return entry('BLOCKED', 'No 5 m site DEM with official slope map present (python -m backend.download_data --include-site-5m)')
    rows, diffs = [], []
    for site, slp_path in pairs:
        fp = raster_footprint(DATASETS[site]['path'])
        c = fp['center']
        for dlat, dlon in ((0, 0), (0.01, 0), (-0.01, 0), (0, 0.5), (0, -0.5)):
            lat, lon = c['lat'] + dlat, c['lon'] + dlon
            ours = local_slope(lat, lon, 30.0, with_points=True)
            if ours.get('source') != site or not ours.get('points'):
                rows.append({'site': site, 'lat': lat, 'lon': lon, 'skipped': ours.get('status')})
                continue
            plon = np.array([p[0] for p in ours['points']])
            plat = np.array([p[1] for p in ours['points']])
            official = RasterSampler.open(site + '_slp', slp_path, lon, lat, 0.5)
            try:
                ref = official.sample(plon, plat)
            finally:
                official.close()
            mine = np.array([p[2] for p in ours['points']])
            ok = np.isfinite(ref)
            d = mine[ok] - ref[ok]
            diffs.extend(d.tolist())
            rows.append({'site': site, 'lat': round(lat, 5), 'lon': round(lon, 5), 'n': int(ok.sum()),
                         'ours_mean_deg': float(mine.mean()), 'ours_max_deg': float(mine.max()),
                         'official_mean_deg': float(np.nanmean(ref)), 'official_max_deg': float(np.nanmax(ref)),
                         'median_abs_diff_deg': float(np.median(np.abs(d))) if d.size else None})
    from backend.main import _worker_calculate
    site, _ = pairs[0]
    c = raster_footprint(DATASETS[site]['path'])['center']
    payload = {'dataset_id': site, 'latitude': c['lat'], 'longitude': c['lon'], 'landing_utc': '2026-12-17T00:00:00Z',
               'duration_hours': 24, 'buffer_hours': 0, 'step_minutes': 60, 'horizon_radius_km': 200, 'sun_observer_height_m': 4,
               'earth_observer_height_m': 4, 'uncertainty_mode': 'nominal', 'err_k': 1, 'dark_fraction_threshold': 0.01,
               'shifts_hours': [0], 'constraints': {'max_slope_deg': 10, 'slope_footprint_radius_m': 30}}
    result = _worker_calculate(payload)
    mission = result.get('mission') or {}
    slope = mission.get('slope') or {}
    e2e = {'site': site, 'centre': c, 'decision': mission.get('status', result.get('status')), 'error_code': result.get('error_code'),
           'slope': {k: slope.get(k) for k in ('slope_max_deg', 'slope_mean_deg', 'status', 'source', 'sampling_interval_m', 'n_points')},
           'max_slope_violation': [v for v in mission.get('nominal_violations', []) if v['code'] == 'MAX_SLOPE'],
           'slope_unknown': any(u['code'] == 'SLOPE_UNKNOWN' for u in mission.get('unresolved', [])),
           'horizon_layers': (result.get('horizon') or {}).get('layer_resolution_m')}
    median_abs = float(np.median(np.abs(diffs))) if diffs else None
    e2e_ok = slope.get('status') == 'screening_only' and slope.get('source') == site and not e2e['slope_unknown']
    ok = median_abs is not None and median_abs <= 2.0 and e2e_ok
    return entry('PASS' if ok else 'FAIL',
                 f'5 m slope vs official PGDA slope map: median |diff| {median_abs:.2f} deg over {len(diffs)} points (criterion <= 2 deg); '
                 f'end-to-end analysis with max_slope_deg evaluated slope from {slope.get("source")}. Screening only, not landing safety.'
                 if median_abs is not None else 'No comparable slope points',
                 {'criterion': 'median |ours - official| <= 2 deg; worker analysis reports screening_only slope from the 5 m layer',
                  'rows': rows, 'end_to_end': e2e})


def v07_disk_quadrature() -> dict:
    from backend.terrain_engine import sun_disk_fraction
    r = 0.27
    rows = []
    for offset in np.linspace(-0.26, 0.26, 27):
        flat = [0.0] * 3600
        el = offset
        # Analytic visible fraction of a disc above a straight horizon at 0 deg (small-angle).
        d = -el / r  # horizon position relative to centre, in radii
        analytic = 1.0 if d <= -1 else 0.0 if d >= 1 else (math.acos(d) - d * math.sqrt(1 - d * d)) / math.pi
        got = sun_disk_fraction(180.0, el, r, flat)
        rows.append({'el_offset_deg': round(float(el), 4), 'analytic': analytic, 'quadrature': got['fraction'],
                     'abs_err': abs(got['fraction'] - analytic), 'reported_refinement_diff': got['numerical_diff']})
    worst = max(x['abs_err'] for x in rows)
    curved = _v07_curved_terrain()
    ok = worst < 0.01 and curved['status'] == 'PASS'
    if curved['status'] == 'BLOCKED':
        return entry('PASS' if worst < 0.01 else 'FAIL',
                     f'Flat analytic part: max |error| {worst:.4f} (criterion < 0.01). Curved terrain BLOCKED: {curved["reason"]}',
                     {'max_abs_error': worst, 'rows': rows, 'curved': curved})
    return entry('PASS' if ok else 'FAIL',
                 f'Flat: max |error| {worst:.4f} vs analytic segment (27 offsets). Curved REAL horizons: {curved["n_partial"]} partially '
                 f'occluded Sun samples at {curved["n_sites"]} sites, max |default - dense Cartesian reference| {curved["max_abs_error"]:.4f} '
                 '(criterion < 0.01 for both). Tests disc quadrature only (same horizon interpolation), not horizon accuracy.',
                 {'max_abs_error': worst, 'rows': rows, 'curved': curved})


def _dense_reference_fraction(sun_az, sun_el, radius_deg, horizon, n=401):
    """Independent Cartesian-grid integral of the uniform solar disc above the interpolated horizon."""
    from backend.terrain_engine import horizon_at
    axis = (np.arange(n) + 0.5) / n * 2.0 - 1.0
    gx, gy = np.meshgrid(axis, axis)
    inside = gx * gx + gy * gy <= 1.0
    dx, dy = gx[inside] * radius_deg, gy[inside] * radius_deg
    cos_el = max(1e-8, math.cos(math.radians(sun_el)))
    hs = horizon_at(horizon, sun_az + dx / cos_el)
    return float(np.mean(sun_el + dy >= hs))


def _v07_curved_terrain() -> dict:
    """Pre-registered: every partially occluded sample (0.01 < f < 0.99) must agree within 0.01."""
    if not dem_present():
        return {'status': 'BLOCKED', 'reason': 'LOLA 240 m raster missing'}
    from backend.astro_engine import compute_sky_positions
    from backend.terrain_engine import compute_horizon, sun_disk_fraction
    from datetime import timedelta
    windows = [('2026-12-26T12:00:00Z', 60), ('2027-01-22T12:00:00Z', 48), ('2026-11-28T00:00:00Z', 72)]
    samples, per_site = [], []
    for label, lat, lon in validation_sites():
        h = compute_horizon(lat, lon, radius_km=200.0, sun_height_m=4.0, earth_height_m=4.0)
        prof = h['profiles']['sun']['nominal']
        if h['status'] != 'complete':
            per_site.append({'site': label, 'status': h['status']})
            continue
        n_site = 0
        for start, hours in windows:
            t0 = datetime.strptime(start, '%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=timezone.utc)
            utc = [(t0 + timedelta(minutes=30 * i)).strftime('%Y-%m-%dT%H:%M:%SZ') for i in range(hours * 2 + 1)]
            for p in compute_sky_positions(lat, lon, h['geometry']['observer_dem_m'], utc, 4.0, 4.0):
                sun = p['sun']
                got = sun_disk_fraction(sun['az_deg'], sun['el_deg'], sun['angular_radius_deg'], prof)
                f = got['fraction']
                if f is None or not 0.01 < f < 0.99:
                    continue
                ref = _dense_reference_fraction(sun['az_deg'], sun['el_deg'], sun['angular_radius_deg'], prof)
                samples.append({'site': label, 'utc': p['utc'], 'sun_az_deg': sun['az_deg'], 'sun_el_deg': sun['el_deg'],
                                'default': f, 'reference': ref, 'abs_err': abs(f - ref),
                                'reported_refinement_diff': got['numerical_diff']})
                n_site += 1
        per_site.append({'site': label, 'partial_samples': n_site})
    if len(samples) < 20:
        return {'status': 'BLOCKED', 'reason': f'only {len(samples)} partially occluded samples found (need >= 20)', 'per_site': per_site}
    worst = max(x['abs_err'] for x in samples)
    worst_rows = sorted(samples, key=lambda x: -x['abs_err'])[:10]
    return {'status': 'PASS' if worst < 0.01 else 'FAIL', 'n_partial': len(samples), 'max_abs_error': worst,
            'n_sites': sum(1 for x in per_site if x.get('partial_samples')), 'per_site': per_site,
            'median_abs_error': float(np.median([x['abs_err'] for x in samples])), 'worst_samples': worst_rows,
            'reference': 'Cartesian 401x401 grid inside the disc (independent of the polar quadrature)'}


def v08_err_clone() -> dict:
    err_path = DATASETS['lola_240m']['err']
    if not (dem_present() and err_path and err_path.is_file()):
        return entry('BLOCKED', 'LDEM_60S_240MPP_ADJ_ERR.TIF not present; ERR sensitivity not run. DEM clones: not available (CLONE_NOT_PRECOMPUTED).')
    from backend.terrain_engine import compute_horizon
    rows = []
    for label, lat, lon in validation_sites():
        bands = {}
        row = {'site': [lat, lon], 'label': label}
        for k in (1.0, 2.0):
            h = compute_horizon(lat, lon, radius_km=200.0, sun_height_m=4.0, earth_height_m=4.0, uncertainty_mode='err', k=k)
            nom = np.asarray(h['profiles']['sun']['nominal'], dtype=float)
            cau = np.asarray(h['profiles']['sun'].get('cautious', []), dtype=float)
            opt = np.asarray(h['profiles']['sun'].get('optimistic', []), dtype=float)
            bands[k] = (cau - opt) if cau.size else None
            row[f'k{int(k)}'] = {'status': h['status'], 'observer_err_m': h['geometry']['observer_err_m'],
                                 'excluded_layers': h.get('excluded_layers'),
                                 'ordered_cautious_ge_nominal_ge_optimistic': bool(np.all(cau >= nom - 1e-9) and np.all(nom >= opt - 1e-9)) if cau.size else None,
                                 'max_band_width_deg': float(np.nanmax(cau - opt)) if cau.size else None}
        row['band_k2_ge_band_k1'] = bool(bands[1.0] is not None and bands[2.0] is not None and np.all(bands[2.0] >= bands[1.0] - 1e-9))
        rows.append(row)
    ok = all(r[f'k{k}']['ordered_cautious_ge_nominal_ge_optimistic'] and r[f'k{k}']['status'] == 'complete'
             and isinstance(r[f'k{k}']['observer_err_m'], float) and r[f'k{k}']['observer_err_m'] >= 0
             for r in rows for k in (1, 2)) and all(r['band_k2_ge_band_k1'] for r in rows)
    return entry('PASS' if ok else 'FAIL',
                 f'ERR +/-k sensitivity at {len(rows)} sites for k=1 and k=2: complete coverage, cautious >= nominal >= optimistic, '
                 'band(k=2) >= band(k=1) at every azimuth, observer sigma reported. Consistency only - not a statistical '
                 'validation. DEM clones: see CLONE-01.', rows)


def effres01_effective_resolution() -> dict:
    """EFFRES maps: same grid as their DEM, and valid values in each layer's principal band at every site."""
    import rasterio
    from pyproj import CRS
    from backend.terrain_engine import effective_resolution_summary
    pairs = [(n, d) for n, d in DATASETS.items() if d.get('effres') is not None]
    present = [(n, d) for n, d in pairs if d['path'].is_file() and d['effres'].is_file()]
    if not present:
        return entry('BLOCKED', 'No EFFRES map present (python -m backend.download_data --include-lola-effres)')
    grid, rows = [], []
    for name, d in present:
        with rasterio.open(d['path']) as dem, rasterio.open(d['effres']) as eff:
            same_crs = CRS.from_wkt(dem.crs.to_wkt()).to_dict() == CRS.from_wkt(eff.crs.to_wkt()).to_dict()
            grid.append({'layer': name, 'same_shape': (dem.width, dem.height) == (eff.width, eff.height),
                         'same_transform': dem.transform == eff.transform, 'same_crs_params': same_crs})
    names = [n for n, _ in present]
    for label, lat, lon in validation_sites():
        summary = effective_resolution_summary(lat, lon, names, 200.0)['layers']
        rows.append({'site': label, 'latlon': [lat, lon], **{n: summary[n] for n in names}})
    grid_ok = all(g['same_shape'] and g['same_transform'] and g['same_crs_params'] for g in grid)
    values_ok = all(r[n]['status'] == 'OK' and r[n]['valid_fraction'] >= 0.99 and (r[n]['median_m'] or 0) > 0 for r in rows for n in names)
    ok = grid_ok and values_ok
    medians = {n: [round(r[n]['median_m'], 1) for r in rows if r[n].get('median_m') is not None] for n in names}
    return entry('PASS' if ok else 'FAIL',
                 f'EFFRES for {", ".join(names)}: identical grid to DEM ({grid_ok}); >= 99 % valid, positive values in each principal LOD '
                 f'band at {len(rows)} sites ({values_ok}). Band medians (m): {medians}. Quality metadata only.',
                 {'grid': grid, 'rows': rows})


def v09_constraints() -> dict:
    from backend.decision_engine import _constraints, _longest_true_run
    seconds = [0, 1800, 3600, 5400, 7200, 9000]
    run, span = _longest_true_run([False, True, True, False, True, False], seconds)
    metrics = {'valid': True, 'mean_sun_visible_fraction': 0.4, 'dte_visible_fraction': 0.9,
               'max_continuous_darkness_s': 10 * 3600.0, 'max_continuous_dte_gap_s': 2 * 3600.0}
    v, u = _constraints(metrics, {'slope_max_deg': None}, {'max_darkness_hours': 8, 'min_sun_fraction': 0.5,
                                                         'min_dte_fraction': 0.5, 'max_dte_gap_hours': 8, 'max_slope_deg': 10})
    codes = sorted(x['code'] for x in v)
    ok = run == 3600 and span == (1, 3) and codes == ['MAX_DARKNESS', 'MIN_ILLUMINATION'] and [x['code'] for x in u] == ['SLOPE_UNKNOWN']
    return entry('PASS' if ok else 'FAIL', 'Constraint/violation logic on hand-computed inputs (longest run, min/max limits, unknown slope)',
                 {'longest_run_s': run, 'span': span, 'violations': codes, 'unknown': [x['code'] for x in u]})


def v10_traceability() -> dict:
    if not dem_present():
        return entry('BLOCKED', 'LOLA 240 m raster missing')
    from backend.main import _worker_calculate
    payload = {'dataset_id': 'lola_240m', 'latitude': SITES[1][0], 'longitude': SITES[1][1], 'landing_utc': '2026-12-01T12:00:00Z',
               'duration_hours': 24, 'buffer_hours': 0, 'step_minutes': 60, 'horizon_radius_km': 200, 'sun_observer_height_m': 4,
               'earth_observer_height_m': 4, 'uncertainty_mode': 'nominal', 'err_k': 1, 'dark_fraction_threshold': 0.01,
               'shifts_hours': [0], 'constraints': {'max_darkness_hours': 8}}
    result = _worker_calculate(payload)
    h, m = result.get('horizon') or {}, result.get('mission') or {}
    checks = {
        'horizon.sources': bool(h.get('sources')), 'horizon.cache_key': bool(h.get('cache_key')),
        'horizon.reference_radius_km': h.get('reference_radius_km') == 200, 'horizon.uncertainty_mode': h.get('uncertainty_mode') == 'nominal',
        'mission.disclaimers': len(m.get('disclaimers', [])) >= 4, 'mission.explanations': bool(m.get('explanations')),
        'timeline.utc_Z': all(p['utc'].endswith('Z') for s in m.get('scenarios', []) for p in s['timeline']),
        'nominal_never_GREEN': m.get('status') != 'GREEN',
    }
    ok = all(checks.values())
    return entry('PASS' if ok else 'FAIL', f"Real 24 h analysis at test site 2: status {m.get('status')}; provenance fields present", {'checks': checks, 'status': m.get('status')})


def clone01_ensemble() -> dict:
    """PGDA DEM clones: mapping to the tile, consistency with _toterr, and precomputed horizon sets.

    Pre-registered criteria: (1) all 100 clone files on exactly the `_surf` grid; (2) for every clone the
    median of |clone - surf| / toterr (decimated 400x400 read) lies in [0.55, 0.80] (Gaussian expectation
    0.674); (3) at least one precomputed profile set with 100 complete clone horizons. The comparison of
    the clone p05-p95 spread with the ERR k=2 band is reported, not used as a criterion.
    """
    import rasterio
    from rasterio.enums import Resampling
    from backend.clone_engine import (CLONE_PROFILES, CLONE_SITES, CloneError, check_clone_grid, clone_paths,
                                      clone_status, envelope)
    from backend.terrain_engine import compute_horizon
    statuses = {t: clone_status(t) for t in CLONE_SITES}
    complete = [t for t, st in statuses.items() if st['complete']]
    if not complete:
        return entry('BLOCKED', 'No complete clone set: ' + ', '.join(f"{t} {st['present']}/{st['expected']}" for t, st in statuses.items()))
    rows, ok = [], True
    shape = (400, 400)
    for tile in complete:
        d = DATASETS[f'{tile.lower()}_5m']
        with rasterio.open(d['path']) as sf, rasterio.open(d['err']) as ef:
            surf = sf.read(1, out_shape=shape, resampling=Resampling.nearest, masked=True).astype('float64').filled(np.nan)
            err = ef.read(1, out_shape=shape, resampling=Resampling.nearest, masked=True).astype('float64').filled(np.nan)
        ratios, grid_errors = [], []
        for path in clone_paths(tile):
            try:
                check_clone_grid(path, d['path'])
            except CloneError as exc:
                grid_errors.append(str(exc))
                continue
            with rasterio.open(path) as cf:
                clone = cf.read(1, out_shape=shape, resampling=Resampling.nearest, masked=True).astype('float64').filled(np.nan)
            r = np.abs(clone - surf) / err
            ratios.append(float(np.nanmedian(r[np.isfinite(r) & (err > 0)])))
        ratio_ok = bool(ratios) and all(0.55 <= x <= 0.80 for x in ratios)
        sets = []
        for meta_path in sorted(CLONE_PROFILES.glob('*.json')) if CLONE_PROFILES.is_dir() else []:
            meta = json.loads(meta_path.read_text(encoding='utf-8'))
            if meta.get('site_tile') != tile:
                continue
            with np.load(meta_path.with_suffix('.npz')) as z:
                arrays = {k: z[k].astype(float) for k in z.files if k.startswith('h')}
            n_complete = {k: int(np.isfinite(v).all(axis=1).sum()) for k, v in arrays.items()}
            info = {'key': meta['key'][:12], 'latlon': [meta['latitude'], meta['longitude']], 'complete_profiles': n_complete,
                    'seconds': meta.get('seconds')}
            try:
                h = compute_horizon(meta['latitude'], meta['longitude'], radius_km=meta['radius_km'],
                                    sun_height_m=meta['observer_height_m']['sun'], earth_height_m=meta['observer_height_m']['earth'],
                                    uncertainty_mode='err', k=2.0)
                env = envelope(arrays[f"h{float(meta['observer_height_m']['sun']):g}"])
                p05, p95 = np.asarray(env['p05'], dtype=float), np.asarray(env['p95'], dtype=float)
                cau, opt = np.asarray(h['profiles']['sun']['cautious'], dtype=float), np.asarray(h['profiles']['sun']['optimistic'], dtype=float)
                info['clone_p05_p95_within_err_k2_band_share'] = float(np.mean((p05 >= opt - 1e-9) & (p95 <= cau + 1e-9)))
                info['clone_spread_deg_max'] = float(np.nanmax(p95 - p05))
                info['err_k2_band_deg_max'] = float(np.nanmax(cau - opt))
            except Exception as exc:  # comparison is informational only
                info['err_comparison'] = f'{type(exc).__name__}: {str(exc)[:120]}'
            sets.append(info)
        sets_ok = any(all(v == 100 for v in x['complete_profiles'].values()) for x in sets)
        rows.append({'tile': tile, 'files': statuses[tile], 'grid_errors': grid_errors[:5], 'grid_ok': not grid_errors,
                     'ratio_median_of_medians': float(np.median(ratios)) if ratios else None,
                     'ratio_min': min(ratios) if ratios else None, 'ratio_max': max(ratios) if ratios else None,
                     'ratio_ok': ratio_ok, 'profile_sets': sets, 'profile_sets_ok': sets_ok})
        ok &= (not grid_errors) and ratio_ok and sets_ok
    incomplete = {t: st for t, st in statuses.items() if not st['complete']}
    summary = '; '.join(f"{r['tile']}: grid {'OK' if r['grid_ok'] else 'FAIL'}, |clone-surf|/toterr median {r['ratio_median_of_medians']:.3f} "
                        f"(range {r['ratio_min']:.3f}-{r['ratio_max']:.3f}; criterion 0.55-0.80), complete profile sets "
                        f"{sum(all(v == 100 for v in x['complete_profiles'].values()) for x in r['profile_sets'])}" for r in rows)
    return entry('PASS' if ok else 'FAIL',
                 summary + f". Not downloaded: {', '.join(incomplete) or 'none'}. Empirical ensemble consistency only; "
                 'not a statistical validation of the DEM.', rows)


CHECKS = [('V-01', v01_sources_and_coverage), ('V-02', v02_frames), ('V-03', v03_utc), ('V-05', v05_radius_sensitivity),
          ('V-06', v06_lod_nodata), ('V-07', v07_disk_quadrature), ('V-08', v08_err_clone), ('V-09', v09_constraints),
          ('V-10', v10_traceability), ('SLOPE-01', slope01_cross_check), ('EFFRES-01', effres01_effective_resolution),
          ('CLONE-01', clone01_ensemble)]


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(prog='python -m backend.validation')
    parser.add_argument('--skip-network', action='store_true', help='do not query JPL Horizons (A-04/V-04 -> NOT_RUN)')
    args = parser.parse_args(argv)
    tests = {}
    for tid, fn in CHECKS:
        try:
            tests[tid] = fn()
        except Exception as exc:  # record honestly; never convert an error into PASS
            tests[tid] = entry('FAIL', f'Check raised {type(exc).__name__}: {str(exc)[:200]}', traceback.format_exc(limit=3)[-800:])
        print(f"{tid}: {tests[tid]['status']} - {tests[tid]['summary']}")
    if args.skip_network:
        tests['A-04'] = entry('NOT_RUN', 'Skipped (--skip-network)')
    else:
        try:
            tests['A-04'] = a04_horizons()
        except Exception as exc:
            tests['A-04'] = entry('FAIL', f'Horizons query failed: {type(exc).__name__}: {str(exc)[:200]}')
    tests['V-04'] = {**tests['A-04'], 'summary': 'Same run as A-04: ' + tests['A-04']['summary']}
    print(f"A-04: {tests['A-04']['status']} - {tests['A-04']['summary']}")
    VALIDATION.mkdir(parents=True, exist_ok=True)
    report = {'generated_utc': now(), 'tool': 'python -m backend.validation', 'tests': tests}
    tmp = VALIDATION / f'report.json.{os.getpid()}.part'
    tmp.write_text(json.dumps(report, indent=2, ensure_ascii=False, default=float), encoding='utf-8')
    os.replace(tmp, VALIDATION / 'report.json')
    print(f"Report written: data/validation/report.json")
    return 0 if all(t['status'] != 'FAIL' for t in tests.values()) else 1


if __name__ == '__main__':
    sys.exit(main())
