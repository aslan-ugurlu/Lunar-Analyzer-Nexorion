"""Explainable screening-grade lunar mission constraints and Pareto comparison.

GREEN never means a certified landing clearance; it requires completed nominal,
conservative and quality tests. Missing critical evidence -> GRAY, not invented GREEN.
"""
from __future__ import annotations
import math
from datetime import datetime, timedelta, timezone
from typing import Any

import numpy as np
from backend.astro_engine import compute_sky_positions
from backend.terrain_engine import sun_disk_fraction, earth_dte_visible, local_slope


class MissionDataError(RuntimeError):
    pass


def _iso(dt):
    return dt.astimezone(timezone.utc).isoformat(timespec='seconds').replace('+00:00','Z')


def _time_grid(landing_utc, duration_hours, buffer_hours, step_minutes, shift_hours):
    dt = datetime.fromisoformat(landing_utc.replace('Z','+00:00'))
    start = dt + timedelta(hours=shift_hours)
    total_seconds = (duration_hours + buffer_hours) * 3600
    step_s = step_minutes * 60
    n = int(math.ceil(total_seconds/step_s))
    if n > 6000:
        raise ValueError('Excessive timeline samples')
    seconds = [min(i*step_s,total_seconds) for i in range(n+1)]
    return [_iso(start+timedelta(seconds=s)) for s in seconds], seconds


def _longest_true_run(flags, seconds):
    """Sampled-step gap bound; transitions NOT refined to exact times."""
    longest = 0.0
    longest_interval = None
    start = None
    for i in range(len(seconds)-1):
        if bool(flags[i]):
            if start is None:
                start = i
        elif start is not None:
            dur = seconds[i]-seconds[start]
            if dur > longest:
                longest, longest_interval = dur, (start,i)
            start = None
    if start is not None:
        dur = seconds[-1]-seconds[start]
        if dur > longest:
            longest, longest_interval = dur, (start,len(seconds)-1)
    return longest, longest_interval


def _evaluate_series(sky, seconds, sun_h, earth_h, dark_threshold):
    sun_values=[]
    earth_values=[]
    integ_errors=[]
    for time in sky:
        sun=time['sun']; earth=time['earth']
        result=sun_disk_fraction(sun['az_deg'],sun['el_deg'],sun['angular_radius_deg'],sun_h)
        sun_values.append(result['fraction'])
        integ_errors.append(result['numerical_diff'])
        earth_values.append(earth_dte_visible(earth['az_deg'],earth['el_deg'],earth_h))
    if any(v is None for v in sun_values) or any(v is None for v in earth_values):
        return {'valid':False,'reason':'Incomplete DEM horizon along Sun/Earth direction',
                'sun_visible_fraction':sun_values,'earth_visible':earth_values}
    sun_array=np.asarray(sun_values,dtype=float)
    dte_array=np.asarray(earth_values,dtype=bool)
    dts = np.diff(seconds)
    if not np.isfinite(sun_array).all() or not dts.size or np.any(dts<=0):
        return {'valid':False,'reason':'Invalid numerical timeline'}
    # Left-interval estimates: transitions unresolved below temporal sampling step.
    illum = float(np.sum(sun_array[:-1]*dts)/np.sum(dts))
    earth_ratio=float(np.sum(dte_array[:-1]*dts)/np.sum(dts))
    darkness_s, dark_span=_longest_true_run(sun_array<=dark_threshold, seconds)
    dte_gap_s, dte_span=_longest_true_run(~dte_array, seconds)
    return {'valid':True,'mean_sun_visible_fraction':illum,'dte_visible_fraction':earth_ratio,
            'max_continuous_darkness_s':darkness_s,'max_continuous_dte_gap_s':dte_gap_s,
            'max_disk_integration_difference':max((v for v in integ_errors if v is not None),default=0),
            'darkness_interval':dark_span,'dte_gap_interval':dte_span,
            'sun_visible_fraction':sun_values,'earth_visible':earth_values,
            'time_resolution_minutes':float(max(dts)/60)}


def _constraints(metrics, slope, limits):
    violations=[]
    unknown=[]
    if not metrics['valid']:
        unknown.append({'code':'INCOMPLETE_VISIBILITY','message':metrics.get('reason')})
    else:
        checks=[
            ('MAX_DARKNESS','max_continuous_darkness_s','max_darkness_hours',3600,'max'),
            ('MIN_ILLUMINATION','mean_sun_visible_fraction','min_sun_fraction',1,'min'),
            ('MIN_DTE','dte_visible_fraction','min_dte_fraction',1,'min'),
            ('MAX_DTE_GAP','max_continuous_dte_gap_s','max_dte_gap_hours',3600,'max'),
        ]
        for code,key,setting,scale,op in checks:
            limit=limits.get(setting)
            if limit is None:
                continue
            value=metrics[key]
            allowed=limit*scale
            bad=value>allowed+1e-9 if op=='max' else value<allowed-1e-9
            if bad:
                violations.append({'code':code,'observed':value,'limit':allowed,
                                   'excess':(value-allowed if op=='max' else allowed-value),
                                   'unit':'s' if scale==3600 else 'fraction'})
    maximum=limits.get('max_slope_deg')
    if maximum is not None:
        if slope.get('slope_max_deg') is None:
            unknown.append({'code':'SLOPE_UNKNOWN','message':'High-resolution DEM or slope sample unavailable'})
        elif slope['slope_max_deg']>maximum:
            violations.append({'code':'MAX_SLOPE','observed':slope['slope_max_deg'],
                               'limit':maximum,'excess':slope['slope_max_deg']-maximum,'unit':'deg'})
    return violations, unknown


def analyze_mission(horizon:dict, latitude:float, longitude:float, landing_utc:str,
                    duration_hours:float, buffer_hours:float, step_minutes:int,
                    constraints:dict, shifts_hours:list[int],
                    sun_observer_height_m:float, earth_observer_height_m:float,
                    dark_threshold:float=0.01):
    if not 0<=dark_threshold<=0.1:
        raise ValueError('Invalid dark threshold')
    if horizon['status']!='complete':
        return {'status':'GRAY','reason':'Horizon model is partial; cannot classify',
                'quality':horizon['status'],'scenarios':[]}
    profiles=horizon['profiles']
    modes=['nominal']
    if horizon['uncertainty_mode']=='err':
        modes.append('cautious')
    slope=local_slope(latitude,longitude, constraints.get('slope_footprint_radius_m',30.0))
    scenario_results=[]
    for shift in sorted(set(shifts_hours+[0])):
        utc_values,seconds=_time_grid(landing_utc,duration_hours,buffer_hours,step_minutes,shift)
        sky=compute_sky_positions(latitude,longitude,horizon['geometry']['observer_dem_m'],
                                  utc_values,sun_observer_height_m,earth_observer_height_m)
        variants={}
        for mode in modes:
            metrics=_evaluate_series(sky,seconds,profiles['sun'][mode],profiles['earth'][mode],dark_threshold)
            violations, unknown=_constraints(metrics,slope,constraints)
            variants[mode]={'metrics':metrics,'violations':violations,'unknown':unknown}
        scenario_results.append({'shift_hours':shift,'start_utc':utc_values[0],
                                 'end_utc':utc_values[-1],'variants':variants,
                                 # Main frontend uses this single nominal timeline for all modes.
                                 'timeline':[{'utc':sky[i]['utc'],
                                              'sun':sky[i]['sun'],'earth':sky[i]['earth'],
                                              'sun_visible_fraction':variants['nominal']['metrics'].get('sun_visible_fraction',[None]*len(sky))[i],
                                              'dte_visible':variants['nominal']['metrics'].get('earth_visible',[None]*len(sky))[i]}
                                             for i in range(len(sky))]})
    nominal_violations=[v for s in scenario_results for v in s['variants']['nominal']['violations']]
    nominal_unknown=[v for s in scenario_results for v in s['variants']['nominal']['unknown']]
    cautious_violations=[v for s in scenario_results if 'cautious' in s['variants']
                         for v in s['variants']['cautious']['violations']]
    cautious_unknown=[v for s in scenario_results if 'cautious' in s['variants']
                      for v in s['variants']['cautious']['unknown']]
    if nominal_violations:
        status='RED'
    elif nominal_unknown or cautious_unknown:
        status='GRAY'
    elif cautious_violations:
        status='YELLOW'
    elif horizon['uncertainty_mode']=='nominal':
        status='GRAY'  # nominal screen alone cannot justify verified GREEN
    else:
        status='GREEN'
    labels={'RED':'Nominal görev kısıtları sağlanmıyor',
            'YELLOW':'Nominal uygun; ihtiyatlı arazi senaryosunda kısıt ihlali var',
            'GRAY':'Veri veya belirsizlik doğrulaması yetersiz',
            'GREEN':'Tanımlı kısıtlar nominal ve ihtiyatlı senaryolarda sağlanıyor'}
    explanations={'public':labels[status]+'. Bu sonuç iniş güvenliği sertifikası değildir.',
                  'engineer':f'{status}: nominal violations={len(nominal_violations)}, '+
                              f'cautious violations={len(cautious_violations)}, unknown={len(nominal_unknown)+len(cautious_unknown)}; '+
                              f'DEM={horizon["sources"]}; radius={horizon["reference_radius_km"]}km; method={horizon["uncertainty_mode"]}.'}
    return {'status':status,'label':labels[status],'explanations':explanations,
            'slope':slope,'scenarios':scenario_results,
            'nominal_violations':nominal_violations,'cautious_violations':cautious_violations,
            'unresolved':nominal_unknown+cautious_unknown,
            'disclaimers':['DTE is geometrical Earth-center line of sight, not radio link viability',
                           'Mean solar disk visibility is NOT electrical power',
                           'Sun disk and event times are sampled; transition times are not certified',
                           'Landing safety and hazards below DEM resolution are not evaluated',
                           'ERR +/- k scenarios are not confidence intervals']}


def pareto_compare(candidates:list[dict], priority='balanced'):
    """Dominance among same-class completed candidates; smaller is better for all costs."""
    priority_options=('balanced','sun','comms','resilience')
    if priority not in priority_options:
        raise ValueError('Invalid priority')
    good=[]
    for candidate in candidates:
        result=candidate['result']
        if result['status'] not in ('GREEN','YELLOW'):
            continue
        baseline=next((s for s in result['scenarios'] if s['shift_hours']==0),None)
        if baseline is None or not baseline['variants']['nominal']['metrics']['valid']:
            continue
        m=baseline['variants']['nominal']['metrics']
        values=(-m['mean_sun_visible_fraction'],m['max_continuous_darkness_s'],
                -m['dte_visible_fraction'],m['max_continuous_dte_gap_s'])
        good.append({'id':candidate['id'],'status':result['status'],'costs':values,
                     'metrics':{k:m[k] for k in ('mean_sun_visible_fraction',
                       'max_continuous_darkness_s','dte_visible_fraction','max_continuous_dte_gap_s')}})
    for item in good:
        item['dominated_by']=[other['id'] for other in good if other['id']!=item['id']
                              and other['status']==item['status']
                              and all(a<=b for a,b in zip(other['costs'],item['costs']))
                              and any(a<b for a,b in zip(other['costs'],item['costs']))]
        del item['costs']
    # Ranking never changes scientific status; no universal hidden weighted score.
    keymap={'balanced':lambda x:(bool(x['dominated_by']),x['metrics']['max_continuous_darkness_s'],
                                   x['metrics']['max_continuous_dte_gap_s']),
            'sun':lambda x:(bool(x['dominated_by']),-x['metrics']['mean_sun_visible_fraction']),
            'comms':lambda x:(bool(x['dominated_by']),x['metrics']['max_continuous_dte_gap_s'],
                                   -x['metrics']['dte_visible_fraction']),
            'resilience':lambda x:(bool(x['dominated_by']),x['metrics']['max_continuous_darkness_s'])}
    return {'priority':priority,'green':sorted((x for x in good if x['status']=='GREEN'),key=keymap[priority]),
            'yellow':sorted((x for x in good if x['status']=='YELLOW'),key=keymap[priority]),
            'excluded':[{'id':x['id'],'status':x['result']['status']} for x in candidates
                        if x['result']['status'] not in ('GREEN','YELLOW')],
            'note':'Pareto dominance uses four nominal metrics; status/uncertainty are separate. '+
                   'Resilience ordering is illustrative, not an independently calculated tolerance score.'}
