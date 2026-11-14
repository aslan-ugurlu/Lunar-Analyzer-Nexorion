"""Download public NAIF kernels (and, on request, the LOLA 240 m DEM) with atomic writes.

Run from the project root:
    python -m backend.download_data                      # NAIF kernels only (default)
    python -m backend.download_data --include-lola-240m  # + PGDA LDEM_60S_240MPP_ADJ.TIF

Provenance rules:
- Local SHA-256 is LOCAL provenance only, never a publisher authentication.
- PGDA product 90 publishes no checksum for the LOLA GeoTIFF (checked 2026-11-14),
  so the DEM is validated by HTTP status, Content-Length, and by opening it with
  rasterio (band count, CRS, Moon sphere radius, south polar stereographic origin,
  NoData and a finite elevation sample). Nothing here makes an analysis GREEN.
"""
from __future__ import annotations

import argparse
import hashlib
import http.client
import json
import math
import os
import shutil
import sys
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

from backend.config import DATA, LOLA, SITES, SPICE

URLS = {
    "naif0012.tls": "https://naif.jpl.nasa.gov/pub/naif/generic_kernels/lsk/naif0012.tls",
    "pck00011.tpc": "https://naif.jpl.nasa.gov/pub/naif/generic_kernels/pck/pck00011.tpc",
    "de440s.bsp": "https://naif.jpl.nasa.gov/pub/naif/generic_kernels/spk/planets/de440s.bsp",
    "moon_pa_de440_200625.bpc": "https://naif.jpl.nasa.gov/pub/naif/generic_kernels/pck/moon_pa_de440_200625.bpc",
    "moon_de440_250416.tf": "https://naif.jpl.nasa.gov/pub/naif/generic_kernels/fk/satellites/moon_de440_250416.tf",
}

# Direct file URL listed on the official PGDA product page
# https://pgda.gsfc.nasa.gov/products/90 ("A New View of the Lunar South Pole from LOLA",
# Barker et al. 2023, PSJ 4:183; data DOI 10.60903/gsfcpgda-lola-spole). Verified 2026-11-14.
LOLA_240M_NAME = "LDEM_60S_240MPP_ADJ.TIF"
LOLA_240M_URL = "https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LDEM_60S_240MPP_ADJ.TIF"
# Same product page lists the per-pixel ERR layer (255M) used by uncertainty_mode='err'.
LOLA_240M_ERR_NAME = "LDEM_60S_240MPP_ADJ_ERR.TIF"
LOLA_240M_ERR_URL = "https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LDEM_60S_240MPP_ADJ_ERR.TIF"
LOLA_PRODUCT_PAGE = "https://pgda.gsfc.nasa.gov/products/90"
SITE_PRODUCT_PAGE = "https://pgda.gsfc.nasa.gov/products/78"

# Official PGDA file catalogue (checked 2026-11-14). Only these (name, url) pairs can be
# downloaded from the network; nothing is built from user input.
#  - product 90 (Barker et al. 2023): 80 m regional DEM + ERR, same directory as the 240 m files.
#  - product 78 (Barker et al. 2021, PSS 203:105119): 5 m site DEMs. README: "_surf" = surface height Z
#    in metres with interpolation filling empty pixels, "_toterr" = total Z RMS error (m),
#    "_slp" = official slope map (deg). Site01 = Connecting ridge, Site04 = Shackleton rim.
_P90 = "https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/"
_P78 = "https://pgda.gsfc.nasa.gov/data/LOLA_5mpp/"
CATALOG = {
    'lola_240m': (LOLA, LOLA_240M_NAME, LOLA_240M_URL, LOLA_PRODUCT_PAGE),
    'lola_240m_err': (LOLA, LOLA_240M_ERR_NAME, LOLA_240M_ERR_URL, LOLA_PRODUCT_PAGE),
    'lola_80m': (LOLA, 'LDEM_80S_80MPP_ADJ.TIF', _P90 + 'LDEM_80S_80MPP_ADJ.TIF', LOLA_PRODUCT_PAGE),
    'lola_80m_err': (LOLA, 'LDEM_80S_80MPP_ADJ_ERR.TIF', _P90 + 'LDEM_80S_80MPP_ADJ_ERR.TIF', LOLA_PRODUCT_PAGE),
    # Product 90 page: "*_ADJ_EFFRES.TIF - LDEM effective resolution (in meters)" (checked 2026-11-14).
    'lola_240m_effres': (LOLA, 'LDEM_60S_240MPP_ADJ_EFFRES.TIF', _P90 + 'LDEM_60S_240MPP_ADJ_EFFRES.TIF', LOLA_PRODUCT_PAGE),
    'lola_80m_effres': (LOLA, 'LDEM_80S_80MPP_ADJ_EFFRES.TIF', _P90 + 'LDEM_80S_80MPP_ADJ_EFFRES.TIF', LOLA_PRODUCT_PAGE),
}
# Product 78 site tiles (README: Site07 = Peak near Shackleton, Site11 = de Gerlache rim,
# Site23 = Malapert massif). Site23 is larger (~70.6 MB per file).
SITE_TILES = ('Site01', 'Site04', 'Site07', 'Site11', 'Site23')
for _site in SITE_TILES:
    for _suffix, _kind in (('surf', ''), ('toterr', '_err'), ('slp', '_slp')):
        _name = f'{_site}_final_adj_5mpp_{_suffix}.tif'
        CATALOG[f'{_site.lower()}_5m{_kind}'] = (SITES, _name, f'{_P78}{_site}/{_name}', SITE_PRODUCT_PAGE)
# Product 78 "Clones/: 100 clones of LDEM" (README). Each clone is a full 5 m elevation GeoTIFF on the
# same grid as `_surf` (checked on Site01 clone 0001: clone - surf std 0.44 m). File names end in
# `_err.tif` on the server. Only sites whose listing shows 100 clones are catalogued.
CLONE_SITES = ('Site01', 'Site04', 'Site07', 'Site11')
CLONE_COUNT = 100
CLONES = SITES / 'clones'
for _site in CLONE_SITES:
    for _i in range(1, CLONE_COUNT + 1):
        _name = f'{_site}_final_adj_5mpp_{_i:04d}_err.tif'
        CATALOG[f'{_site.lower()}_clone_{_i:04d}'] = (CLONES / _site, _name, f'{_P78}{_site}/Clones/{_name}', SITE_PRODUCT_PAGE)
_CATALOG_PAIRS = {(name, url) for _, name, url, _ in CATALOG.values()}
MOON_RADIUS_M = 1737400.0
LOCK_STALE_SECONDS = 15 * 60       # a live download refreshes its lock at least every 30 s
DISK_MARGIN_BYTES = 64 * 1024 * 1024


class DownloadError(IOError):
    """User-actionable download/validation failure (no traceback needed)."""


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open('rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def basic_check(path: Path, name: str, content_length: int | None = None) -> None:
    size = path.stat().st_size
    if size == 0 or (content_length is not None and size != content_length):
        raise IOError(f"Invalid file size: {name}, size={size}, expected={content_length}")
    if name.endswith(('.tls', '.tpc', '.tf')):
        with path.open('rb') as file:
            head = file.read(4096)
        if not head.startswith(b'KPL/'):
            raise IOError(f"Invalid SPICE text-kernel header: {name}")
    elif name.endswith(('.bsp', '.bpc')):
        with path.open('rb') as file:
            head = file.read(8)
        if head[:4] not in (b'DAF/',):
            raise IOError(f"Invalid DAF SPICE binary header: {name}")


def atomic_download(url: str, dest: Path) -> None:
    part = dest.with_name(dest.name + '.part')
    part.unlink(missing_ok=True)
    request = urllib.request.Request(url, headers={'User-Agent': 'LunarMissionWindowAnalyzer/1.0'})
    try:
        with urllib.request.urlopen(request, timeout=90) as response:
            if response.status != 200:
                raise IOError(f"HTTP {response.status}")
            length = response.headers.get('Content-Length')
            expected = int(length) if length and length.isdecimal() else None
            with part.open('wb') as out:
                while True:
                    chunk = response.read(512 * 1024)
                    if not chunk:
                        break
                    out.write(chunk)
        basic_check(part, dest.name, expected)
        os.replace(part, dest)
    finally:
        part.unlink(missing_ok=True)


# --------------------------------------------------------------------------- manifest

def _read_manifest(manifest_path: Path) -> dict:
    if not manifest_path.exists():
        return {}
    try:
        return json.loads(manifest_path.read_text(encoding='utf-8'))
    except (ValueError, OSError):
        raise IOError('Existing manifest is invalid; preserve and examine before continuing')


def _write_manifest(manifest_path: Path, manifest: dict) -> None:
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    tmp = manifest_path.with_name(f'{manifest_path.name}.{os.getpid()}.part')  # per-process: parallel downloads
    tmp.write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding='utf-8')
    os.replace(tmp, manifest_path)


# --------------------------------------------------------------------------- process / lock

def pid_alive(pid: int) -> bool:
    """True if a process with this PID currently exists.

    NOTE: never use os.kill(pid, 0) on Windows - it TERMINATES the process.
    """
    if pid <= 0:
        return False
    if os.name == 'nt':
        import ctypes
        from ctypes import wintypes
        kernel32 = ctypes.WinDLL('kernel32', use_last_error=True)
        kernel32.OpenProcess.restype = wintypes.HANDLE
        kernel32.OpenProcess.argtypes = (wintypes.DWORD, wintypes.BOOL, wintypes.DWORD)
        handle = kernel32.OpenProcess(0x1000, False, pid)  # PROCESS_QUERY_LIMITED_INFORMATION
        if not handle:
            return ctypes.get_last_error() == 5  # ACCESS_DENIED -> exists but not ours
        try:
            code = wintypes.DWORD()
            if not kernel32.GetExitCodeProcess(handle, ctypes.byref(code)):
                return True
            return code.value == 259  # STILL_ACTIVE
        finally:
            kernel32.CloseHandle(handle)
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


class DownloadLock:
    """Exclusive O_CREAT|O_EXCL lock with PID + heartbeat; detects orphaned locks."""

    def __init__(self, path: Path, stale_seconds: float = LOCK_STALE_SECONDS):
        self.path = path
        self.stale_seconds = stale_seconds
        self._stop = threading.Event()
        self._thread = None
        self.recovered_stale = False

    def _describe(self) -> dict | None:
        try:
            info = json.loads(self.path.read_text(encoding='utf-8'))
        except (OSError, ValueError):
            info = {}
        try:
            info['age_s'] = time.time() - self.path.stat().st_mtime
        except OSError:
            return None
        return info

    def is_active(self) -> bool:
        info = self._describe()
        if info is None:
            return False
        pid = info.get('pid')
        fresh = info['age_s'] < self.stale_seconds
        return bool(isinstance(pid, int) and pid_alive(pid) and fresh)

    def acquire(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        for _ in range(2):
            try:
                fd = os.open(self.path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            except FileExistsError:
                if self.is_active():
                    info = self._describe() or {}
                    raise DownloadError(
                        f'Another download of this file is active (pid={info.get("pid")}, '
                        f'lock={self.path.name}); not starting a competing download')
                # Orphaned lock from a dead/old session: remove and retry once.
                self.path.unlink(missing_ok=True)
                self.recovered_stale = True
                continue
            with os.fdopen(fd, 'w', encoding='utf-8') as handle:
                json.dump({'pid': os.getpid(), 'started_utc': datetime.now(timezone.utc).isoformat()}, handle)
            self._thread = threading.Thread(target=self._heartbeat, daemon=True)
            self._thread.start()
            return
        raise DownloadError(f'Could not acquire download lock {self.path.name}')

    def _heartbeat(self) -> None:
        while not self._stop.wait(30):
            try:
                os.utime(self.path, None)
            except OSError:
                return

    def release(self) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=2)
        self.path.unlink(missing_ok=True)

    def __enter__(self):
        self.acquire()
        return self

    def __exit__(self, *exc):
        self.release()
        return False


# --------------------------------------------------------------------------- GeoTIFF validation

def validate_lola_geotiff(path: Path, require_pole: bool = True) -> dict:
    """Open with rasterio and check structure/metadata. Raises DownloadError when invalid.

    This is a structural/metadata validation, NOT a scientific accuracy validation.
    """
    try:
        import rasterio
        from pyproj import CRS
    except ImportError as exc:  # pragma: no cover - dependency issue
        raise DownloadError(f'rasterio/pyproj unavailable for validation: {exc}')
    try:
        ds = rasterio.open(path)
    except Exception as exc:
        raise DownloadError(f'Not a readable GeoTIFF: {type(exc).__name__}')
    with ds:
        if ds.driver != 'GTiff':
            raise DownloadError(f'Unexpected raster driver {ds.driver}')
        if ds.count != 1:
            raise DownloadError(f'Expected 1 band, found {ds.count}')
        if ds.crs is None:
            raise DownloadError('GeoTIFF has no CRS')
        crs = CRS.from_wkt(ds.crs.to_wkt())
        ell = crs.ellipsoid
        a, b = ell.semi_major_metre, ell.semi_minor_metre
        if not (abs(a - MOON_RADIUS_M) < 100 and abs(b - MOON_RADIUS_M) < 100):
            raise DownloadError(f'Unexpected ellipsoid a={a}, b={b} (expected 1737.4 km Moon sphere)')
        proj = crs.to_dict() if hasattr(crs, 'to_dict') else {}
        method = (crs.coordinate_operation.method_name if crs.coordinate_operation else '') or ''
        lat_0 = proj.get('lat_0', proj.get('lat_ts'))
        is_south_polar = ('stere' in str(proj.get('proj', '')) or 'Stereographic' in method) and \
            lat_0 is not None and float(lat_0) <= -89.999
        if not is_south_polar:
            raise DownloadError(f'CRS is not south polar stereographic (proj={proj.get("proj")}, lat_0={lat_0})')
        if ds.transform.determinant == 0:
            raise DownloadError('Degenerate affine transform')
        # Read a small window around the south pole (transformed, not assumed at x=y=0);
        # site-scale rasters (PGDA product 78) do not contain the pole -> sample their centre.
        import numpy as np
        from pyproj import Transformer
        from rasterio.windows import Window
        geo = CRS.from_proj4(f'+proj=longlat +a={a} +b={b} +no_defs')
        px, py = Transformer.from_crs(geo, crs, always_xy=True).transform(0.0, -90.0)
        row, col = ds.index(px, py)
        pole_inside = 0 <= row < ds.height and 0 <= col < ds.width
        if not pole_inside:
            if require_pole:
                raise DownloadError('South pole lies outside the raster footprint')
            row, col = ds.height // 2, ds.width // 2
        c0, r0 = max(0, col - 8), max(0, row - 8)
        win = Window(c0, r0, min(16, ds.width - c0), min(16, ds.height - r0))
        sample = ds.read(1, window=win, masked=True).astype('float64').filled(math.nan)
        finite = sample[np.isfinite(sample)]
        if finite.size == 0:
            raise DownloadError('No valid pixels in the validation sample window')
        lo, hi = float(finite.min()), float(finite.max())
        if lo < -20000 or hi > 20000:
            raise DownloadError(f'Sample outside plausible metres/degrees range: {lo}..{hi}')
        sample_info = {'min': lo, 'max': hi, 'n_valid': int(finite.size)}
        return {
            'sample_location': 'south_pole' if pole_inside else 'raster_centre',
            ('south_pole_sample_m' if pole_inside else 'centre_sample'): sample_info,
            'driver': ds.driver, 'dtype': ds.dtypes[0], 'width': ds.width, 'height': ds.height,
            'bands': ds.count, 'nodata': None if ds.nodata is None else float(ds.nodata),
            'crs_wkt_name': crs.name, 'projection_method': method or str(proj.get('proj')),
            'lat_0': float(lat_0), 'lon_0': float(proj.get('lon_0', 0.0)),
            'sphere_radius_m': float(a),
            'pixel_size_m': [float(ds.transform.a), float(ds.transform.e)],
            'bounds_m': [float(v) for v in ds.bounds],
            'area_or_point': ds.tags().get('AREA_OR_POINT'),
            'units_note': 'PGDA product page states LDEM values are surface height in metres; '
                          'reference sphere radius taken from GeoTIFF CRS',
        }


# --------------------------------------------------------------------------- LOLA download

def _content_length(response) -> int | None:
    length = response.headers.get('Content-Length')
    return int(length) if length and length.isdecimal() else None


def download_lola_240m(dest_dir: Path = LOLA, manifest_path: Path = DATA / 'manifest.json',
                       url: str = LOLA_240M_URL, opener=urllib.request.urlopen,
                       disk_usage=shutil.disk_usage, timeout: float = 120,
                       log=print, name: str = LOLA_240M_NAME, max_attempts: int = 4) -> dict:
    """Idempotently stage a PGDA LOLA GeoTIFF (default LDEM_60S_240MPP_ADJ.TIF).

    `name`/`url` are fixed constants from this module (never user input).
    Returns the manifest record.
    """
    if (name, url) not in _CATALOG_PAIRS and opener is urllib.request.urlopen:
        raise DownloadError('Only catalogued PGDA products may be downloaded')
    product_page = next((page for _, n, u, page in CATALOG.values() if (n, u) == (name, url)), LOLA_PRODUCT_PAGE)
    # Site-scale rasters (product 78) do not contain the pole; validate them at their centre.
    require_pole = dest_dir.name != SITES.name and 'Site' not in name
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / name
    part = dest.with_name(dest.name + '.part')
    lock = DownloadLock(dest.with_name(dest.name + '.download.lock'))
    manifest = _read_manifest(manifest_path)
    record: dict = {'path': f'{dest_dir.name}/{name}', 'url': url, 'product_page': product_page,
                    'official_checksum': 'NOT_PUBLISHED_BY_PGDA',
                    'official_sha256_matched': False}

    if dest.exists():
        # Never overwrite an existing file silently; validate it instead.
        try:
            meta = validate_lola_geotiff(dest, require_pole=require_pole)
        except DownloadError as exc:
            raise DownloadError(f'Existing {dest.name} failed validation ({exc}); '
                                f'move it aside explicitly and retry') from None
        log(f'[OK] {dest.name} already present and structurally valid')
        record.update({'bytes': dest.stat().st_size, 'sha256_local': sha256(dest),
                       'status': 'PRESENT_UNVERIFIED', 'validation': meta,
                       'validation_scope': 'rasterio structure/CRS/NoData/sample; not scientific accuracy',
                       'checked_utc': datetime.now(timezone.utc).isoformat()})
        manifest.setdefault('lola', {})[name] = record
        _write_manifest(manifest_path, manifest)
        return record

    with lock:
        if lock.recovered_stale:
            log('[WARN] removed orphaned download lock from an earlier session')
        if part.exists():
            log(f'[WARN] orphaned partial file {part.name} ({part.stat().st_size} bytes) discarded; restarting')
            part.unlink()
        started = time.monotonic()
        expected = None
        etag = None
        attempts = 0
        resumed = 0
        try:
            while True:
                attempts += 1
                have = part.stat().st_size if part.exists() else 0
                headers = {'User-Agent': 'LunarMissionWindowAnalyzer/1.0'}
                if have:
                    headers['Range'] = f'bytes={have}-'
                request = urllib.request.Request(url, headers=headers)
                try:
                    response_cm = opener(request, timeout=timeout)
                except urllib.error.HTTPError as exc:
                    raise DownloadError(f'HTTP {exc.code} from PGDA; download manually from {LOLA_PRODUCT_PAGE}') from None
                except (urllib.error.URLError, TimeoutError, OSError) as exc:
                    if have and attempts < max_attempts:
                        log(f'[WARN] connection failed ({type(exc).__name__}); retrying from byte {have}')
                        continue
                    raise DownloadError(f'Network unavailable ({type(exc).__name__}); retry later or download '
                                        f'manually from {LOLA_PRODUCT_PAGE}') from None
                with response_cm as response:
                    status = getattr(response, 'status', 200)
                    remote_etag = response.headers.get('ETag')
                    if have and status == 206:
                        # Resume only if the server returns exactly the missing tail of the SAME file.
                        crange = response.headers.get('Content-Range', '')
                        try:
                            unit, rest = crange.split(' ', 1)
                            span, total = rest.split('/', 1)
                            first = int(span.split('-', 1)[0])
                            total = int(total)
                        except ValueError:
                            raise DownloadError(f'Malformed Content-Range {crange!r}; refusing to resume') from None
                        if unit != 'bytes' or first != have or total != expected:
                            raise DownloadError(f'Content-Range {crange!r} does not continue byte {have} of {expected}')
                        if etag and remote_etag and remote_etag != etag:
                            raise DownloadError('Remote file changed during download (ETag differs); restart later')
                        mode = 'ab'
                        resumed += 1
                        log(f'[RESUME] {dest.name} from byte {have} (HTTP 206)')
                    elif status == 200:
                        length = _content_length(response)
                        if length is None:
                            raise DownloadError('Server did not report Content-Length; refusing unverifiable download')
                        if expected is None:
                            expected = length
                            etag = remote_etag
                            free = disk_usage(dest_dir).free
                            if free < expected + DISK_MARGIN_BYTES:
                                raise DownloadError(f'Insufficient disk space: need {expected + DISK_MARGIN_BYTES} bytes, '
                                                    f'free {free}')
                            log(f'[DOWNLOAD] {dest.name} ({expected / 1e6:.1f} MB reported by server)')
                        elif length != expected or (etag and remote_etag and remote_etag != etag):
                            raise DownloadError('Remote file changed between attempts; restart later')
                        else:
                            log(f'[RESTART] server ignored Range; downloading {dest.name} from the start')
                        mode = 'wb'
                    else:
                        raise DownloadError(f'HTTP {status} from PGDA')
                    received = part.stat().st_size if (mode == 'ab' and part.exists()) else 0
                    last_report = 0.0
                    stream_error = None
                    with part.open(mode) as out:
                        while True:
                            try:
                                chunk = response.read(1024 * 1024)
                            except (OSError, http.client.HTTPException) as exc:  # connection dropped mid-stream
                                stream_error = exc
                                break
                            if not chunk:
                                break
                            try:
                                out.write(chunk)
                            except OSError as exc:
                                raise DownloadError(f'Write failed ({type(exc).__name__}: {exc.strerror or exc}); '
                                                    f'check free disk space') from None
                            received += len(chunk)
                            now = time.monotonic()
                            if now - last_report > 5:
                                log(f'  {received / 1e6:.1f}/{expected / 1e6:.1f} MB')
                                last_report = now
                size = part.stat().st_size
                if size == expected:
                    break
                if size < expected and attempts < max_attempts:
                    why = type(stream_error).__name__ if stream_error else 'stream ended early'
                    log(f'[WARN] incomplete transfer ({size}/{expected} bytes, {why}); resuming')
                    continue
                raise DownloadError(f'Size mismatch: received {size} bytes, server reported {expected}')
            meta = validate_lola_geotiff(part, require_pole=require_pole)
            os.replace(part, dest)
        finally:
            part.unlink(missing_ok=True)

    record.update({'bytes': dest.stat().st_size, 'content_length': expected,
                   'sha256_local': sha256(dest), 'status': 'PRESENT_UNVERIFIED',
                   'validation': meta,
                   'validation_scope': 'HTTP 200 (+ 206 resume with matching Content-Range/ETag) + Content-Length match + '
                                       'rasterio structure/CRS/NoData/sample; local SHA-256 is NOT publisher authentication',
                   'attempts': attempts, 'resumed_transfers': resumed,
                   'download_seconds': round(time.monotonic() - started, 1),
                   'downloaded_utc': datetime.now(timezone.utc).isoformat()})
    manifest = _read_manifest(manifest_path)  # re-read: never clobber concurrent kernel records
    manifest.setdefault('lola', {})[name] = record
    _write_manifest(manifest_path, manifest)
    log(f'[OK] {dest.name} staged ({record["bytes"]} bytes); local SHA-256 recorded')
    return record


# --------------------------------------------------------------------------- kernels

def download_kernels(manifest_path: Path = DATA / 'manifest.json') -> None:
    SPICE.mkdir(parents=True, exist_ok=True)
    manifest = _read_manifest(manifest_path)
    old = manifest.get('files', {})
    files = {}
    for name, url in URLS.items():
        dest = SPICE / name
        prior = old.get(name, {})
        if dest.exists():
            try:
                basic_check(dest, name)
                digest = sha256(dest)
                if prior.get('sha256') and digest != prior['sha256']:
                    raise IOError('Local file changed since manifest was created')
                print(f'[OK] {name}')
            except (OSError, IOError):
                # Never silently accept a corrupt existing file or overwrite it.
                raise IOError(f'Existing {name} failed integrity; quarantine/remove it explicitly then retry')
        else:
            print(f'[DOWNLOAD] {name}')
            atomic_download(url, dest)
            digest = sha256(dest)
        files[name] = {
            'path': str(dest.relative_to(DATA)), 'url': url,
            'bytes': dest.stat().st_size, 'sha256': digest,
            'validation': 'size/header checked; local SHA-256 recorded',
            'official_sha256_matched': False,  # Not claimed without official checksum
        }
    manifest = _read_manifest(manifest_path)
    manifest['updated_utc'] = datetime.now(timezone.utc).isoformat()
    manifest['files'] = files
    _write_manifest(manifest_path, manifest)
    print('SPICE files staged. SHA-256 is LOCAL provenance, not NASA authentication.')


def download_product(key: str, **kwargs) -> dict:
    """Download one catalogued PGDA file by catalogue key (see CATALOG)."""
    dest_dir, name, url, _ = CATALOG[key]
    return download_lola_240m(dest_dir=kwargs.pop('dest_dir', dest_dir), name=name, url=url, **kwargs)


FLAG_PRODUCTS = {
    'include_lola_240m': ['lola_240m'],
    'include_lola_240m_err': ['lola_240m_err'],
    'include_lola_80m': ['lola_80m'],
    'include_lola_80m_err': ['lola_80m_err'],
    'include_site_5m': ['site01_5m', 'site01_5m_err', 'site01_5m_slp', 'site04_5m', 'site04_5m_err', 'site04_5m_slp'],
    'include_site_5m_extra': [f'{s}_5m{k}' for s in ('site07', 'site11', 'site23') for k in ('', '_err', '_slp')],
    'include_lola_effres': ['lola_240m_effres', 'lola_80m_effres'],
}


def clone_keys(site: str, first: int = 1, last: int = CLONE_COUNT) -> list[str]:
    """Catalogue keys for clones first..last of one site (validated against CLONE_SITES)."""
    if site not in CLONE_SITES:
        raise DownloadError(f'No catalogued clones for {site}; available: {", ".join(CLONE_SITES)}')
    if not 1 <= first <= last <= CLONE_COUNT:
        raise DownloadError(f'Clone range must satisfy 1 <= first <= last <= {CLONE_COUNT}')
    return [f'{site.lower()}_clone_{i:04d}' for i in range(first, last + 1)]


def _clone_range(text: str) -> tuple[int, int]:
    try:
        first, last = (int(v) for v in text.split('-', 1)) if '-' in text else (int(text), int(text))
    except ValueError:
        raise argparse.ArgumentTypeError('use N or N-M, e.g. 1-100') from None
    return first, last


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog='python -m backend.download_data',
                                     description='Stage NAIF kernels and optionally official PGDA LOLA GeoTIFFs.')
    parser.add_argument('--include-lola-240m', action='store_true',
                        help=f'also download {LOLA_240M_NAME} (~219 MB) from {LOLA_PRODUCT_PAGE}')
    parser.add_argument('--include-lola-240m-err', action='store_true',
                        help=f'also download {LOLA_240M_ERR_NAME} (~267 MB; enables ERR sensitivity mode)')
    parser.add_argument('--include-lola-80m', action='store_true',
                        help=f'also download LDEM_80S_80MPP_ADJ.TIF (~189 MB) from {LOLA_PRODUCT_PAGE}')
    parser.add_argument('--include-lola-80m-err', action='store_true',
                        help='also download LDEM_80S_80MPP_ADJ_ERR.TIF (~255 MB; 80 m layer in ERR mode)')
    parser.add_argument('--include-site-5m', action='store_true',
                        help=f'also download Site01 + Site04 5 m surf/toterr/slp GeoTIFFs (6 x ~41 MB) from {SITE_PRODUCT_PAGE}')
    parser.add_argument('--include-site-5m-extra', action='store_true',
                        help='also download Site07, Site11 (~41 MB/file) and Site23 (~71 MB/file) surf/toterr/slp')
    parser.add_argument('--include-lola-effres', action='store_true',
                        help='also download the 240 m (~260 MB) and 80 m (~250 MB) EFFRES effective-resolution maps')
    parser.add_argument('--include-site-clones', nargs='+', choices=CLONE_SITES, metavar='SITE',
                        help=f'also download DEM clones (~41 MB each) for these sites: {", ".join(CLONE_SITES)}')
    parser.add_argument('--clone-range', type=_clone_range, default=(1, CLONE_COUNT),
                        help='clone numbers to download, N or N-M (default 1-100)')
    args = parser.parse_args(argv)
    download_kernels()
    requested = [key for flag, keys in FLAG_PRODUCTS.items() if getattr(args, flag) for key in keys]
    for site in args.include_site_clones or ():
        requested += clone_keys(site, *args.clone_range)
    for key in requested:
        if key == 'lola_240m':
            download_lola_240m()  # default arguments (backwards compatible)
        elif key == 'lola_240m_err':
            download_lola_240m(name=LOLA_240M_ERR_NAME, url=LOLA_240M_ERR_URL)
        else:
            download_product(key)
    if not requested:
        print(f'LOLA GeoTIFFs not requested. Use --include-lola-240m (etc.) or download manually from {LOLA_PRODUCT_PAGE}')


if __name__ == '__main__':
    try:
        main()
    except (DownloadError, IOError) as exc:
        print(f'[ERROR] {exc}', file=sys.stderr)
        sys.exit(1)
