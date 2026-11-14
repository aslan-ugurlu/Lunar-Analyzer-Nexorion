"""V-03 UTC->ET regression tests and Horizons header-format regression.

The SPICE tests need the real NAIF kernels in data/spice; without them they are
SKIPPED (reported as skipped, never as passed). No network access here.
"""
from datetime import datetime, timezone

import pytest

from backend.config import KERNELS
from backend.verify_horizons import parse_horizons_csv

KERNELS_PRESENT = all(k.is_file() and k.stat().st_size > 0 for k in KERNELS)
needs_kernels = pytest.mark.skipif(not KERNELS_PRESENT, reason='NAIF kernels not present (NOT_RUN)')

# Header/row lines copied from a real Horizons API response captured 2026-11-14
# (APPARENT='AIRLESS'); only these two lines plus markers are kept.
REAL_AIRLESS_RESPONSE = (
    'Center pole/equ : MEAN_ME (high precision)        {East-longitude positive}\n'
    ' Date__(UT)__HR:MN:SC.fff, , ,Azimuth_(a-app), Elevation_(a-app),\n'
    '*****************************************************************\n'
    '$$SOE\n'
    ' 2026-Dec-01 12:00:00.000,*,i,  273.971637025,       1.499344942,\n'
    '$$EOE\n'
)


def test_parser_accepts_real_airless_header():
    parsed = parse_horizons_csv(REAL_AIRLESS_RESPONSE)
    assert parsed['az_deg'] == pytest.approx(273.971637025)
    assert parsed['el_deg'] == pytest.approx(1.499344942)


def test_parser_rejects_ambiguous_columns():
    raw = 'X, Azi_(a-app), Azimuth_(a-app), Elev_(a-app)\n$$SOE\n1, 2, 3, 4\n$$EOE\n'
    with pytest.raises(ValueError):
        parse_horizons_csv(raw)


@needs_kernels
def test_load_kernels_and_frame():
    from backend.astro_engine import load_kernels, _spice
    load_kernels(force_reload=True)
    spice = _spice()
    assert spice.namfrm('MOON_ME_DE440_ME421') != 0


@needs_kernels
@pytest.mark.parametrize('text', ['2026-11-14T12:00:00Z', '2030-02-28T23:59:59.5+00:00',
                                  '2035-12-31T00:00:00Z'])
def test_utc_to_et_matches_independent_tt_offset(text):
    """ET ~= (UTC calendar seconds since 2000-01-01T12:00) + TT-UTC (69.184 s since 2017).

    TDB-TT periodic term is < 2 ms, so 0.01 s tolerance is an independent check
    of the leap-second kernel handling (assumes no new leap second through 2035).
    """
    from backend.astro_engine import load_kernels, normalize_utc_to_et
    load_kernels()
    canonical, et = normalize_utc_to_et(text)
    utc = datetime.fromisoformat(text.replace('Z', '+00:00')).astimezone(timezone.utc)
    expected = (utc - datetime(2000, 1, 1, 12, tzinfo=timezone.utc)).total_seconds() + 69.184
    assert et == pytest.approx(expected, abs=0.01)
    assert canonical.endswith('Z')


@needs_kernels
def test_utc_rejects_naive_and_out_of_window():
    from backend.astro_engine import load_kernels, normalize_utc_to_et
    load_kernels()
    with pytest.raises(ValueError):
        normalize_utc_to_et('2026-11-14T12:00:00')
    with pytest.raises(ValueError):
        normalize_utc_to_et('2040-01-01T00:00:00Z')
