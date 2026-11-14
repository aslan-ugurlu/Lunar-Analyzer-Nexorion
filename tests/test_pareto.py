"""Pareto comparison logic with hand-written metric dicts (logic test, not NASA results).

Regression: pareto_compare raised KeyError('costs') whenever >= 2 GREEN/YELLOW
candidates were compared (found with real ERR-mode analyses on 2026-11-14).
"""
from backend.decision_engine import pareto_compare


def candidate(ident, status, sun, dark_h, dte, gap_h):
    metrics = {'valid': True, 'mean_sun_visible_fraction': sun, 'max_continuous_darkness_s': dark_h * 3600,
               'dte_visible_fraction': dte, 'max_continuous_dte_gap_s': gap_h * 3600}
    return {'id': ident, 'result': {'status': status, 'scenarios': [
        {'shift_hours': 0, 'variants': {'nominal': {'metrics': metrics}}}]}}


def test_two_green_candidates_no_keyerror_and_dominance():
    a = candidate('a', 'GREEN', 0.9, 1, 0.9, 1)   # better in every metric
    b = candidate('b', 'GREEN', 0.8, 2, 0.8, 2)
    out = pareto_compare([b, a], 'balanced')
    ids = [x['id'] for x in out['green']]
    assert ids == ['a', 'b']
    by = {x['id']: x for x in out['green']}
    assert by['a']['dominated_by'] == []
    assert by['b']['dominated_by'] == ['a']
    assert all('costs' not in x for x in out['green'])


def test_dominance_only_within_same_status_and_red_excluded():
    a = candidate('a', 'GREEN', 0.9, 1, 0.9, 1)
    y = candidate('y', 'YELLOW', 0.5, 5, 0.5, 5)
    r = candidate('r', 'RED', 1.0, 0, 1.0, 0)
    out = pareto_compare([a, y, r], 'sun')
    assert [x['id'] for x in out['yellow']] == ['y']
    assert out['yellow'][0]['dominated_by'] == []  # GREEN does not dominate YELLOW across classes
    assert out['excluded'] == [{'id': 'r', 'status': 'RED'}]


def test_trade_off_candidates_are_mutually_non_dominated():
    sunny = candidate('sunny', 'GREEN', 0.95, 1, 0.6, 6)
    talky = candidate('talky', 'GREEN', 0.7, 3, 0.95, 1)
    out = pareto_compare([sunny, talky], 'comms')
    assert [x['id'] for x in out['green']] == ['talky', 'sunny']
    assert all(x['dominated_by'] == [] for x in out['green'])
