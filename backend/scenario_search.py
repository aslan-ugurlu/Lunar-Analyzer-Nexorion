"""Pre-registered search for decision classes on REAL data (Faz 7: "does YELLOW occur?").

    python -m backend.scenario_search [--days-step 3] [--out logs/scenario_search.json]

Design fixed BEFORE running (README / PROGRESS record it): sites = validation_sites() (two fixed test
points + every present 5 m tile centre); landings every N days 2026-12-01 .. 2027-11-28 at 00:00 UTC;
48 h + 12 h, 30-min step, shifts +0/24/48/72 h, panel = antenna = 4 m, ERR k = 1, 200 km.
Two constraint profiles: 'form_default' (darkness <= 8 h, Sun >= 50 %, DTE >= 50 %, DTE gap <= 8 h) and
'sun_only' (darkness <= 8 h, Sun >= 50 %). Every decision comes from analyze_mission's own metrics and
the same rule (nominal violation RED; unknown GRAY; cautious violation YELLOW; else GREEN).
Nothing is tuned to produce a class; whatever occurs is reported, including zero counts.
"""
from __future__ import annotations

import argparse
import json
import time
from collections import Counter
from datetime import datetime, timedelta, timezone

from backend.decision_engine import _constraints, analyze_mission
from backend.terrain_engine import compute_horizon
from backend.validation import validation_sites

PROFILES = {
    'form_default': {'max_darkness_hours': 8, 'min_sun_fraction': 0.5, 'min_dte_fraction': 0.5, 'max_dte_gap_hours': 8},
    'sun_only': {'max_darkness_hours': 8, 'min_sun_fraction': 0.5},
}
MISSION = {'duration_hours': 48, 'buffer_hours': 12, 'step_minutes': 30, 'shifts_hours': [0, 24, 48, 72],
           'sun_h': 4.0, 'earth_h': 4.0, 'k': 1.0, 'radius_km': 200.0, 'dark_threshold': 0.01}


def classify(mission: dict, limits: dict) -> tuple[str, list, list]:
    """Re-evaluate the SAME per-variant metrics against `limits` with the decision engine's rule."""
    nominal_v, cautious_v, unknown = [], [], []
    slope = mission.get('slope') or {}
    for s in mission['scenarios']:
        for variant, sink in (('nominal', nominal_v), ('cautious', cautious_v)):
            v = s['variants'].get(variant)
            if v is None:
                continue
            viol, unk = _constraints(v['metrics'], slope, limits)
            sink += [dict(x, shift=s['shift_hours'], variant=variant) for x in viol]
            unknown += unk
    if nominal_v:
        return 'RED', nominal_v, cautious_v
    if unknown:
        return 'GRAY', nominal_v, cautious_v
    if cautious_v:
        return 'YELLOW', nominal_v, cautious_v
    return 'GREEN', nominal_v, cautious_v


def run(days_step: int = 3, log=print) -> dict:
    t0 = time.perf_counter()
    start = datetime(2026, 12, 1, tzinfo=timezone.utc)
    landings = []
    day = start
    while day <= datetime(2027, 11, 28, tzinfo=timezone.utc):
        landings.append(day.strftime('%Y-%m-%dT%H:%M:%SZ'))
        day += timedelta(days=days_step)
    sites = validation_sites()
    counts = {p: {label: Counter() for label, *_ in sites} for p in PROFILES}
    yellow = []
    for label, lat, lon in sites:
        h = compute_horizon(lat, lon, radius_km=MISSION['radius_km'], sun_height_m=MISSION['sun_h'],
                            earth_height_m=MISSION['earth_h'], uncertainty_mode='err', k=MISSION['k'])
        log(f'{label}: horizon {h["status"]}, layers {h["layer_resolution_m"]}, excluded {list(h.get("excluded_layers", {}))}')
        for utc in landings:
            m = analyze_mission(h, lat, lon, utc, MISSION['duration_hours'], MISSION['buffer_hours'], MISSION['step_minutes'],
                                PROFILES['form_default'], MISSION['shifts_hours'], MISSION['sun_h'], MISSION['earth_h'],
                                dark_threshold=MISSION['dark_threshold'])
            for pname, limits in PROFILES.items():
                status, nominal_v, cautious_v = classify(m, limits)
                if pname == 'form_default':
                    assert status == m['status'], (status, m['status'])  # rule replication check
                counts[pname][label][status] += 1
                if status == 'YELLOW':
                    yellow.append({'profile': pname, 'site': label, 'latlon': [lat, lon], 'landing_utc': utc,
                                   'cautious_violations': cautious_v,
                                   'nominal_metrics_by_shift': {s['shift_hours']: {k: s['variants']['nominal']['metrics'].get(k) for k in (
                                       'mean_sun_visible_fraction', 'max_continuous_darkness_s', 'dte_visible_fraction',
                                       'max_continuous_dte_gap_s')} for s in m['scenarios']}})
        log(f'  {label}: ' + ' | '.join(f'{p}: {dict(counts[p][label])}' for p in PROFILES))
    return {'design': {'landings': [landings[0], landings[-1], len(landings)], 'days_step': days_step, 'mission': MISSION,
                       'profiles': PROFILES, 'sites': sites},
            'counts': {p: {s: dict(c) for s, c in v.items()} for p, v in counts.items()},
            'totals': {p: dict(sum((c for c in v.values()), Counter())) for p, v in counts.items()},
            'yellow_cases': yellow, 'seconds': round(time.perf_counter() - t0, 1),
            'generated_utc': datetime.now(timezone.utc).isoformat(timespec='seconds')}


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(prog='python -m backend.scenario_search')
    parser.add_argument('--days-step', type=int, default=3)
    parser.add_argument('--out', default='logs/scenario_search.json')
    args = parser.parse_args(argv)
    result = run(args.days_step)
    with open(args.out, 'w', encoding='utf-8') as f:
        json.dump(result, f, indent=1, ensure_ascii=False, default=float)
    print('totals', json.dumps(result['totals']), 'yellow cases', len(result['yellow_cases']), f"{result['seconds']} s")
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
