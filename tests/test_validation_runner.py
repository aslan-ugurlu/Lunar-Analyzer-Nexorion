"""Offline parts of backend.validation (pure numerical / logic checks)."""
import pytest

from backend import validation


def test_entry_rejects_unknown_status():
    with pytest.raises(AssertionError):
        validation.entry('GREENISH', 'x')


def test_v07_disk_quadrature_against_analytic_segment():
    result = validation.v07_disk_quadrature()
    assert result['status'] == 'PASS'
    assert result['evidence']['max_abs_error'] < 0.01
    fractions = [r['analytic'] for r in result['evidence']['rows']]
    assert all(a <= b for a, b in zip(fractions, fractions[1:]))  # rises as the disc climbs
    assert fractions[0] < 0.01 and fractions[-1] > 0.99           # offsets span almost hidden..visible


def test_v09_constraint_logic():
    result = validation.v09_constraints()
    assert result['status'] == 'PASS'
    assert result['evidence']['violations'] == ['MAX_DARKNESS', 'MIN_ILLUMINATION']
    assert result['evidence']['unknown'] == ['SLOPE_UNKNOWN']


def test_missing_err_is_blocked_not_pass(monkeypatch, tmp_path):
    fake = dict(validation.DATASETS['lola_240m'])
    fake['err'] = tmp_path / 'absent_ERR.TIF'
    monkeypatch.setitem(validation.DATASETS, 'lola_240m', fake)
    assert validation.v08_err_clone()['status'] == 'BLOCKED'
