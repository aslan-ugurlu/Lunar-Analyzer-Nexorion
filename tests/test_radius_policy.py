"""200-km reference radius rule (offline, synthetic; no scientific values are produced).

A horizon scanned to less than the 200-km reference radius is the maximum over a SUBSET of the
reference terrain samples, so it can only be lower or equal: visibility is optimistic. Such a
screen may therefore never end GREEN (capped at YELLOW), while RED remains valid.
The sky positions and slope below are labelled synthetic test doubles, not SPICE/LOLA output.
"""
import pytest

import backend.decision_engine as de
from backend.config import REFERENCE_HORIZON_RADIUS_KM


@pytest.mark.parametrize('radius,before,after,capped', [
    (135.0, 'GREEN', 'YELLOW', True),
    (199.99, 'GREEN', 'YELLOW', True),
    (135.0, 'RED', 'RED', False),
    (135.0, 'YELLOW', 'YELLOW', False),
    (135.0, 'GRAY', 'GRAY', False),
    (200.0, 'GREEN', 'GREEN', False),
])
def test_radius_policy_caps_only_green_below_reference(radius, before, after, capped):
    policy = de._radius_policy(radius, before)
    assert REFERENCE_HORIZON_RADIUS_KM == 200.0
    assert policy['status_after_policy'] == after
    assert policy['capped'] is capped
    assert policy['below_reference'] is (radius < 200.0)
    assert policy['code'] == ('REDUCED_HORIZON_RADIUS' if radius < 200.0 else 'REFERENCE_RADIUS')


def _synthetic(monkeypatch, sun_el):
    """Flat 0-degree horizon; Sun/Earth at constant elevation (synthetic double)."""
    def sky(lat, lon, dem, utc_values, sun_h, earth_h):
        return [{'utc': u, 'sun': {'az_deg': 10.0, 'el_deg': sun_el, 'angular_radius_deg': 0.27},
                 'earth': {'az_deg': 20.0, 'el_deg': 5.0, 'angular_radius_deg': 0.95}} for u in utc_values]
    monkeypatch.setattr(de, 'compute_sky_positions', sky)
    monkeypatch.setattr(de, 'local_slope', lambda *a, **k: {'slope_max_deg': None, 'status': 'SYNTHETIC'})


def _horizon(radius_km):
    flat = [0.0] * 3600
    profile = {'nominal': flat, 'cautious': flat, 'optimistic': flat, 'coverage': [1.0] * 3600}
    return {'status': 'complete', 'uncertainty_mode': 'err', 'reference_radius_km': radius_km,
            'sources': {'synthetic': 'test'}, 'profiles': {'sun': profile, 'earth': profile},
            'geometry': {'observer_dem_m': 0.0}}


def _run(radius_km, constraints):
    return de.analyze_mission(_horizon(radius_km), -89.5, 0.0, '2026-12-01T00:00:00Z', 6, 0, 60,
                              constraints, [], 1.0, 1.0)


def test_fast_scan_that_would_pass_is_yellow_not_green(monkeypatch):
    _synthetic(monkeypatch, sun_el=5.0)
    reference = _run(200.0, {'max_darkness_hours': 1})
    fast = _run(135.0, {'max_darkness_hours': 1})
    assert reference['status'] == 'GREEN'
    assert reference['radius_policy']['code'] == 'REFERENCE_RADIUS'
    assert fast['status'] == 'YELLOW'
    assert fast['radius_policy']['capped'] and fast['radius_policy']['status_before_policy'] == 'GREEN'
    assert '135 km' in fast['label'] and '200 km' in fast['label']
    assert 'REDUCED_HORIZON_RADIUS' in fast['explanations']['engineer']
    # The cap is explained, never hidden: no constraint violation is invented for it.
    assert fast['nominal_violations'] == [] and fast['cautious_violations'] == []


def test_fast_scan_red_stays_red(monkeypatch):
    _synthetic(monkeypatch, sun_el=-5.0)  # Sun below the flat horizon all window -> darkness violation
    fast = _run(135.0, {'max_darkness_hours': 1})
    assert fast['status'] == 'RED'
    assert fast['radius_policy']['below_reference'] and not fast['radius_policy']['capped']
