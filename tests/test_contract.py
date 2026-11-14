from datetime import datetime, timezone
import math
import pytest
from pydantic import ValidationError
from fastapi.testclient import TestClient
from backend.main import app, AnalysisInput
from backend.terrain_engine import sun_disk_fraction, earth_dte_visible, horizon_at
from backend.verify_horizons import parse_horizons_csv, separation

BASE = dict(dataset_id='lola_240m', latitude=-89.54, longitude=0.0,
            landing_utc='2026-12-01T12:00:00Z', duration_hours=48,
            constraints={'max_darkness_hours': 8})

@pytest.mark.parametrize('change', [
    {'latitude':0}, {'longitude':181}, {'landing_utc':'2099-01-01T00:00:00Z'},
    {'landing_utc':'2026-12-01T12:00:00'}, {'horizon_radius_km':9000},
    {'sun_observer_height_m':-1}, {'duration_hours':900},
    {'shifts_hours':[0,24,24]}, {'unknown_key':42},
])
def test_strict_input(change):
    with pytest.raises(ValidationError):
        AnalysisInput.model_validate({**BASE,**change})

def test_valid_input():
    request=AnalysisInput.model_validate(BASE)
    assert request.landing_utc.utcoffset().total_seconds()==0

def test_angular_separation():
    assert separation(0,0,0,0)==pytest.approx(0,abs=1e-12)
    assert separation(0,0,90,0)==pytest.approx(90,abs=1e-10)

def test_horizons_csv_parser():
    raw='Some metadata\nDate__(UT)__HR:MN, Azi_(a-app), Elev_(a-app)\n$$SOE\n2026-Dec-01 12:00, 12.5, -0.75\n$$EOE\n'
    result=parse_horizons_csv(raw)
    assert result['az_deg']==12.5
    assert result['el_deg']==-0.75

def test_horizons_missing_headers_fail():
    with pytest.raises(ValueError):
        parse_horizons_csv('$$SOE\n1,2,3\n$$EOE')

def test_solar_disk_geometry_without_dem():
    profile=[0.0]*3600  # Mathematical unit test, NOT a NASA DEM or scientific site result.
    assert sun_disk_fraction(180,5,0.25,profile)['fraction']==1.0
    assert sun_disk_fraction(180,-5,0.25,profile)['fraction']==0.0
    assert earth_dte_visible(0,1,profile) is True
    assert earth_dte_visible(0,-1,profile) is False
    assert horizon_at(profile,17)==0.0

def test_health_and_missing_data():
    with TestClient(app) as client:
        health=client.get('/health')
        assert health.status_code==200
        assert 'datasets' in health.json()
        result=client.post('/analyses',json=BASE)
        assert result.status_code in (202,503)
        if result.status_code==503:
            assert result.json()['error']['code'] in ('SPICE_MISSING','DEM_MISSING')
