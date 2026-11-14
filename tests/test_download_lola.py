"""§11.3 `--include-lola-240m` safety tests.

MOCK NOTICE: these tests use a mocked HTTP opener and a tiny SYNTHETIC GeoTIFF
fixture written to pytest's tmp_path. The fixture is NOT a NASA raster, is never
written under data/, and no scientific result is derived from it. The real PGDA
download is verified separately (see PROGRESS.md / data/manifest.json).
"""
import errno
import io
import json
import os
import pathlib
import urllib.error

import numpy as np
import pytest
import rasterio
from rasterio.transform import from_origin

from backend import download_data as dd

MOON_STEREO = ('+proj=stere +lat_0=-90 +lon_0=0 +k=1 +x_0=0 +y_0=0 '
               '+a=1737400 +b=1737400 +units=m +no_defs')


def synthetic_tiff_bytes(tmp_path, crs=MOON_STEREO, value=1500.0) -> bytes:
    path = tmp_path / 'fixture_synthetic.tif'
    data = np.full((20, 20), value, dtype='float32')
    with rasterio.open(path, 'w', driver='GTiff', width=20, height=20, count=1, dtype='float32',
                       crs=crs, transform=from_origin(-2400, 2400, 240, 240), nodata=-9999.0) as ds:
        ds.write(data, 1)
    blob = path.read_bytes()
    path.unlink()
    return blob


class FakeResponse:
    def __init__(self, body: bytes, content_length=None, status=200):
        self._io = io.BytesIO(body)
        self.status = status
        length = len(body) if content_length is None else content_length
        self.headers = {} if length == 'omit' else {'Content-Length': str(length)}

    def read(self, n=-1):
        return self._io.read(n)

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def opener_for(response=None, exc=None):
    calls = []

    def _open(request, timeout=None):
        calls.append(request.full_url)
        if exc is not None:
            raise exc
        return response
    _open.calls = calls
    return _open


def never_called(request, timeout=None):
    raise AssertionError('network must not be used')


def big_disk(_):
    return type('U', (), {'free': 10**12})()


@pytest.fixture
def env(tmp_path):
    dest_dir = tmp_path / 'lola'
    manifest = tmp_path / 'manifest.json'
    manifest.write_text(json.dumps({'files': {'naif0012.tls': {'sha256': 'x'}}}), encoding='utf-8')
    return dest_dir, manifest


def run(env, opener, **kw):
    dest_dir, manifest = env
    return dd.download_lola_240m(dest_dir=dest_dir, manifest_path=manifest, opener=opener,
                                 disk_usage=kw.pop('disk_usage', big_disk), log=lambda *_: None, **kw)


def test_first_install(env, tmp_path):
    body = synthetic_tiff_bytes(tmp_path)
    record = run(env, opener_for(FakeResponse(body)))
    dest_dir, manifest = env
    dest = dest_dir / dd.LOLA_240M_NAME
    assert dest.read_bytes() == body
    assert not (dest_dir / (dd.LOLA_240M_NAME + '.part')).exists()
    assert not (dest_dir / (dd.LOLA_240M_NAME + '.download.lock')).exists()
    assert record['status'] == 'PRESENT_UNVERIFIED'
    assert record['official_sha256_matched'] is False
    assert record['validation']['sphere_radius_m'] == pytest.approx(1737400)
    saved = json.loads(manifest.read_text(encoding='utf-8'))
    assert saved['files']['naif0012.tls']['sha256'] == 'x'  # kernel records preserved
    assert saved['lola'][dd.LOLA_240M_NAME]['sha256_local'] == record['sha256_local']


def test_already_valid_file_skips_network(env, tmp_path):
    dest_dir, _ = env
    dest_dir.mkdir(parents=True)
    (dest_dir / dd.LOLA_240M_NAME).write_bytes(synthetic_tiff_bytes(tmp_path))
    record = run(env, never_called)
    assert record['status'] == 'PRESENT_UNVERIFIED'


def test_existing_invalid_file_not_overwritten(env):
    dest_dir, _ = env
    dest_dir.mkdir(parents=True)
    (dest_dir / dd.LOLA_240M_NAME).write_bytes(b'not a tiff')
    with pytest.raises(dd.DownloadError, match='move it aside'):
        run(env, never_called)
    assert (dest_dir / dd.LOLA_240M_NAME).read_bytes() == b'not a tiff'


def test_orphaned_part_is_discarded_and_download_completes(env, tmp_path):
    dest_dir, _ = env
    dest_dir.mkdir(parents=True)
    (dest_dir / (dd.LOLA_240M_NAME + '.part')).write_bytes(b'half')
    body = synthetic_tiff_bytes(tmp_path)
    run(env, opener_for(FakeResponse(body)))
    assert (dest_dir / dd.LOLA_240M_NAME).read_bytes() == body
    assert not (dest_dir / (dd.LOLA_240M_NAME + '.part')).exists()


def test_active_download_conflict_is_refused(env):
    dest_dir, _ = env
    dest_dir.mkdir(parents=True)
    lock = dest_dir / (dd.LOLA_240M_NAME + '.download.lock')
    lock.write_text(json.dumps({'pid': os.getpid()}), encoding='utf-8')  # alive + fresh
    part = dest_dir / (dd.LOLA_240M_NAME + '.part')
    part.write_bytes(b'in progress')
    with pytest.raises(dd.DownloadError, match='active'):
        run(env, never_called)
    assert part.read_bytes() == b'in progress'  # the active download's data is untouched
    assert lock.exists()


def test_stale_lock_from_dead_process_recovered(env, tmp_path):
    dest_dir, _ = env
    dest_dir.mkdir(parents=True)
    lock = dest_dir / (dd.LOLA_240M_NAME + '.download.lock')
    lock.write_text(json.dumps({'pid': 2**30}), encoding='utf-8')
    run(env, opener_for(FakeResponse(synthetic_tiff_bytes(tmp_path))))
    assert (dest_dir / dd.LOLA_240M_NAME).exists()
    assert not lock.exists()


def test_corrupt_tiff_rejected(env):
    with pytest.raises(dd.DownloadError, match='GeoTIFF'):
        run(env, opener_for(FakeResponse(os.urandom(4096))))
    dest_dir, _ = env
    assert not (dest_dir / dd.LOLA_240M_NAME).exists()
    assert not (dest_dir / (dd.LOLA_240M_NAME + '.part')).exists()


def test_wrong_crs_rejected(env, tmp_path):
    earth = '+proj=stere +lat_0=-90 +lon_0=0 +k=1 +x_0=0 +y_0=0 +ellps=WGS84 +units=m +no_defs'
    with pytest.raises(dd.DownloadError, match='ellipsoid'):
        run(env, opener_for(FakeResponse(synthetic_tiff_bytes(tmp_path, crs=earth))))


def test_wrong_size_rejected(env, tmp_path):
    body = synthetic_tiff_bytes(tmp_path)
    with pytest.raises(dd.DownloadError, match='Size mismatch'):
        run(env, opener_for(FakeResponse(body, content_length=len(body) + 100)))
    dest_dir, _ = env
    assert not (dest_dir / dd.LOLA_240M_NAME).exists()


def test_missing_content_length_refused(env, tmp_path):
    with pytest.raises(dd.DownloadError, match='Content-Length'):
        run(env, opener_for(FakeResponse(synthetic_tiff_bytes(tmp_path), content_length='omit')))


def test_insufficient_disk_precheck(env, tmp_path):
    small = lambda _: type('U', (), {'free': 10})()
    with pytest.raises(dd.DownloadError, match='disk space'):
        run(env, opener_for(FakeResponse(synthetic_tiff_bytes(tmp_path))), disk_usage=small)


def test_disk_full_during_write(env, tmp_path, monkeypatch):
    real_open = pathlib.Path.open

    class Full(io.RawIOBase):
        def writable(self):
            return True

        def write(self, b):
            raise OSError(errno.ENOSPC, 'No space left on device')

    def fake_open(self, mode='r', *a, **k):
        if self.name.endswith('.part') and 'w' in mode:
            return Full()
        return real_open(self, mode, *a, **k)
    monkeypatch.setattr(pathlib.Path, 'open', fake_open)
    with pytest.raises(dd.DownloadError, match='disk space'):
        run(env, opener_for(FakeResponse(synthetic_tiff_bytes(tmp_path))))
    dest_dir, _ = env
    assert not (dest_dir / dd.LOLA_240M_NAME).exists()


def test_http_error(env):
    err = urllib.error.HTTPError(dd.LOLA_240M_URL, 404, 'Not Found', {}, None)
    with pytest.raises(dd.DownloadError, match='HTTP 404'):
        run(env, opener_for(exc=err))


def test_offline(env):
    with pytest.raises(dd.DownloadError, match='Network unavailable'):
        run(env, opener_for(exc=urllib.error.URLError('offline')))
    dest_dir, _ = env
    assert not (dest_dir / (dd.LOLA_240M_NAME + '.download.lock')).exists()


def test_uncatalogued_url_refused_for_real_network(env):
    dest_dir, manifest = env
    with pytest.raises(dd.DownloadError, match='catalogued'):
        dd.download_lola_240m(dest_dir=dest_dir, manifest_path=manifest, url='https://example.com/x.tif')


def test_default_cli_does_not_download_lola(monkeypatch):
    called = []
    monkeypatch.setattr(dd, 'download_kernels', lambda: called.append('kernels'))
    monkeypatch.setattr(dd, 'download_lola_240m', lambda **k: called.append('lola'))
    dd.main([])
    assert called == ['kernels']
    called.clear()
    dd.main(['--include-lola-240m'])
    assert called == ['kernels', 'lola']


def test_pid_alive_is_non_destructive():
    assert dd.pid_alive(os.getpid()) is True
    assert dd.pid_alive(2**30) is False


# ---------------------------------------------------------------- resume (HTTP Range) tests
# MOCK NOTICE: scripted fake HTTP responses; body = synthetic tiny GeoTIFF fixture.

class ScriptedOpener:
    """Returns pre-scripted responses and records the Range header of each request."""

    def __init__(self, responses):
        self.responses = list(responses)
        self.ranges = []

    def __call__(self, request, timeout=None):
        self.ranges.append(request.get_header('Range'))
        item = self.responses.pop(0)
        if isinstance(item, Exception):
            raise item
        return item


class RangeResponse(FakeResponse):
    def __init__(self, body, status, headers):
        super().__init__(body, content_length='omit', status=status)
        self.headers = headers


def test_truncated_transfer_is_resumed_with_range(env, tmp_path):
    body = synthetic_tiff_bytes(tmp_path)
    cut = len(body) // 2
    first = RangeResponse(body[:cut], 200, {'Content-Length': str(len(body)), 'ETag': 'W/"v1"'})
    tail = RangeResponse(body[cut:], 206, {'Content-Range': f'bytes {cut}-{len(body) - 1}/{len(body)}', 'ETag': 'W/"v1"'})
    opener = ScriptedOpener([first, tail])
    record = run(env, opener)
    dest_dir, _ = env
    assert (dest_dir / dd.LOLA_240M_NAME).read_bytes() == body
    assert opener.ranges == [None, f'bytes={cut}-']
    assert record['resumed_transfers'] == 1 and record['attempts'] == 2


def test_resume_refused_when_remote_file_changed(env, tmp_path):
    body = synthetic_tiff_bytes(tmp_path)
    cut = len(body) // 2
    first = RangeResponse(body[:cut], 200, {'Content-Length': str(len(body)), 'ETag': 'W/"v1"'})
    tail = RangeResponse(body[cut:], 206, {'Content-Range': f'bytes {cut}-{len(body) - 1}/{len(body)}', 'ETag': 'W/"v2"'})
    with pytest.raises(dd.DownloadError, match='changed'):
        run(env, ScriptedOpener([first, tail]))
    dest_dir, _ = env
    assert not (dest_dir / dd.LOLA_240M_NAME).exists()
    assert not (dest_dir / (dd.LOLA_240M_NAME + '.part')).exists()


def test_resume_refused_on_inconsistent_content_range(env, tmp_path):
    body = synthetic_tiff_bytes(tmp_path)
    cut = len(body) // 2
    first = RangeResponse(body[:cut], 200, {'Content-Length': str(len(body))})
    wrong = RangeResponse(body[cut:], 206, {'Content-Range': f'bytes 0-{len(body) - 1}/{len(body)}'})
    with pytest.raises(dd.DownloadError, match='does not continue'):
        run(env, ScriptedOpener([first, wrong]))


def test_server_ignoring_range_restarts_cleanly(env, tmp_path):
    body = synthetic_tiff_bytes(tmp_path)
    cut = len(body) // 3
    first = RangeResponse(body[:cut], 200, {'Content-Length': str(len(body))})
    full = RangeResponse(body, 200, {'Content-Length': str(len(body))})
    run(env, ScriptedOpener([first, full]))
    dest_dir, _ = env
    assert (dest_dir / dd.LOLA_240M_NAME).read_bytes() == body


def test_connection_drop_mid_stream_then_resume(env, tmp_path):
    body = synthetic_tiff_bytes(tmp_path)
    cut = len(body) // 2

    class Dropping(RangeResponse):
        def __init__(self):
            super().__init__(body[:cut], 200, {'Content-Length': str(len(body))})
            self.sent = False

        def read(self, n=-1):
            if self.sent:
                raise ConnectionResetError('peer reset')
            self.sent = True
            return body[:cut]

    tail = RangeResponse(body[cut:], 206, {'Content-Range': f'bytes {cut}-{len(body) - 1}/{len(body)}'})
    record = run(env, ScriptedOpener([Dropping(), tail]))
    assert record['resumed_transfers'] == 1


def test_gives_up_after_max_attempts(env, tmp_path):
    body = synthetic_tiff_bytes(tmp_path)
    short = [RangeResponse(body[:10], 200, {'Content-Length': str(len(body))})] + \
        [RangeResponse(b'', 206, {'Content-Range': f'bytes 10-{len(body) - 1}/{len(body)}'}) for _ in range(5)]
    with pytest.raises(dd.DownloadError, match='Size mismatch'):
        dd.download_lola_240m(dest_dir=env[0], manifest_path=env[1], opener=ScriptedOpener(short),
                              disk_usage=big_disk, log=lambda *_: None, max_attempts=3)


def test_manifest_sharing_violation_is_retried_not_reported_as_invalid(tmp_path, monkeypatch):
    """Windows parallel downloads: a transient PermissionError on read/replace must be retried."""
    from backend import download_data as dd
    m = tmp_path / 'manifest.json'
    m.write_text('{"lola": {"a": 1}}', encoding='utf-8')
    real_read = type(m).read_text
    calls = {'read': 0, 'replace': 0}

    def flaky_read(self, *a, **k):
        calls['read'] += 1
        if calls['read'] < 3:
            raise PermissionError(5, 'Access is denied')
        return real_read(self, *a, **k)
    monkeypatch.setattr(type(m), 'read_text', flaky_read)
    monkeypatch.setattr(dd.time, 'sleep', lambda s: None)
    assert dd._read_manifest(m) == {'lola': {'a': 1}}
    real_replace = dd.os.replace

    def flaky_replace(src, dst):
        calls['replace'] += 1
        if calls['replace'] < 3:
            raise PermissionError(5, 'Access is denied')
        return real_replace(src, dst)
    monkeypatch.setattr(dd.os, 'replace', flaky_replace)
    dd._write_manifest(m, {'lola': {'b': 2}})
    assert calls['replace'] == 3
    assert not list(tmp_path.glob('manifest.json.*.part'))
    monkeypatch.setattr(type(m), 'read_text', real_read)
    m.write_text('{not json', encoding='utf-8')
    with pytest.raises(IOError, match='invalid JSON'):
        dd._read_manifest(m)
