"""Independent JPL Horizons observer test. Requires network and real SPICE kernels.

Scientific scope: compares apparent topocentric Sun/Earth direction in the same
user-declared spherical (1737.4 km) Moon Mean-Earth surface geometry.
DO NOT report complete scientific validation after only three synthetic sites.
"""
import csv
import io
import json
import math
import re
import urllib.parse
import urllib.request

import numpy as np
from backend.astro_engine import (load_kernels, compute_sky_positions,
                                  normalize_utc_to_et)
from backend.config import FRAME, R_MOON_KM

HORIZONS_URL='https://ssd.jpl.nasa.gov/api/horizons.api'


def az_el_unit(az_deg, el_deg):
    az, el=np.radians([az_deg, el_deg])
    return np.array([np.cos(el)*np.sin(az),np.cos(el)*np.cos(az),np.sin(el)])


def separation(az_a, el_a, az_b, el_b):
    a,b=az_el_unit(az_a,el_a),az_el_unit(az_b,el_b)
    return float(np.degrees(np.arctan2(np.linalg.norm(np.cross(a,b)),np.dot(a,b))))


# Horizons labels the apparent az/el columns differently depending on output
# options: 'Azi_(a-app)'/'Elev_(a-app)' (refracted/default) and
# 'Azimuth_(a-app)'/'Elevation_(a-app)' (APPARENT='AIRLESS', observed 2026-11-14).
_AZ_COLUMN = re.compile(r'^Azi(muth)?_\(a-app\)$')
_EL_COLUMN = re.compile(r'^Elev(ation)?_\(a-app\)$')


def parse_horizons_csv(raw):
    if '$$SOE' not in raw or '$$EOE' not in raw:
        raise ValueError('Horizons response missing ephemeris markers; inspect service error')
    prior=raw.split('$$SOE',1)[0]
    candidates=[]
    for line in prior.splitlines():
        cells=[c.strip() for c in next(csv.reader([line],skipinitialspace=True),[])]
        if any(_AZ_COLUMN.match(c) for c in cells) and any(_EL_COLUMN.match(c) for c in cells):
            candidates.append(line.strip())
    if not candidates:
        raise ValueError('Horizons response missing azimuth/elevation column headers')
    headers=next(csv.reader([candidates[-1]],skipinitialspace=True))
    headers=[h.strip() for h in headers]
    def getindex(pattern):
        matches=[i for i,h in enumerate(headers) if pattern.match(h)]
        if len(matches)!=1:
            raise ValueError(f'Expected one Horizons column for {pattern.pattern}, found {len(matches)}')
        return matches[0]
    azi=getindex(_AZ_COLUMN)
    elev=getindex(_EL_COLUMN)
    body=raw.split('$$SOE',1)[1].split('$$EOE',1)[0].strip()
    lines=[r for r in csv.reader(io.StringIO(body),skipinitialspace=True) if any(v.strip() for v in r)]
    if len(lines)!=1:
        raise ValueError(f'Expected exactly one Horizons ephemeris row, received {len(lines)}')
    row=lines[0]
    if len(row)<=max(azi,elev):
        raise ValueError(f'Horizons row/header mismatch: {headers!r}, {row!r}')
    az,el=float(row[azi].strip()),float(row[elev].strip())
    if not (-90<=el<=90 and 0<=az<=360):
        raise ValueError('Horizons angle out of range')
    return {'az_deg':az,'el_deg':el,'headers':headers}


def query_horizons(target_id, latitude, longitude, altitude_km, utc):
    canonical,_ = normalize_utc_to_et(utc)
    date=canonical.replace('T',' ').replace('Z','')
    params={
        'format':'json','COMMAND':f"'{target_id}'",'OBJ_DATA':"'NO'",
        'MAKE_EPHEM':"'YES'",'EPHEM_TYPE':"'OBSERVER'",
        'CENTER':"'coord@301'",'COORD_TYPE':"'GEODETIC'",
        'SITE_COORD':f"'{longitude%360:.10f},{latitude:.10f},{altitude_km:.10f}'",
        'TLIST':f"'{date}'",'QUANTITIES':"'4'",'CSV_FORMAT':"'YES'",
        'CAL_FORMAT':"'CAL'",'TIME_TYPE':"'UT'",'TIME_DIGITS':"'FRACSEC'",
        'APPARENT':"'AIRLESS'",'EXTRA_PREC':"'YES'",
    }
    url=HORIZONS_URL+'?'+urllib.parse.urlencode(params)
    with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'LunarMissionWindowAnalyzer/1.0'}),timeout=40) as response:
        data=json.load(response)
    if data.get('error'):
        raise RuntimeError(f'Horizons API error: {data["error"][:250]}')
    result=data.get('result','')
    parsed=parse_horizons_csv(result)
    parsed['center_metadata']=[line.strip() for line in result.splitlines()
        if 'Center radii' in line or 'Center pole/equ' in line or 'Center site name' in line]
    return parsed


def run_a04_suite(tolerance_deg=0.005):
    load_kernels()
    # Synthetic DEM heights: these are controlled geometry checks, not sampled lunar landmarks.
    cases=[
        ('near Shackleton example',-89.54,0.,1200.,4.,'2026-12-01T12:00:00Z'),
        ('near Connecting Ridge example',-89.45,-137.5,1500.,4.,'2026-06-15T06:00:00Z'),
        ('near Malapert example',-86.,2.5,4500.,40.,'2027-03-21T18:00:00Z'),
    ]
    rows=[]
    for name,lat,lon,dem,obs,t in cases:
        local=compute_sky_positions(lat,lon,dem,[t],obs,obs)[0]
        total_km=(dem+obs)/1000.
        for label,body in [('sun','10'),('earth','399')]:
            remote=query_horizons(body,lat,lon,total_km,t)
            actual=separation(local[label]['az_deg'],local[label]['el_deg'],remote['az_deg'],remote['el_deg'])
            rows.append({'case':name,'body':label,'utc':t,'difference_deg':actual,
                         'passed':actual<=tolerance_deg,'horizons_site_metadata':remote['center_metadata']})
    return {'test':'A-04','all_passed':all(r['passed'] for r in rows),
            'threshold_deg':tolerance_deg,'frame':FRAME,'aberration':'LT+S',
            'observer_assumption':'Moon mean-Earth sphere R=1737.4 km; check Horizons site metadata',
            'test_heights':'synthetic; not LOLA-derived',
            'warning':'This tests 3 geometries; it does not establish terrain or full-year correctness',
            'rows':rows}


if __name__=='__main__':
    print(json.dumps(run_a04_suite(),indent=2,ensure_ascii=False))
