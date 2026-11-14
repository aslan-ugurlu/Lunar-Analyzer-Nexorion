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

# Test locations: (1) example coordinate from the project docs, (2) highest DEM pixel
# within 40 km of the pole found in LDEM_60S_240MPP_ADJ.TIF. Neither is an official candidate.
SITES = [(-89.54, 0.0), (-89.4512, -137.1427)]


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
    result = run_a04_suite()
    worst = max(r['difference_deg'] for r in result['rows'])
    return entry('PASS' if result['all_passed'] else 'FAIL',
                 f"{len(result['rows'])} Sun/Earth directions at 3 sites/dates; max separation {worst:.2e} deg (threshold 0.005); synthetic heights",
                 {'max_difference_deg': worst, 'rows': [{k: r[k] for k in ('case', 'body', 'utc', 'difference_deg', 'passed')} for r in result['rows']],
                  'horizons_site_metadata': result['rows'][0]['horizons_site_metadata']})


def v05_radius_sensitivity() -> dict:
    if not dem_present():
        return entry('BLOCKED', 'LOLA 240 m raster missing')
    from backend.terrain_engine import compute_horizon
    rows = []
    for lat, lon in SITES:
        prof = {}
        timings = {}
        for radius in (135.0, 200.0, 250.0):  # 250 km: offline validation only (API limit is 200)
            t0 = time.perf_counter()
            h = compute_horizon(lat, lon, radius_km=radius, sun_height_m=4.0, earth_height_m=4.0)
            timings[radius] = round(time.perf_counter() - t0, 2)
            prof[radius] = np.asarray(h['profiles']['sun']['nominal'], dtype=float)
        d1 = np.abs(prof[200.0] - prof[135.0])
        d2 = np.abs(prof[250.0] - prof[200.0])
        rows.append({'site': [lat, lon], 'seconds': timings,
                     'max_abs_diff_deg_135_vs_200': float(np.nanmax(d1)), 'share_az_diff_gt_0.01deg_135_vs_200': float(np.mean(d1 > 0.01)),
                     'max_abs_diff_deg_200_vs_250': float(np.nanmax(d2)), 'share_az_diff_gt_0.01deg_200_vs_250': float(np.mean(d2 > 0.01))})
    worst = max(r['max_abs_diff_deg_200_vs_250'] for r in rows)
    ok = worst < 0.05
    return entry('PASS' if ok else 'FAIL',
                 f'Criterion: 200->250 km max horizon change < 0.05 deg at both test sites; observed {worst:.4f} deg. 2 sites only; not exhaustive.',
                 rows)


def v06_lod_nodata() -> dict:
    if not dem_present():
        return entry('BLOCKED', 'LOLA 240 m raster missing')
    import rasterio
    from rasterio.windows import from_bounds
    with rasterio.open(DATASETS['lola_240m']['path']) as ds:
        win = from_bounds(-260000, -260000, 260000, 260000, transform=ds.transform)
        data = ds.read(1, window=win, masked=True)
        nan_count = int(np.count_nonzero(~np.isfinite(data.filled(np.nan))))
    from backend.terrain_engine import RasterSampler
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
    other_layers = [k for k, v in DATASETS.items() if k != 'lola_240m' and v['path'].is_file()]
    evidence = {'nan_pixels_within_260km_box': nan_count, 'nodata_pixel_sample_returns': 'NaN' if math.isnan(sampled) else sampled,
                'higher_resolution_layers_present': other_layers}
    if not math.isnan(sampled):
        return entry('FAIL', 'NoData pixel did not propagate as NaN', evidence)
    if not other_layers:
        return entry('BLOCKED', 'NoData handling PASS (NaN propagates, no zero fill); LOD switching not testable: only lola_240m present', evidence)
    return entry('PASS', 'NoData propagates as NaN; multiple LOD layers present', evidence)


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
    ok = worst < 0.01
    return entry('PASS' if ok else 'FAIL',
                 f'Disc fraction vs analytic circular segment (flat horizon, r=0.27 deg, 27 offsets): max |error| {worst:.4f} (criterion < 0.01). Curved terrain not covered.',
                 {'max_abs_error': worst, 'rows': rows})


def v08_err_clone() -> dict:
    err_path = DATASETS['lola_240m']['err']
    if not (dem_present() and err_path and err_path.is_file()):
        return entry('BLOCKED', 'LDEM_60S_240MPP_ADJ_ERR.TIF not present; ERR sensitivity not run. DEM clones: not available (CLONE_NOT_PRECOMPUTED).')
    from backend.terrain_engine import compute_horizon
    rows = []
    for lat, lon in SITES:
        h = compute_horizon(lat, lon, radius_km=200.0, sun_height_m=4.0, earth_height_m=4.0, uncertainty_mode='err', k=1.0)
        nom = np.asarray(h['profiles']['sun']['nominal'], dtype=float)
        cau = np.asarray(h['profiles']['sun'].get('cautious', []), dtype=float)
        opt = np.asarray(h['profiles']['sun'].get('optimistic', []), dtype=float)
        rows.append({'site': [lat, lon], 'status': h['status'], 'observer_err_m': h['geometry']['observer_err_m'],
                     'ordered_cautious_ge_nominal_ge_optimistic': bool(np.all(cau >= nom - 1e-9) and np.all(nom >= opt - 1e-9)) if cau.size else None,
                     'max_band_width_deg': float(np.nanmax(cau - opt)) if cau.size else None})
    ok = all(r['ordered_cautious_ge_nominal_ge_optimistic'] for r in rows)
    return entry('PASS' if ok else 'FAIL',
                 'ERR +/-1 sigma sensitivity ran; checks band ordering only (not statistical validation). DEM clones NOT_RUN.', rows)


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


CHECKS = [('V-01', v01_sources_and_coverage), ('V-02', v02_frames), ('V-03', v03_utc), ('V-05', v05_radius_sensitivity),
          ('V-06', v06_lod_nodata), ('V-07', v07_disk_quadrature), ('V-08', v08_err_clone), ('V-09', v09_constraints),
          ('V-10', v10_traceability)]


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
