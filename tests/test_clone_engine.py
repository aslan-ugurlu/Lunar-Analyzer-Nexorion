"""DEM clone ensemble mechanics (offline). SYNTHETIC: tiny GeoTIFFs in tmp_path and labelled synthetic
horizon/sky doubles exercise code paths only; no NASA clone result is produced or implied here."""
import numpy as np
import pytest
import rasterio
from rasterio.transform import from_origin

import backend.clone_engine as ce
import backend.decision_engine as de

STEREO = '+proj=stere +lat_0=-90 +lon_0=0 +k=1 +x_0=0 +y_0=0 +a=1737400 +b=1737400 +units=m +no_defs'


def _tif(path, origin=(-1000.0, 1000.0), n=40):
    with rasterio.open(path, 'w', driver='GTiff', width=n, height=n, count=1, dtype='float32', crs=STEREO,
                       transform=from_origin(origin[0], origin[1], 5, 5), nodata=np.nan) as ds:
        ds.write(np.full((n, n), 1000.0, dtype='float32'), 1)
    return path


def test_clone_grid_must_match_surface(tmp_path):
    surf = _tif(tmp_path / 'surf.tif')
    ce.check_clone_grid(_tif(tmp_path / 'ok.tif'), surf)
    with pytest.raises(ce.CloneError):
        ce.check_clone_grid(_tif(tmp_path / 'shifted.tif', origin=(-995.0, 1000.0)), surf)


def test_incomplete_clone_set_is_refused(tmp_path, monkeypatch):
    monkeypatch.setattr(ce, 'CLONES', tmp_path)
    (tmp_path / 'Site01').mkdir()
    for i in (1, 2, 3):
        (tmp_path / 'Site01' / f'Site01_final_adj_5mpp_{i:04d}_err.tif').write_bytes(b'x')
    st = ce.clone_status('Site01')
    assert st == {'site_tile': 'Site01', 'present': 3, 'expected': 100, 'complete': False}
    monkeypatch.setattr(ce, 'site_tile_for', lambda lat, lon: 'Site01')
    with pytest.raises(ce.CloneError, match='3/100'):
        ce.precompute(-89.46, -137.49)
    assert '3/100' in ce.describe_gap(-89.46, -137.49)


def _sky(monkeypatch):
    def sky(lat, lon, dem, utc_values, sun_h, earth_h):
        return [{'utc': u, 'sun': {'az_deg': 10.0, 'el_deg': 1.0, 'angular_radius_deg': 0.27},
                 'earth': {'az_deg': 20.0, 'el_deg': 5.0, 'angular_radius_deg': 0.95}} for u in utc_values]
    monkeypatch.setattr(de, 'compute_sky_positions', sky)
    monkeypatch.setattr(de, 'local_slope', lambda *a, **k: {'slope_max_deg': None, 'status': 'SYNTHETIC'})


def _run_clone(blocked):
    flat = [0.0] * 3600
    profile = {'nominal': flat, 'coverage': [1.0] * 3600, 'cautious': flat, 'optimistic': flat}
    horizon = {'status': 'complete', 'uncertainty_mode': 'clone', 'reference_radius_km': 200.0,
               'sources': {'synthetic': 'test'}, 'profiles': {'sun': profile, 'earth': profile},
               'geometry': {'observer_dem_m': 0.0}}
    sun = np.zeros((100, 3600))
    sun[:blocked, :] = 3.0  # synthetic: these clones hide the Sun (el 1 deg) all the time
    ensemble = {'sun': sun, 'earth': np.zeros((100, 3600))}
    return de.analyze_mission(horizon, -89.5, 0.0, '2026-12-01T00:00:00Z', 6, 0, 60,
                              {'max_darkness_hours': 1}, [], 4.0, 4.0, clone_ensemble=ensemble)


def test_clone_p95_rule_yellow_when_more_than_5_percent_fail(monkeypatch):
    _sky(monkeypatch)
    m = _run_clone(blocked=10)
    assert m['status'] == 'YELLOW'
    clone = m['scenarios'][0]['variants']['cautious']['clone']
    assert clone['n'] == 100 and clone['pass_count'] == 90
    assert m['cautious_violations'][0]['code'] == 'MAX_DARKNESS'
    assert m['cautious_violations'][0]['clone_fail_count'] == 10
    assert 'clone' in m['label']
    metrics = m['scenarios'][0]['variants']['cautious']['metrics']
    assert metrics['method'] == 'clone_p95' and isinstance(metrics['max_disk_integration_difference'], float)


def test_clone_p95_rule_green_when_at_most_5_percent_fail(monkeypatch):
    _sky(monkeypatch)
    m = _run_clone(blocked=3)
    assert m['status'] == 'GREEN'
    assert m['scenarios'][0]['variants']['cautious']['clone']['pass_fraction'] == pytest.approx(0.97)


def test_clone_mode_without_ensemble_is_an_error(monkeypatch):
    _sky(monkeypatch)
    flat = [0.0] * 3600
    profile = {'nominal': flat, 'coverage': [1.0] * 3600}
    horizon = {'status': 'complete', 'uncertainty_mode': 'clone', 'reference_radius_km': 200.0,
               'sources': {}, 'profiles': {'sun': profile, 'earth': profile}, 'geometry': {'observer_dem_m': 0.0}}
    with pytest.raises(de.MissionDataError):
        de.analyze_mission(horizon, -89.5, 0.0, '2026-12-01T00:00:00Z', 6, 0, 60, {'max_darkness_hours': 1}, [], 4.0, 4.0)
