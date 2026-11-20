"""Lunar Mission Window Analyzer REST API.

Run in project root: uvicorn backend.main:app --host 127.0.0.1 --port 8000
The process pool is isolated (spawn) so a native SPICE/GDAL crash does not
normally bring down the API process. No fabricated scientific results.
"""
from __future__ import annotations

import asyncio
from collections import defaultdict, deque
from concurrent.futures import ProcessPoolExecutor
from concurrent.futures.process import BrokenProcessPool
from contextlib import asynccontextmanager
from datetime import datetime, timezone, timedelta
import json
import logging
import math
import multiprocessing
import os
import threading
import time
import uuid
from typing import Literal

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from backend.config import (DATASETS, KERNELS, MAX_PENDING, MAX_WORKERS, CACHE,
                            ANALYSIS_TIMEOUT_S, VALIDATION, PGDA_SOUTH_POLE_PAGE, PGDA_SITE_PAGE, SITE_NAMES)

logging.basicConfig(level=logging.INFO,format='%(asctime)s %(levelname)s %(message)s')
log=logging.getLogger('lunar')

class ApiError(Exception):
    def __init__(self, code, message, status=400):
        self.code,self.message,self.status=code,message,status
        super().__init__(message)


def utc(value:datetime)->datetime:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError('UTC offset required')
    return value.astimezone(timezone.utc)


class SafeBase(BaseModel):
    model_config=ConfigDict(extra='forbid',allow_inf_nan=False)


class Constraints(SafeBase):
    max_darkness_hours: float|None=Field(None,ge=0,le=720)
    min_sun_fraction: float|None=Field(None,ge=0,le=1)
    min_dte_fraction: float|None=Field(None,ge=0,le=1)
    max_dte_gap_hours: float|None=Field(None,ge=0,le=720)
    max_slope_deg: float|None=Field(None,ge=0,le=90)
    slope_footprint_radius_m: float=Field(30,ge=5,le=200)

    @model_validator(mode='after')
    def nonempty(self):
        if all(getattr(self,k) is None for k in
               ('max_darkness_hours','min_sun_fraction','min_dte_fraction','max_dte_gap_hours','max_slope_deg')):
            raise ValueError('At least one mission constraint is required')
        return self


class AnalysisInput(SafeBase):
    dataset_id: str=Field('lola_240m',min_length=1,max_length=50)
    latitude: float=Field(ge=-90,le=-80)
    longitude: float=Field(ge=-180,le=180)
    landing_utc: datetime
    duration_hours: float=Field(336,gt=0,le=720)
    buffer_hours: float=Field(0,ge=0,le=168)
    step_minutes: int=Field(30,ge=10,le=120)
    horizon_radius_km: float=Field(200,ge=10,le=200)
    sun_observer_height_m: float=Field(4,ge=0,le=100)
    earth_observer_height_m: float=Field(4,ge=0,le=100)
    uncertainty_mode: Literal['nominal','err','clone']='nominal'
    err_k: float=Field(1.0,ge=0,le=3)
    dark_fraction_threshold: float=Field(.01,ge=0,le=.1)
    shifts_hours: list[int]=Field(default_factory=lambda:[0,24,48,72],max_length=5)
    constraints: Constraints

    @model_validator(mode='after')
    def validate_scope(self):
        start=utc(self.landing_utc)
        if self.dataset_id not in DATASETS:
            raise ValueError('Unknown dataset identifier')
        if not datetime(2026,1,1,tzinfo=timezone.utc)<=start<datetime(2036,1,1,tzinfo=timezone.utc):
            raise ValueError('Supported date interval 2026-01-01 to 2035-12-31')
        if len(self.shifts_hours)!=len(set(self.shifts_hours)) or any(x<0 or x>168 for x in self.shifts_hours):
            raise ValueError('Shift hours must be unique integers 0..168')
        shifts=set(self.shifts_hours)|{0}
        end=start+timedelta(hours=self.duration_hours+self.buffer_hours+max(shifts))
        if end>=datetime(2036,1,1,tzinfo=timezone.utc):
            raise ValueError('Mission end beyond supported date window')
        points=math.ceil((self.duration_hours+self.buffer_hours)*60/self.step_minutes)+1
        if points>6000 or points*len(shifts)>12000:
            raise ValueError('Analysis sampling budget exceeded; increase step_minutes or reduce duration')
        return self


class CompareInput(SafeBase):
    analysis_ids: list[str]=Field(min_length=2,max_length=12)
    priority: Literal['balanced','sun','comms','resilience']='balanced'


class ShiftInput(SafeBase):
    analysis_id:str
    shifts_hours:list[int]=Field(default_factory=lambda:[0,24,48,72],min_length=1,max_length=5)

    @field_validator('shifts_hours')
    @classmethod
    def check_shifts(cls,values):
        if len(values)!=len(set(values)) or any(x<0 or x>168 for x in values):
            raise ValueError('Unique shift hours in 0..168 required')
        return values


def _load_clones(payload:dict):
    from backend.clone_engine import load_clone_ensemble
    return load_clone_ensemble(payload['latitude'],payload['longitude'],payload['sun_observer_height_m'],
                               payload['earth_observer_height_m'],payload['horizon_radius_km'])


def _attach_clone(horizon:dict, ensemble:dict)->dict:
    """Nominal horizon + clone p05/p95 display band (per azimuth) and provenance. Decision uses per-clone metrics."""
    from backend.clone_engine import envelope, CLONE_CAUTIOUS_PERCENTILE
    out=json.loads(json.dumps(horizon))
    band_complete=True
    for body in ('sun','earth'):
        env=envelope(ensemble['profiles'][body])
        band_complete&=env['complete']
        out['profiles'][body]['cautious']=env['p95']
        out['profiles'][body]['optimistic']=env['p05']
    meta=ensemble['meta']
    dem=ensemble['observer_dem_m']
    out.update({'uncertainty_mode':'clone','k':None,
                'clone_ensemble':{'n_clones':meta['n_clones'],'site_tile':meta['site_tile'],'cloned_layer':meta['cloned_layer'],
                                  'profile_key':meta['key'],'created_utc':meta['created_utc'],'source':meta['source'],
                                  'percentile':CLONE_CAUTIOUS_PERCENTILE,'band':'per-azimuth p05-p95 of clone horizons (display only)',
                                  'observer_dem_m_range':[float(dem.min()),float(dem.max())],'band_complete':band_complete,
                                  'note':meta['note']}})
    if not band_complete:
        out['status']='partial'
    out['notes']=out.get('notes',[])+['DEM clones: empirical spread of PGDA realisations of the observer tile only; not a certified confidence level']
    return out


def _worker_calculate(payload:dict)->dict:
    from backend.terrain_engine import compute_horizon, TerrainMissing, TerrainError
    from backend.decision_engine import analyze_mission
    try:
        clone_mode=payload['uncertainty_mode']=='clone'
        horizon=compute_horizon(payload['latitude'],payload['longitude'],
                radius_km=payload['horizon_radius_km'],
                sun_height_m=payload['sun_observer_height_m'],
                earth_height_m=payload['earth_observer_height_m'],
                uncertainty_mode='nominal' if clone_mode else payload['uncertainty_mode'],k=payload['err_k'],dataset_id=payload['dataset_id'])
        ensemble=None
        if clone_mode:
            from backend.clone_engine import describe_gap
            ensemble=_load_clones(payload)
            if ensemble is None:
                return {'status':'GRAY','error_code':'CLONE_NOT_PRECOMPUTED',
                        'reason':describe_gap(payload['latitude'],payload['longitude'])}
            horizon=_attach_clone(horizon,ensemble)
        mission=analyze_mission(horizon,payload['latitude'],payload['longitude'],payload['landing_utc'],
                payload['duration_hours'],payload['buffer_hours'],payload['step_minutes'],
                payload['constraints'],payload['shifts_hours'],
                payload['sun_observer_height_m'],payload['earth_observer_height_m'],
                dark_threshold=payload['dark_fraction_threshold'],
                clone_ensemble=ensemble['profiles'] if ensemble else None)
        return {'status':mission['status'],'mission':mission,'horizon':horizon}
    except TerrainMissing as exc:
        return {'status':'GRAY','error_code':'DEM_MISSING','reason':str(exc)}
    except TerrainError as exc:
        return {'status':'GRAY','error_code':'TERRAIN_UNAVAILABLE','reason':str(exc)}


def _worker_shift(horizon:dict,payload:dict,shifts:list[int]):
    from backend.decision_engine import analyze_mission
    if horizon is None:
        return {'status':'GRAY','reason':'No existing horizon result to reuse'}
    ensemble=None
    if horizon.get('uncertainty_mode')=='clone':
        ensemble=_load_clones(payload)
        if ensemble is None or ensemble['meta']['key']!=horizon.get('clone_ensemble',{}).get('profile_key'):
            return {'status':'GRAY','error_code':'CLONE_NOT_PRECOMPUTED','reason':'Clone profiles of the parent analysis are no longer available'}
    result=analyze_mission(horizon,payload['latitude'],payload['longitude'],payload['landing_utc'],
             payload['duration_hours'],payload['buffer_hours'],payload['step_minutes'],
             payload['constraints'],shifts,payload['sun_observer_height_m'],
             payload['earth_observer_height_m'],payload['dark_fraction_threshold'],
             clone_ensemble=ensemble['profiles'] if ensemble else None)
    return {'status':result['status'],'mission':result,'horizon':horizon}


def _new_pool()->ProcessPoolExecutor:
    """Windows-safe pool factory. Called ONLY from lifespan or pool recycling.

    Never at import time / module top level / per request (spawn re-imports this
    module in every child; see tests/test_spawn_pool.py).
    """
    return ProcessPoolExecutor(max_workers=MAX_WORKERS,
                               mp_context=multiprocessing.get_context('spawn'))


def _terminate_pool(pool:ProcessPoolExecutor)->None:
    """Stop a pool without waiting for running native work (no hang on shutdown)."""
    terminate=getattr(pool,'terminate_workers',None)  # Python >= 3.14
    if callable(terminate):
        try:
            terminate()
            return
        except Exception:  # pragma: no cover - fall back below
            pass
    # Python 3.11-3.13: no public API to kill a running worker; use the process table.
    for process in list((getattr(pool,'_processes',None) or {}).values()):
        try:
            process.terminate()
        except Exception:
            pass
    pool.shutdown(wait=False,cancel_futures=True)


def _recycle_pool(app:FastAPI,broken:ProcessPoolExecutor)->None:
    # Only recycle the pool that actually failed; a concurrent handler may already have.
    if app.state.pool is broken:
        app.state.pool=_new_pool()
        app.state.worker_generation+=1
        _terminate_pool(broken)


@asynccontextmanager
async def lifespan(app:FastAPI):
    app.state.pool=_new_pool()
    app.state.jobs={}
    app.state.tasks=set()
    app.state.lock=asyncio.Lock()
    app.state.clients=defaultdict(deque)
    app.state.worker_generation=0
    log.info('Lunar API started; %d spawn worker processes configured',MAX_WORKERS)
    try:
        yield
    finally:
        for task in list(app.state.tasks):
            task.cancel()
        # Do not wait for in-flight native work at shutdown; terminate it.
        _terminate_pool(app.state.pool)

app=FastAPI(title='Lunar Mission Window Analyzer',version='1.3',debug=False,lifespan=lifespan)


def _cors_origins()->list[str]:
    """Explicit dev origins only. Wildcards are refused (no wildcard CORS in production)."""
    raw=os.environ.get('LUNAR_CORS_ORIGINS','http://localhost:5173,http://127.0.0.1:5173')
    origins=[o.strip() for o in raw.split(',') if o.strip()]
    if any('*' in o for o in origins):
        raise RuntimeError('Wildcard CORS origins are not allowed')
    return origins


app.add_middleware(CORSMiddleware,allow_origins=_cors_origins(),allow_credentials=False,
                   allow_methods=['GET','POST'],allow_headers=['Content-Type'],
                   expose_headers=['X-Request-ID'])


def fail(code,message,status,request_id):
    return JSONResponse(status_code=status,content={'error':{'code':code,'message':message,'request_id':request_id}})


@app.middleware('http')
async def request_id(request:Request,call_next):
    request.state.request_id=uuid.uuid4().hex
    response=await call_next(request)
    response.headers['X-Request-ID']=request.state.request_id
    return response


@app.exception_handler(ApiError)
async def api_error(request:Request,exc:ApiError):
    return fail(exc.code,exc.message,exc.status,request.state.request_id)


def _safe_validation_details(exc:RequestValidationError)->list[dict]:
    """Field + message only. Never echo raw input values, URLs or internals."""
    details=[]
    for error in exc.errors()[:20]:
        loc=[str(p) for p in error.get('loc',()) if p not in ('body',)]
        message=str(error.get('msg',''))[:200]
        details.append({'field':'.'.join(loc) or None,'message':message,'type':str(error.get('type',''))[:60]})
    return details


@app.exception_handler(RequestValidationError)
async def invalid(request:Request,exc:RequestValidationError):
    return JSONResponse(status_code=422,content={'error':{
        'code':'INVALID_INPUT','message':'Input parameters are invalid or outside supported limits',
        'request_id':request.state.request_id,'details':_safe_validation_details(exc)}})


@app.exception_handler(Exception)
async def unexpected(request:Request,exc:Exception):
    log.exception('[%s] Unhandled error',request.state.request_id)
    return fail('INTERNAL_ERROR','Service could not complete this request',500,request.state.request_id)


def _present(path)->bool:
    return bool(path) and path.is_file() and path.stat().st_size>0


def _data_state():
    kernels={p.name:_present(p) for p in KERNELS}
    datasets={name:_present(v['path']) for name,v in DATASETS.items()}
    return {'spice_files_present':all(kernels.values()),'kernels':kernels,'datasets':datasets,
            'note':'Presence is not checksum or kernel-coverage validation'}


@app.get('/health')
async def health():
    info=_data_state()
    info['status']='ready' if info['spice_files_present'] and any(info['datasets'].values()) else 'degraded'
    info['jobs_pending']=sum(job['status'] in ('queued','running') for job in app.state.jobs.values())
    # Additive fields (v1.1): per-layer presence; still NOT scientific validation.
    info['layers']={name:{'dem':_present(d['path']),'err':_present(d.get('err')),
                          'effres':_present(d.get('effres'))} for name,d in DATASETS.items()}
    # v1.3 (additive): clone files per site + precomputed profile sets; legacy string kept.
    from backend.clone_engine import summary_status
    info['clones']=summary_status()
    info['clone_profiles']='AVAILABLE' if info['clones']['precomputed_profile_sets'] else 'NOT_PRECOMPUTED'
    info['limits']={'max_workers':MAX_WORKERS,'max_pending':MAX_PENDING,
                    'analyses_per_minute_per_client':5,'analysis_timeout_s':ANALYSIS_TIMEOUT_S}
    info['scientific_validation']='Reported separately by GET /validation from real test runs only'
    return info


_SITE_FILES={name:{'expected_file':d['path'].name,'expected_folder':'data/'+d['path'].parent.name,
                   'source_page':PGDA_SITE_PAGE if d['kind']=='site' else PGDA_SOUTH_POLE_PAGE,
                   'region_name':SITE_NAMES.get(name)}
             for name,d in DATASETS.items()}
_FOOTPRINTS={}


def _footprint(name):
    """Raster extent from its own georeferencing, cached per file version; None if unavailable."""
    path=DATASETS[name]['path']
    if not path.is_file():
        return None
    st=path.stat()
    key=(name,st.st_size,st.st_mtime_ns)
    if key not in _FOOTPRINTS:
        try:
            from backend.terrain_engine import raster_footprint
            _FOOTPRINTS[key]=raster_footprint(path)
        except Exception:
            log.exception('Footprint unavailable for %s',name)
            _FOOTPRINTS[key]=None
    return _FOOTPRINTS[key]


@app.get('/sites')
async def sites():
    return {'sites':[{'id':name,'resolution_m':d['resolution_m'],'kind':d['kind'],
              'available':d['path'].is_file(),
              'uncertainty_err_available':bool(d.get('err') and d['err'].is_file()),
              'effres_available':bool(d.get('effres') and d['effres'].is_file()),
              **_SITE_FILES[name],
              'footprint':_footprint(name),
              'note':'Raster layer, not an approved landing coordinate'}
              for name,d in DATASETS.items()],
            'site_coordinates':'Choose explicitly; named landmark coordinates are not invented'}


VALIDATION_IDS=('A-04','V-01','V-02','V-03','V-04','V-05','V-06','V-07','V-08','V-09','V-10','SLOPE-01','EFFRES-01','CLONE-01')


@app.get('/validation')
async def validation():
    """Scientific validation status ONLY from saved real runs; otherwise NOT_RUN."""
    report_path=VALIDATION/'report.json'
    tests={tid:{'status':'NOT_RUN','summary':'No recorded run','evidence':None,'run_utc':None}
           for tid in VALIDATION_IDS}
    meta={'source':None,'generated_utc':None}
    if report_path.is_file():
        try:
            saved=json.loads(report_path.read_text(encoding='utf-8'))
            for tid,entry in (saved.get('tests') or {}).items():
                if tid in tests and isinstance(entry,dict) and entry.get('status') in ('PASS','FAIL','NOT_RUN','BLOCKED'):
                    tests[tid]={'status':entry['status'],'summary':str(entry.get('summary',''))[:500],
                                'evidence':entry.get('evidence'),'run_utc':entry.get('run_utc')}
            meta={'source':'data/validation/report.json','generated_utc':saved.get('generated_utc')}
        except (OSError,ValueError):
            meta={'source':'unreadable report','generated_utc':None}
    return {'tests':tests,**meta,
            'note':'PASS covers only the recorded cases; it is not a landing or mission certification'}


async def _limit_client(request:Request):
    # In-memory one-process limiter. For internet/public deployment place a reverse
    # proxy / distributed rate limiter in front and use trusted client IP handling.
    client=request.client.host if request.client else 'unknown'
    now=time.monotonic()
    async with app.state.lock:
        q=app.state.clients[client]
        while q and now-q[0]>=60:
            q.popleft()
        if len(q)>=5:
            raise ApiError('RATE_LIMITED','Maximum five new analyses per minute',429)
        q.append(now)


async def _queue_work(request:Request,fn,*args,parent_id=None,payload=None):
    async with app.state.lock:
        pending=sum(v['status'] in ('queued','running') for v in app.state.jobs.values())
        if pending>=MAX_PENDING:
            raise ApiError('QUEUE_FULL','Analysis queue is at capacity',429)
        if len(app.state.jobs)>150:
            older=sorted((x for x in app.state.jobs if app.state.jobs[x]['status'] not in ('queued','running')),
                          key=lambda x:app.state.jobs[x]['created_mono'])
            for x in older[:len(app.state.jobs)-100]:
                del app.state.jobs[x]
        ident=uuid.uuid4().hex
        app.state.jobs[ident]={'id':ident,'status':'queued','created_mono':time.monotonic(),
                               'result':None,'error':None,'parent_id':parent_id,'payload':payload}
        task=asyncio.create_task(_perform(ident,fn,*args))
        app.state.tasks.add(task)
        task.add_done_callback(app.state.tasks.discard)
    return {'analysis_id':ident,'status':'queued','request_id':request.state.request_id}


async def _perform(ident,fn,*args):
    job=app.state.jobs[ident]
    job['status']='running'
    loop=asyncio.get_running_loop()
    pool=app.state.pool
    try:
        result=await asyncio.wait_for(loop.run_in_executor(pool,fn,*args),timeout=ANALYSIS_TIMEOUT_S)
        job['result']=result
        job['status']='completed' if result.get('status')!='GRAY' else 'partial'
    except asyncio.TimeoutError:
        # A running native computation cannot be cancelled: terminate the pool's
        # processes and recreate it. Other in-flight jobs then fail with WORKER_UNAVAILABLE.
        log.error('Analysis %s exceeded %ss; recycling worker pool',ident,ANALYSIS_TIMEOUT_S)
        job['status']='failed'
        job['error']='ANALYSIS_TIMEOUT'
        _recycle_pool(app,pool)
    except BrokenProcessPool:
        log.exception('Native worker pool broke during analysis %s',ident)
        job['status']='failed'
        job['error']='WORKER_UNAVAILABLE'
        _recycle_pool(app,pool)
    except asyncio.CancelledError:
        job['status']='failed'
        job['error']='CANCELLED'
        raise
    except Exception:
        log.exception('Worker failed: %s',ident)
        job['status']='failed'
        job['error']='CALCULATION_ERROR'


@app.post('/analyses',status_code=202)
async def analyse(body:AnalysisInput,request:Request):
    await _limit_client(request)
    if not _data_state()['spice_files_present']:
        raise ApiError('SPICE_MISSING','Required SPICE files are unavailable',503)
    selected=DATASETS[body.dataset_id]
    if not selected['path'].is_file():
        # user sees explicit unavailable; no fake scientific output
        raise ApiError('DEM_MISSING','Selected NASA terrain file is unavailable',503)
    payload=body.model_dump(mode='json')
    # ISO times from pydantic already offset aware; normalize for all workers
    payload['landing_utc']=utc(body.landing_utc).isoformat().replace('+00:00','Z')
    return await _queue_work(request,_worker_calculate,payload,payload=payload)


def _job_or_404(ident):
    j=app.state.jobs.get(ident)
    if j is None:
        raise ApiError('ANALYSIS_NOT_FOUND','Unknown analysis identifier',404)
    return j


@app.get('/analyses/{analysis_id}')
async def get_analysis(analysis_id:str):
    j=_job_or_404(analysis_id)
    return {k:v for k,v in j.items() if k!='created_mono' and k!='payload'}


@app.get('/analyses/{analysis_id}/horizon')
async def get_horizon(analysis_id:str):
    j=_job_or_404(analysis_id)
    if j.get('result') is None or j['result'].get('horizon') is None:
        raise ApiError('HORIZON_NOT_READY','No computed horizon available',409)
    return j['result']['horizon']


@app.get('/analyses/{analysis_id}/timeline')
async def get_timeline(analysis_id:str):
    j=_job_or_404(analysis_id)
    if j.get('result') is None or 'mission' not in j['result']:
        raise ApiError('TIMELINE_NOT_READY','Timeline has not been calculated',409)
    return {'status':j['result']['status'],'scenarios':[
          {'shift_hours':s['shift_hours'],'start_utc':s['start_utc'],
           'end_utc':s['end_utc'],'timeline':s['timeline']} for s in j['result']['mission']['scenarios']]}


@app.post('/compare')
async def compare(body:CompareInput):
    from backend.decision_engine import pareto_compare
    analyses=[]
    for ident in body.analysis_ids:
        j=_job_or_404(ident)
        if not j.get('result') or 'mission' not in j['result']:
            raise ApiError('ANALYSIS_NOT_READY','Some analyses are missing or not complete',409)
        analyses.append({'id':ident,'result':j['result']['mission']})
    profiles=[j['payload'] for ident in body.analysis_ids for j in [app.state.jobs[ident]]]
    # Scientific apples-to-apples: identical mission/constraints, varying site only.
    canon=lambda p:{k:v for k,v in p.items() if k not in ('latitude','longitude','dataset_id')}
    if any(canon(p)!=canon(profiles[0]) for p in profiles[1:]):
        raise ApiError('INCOMPARABLE','Use identical mission profiles, heights and constraints',422)
    return pareto_compare(analyses,body.priority)


@app.post('/scenarios/shift',status_code=202)
async def shift(body:ShiftInput,request:Request):
    await _limit_client(request)
    parent=_job_or_404(body.analysis_id)
    if not parent.get('result') or not parent['result'].get('horizon'):
        raise ApiError('ANALYSIS_NOT_READY','Parent horizon not available',409)
    payload=parent['payload'].copy()
    end=utc(datetime.fromisoformat(payload['landing_utc'].replace('Z','+00:00')))+timedelta(
        hours=payload['duration_hours']+payload['buffer_hours']+max(body.shifts_hours))
    if end>=datetime(2036,1,1,tzinfo=timezone.utc):
        raise ApiError('INVALID_INPUT','Shift scenario exceeds supported date interval',422)
    count=math.ceil((payload['duration_hours']+payload['buffer_hours'])*60/payload['step_minutes'])+1
    if count*len(set(body.shifts_hours)|{0})>12000:
        raise ApiError('INVALID_INPUT','Shift time-series budget exceeded',422)
    payload['shifts_hours']=body.shifts_hours
    return await _queue_work(request,_worker_shift,parent['result']['horizon'],payload,
                             body.shifts_hours,parent_id=body.analysis_id,payload=payload)
