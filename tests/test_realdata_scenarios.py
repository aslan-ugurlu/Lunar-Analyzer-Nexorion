"""Reproducible REAL-DATA scenarios (Faz 7, pinned in Faz 8).

These run the production worker (`_worker_calculate`, same Pydantic payload as POST /analyses) on the
real NASA PGDA LOLA rasters, NAIF SPICE kernels and PGDA DEM clones listed in
docs/validation/data_versions_2026-11-14.json. They are SKIPPED when those files are absent, so a CI
machine without NASA data reports "skipped", never a fake pass.

The expected values were OBSERVED on 2026-11-14 (see PROGRESS.md / docs/VALIDATION.md). If a data
product or the code changes, a failure means "the result changed": investigate and document it; do
not edit an expectation just to make the test pass. Screening results, not landing certification and
not a NASA approval.
"""
import pytest

from backend.config import DATASETS, KERNELS
from backend.main import AnalysisInput, _worker_calculate

SITE01_CENTRE = (-89.46316, -137.48955)   # raster coverage centre of PGDA Site01 (not a landing point)
FORM_DEFAULTS = {'max_darkness_hours': 8, 'min_sun_fraction': 0.5, 'min_dte_fraction': 0.5, 'max_dte_gap_hours': 8}

_needed = [p for p in KERNELS] + [DATASETS[n]['path'] for n in ('lola_240m', 'lola_80m', 'site01_5m', 'site04_5m')] + \
          [DATASETS[n]['err'] for n in ('lola_240m', 'lola_80m', 'site01_5m', 'site04_5m')]
real_data = pytest.mark.skipif(not all(p.is_file() for p in _needed), reason='NASA SPICE/LOLA files not present locally')


def _clone_ready() -> bool:
    try:
        from backend.clone_engine import load_clone_ensemble
        return load_clone_ensemble(*SITE01_CENTRE, 4.0, 4.0, 200.0) is not None
    except Exception:
        return False


def _run(landing_utc: str, mode: str = 'err', **extra) -> dict:
    body = AnalysisInput(latitude=SITE01_CENTRE[0], longitude=SITE01_CENTRE[1], dataset_id='site01_5m',
                         landing_utc=landing_utc, duration_hours=48, buffer_hours=12, step_minutes=30,
                         horizon_radius_km=extra.pop('radius', 200), sun_observer_height_m=4, earth_observer_height_m=4,
                         uncertainty_mode=mode, err_k=1, dark_fraction_threshold=0.01, shifts_hours=[0, 24, 48, 72],
                         constraints={**FORM_DEFAULTS, **extra})
    payload = body.model_dump(mode='json')
    payload['landing_utc'] = landing_utc
    return _worker_calculate(payload)


def _shift(mission: dict, hours: int) -> dict:
    return next(s for s in mission['scenarios'] if s['shift_hours'] == hours)


@real_data
def test_real_yellow_err_site01_2027_11_14():
    """Nominal passes; ERR +1 sigma horizon lengthens the +72 h Earth (DTE) gap past 8 h."""
    r = _run('2027-11-14T00:00:00Z')
    m = r['mission']
    assert r['status'] == 'YELLOW'
    assert m['nominal_violations'] == []
    assert {v['code'] for v in m['cautious_violations']} == {'MAX_DTE_GAP'}
    s72 = _shift(m, 72)
    assert s72['variants']['nominal']['metrics']['max_continuous_dte_gap_s'] == pytest.approx(7.0 * 3600)
    assert s72['variants']['cautious']['metrics']['max_continuous_dte_gap_s'] == pytest.approx(11.5 * 3600)
    assert r['horizon']['layer_resolution_m'] == {'lola_240m': 240, 'lola_80m': 80, 'site01_5m': 5, 'site04_5m': 5}


@real_data
def test_real_same_request_nominal_mode_is_gray_and_fast_scan_cannot_be_green():
    assert _run('2027-11-14T00:00:00Z', mode='nominal')['status'] == 'GRAY'
    green = _run('2026-12-17T00:00:00Z')
    fast = _run('2026-12-17T00:00:00Z', radius=135)
    assert green['status'] == 'GREEN'
    assert fast['status'] == 'YELLOW' and fast['mission']['radius_policy']['capped'] is True


@real_data
def test_real_red_dte_loss_and_slope_site01_2026_12_26():
    r = _run('2026-12-26T12:00:00Z', max_slope_deg=10)
    m = r['mission']
    assert r['status'] == 'RED'
    assert {v['code'] for v in m['nominal_violations']} == {'MIN_DTE', 'MAX_DTE_GAP'}
    assert m['slope']['source'] == 'site01_5m'
    assert m['slope']['slope_max_deg'] == pytest.approx(9.3418, abs=1e-3)


@real_data
@pytest.mark.skipif(not _clone_ready(), reason='Site01 clones or the precomputed clone profiles are not present')
def test_real_clone_mode_site01():
    """PGDA 100-clone ensemble: same classes as ERR on these dates; 73/100 clones pass at +72 h on 2027-11-14."""
    yellow = _run('2027-11-14T00:00:00Z', mode='clone')
    assert yellow['status'] == 'YELLOW'
    c72 = _shift(yellow['mission'], 72)['variants']['cautious']
    assert c72['clone']['n'] == 100 and c72['clone']['pass_count'] == 73
    assert c72['clone']['fail_count_by_code'] == {'MAX_DTE_GAP': 27}
    assert c72['metrics']['method'] == 'clone_p95'
    assert c72['metrics']['max_continuous_dte_gap_s'] == pytest.approx(10.5 * 3600)
    assert yellow['horizon']['uncertainty_mode'] == 'clone' and yellow['horizon']['clone_ensemble']['n_clones'] == 100
    assert _run('2026-12-17T00:00:00Z', mode='clone')['status'] == 'GREEN'
    assert _run('2026-12-26T12:00:00Z', mode='clone')['status'] == 'RED'
