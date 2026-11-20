"""Windows `spawn` ProcessPoolExecutor lifecycle tests (real child processes).

The worker functions below are trivial test functions (crash / sleep / echo);
they produce no scientific values. Child processes are started with `spawn`,
which re-imports this module and backend.main: that import must not start a
server or a pool.
"""
import os
import time
import types

import pytest
from fastapi.testclient import TestClient

import backend.main as main
from backend.main import app


def worker_ok(tag):
    return {'status': 'TEST_OK', 'tag': tag, 'pid': os.getpid()}


def worker_crash():
    os._exit(3)  # simulates a native SPICE/GDAL crash killing the worker process


def worker_sleep(seconds):
    time.sleep(seconds)
    return {'status': 'TEST_OK'}


FAKE_REQUEST = types.SimpleNamespace(state=types.SimpleNamespace(request_id='test'))


def wait_status(client, ident, wanted, timeout=60):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        body = client.get(f'/analyses/{ident}').json()
        if body['status'] in wanted:
            return body
        time.sleep(0.2)
    raise AssertionError(f'job {ident} did not reach {wanted}: {body}')


def queue(client, fn, *args):
    return client.portal.call(main._queue_work, FAKE_REQUEST, fn, *args)['analysis_id']


def test_import_creates_no_pool():
    # Module import must not create the executor (only lifespan does). Spawned
    # children re-import backend.main, so a top-level pool would recurse.
    src = open(main.__file__, encoding='utf-8').read()
    top_level = [line for line in src.splitlines() if line.startswith('app.state.pool') or
                 (line.startswith(('pool', 'POOL', 'executor')) and 'ProcessPoolExecutor(' in line)]
    assert top_level == []


def test_lifespan_creates_spawn_pool_and_runs_job():
    with TestClient(app) as client:
        pool = app.state.pool
        assert pool._mp_context.get_start_method() == 'spawn'
        assert pool._max_workers == 2
        ident = queue(client, worker_ok, 'a')
        body = wait_status(client, ident, ('completed', 'failed'))
        assert body['status'] == 'completed'
        assert body['result']['pid'] != os.getpid()  # really ran in a child process


def test_broken_worker_is_isolated_and_pool_recreated():
    with TestClient(app) as client:
        first_pool = app.state.pool
        crashed = queue(client, worker_crash)
        body = wait_status(client, crashed, ('completed', 'failed'))
        assert body['status'] == 'failed'
        assert body['error'] == 'WORKER_UNAVAILABLE'
        assert app.state.pool is not first_pool
        # API still healthy and new jobs run on the recreated pool.
        assert client.get('/health').status_code == 200
        ok = queue(client, worker_ok, 'after-crash')
        assert wait_status(client, ok, ('completed', 'failed'))['status'] == 'completed'


def test_timeout_terminates_worker_and_recovers(monkeypatch):
    monkeypatch.setattr(main, 'ANALYSIS_TIMEOUT_S', 2)
    with TestClient(app) as client:
        before = app.state.pool
        slow = queue(client, worker_sleep, 120)
        body = wait_status(client, slow, ('completed', 'failed'), timeout=60)
        assert body['error'] == 'ANALYSIS_TIMEOUT'
        assert app.state.pool is not before
        ok = queue(client, worker_ok, 'after-timeout')
        assert wait_status(client, ok, ('completed', 'failed'))['status'] == 'completed'


def test_shutdown_does_not_wait_for_running_native_work():
    started = time.monotonic()
    with TestClient(app) as client:
        queue(client, worker_sleep, 120)
        time.sleep(1.0)
    assert time.monotonic() - started < 30  # lifespan exit terminated the worker


def test_queue_full_returns_429():
    with TestClient(app) as client:
        for i in range(main.MAX_PENDING):
            app.state.jobs[f'dummy{i}'] = {'id': f'dummy{i}', 'status': 'running', 'created_mono': 0,
                                          'result': None, 'error': None, 'parent_id': None, 'payload': None}
        with pytest.raises(main.ApiError) as err:
            client.portal.call(main._queue_work, FAKE_REQUEST, worker_ok, 'x')
        assert err.value.status == 429 and err.value.code == 'QUEUE_FULL'


def test_rate_limit_five_per_minute(monkeypatch):
    monkeypatch.setattr(main, '_data_state', lambda: {'spice_files_present': False, 'datasets': {}})
    body = dict(dataset_id='lola_240m', latitude=-89.5, longitude=0.0, landing_utc='2026-12-01T12:00:00Z',
                duration_hours=24, constraints={'max_darkness_hours': 8})
    with TestClient(app) as client:
        codes = [client.post('/analyses', json=body).status_code for _ in range(6)]
    assert codes[:5] == [503] * 5
    assert codes[5] == 429
