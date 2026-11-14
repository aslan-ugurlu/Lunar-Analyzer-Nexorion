"""LOD layer selection, ERR-mode layer consistency, raster footprint and catalogue rules.

SYNTHETIC FIXTURE NOTICE: small GeoTIFFs are written to pytest's tmp_path with the Moon
south-polar stereographic CRS. They exercise code paths only; they are not NASA rasters and
no scientific result is derived from them.
"""
import numpy as np
import pytest
import rasterio
from rasterio.transform import from_origin

from backend import download_data as dd
from backend import terrain_engine as te

STEREO = '+proj=stere +lat_0=-90 +lon_0=0 +k=1 +x_0=0 +y_0=0 +a=1737400 +b=1737400 +units=m +no_defs'


def write_tif(path, value, res, half_extent_m, centre=(0.0, 0.0)):
    n = int(2 * half_extent_m / res)
    data = np.full((n, n), value, dtype='float32')
    with rasterio.open(path, 'w', driver='GTiff', width=n, height=n, count=1, dtype='float32', crs=STEREO,
                       transform=from_origin(centre[0] - half_extent_m, centre[1] + half_extent_m, res, res),
                       nodata=np.nan) as ds:
        ds.write(data, 1)
    return path


@pytest.fixture
def layers(tmp_path, monkeypatch):
    dem240 = write_tif(tmp_path / 'dem240.tif', 1000.0, 240, 60000)
    err240 = write_tif(tmp_path / 'err240.tif', 2.0, 240, 60000)
    dem80 = write_tif(tmp_path / 'dem80.tif', 1010.0, 80, 40000)
    catalog = {
        'lola_240m': {'path': dem240, 'resolution_m': 240, 'kind': 'global', 'err': err240, 'effres': None},
        'lola_80m': {'path': dem80, 'resolution_m': 80, 'kind': 'regional', 'err': tmp_path / 'absent_err80.tif', 'effres': None},
    }
    monkeypatch.setattr(te, 'DATASETS', catalog)
    return catalog


def test_lod_prefers_finer_layer_near_observer(layers):
    ctx = te.TerrainContext(0.0, -89.8, 50.0, uncertainty=False)
    try:
        assert set(ctx.sources) == {'lola_240m', 'lola_80m'}
        lon, lat = np.array([0.0]), np.array([-89.8])
        _, _, prov_near = ctx.sample(lon, lat, np.array([10.0]))
        _, _, prov_far = ctx.sample(lon, lat, np.array([100.0]))
        assert prov_near[0] == 'lola_80m'
        assert prov_far[0] == 'lola_240m'
    finally:
        ctx.close()


def test_err_mode_excludes_layers_without_err(layers):
    ctx = te.TerrainContext(0.0, -89.8, 50.0, uncertainty=True)
    try:
        assert set(ctx.sources) == {'lola_240m'}
        assert 'lola_80m' in ctx.excluded and 'ERR' in ctx.excluded['lola_80m']
        h, err, prov = ctx.sample(np.array([0.0]), np.array([-89.8]), np.array([10.0]), with_error=True)
        assert prov[0] == 'lola_240m' and err[0] == pytest.approx(2.0) and h[0] == pytest.approx(1000.0)
    finally:
        ctx.close()


def test_raster_footprint_of_site_tile(tmp_path):
    # 10 km tile centred 30 km from the pole along +y (south-polar stereographic: y = rho*cos(lon) -> lon 0).
    tile = write_tif(tmp_path / 'tile.tif', 1500.0, 5, 5000, centre=(0.0, 30000.0))
    fp = te.raster_footprint(tile)
    assert fp['contains_pole'] is False
    assert fp['width_km'] == pytest.approx(10.0)
    assert fp['center']['lat'] == pytest.approx(-90 + np.degrees(2 * np.arctan(30000 / (2 * 1737400))), abs=1e-3)
    assert abs(fp['center']['lon']) < 1e-6
    assert fp['lat_range'][0] < fp['center']['lat'] < fp['lat_range'][1]


def test_site_raster_validates_without_pole(tmp_path):
    tile = write_tif(tmp_path / 'Site99_final_adj_5mpp_surf.tif', 1500.0, 5, 2000, centre=(0.0, 30000.0))
    meta = dd.validate_lola_geotiff(tile, require_pole=False)
    assert meta['sample_location'] == 'raster_centre'
    assert meta['centre_sample']['min'] == pytest.approx(1500.0)
    with pytest.raises(dd.DownloadError, match='South pole'):
        dd.validate_lola_geotiff(tile, require_pole=True)


def test_catalogue_contains_only_official_pgda_urls():
    for key, (dest, name, url, page) in dd.CATALOG.items():
        assert url.startswith('https://pgda.gsfc.nasa.gov/data/LOLA_'), key
        assert url.endswith('/' + name)
        assert page in (dd.LOLA_PRODUCT_PAGE, dd.SITE_PRODUCT_PAGE)
    assert dd.CATALOG['lola_80m'][2] == 'https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LDEM_80S_80MPP_ADJ.TIF'
    assert dd.CATALOG['site01_5m'][2] == 'https://pgda.gsfc.nasa.gov/data/LOLA_5mpp/Site01/Site01_final_adj_5mpp_surf.tif'
    assert dd.CATALOG['site04_5m_err'][1] == 'Site04_final_adj_5mpp_toterr.tif'


def test_new_cli_flags_map_to_catalogue(monkeypatch):
    called = []
    monkeypatch.setattr(dd, 'download_kernels', lambda: None)
    monkeypatch.setattr(dd, 'download_product', lambda key, **k: called.append(key))
    dd.main(['--include-lola-80m', '--include-site-5m'])
    assert called == ['lola_80m', 'site01_5m', 'site01_5m_err', 'site01_5m_slp', 'site04_5m', 'site04_5m_err', 'site04_5m_slp']
