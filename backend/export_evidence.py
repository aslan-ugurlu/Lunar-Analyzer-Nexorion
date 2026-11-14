"""Export committed, data-free validation evidence (Faz 8).

    python -m backend.export_evidence [--out docs/validation]

Writes small JSON files that may be committed (they contain NO NASA raster/kernel bytes):
  * report_<date>.json         copy of data/validation/report.json (the real validation run)
  * data_versions_<date>.json  per-file provenance from data/manifest.json: official URL, product page,
                               byte size, download time, LOCAL SHA-256 (PGDA publishes no checksum, so this
                               is not NASA authentication), plus precomputed clone-profile set identities.
Non-finite numbers are written as null. Nothing here is a NASA approval or certification.
"""
from __future__ import annotations

import argparse
import json
import math
from datetime import datetime, timezone
from pathlib import Path

from backend.config import DATA, VALIDATION
from backend.clone_engine import CLONE_PROFILES


def _clean(value):
    if isinstance(value, float) and not math.isfinite(value):
        return None
    if isinstance(value, dict):
        return {k: _clean(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_clean(v) for v in value]
    return value


def data_versions() -> dict:
    manifest = json.loads((DATA / 'manifest.json').read_text(encoding='utf-8'))
    kernels = [{'file': name, 'bytes': e.get('bytes'), 'url': e.get('url'), 'sha256_local': e.get('sha256')}
               for name, e in sorted(manifest.get('files', {}).items())]
    rasters, clones = [], []
    for name, e in sorted(manifest.get('lola', {}).items()):
        row = {'file': e.get('path', name), 'bytes': e.get('bytes'), 'url': e.get('url'), 'product_page': e.get('product_page'),
               'downloaded_utc': e.get('downloaded_utc'), 'status': e.get('status'), 'sha256_local': e.get('sha256_local'),
               'official_checksum': e.get('official_checksum')}
        (clones if '/Clones/' in (e.get('url') or '') else rasters).append(row)
    sets = []
    if CLONE_PROFILES.is_dir():
        for meta_path in sorted(CLONE_PROFILES.glob('*.json')):
            m = json.loads(meta_path.read_text(encoding='utf-8'))
            sets.append({k: m.get(k) for k in ('key', 'latitude', 'longitude', 'radius_km', 'observer_height_m', 'site_tile',
                                               'cloned_layer', 'n_clones', 'complete_profiles', 'created_utc', 'seconds',
                                               'nominal_layers', 'source')})
    return {'generated_utc': datetime.now(timezone.utc).isoformat(timespec='seconds'),
            'note': 'Local SHA-256 values are provenance only: PGDA publishes no checksums. Presence/structure checks are not '
                    'scientific validation, and nothing here is a NASA approval or certification.',
            'spice_kernels': kernels, 'lola_rasters': rasters,
            'site01_clones': {'count': len(clones), 'total_bytes': sum(c['bytes'] or 0 for c in clones), 'files': clones},
            'clone_profile_sets': sets}


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(prog='python -m backend.export_evidence')
    parser.add_argument('--out', default='docs/validation')
    args = parser.parse_args(argv)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    report = json.loads((VALIDATION / 'report.json').read_text(encoding='utf-8'))
    day = report['generated_utc'][:10]
    (out / f'report_{day}.json').write_text(json.dumps(_clean(report), indent=1, ensure_ascii=False), encoding='utf-8')
    (out / f'data_versions_{day}.json').write_text(json.dumps(_clean(data_versions()), indent=1, ensure_ascii=False),
                                                  encoding='utf-8')
    print(f'wrote {out}/report_{day}.json and {out}/data_versions_{day}.json')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
