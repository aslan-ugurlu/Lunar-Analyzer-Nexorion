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
from backend.config import REFERENCE_HORIZON_RADIUS_KM
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


_CLONE_WORST_HIGH={'max_continuous_darkness_s':True,'mean_sun_visible_fraction':False,
                   'dte_visible_fraction':False,'max_continuous_dte_gap_s':True}


def _clone_variant(sky, seconds, ensemble, dark_threshold, slope, limits, percentile=95.0):
    """Evaluate every real clone horizon; 'cautious' metric = percentile-worst clone per constraint.

    Max-type metrics (darkness, DTE gap) use the p95 value, min-type metrics (Sun, DTE share) the p05
    value. The joint share of clones passing ALL constraints is reported separately. Screening
    statistics over 100 PGDA realisations, not a certified confidence level.
    """
    sun_profiles, earth_profiles = ensemble['sun'], ensemble['earth']
    n=len(sun_profiles)
    per_clone=[_evaluate_series(sky,seconds,sun_profiles[i],earth_profiles[i],dark_threshold) for i in range(n)]
    invalid=sum(1 for m in per_clone if not m['valid'])
    if invalid:
        metrics={'valid':False,'reason':f'{invalid} of {n} clone horizons incomplete along the Sun/Earth direction',
                 'method':'clone','n_clones':n}
        violations, unknown=_constraints(metrics,slope,limits)
        return {'metrics':metrics,'violations':violations,'unknown':unknown,
                'clone':{'n':n,'pass_count':None,'pass_fraction':None,'invalid':invalid}}
    metrics={'valid':True,'method':f'clone_p{percentile:g}','n_clones':n,'darkness_interval':None,'dte_gap_interval':None}
    spread={}
    for key,worst_high in _CLONE_WORST_HIGH.items():
        arr=np.asarray([m[key] for m in per_clone],dtype=float)
        metrics[key]=float(np.percentile(arr, percentile if worst_high else 100-percentile))
        spread[key]={'min':float(arr.min()),'p05':float(np.percentile(arr,5)),'p50':float(np.percentile(arr,50)),
                     'p95':float(np.percentile(arr,95)),'max':float(arr.max())}
    metrics['time_resolution_minutes']=per_clone[0]['time_resolution_minutes']
    # Worst numerical disc-integration difference over all clones (same meaning as the nominal field).
    metrics['max_disk_integration_difference']=max(m['max_disk_integration_difference'] for m in per_clone)
    violations, unknown=_constraints(metrics,slope,limits)
    passing=sum(1 for m in per_clone if not _constraints(m,slope,limits)[0])
    failing_by_code={}
    for m in per_clone:
        for v in _constraints(m,slope,limits)[0]:
            failing_by_code[v['code']]=failing_by_code.get(v['code'],0)+1
    for v in violations:
        v['clone_fail_count']=failing_by_code.get(v['code'],0)
        v['clone_n']=n
    return {'metrics':metrics,'violations':violations,'unknown':unknown,
            'clone':{'n':n,'pass_count':passing,'pass_fraction':passing/n,'fail_count_by_code':failing_by_code,
                     'metric_spread':spread,'percentile':percentile}}


def _radius_policy(radius_km:float, status:str) -> dict:
    """GREEN requires the 200-km reference scan.

    A shorter scan takes the horizon maximum over a SUBSET of the reference terrain samples, so its
    horizon can only be lower or equal: Sun/Earth visibility is optimistic. RED (nominal violation)
    therefore remains valid, while GREEN/YELLOW could worsen at 200 km. GREEN is capped at YELLOW.
    """
    below=radius_km<REFERENCE_HORIZON_RADIUS_KM-1e-9
    after='YELLOW' if (below and status=='GREEN') else status
    if below:
        note=(f'Horizon scanned to {radius_km:g} km < {REFERENCE_HORIZON_RADIUS_KM:g} km reference. A shorter scan can only '
              'lower the horizon, so visibility is optimistic: RED stays valid, GREEN is capped at YELLOW and '
              'YELLOW/GRAY may worsen at the reference radius.')
    else:
        note=f'Horizon scanned to the {REFERENCE_HORIZON_RADIUS_KM:g} km reference radius (not proof of complete occlusion).'
    return {'code':'REDUCED_HORIZON_RADIUS' if below else 'REFERENCE_RADIUS',
            'radius_km':radius_km,'reference_radius_km':REFERENCE_HORIZON_RADIUS_KM,
            'below_reference':below,'status_before_policy':status,'status_after_policy':after,
            'capped':after!=status,'note':note}


def analyze_mission(horizon:dict, latitude:float, longitude:float, landing_utc:str,
                    duration_hours:float, buffer_hours:float, step_minutes:int,
                    constraints:dict, shifts_hours:list[int],
                    sun_observer_height_m:float, earth_observer_height_m:float,
                    dark_threshold:float=0.01, clone_ensemble:dict|None=None):
    if not 0<=dark_threshold<=0.1:
        raise ValueError('Invalid dark threshold')
    if horizon['status']!='complete':
        return {'status':'GRAY','reason':'Horizon model is partial; cannot classify',
                'quality':horizon['status'],'scenarios':[]}
    profiles=horizon['profiles']
    modes=['nominal']
    if horizon['uncertainty_mode']=='err':
        modes.append('cautious')
    if horizon['uncertainty_mode']=='clone' and clone_ensemble is None:
        raise MissionDataError('Clone mode requires the precomputed clone ensemble')
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
        if horizon['uncertainty_mode']=='clone':
            variants['cautious']=_clone_variant(sky,seconds,clone_ensemble,dark_threshold,slope,constraints)
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
    radius_policy=_radius_policy(float(horizon['reference_radius_km']), status)
    status=radius_policy['status_after_policy']
    labels={'RED':'Nominal görev kısıtları sağlanmıyor',
            'YELLOW':('Nominal uygun; DEM clone topluluğunun %95 kötü tarafında kısıt ihlali var'
                      if horizon['uncertainty_mode']=='clone' else
                      'Nominal uygun; ihtiyatlı arazi senaryosunda kısıt ihlali var'),
            'GRAY':'Veri veya belirsizlik doğrulaması yetersiz',
            'GREEN':'Tanımlı kısıtlar nominal ve ihtiyatlı senaryolarda sağlanıyor'}
    label=labels[status]
    if radius_policy['capped']:
        label=(f'Nominal ve ihtiyatlı kontroller {radius_policy["radius_km"]:g} km hızlı taramada geçti; '
               f'GREEN için {REFERENCE_HORIZON_RADIUS_KM:g} km referans analizi gerekli')
    public=label+'. Bu sonuç iniş güvenliği sertifikası değildir.'
    if radius_policy['below_reference'] and not radius_policy['capped'] and status!='RED':
        public+=(f' Ufuk {radius_policy["radius_km"]:g} km ile tarandı; {REFERENCE_HORIZON_RADIUS_KM:g} km '
                 'referans taramada sonuç daha kötü olabilir.')
    explanations={'public':public,
                  'engineer':f'{status}: nominal violations={len(nominal_violations)}, '+
                              f'cautious violations={len(cautious_violations)}, unknown={len(nominal_unknown)+len(cautious_unknown)}; '+
                              f'DEM={horizon["sources"]}; radius={horizon["reference_radius_km"]}km; method={horizon["uncertainty_mode"]}; '+
                              f'radius_policy={radius_policy["code"]} (before={radius_policy["status_before_policy"]}).'}
    return {'status':status,'label':label,'explanations':explanations,'radius_policy':radius_policy,
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
    # Compute every dominance relation first; costs are removed only afterwards
    # (deleting inside the loop raised KeyError as soon as >= 2 candidates qualified).
    for item in good:
        item['dominated_by']=[other['id'] for other in good if other['id']!=item['id']
                              and other['status']==item['status']
                              and all(a<=b for a,b in zip(other['costs'],item['costs']))
                              and any(a<b for a,b in zip(other['costs'],item['costs']))]
    for item in good:
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
