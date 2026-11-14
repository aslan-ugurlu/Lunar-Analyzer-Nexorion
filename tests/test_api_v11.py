"""API v1.1 additive-contract tests (offline; no scientific values produced)."""
import json
import os

import pytest
from fastapi.testclient import TestClient

import backend.main as main
from backend.main import app
from backend.terrain_engine import prune_cache


def test_422_has_field_details_without_echoing_input():
    secret = 'C:/Users/someone/secret.tif'
    with TestClient(app) as client:
        response = client.post('/analyses', json={'latitude': 0, 'dataset_id': secret,
                                                  'landing_utc': '2026-12-01T12:00:00Z',
                                                  'constraints': {'max_darkness_hours': 8}})
    assert response.status_code == 422
    error = response.json()['error']
    assert error['code'] == 'INVALID_INPUT'
    fields = {d['field'] for d in error['details']}
    assert 'latitude' in fields
    assert secret not in response.text
    assert 'Traceback' not in response.text


def test_cors_allows_only_configured_dev_origin():
    with TestClient(app) as client:
        ok = client.options('/health', headers={'Origin': 'http://localhost:5173',
                                                'Access-Control-Request-Method': 'GET'})
        bad = client.options('/health', headers={'Origin': 'https://evil.example',
                                                 'Access-Control-Request-Method': 'GET'})
    assert ok.headers.get('access-control-allow-origin') == 'http://localhost:5173'
    assert 'access-control-allow-origin' not in bad.headers


def test_wildcard_cors_refused(monkeypatch):
    monkeypatch.setenv('LUNAR_CORS_ORIGINS', '*')
    with pytest.raises(RuntimeError):
        main._cors_origins()


def test_health_reports_layers_and_clone_state():
    with TestClient(app) as client:
        body = client.get('/health').json()
    assert set(body['layers']['lola_240m']) == {'dem', 'err', 'effres'}
    # v1.3: legacy string reflects whether any real precomputed clone profile set exists on this machine.
    sets = body['clones']['precomputed_profile_sets']
    assert body['clone_profiles'] == ('AVAILABLE' if sets else 'NOT_PRECOMPUTED')
    assert set(body['clones']['sites']) == {'Site01', 'Site04', 'Site07', 'Site11'}
    assert all(v['expected'] == 100 and 0 <= v['present'] <= 100 for v in body['clones']['sites'].values())
    assert body['limits']['max_workers'] == 2 and body['limits']['max_pending'] == 6
    assert body['status'] in ('ready', 'degraded')


def test_sites_give_file_guidance_not_absolute_paths():
    with TestClient(app) as client:
        body = client.get('/sites').json()
    site = next(s for s in body['sites'] if s['id'] == 'lola_240m')
    assert site['expected_file'] == 'LDEM_60S_240MPP_ADJ.TIF'
    assert site['expected_folder'] == 'data/lola'
    assert site['source_page'] == 'https://pgda.gsfc.nasa.gov/products/90'
    assert ':' not in site['expected_folder'] and not site['expected_folder'].startswith('/')


def test_validation_defaults_to_not_run(tmp_path, monkeypatch):
    monkeypatch.setattr(main, 'VALIDATION', tmp_path)
    with TestClient(app) as client:
        body = client.get('/validation').json()
    assert set(body['tests']) >= {'A-04', 'V-01', 'V-10'}
    assert all(t['status'] == 'NOT_RUN' for t in body['tests'].values())


def test_validation_ignores_unknown_status(tmp_path, monkeypatch):
    (tmp_path / 'report.json').write_text(json.dumps({'generated_utc': 'x', 'tests': {
        'A-04': {'status': 'PASS', 'summary': 'real'}, 'V-05': {'status': 'GREENISH'}}}), encoding='utf-8')
    monkeypatch.setattr(main, 'VALIDATION', tmp_path)
    with TestClient(app) as client:
        tests = client.get('/validation').json()['tests']
    assert tests['A-04']['status'] == 'PASS'
    assert tests['V-05']['status'] == 'NOT_RUN'


def test_unknown_analysis_and_not_ready_codes():
    with TestClient(app) as client:
        assert client.get('/analyses/nope').status_code == 404
        assert client.get('/analyses/nope/horizon').json()['error']['code'] == 'ANALYSIS_NOT_FOUND'
        app.state.jobs['q'] = {'id': 'q', 'status': 'queued', 'created_mono': 0, 'result': None,
                               'error': None, 'parent_id': None, 'payload': None}
        assert client.get('/analyses/q/horizon').status_code == 409
        assert client.get('/analyses/q/timeline').json()['error']['code'] == 'TIMELINE_NOT_READY'


def test_cache_quota_prunes_oldest(tmp_path):
    for i in range(5):
        path = tmp_path / f'{i}.json'
        path.write_bytes(b'x' * 400_000)
        os.utime(path, (1000 + i, 1000 + i))
    removed = prune_cache(tmp_path, max_mb=1.0, keep=tmp_path / '0.json')
    left = sorted(p.name for p in tmp_path.glob('*.json'))
    assert removed == 3
    assert '0.json' in left and '4.json' in left


def test_sites_v12_region_names_and_footprints():
    """v1.2: PGDA region names and footprints from the raster's own georeferencing (null if absent)."""
    from backend.config import DATASETS
    with TestClient(app) as client:
        sites = {s['id']: s for s in client.get('/sites').json()['sites']}
    assert sites['site01_5m']['region_name'] == 'Connecting ridge'
    assert sites['site04_5m']['region_name'] == 'Shackleton rim'
    assert sites['site01_5m']['source_page'] == 'https://pgda.gsfc.nasa.gov/products/78'
    assert sites['lola_80m']['source_page'] == 'https://pgda.gsfc.nasa.gov/products/90'
    for name, site in sites.items():
        if DATASETS[name]['path'].is_file():
            fp = site['footprint']
            assert set(fp) >= {'center', 'lat_range', 'width_km', 'height_km', 'contains_pole', 'pixel_size_m'}
            assert fp['lat_range'][0] <= fp['center']['lat'] <= fp['lat_range'][1]
        else:
            assert site['footprint'] is None
